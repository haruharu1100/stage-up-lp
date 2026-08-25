/**
 * 仕入候補の入力表（CSV）を書き出す。
 *
 *   npm run phase4:template
 *
 * 出す場所： data/phase4-supplier-template.csv
 *
 * ------------------------------------------------------------------
 * ご本人の指示（原文・§3）：
 *   「最初は MANUAL_SUPPLIER_INPUT / CSV_SUPPLIER_IMPORT で構いません。」
 * ご本人の指示（原文・§4）：
 *   「分からないものはNULL。推測禁止。」
 *
 * ★このコマンドは表の枠を作るだけで、中身は1行も埋めない。
 *   「例として1件入れておく」ことをしないのは、
 *   例の数字がそのまま残って本物の候補に混ざる事故がいちばん多いからである。
 */

import fs from 'node:fs';
import path from 'node:path';
import { SUPPLIER_OFFER_FIELDS, supplierCsvTemplate } from '../lib/phase4/supplier';
import { DATA_DIR } from '../lib/env';

const W = 78;
const hr = (c = '=') => console.log(c.repeat(W));

function main() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const out = path.join(DATA_DIR, 'phase4-supplier-template.csv');

  if (fs.existsSync(out)) {
    // ★すでに書き込んだ表を消さない。書きかけの入力が消えるのがいちばん困る。
    hr();
    console.log('入力表はすでにあります。上書きしませんでした。');
    console.log(`  場所：${out}`);
    console.log('  作り直したい場合は、このファイルを自分で消してからもう一度実行してください。');
    hr();
    return;
  }

  fs.writeFileSync(out, supplierCsvTemplate(), 'utf8');

  hr();
  console.log('仕入候補の入力表を作りました。');
  hr('-');
  console.log(`  場所：${out}`);
  console.log('');
  console.log('  この表に、仕入先で見た商品を1行ずつ書いてください。');
  console.log('  ★分からない欄は空欄のままにしてください。埋めなくて構いません。');
  console.log('  ★ただし次の5つだけは、空欄だと受け取れません：');
  console.log('     仕入先の名前 / 仕入先での商品番号 / 商品名 / 仕入価格 / その値を見た日時');
  console.log('');
  console.log('  項目の意味：');
  for (const f of SUPPLIER_OFFER_FIELDS) {
    console.log(`    ${f.key.padEnd(22)} ${f.labelJa}`);
  }
  console.log('');
  console.log('  書き終えたら次のコマンドで取り込みます：');
  console.log('     npm run phase4:import');
  hr();
}

main();
