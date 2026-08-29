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
  'hp url': 'website',
  hp: 'website',
  url: 'website',
  情報源url: 'website',
  ホームページ: 'website',
  website: 'website',
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
  備考: 'businessDetail',
  メモ: 'businessDetail',
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
    // 業種の列は「その会社が何屋か」の手掛かりなので、営業拒否表記を探す本文にも回す。
    c.pageText = [c.description, c.businessDetail].filter(Boolean).join(' ') || null;
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
