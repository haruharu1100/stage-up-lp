import fs from 'node:fs';
import path from 'node:path';
import { migrate } from '../lib/db/client';
import { initSettings } from '../lib/settings';
import { ingestCompany, type CompanyInput, type CompanySource } from '../lib/sales/ingest';

/**
 * CSVから会社を取り込む。
 *
 * 列の名前は日本語でも英語でも読む。分からない列は捨てる（推測で埋めない）。
 * すでにこのリポジトリにある営業リスト（automation_500_existing.csv など）を
 * そのまま渡せるようにしてある。新しく集め直す必要はない。
 *
 * 使い方: npm run companies:import -- <CSVのパス> [--source EXISTING_LIST]
 */

const HEADER_MAP: Record<string, keyof CompanyInput> = {
  会社名: 'name',
  企業名: 'name',
  name: 'name',
  法人番号: 'corporateNumber',
  住所: 'address',
  所在地: 'address',
  address: 'address',
  // ★ここに入るURLは「候補」であって「確認済みのHP」ではない。
  //   CSVの列名がどうであれ、人が中身を照合したわけではない。
  //   確認済みの欄に入れてしまうと、別会社のページを根拠に営業文を書くことになる。
  //   （実際、既存リストの「情報源URL」には kensetumap.com のような
  //     その会社が書いたのではない紹介サイトが混ざっている）
  'hp url': 'websiteCandidate',
  hp: 'websiteCandidate',
  url: 'websiteCandidate',
  情報源url: 'websiteCandidate',
  ホームページ: 'websiteCandidate',
  website: 'websiteCandidate',
  電話番号: 'phone',
  電話: 'phone',
  tel: 'phone',
  phone: 'phone',
  メール: 'email',
  メールアドレス: 'email',
  email: 'email',
  問い合わせフォーム: 'contactFormUrl',
  フォームurl: 'contactFormUrl',
  代表者: 'representative',
  代表者名: 'representative',
  設立日: 'establishedOn',
  設立: 'establishedOn',
  業種: 'description',
  業種予測: 'description',
  事業内容: 'businessDetail',
  // ★「備考」「メモ」は相手が書いた文章ではなく、こちらの営業記録。
  //   実際の中身は「2026-07-28 人が応答/手応えC/取次で終了」のような架電メモだった。
  //   これを事業内容として入れると、営業文が自分の営業メモを相手に読み上げる形になる。
  //   なので相手の情報としては扱わず、内部メモの欄へ入れる。営業文には出さない。
  備考: 'internalNote',
  メモ: 'internalNote',
  担当者: 'internalNote',
};

/** ダブルクォート対応の最小限のCSV読み。 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

async function main() {
  const file = process.argv[2];
  const sourceArg = process.argv.includes('--source') ? process.argv[process.argv.indexOf('--source') + 1] : 'CSV';
  // ★何件まで入れるか。既存リストは数千件あるので、検証では区切って入れる。
  const limit = process.argv.includes('--limit')
    ? Number(process.argv[process.argv.indexOf('--limit') + 1])
    : Number.MAX_SAFE_INTEGER;
  // ★URLを持っている行だけを入れる。HPの照合を実際に動かして確かめたいときに使う。
  const onlyWithUrl = process.argv.includes('--only-with-url');
  if (!file) {
    console.log('CSVのパスを渡してください。例: npm run companies:import -- ../automation_500_existing.csv');
    process.exit(1);
  }
  const abs = path.isAbsolute(file) ? file : path.join(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.log(`ファイルが見つかりません: ${abs}`);
    process.exit(1);
  }

  await migrate();
  await initSettings();

  const rows = parseCsv(fs.readFileSync(abs, 'utf8'));
  const header = rows[0].map((h) => h.trim().toLowerCase());
  const cols = header.map((h) => HEADER_MAP[h] ?? HEADER_MAP[h.replace(/\s/g, '')] ?? null);
  const unknown = header.filter((_, i) => cols[i] === null);

  if (!cols.includes('name')) {
    console.log('会社名の列が見つかりません。列名に「会社名」または「name」を入れてください。');
    console.log(`読めた列: ${header.join(' / ')}`);
    process.exit(1);
  }

  let inserted = 0;
  let duplicate = 0;
  let rejected = 0;
  const warnings: string[] = [];

  for (const r of rows.slice(1)) {
    const c: Partial<CompanyInput> = { source: sourceArg as CompanySource, sourceUrl: abs };
    cols.forEach((key, i) => {
      if (!key) return;
      const v = (r[i] ?? '').trim();
      if (v === '') return;
      (c as Record<string, unknown>)[key] = v;
    });
    if (!c.name) continue;
    if (onlyWithUrl && !c.websiteCandidate) continue;
    if (inserted >= limit) break;
    // 業種の列は「その会社が何屋か」の手掛かりなので、営業拒否表記を探す本文にも回す。
    // ★内部メモも「営業お断り」と書かれていることがあるので、拒否表記を探す対象には入れる。
    //   （探すだけで、営業文には使わない）
    c.pageText = [c.description, c.businessDetail, c.internalNote].filter(Boolean).join(' ') || null;
    // ★CSVから来た事業内容は「その会社のHPから取った文章」ではない。出どころを必ず残す。
    if (c.businessDetail) c.businessDetailSource = 'MANUAL';
    // ★このCSVは「自分が持っているリスト」。取得元は人の手なので MANUAL と記録する。
    //   どこから来た電話番号か言えないまま営業に使わないため。
    if (c.phone) c.phoneSource = 'MANUAL';
    if (c.email) c.emailSource = 'MANUAL';
    if (c.websiteCandidate) c.websiteSource = 'MANUAL';
    const res = await ingestCompany(c as CompanyInput);
    if (res.status === 'INSERTED') inserted++;
    else if (res.status === 'DUPLICATE') duplicate++;
    else rejected++;
    for (const w of res.warnings) warnings.push(`${c.name}: ${w}`);
  }

  console.log(`読み込み: ${path.basename(abs)}`);
  if (unknown.length > 0) console.log(`  使わなかった列: ${unknown.join(' / ')}`);
  console.log(`  新規登録: ${inserted}件 / 既に居た: ${duplicate}件 / 受け付けなかった: ${rejected}件`);
  if (warnings.length > 0) {
    console.log(`  取り込み時の注意: ${warnings.length}件（先頭10件）`);
    for (const w of warnings.slice(0, 10)) console.log(`   ・${w}`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
