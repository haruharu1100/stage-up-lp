/**
 * 仕入候補の入力表（CSV）を取り込む。
 *
 *   npm run phase4:import                       … data/phase4-supplier-template.csv を読む
 *   npm run phase4:import -- 別のファイル.csv    … 場所を指定する
 *   npm run phase4:import -- --sample           … 見本として入れる（本物の候補に混ぜない）
 *
 * ------------------------------------------------------------------
 * 【このコマンドがしないこと】
 *
 *   ・仕入先のサイトを見に行かない（通信しない）。読むのは手元のCSVだけ。
 *   ・空欄を埋めない。分からない欄は空欄のまま保存する（§4）。
 *   ・URLを組み立てない（§5）。
 *   ・Keepaの枠を1つも使わない。
 *
 * ご本人の指示（原文・§21）：「いきなり100商品を入れないでください。」
 * → 10件を超える行は、ここで止める。
 */

import fs from 'node:fs';
import path from 'node:path';
import { migrate } from '../lib/db/client';
import { countSupplierOffers, saveSupplierOffer } from '../lib/phase4/store';
import { PHASE4_SUPPLIER_OFFER_LIMIT, supplierCsvHeader } from '../lib/phase4/supplier';
import { DATA_DIR } from '../lib/env';

const W = 78;
const hr = (c = '=') => console.log(c.repeat(W));

/**
 * CSVを1行ずつに分ける。引用符の中の改行とカンマを守る。
 * ★自前で書いているのは、商品名に「,」が入るのが当たり前だからである。
 *   単純に split(',') すると、商品名の途中で列がずれ、
 *   仕入価格の欄に商品名の後半が入る、という壊れ方をする。
 */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else { inQuotes = false; }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"') { inQuotes = true; continue; }
    if (ch === ',') { row.push(field); field = ''; continue; }
    if (ch === '\r') continue;
    if (ch === '\n') { row.push(field); rows.push(row); row = []; field = ''; continue; }
    field += ch;
  }
  if (field !== '' || row.length > 0) { row.push(field); rows.push(row); }
  return rows;
}

async function main() {
  const argv = process.argv.slice(2);
  const isSample = argv.includes('--sample');
  const fileArg = argv.find((a) => !a.startsWith('--'));
  const file = fileArg
    ? path.resolve(fileArg)
    : path.join(DATA_DIR, 'phase4-supplier-template.csv');

  hr();
  console.log('仕入候補の取り込み');
  hr('-');

  if (!fs.existsSync(file)) {
    console.log('入力表が見つかりませんでした。');
    console.log(`  探した場所：${file}`);
    console.log('  先に次のコマンドで表を作ってください： npm run phase4:template');
    hr();
    process.exit(1);
  }

  await migrate();

  const text = fs.readFileSync(file, 'utf8');
  const rows = parseCsv(text)
    // 「#」で始まる行は説明書き。空行も飛ばす。
    .filter((r) => r.length > 0 && !(r[0] ?? '').trim().startsWith('#'))
    .filter((r) => r.some((c) => (c ?? '').trim() !== ''));

  if (rows.length === 0) {
    console.log('中身が1行もありませんでした。表に商品を書いてからもう一度実行してください。');
    hr();
    return;
  }

  const header = rows[0].map((h) => h.trim());
  const expected = supplierCsvHeader().split(',');
  const missing = expected.filter((e) => !header.includes(e));
  if (missing.length > 0) {
    // ★列が足りないまま進めない。足りない列を「空欄」として通すと、
    //   入れ忘れたのか、本当に無いのかが区別できなくなる。
    console.log('入力表の見出し行が合っていません。取り込みを止めました。');
    console.log(`  足りない列：${missing.join(' / ')}`);
    console.log('  npm run phase4:template で作った表の見出し行をそのまま使ってください。');
    hr();
    process.exit(1);
  }

  const body = rows.slice(1);
  const before = await countSupplierOffers();
  const room = PHASE4_SUPPLIER_OFFER_LIMIT - before;

  console.log(`  読み込んだ行数：${body.length}行`);
  console.log(`  すでに入っている件数：${before}件（上限 ${PHASE4_SUPPLIER_OFFER_LIMIT}件）`);
  if (isSample) console.log('  ★見本として取り込みます（買う候補には数えません）。');
  console.log('');

  if (room <= 0) {
    console.log('もう上限に達しているので、1件も取り込みませんでした。');
    console.log('  まず npm run phase4:route で結果を見て、どこで落ちるかを確かめてください。');
    hr();
    return;
  }
  if (body.length > room) {
    console.log(`★入る余地は残り ${room}件です。先頭 ${room}行だけを取り込み、残りは取り込みません。`);
    console.log('  10件で一度確かめてから増やす、という決まりのためです。');
    console.log('');
  }

  let saved = 0;
  let skipped = 0;

  for (const [index, cells] of body.slice(0, room).entries()) {
    const raw: Record<string, unknown> = {};
    header.forEach((key, i) => { raw[key] = cells[i] ?? ''; });

    const result = await saveSupplierOffer(raw, isSample ? 'MANUAL_SUPPLIER_INPUT' : 'CSV_SUPPLIER_IMPORT', { isSample });
    const label = String(raw.product_name ?? '（商品名なし）').slice(0, 24);

    if (result.saved) {
      saved += 1;
      console.log(`  ○ ${String(index + 1).padStart(2)}行目  ${label}`);
      for (const issue of result.issuesJa) console.log(`       ・${issue}`);
    } else {
      skipped += 1;
      console.log(`  × ${String(index + 1).padStart(2)}行目  ${label}`);
      console.log(`       ${result.messageJa}`);
    }
  }

  const after = await countSupplierOffers();

  console.log('');
  hr('-');
  console.log(`取り込めた：${saved}件 ／ 取り込めなかった：${skipped}件`);
  console.log(`いま入っている件数：${after}件`);
  if (skipped > 0) {
    console.log('');
    console.log('★取り込めなかった行は、必須の欄が空欄だったものです。');
    console.log('  空欄を推測で埋めることはしません。表を直してから、もう一度実行してください。');
  }
  console.log('');
  console.log('次のコマンドで、Amazon側とつないだ結果を出します（Keepaの枠は使いません）：');
  console.log('   npm run phase4:route');
  hr();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
