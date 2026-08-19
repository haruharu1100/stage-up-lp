import fs from 'node:fs';
import path from 'node:path';
import { all, migrate } from '../lib/db/client';
import { importMarketData } from '../lib/marketdata';

/**
 * 「あれから何日か経った後の相場」を架空で作る（Phase 3・検証用）。
 *
 * 【なぜ必要か】
 * 答え合わせは「判断した日より後に取った成約データ」が無いと成立しない。
 * 実際に30日待たないと1件も検証できないのでは、仕組みが正しく動くのか確かめようがない。
 *
 * 【これは実データではない】
 * 実在サイトから取ったものではなく、判断済みSHADOWの販売市場について
 * 値上がり／値下がり／売れ行きを作り物で振ったもの。
 * 出力は samples/ に残るので、後から「これは架空」と分かる。
 * 本番運用では、この代わりに正式なデータ提供元のCSVを取り込む。
 */

const arg = (name: string, dflt: string): string => {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.split('=').slice(1).join('=') : dflt;
};

/** 商品ごとに毎回同じ結果になるようにするための、文字列からの数値化。 */
function seedOf(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

async function main() {
  await migrate();
  const days = Number(arg('days', '30'));
  const observedAt = new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

  // 答え合わせの対象になっているSHADOWの販売市場だけを作る。
  // 判断していない市場の「その後」を作っても検証の材料にならない。
  const rows = await all(`
    SELECT DISTINCT s.sell_venue_code AS venue, s.expected_sell_price AS expected,
           sp.brand, sp.model_number, sp.jan, sp.name
      FROM route_shadow_trades s
      JOIN supplier_products sp ON sp.id = s.supplier_product_id
     ORDER BY sp.id`);

  if (rows.length === 0) {
    console.log('SHADOWがまだ1件もありません。先に npm run routes を動かしてください。');
    return;
  }

  const header = '市場,区分,ブランド,型番,JAN,価格,価格の種類,成約件数,出品件数,平均売却日数,価格ばらつき,取得日,取得元';
  const lines: string[] = [header];
  const esc = (v: string) => (/[",\r\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);

  let reached = 0;
  for (const r of rows) {
    const expected = Number(r.expected);
    const key = `${r.venue}|${r.brand}|${r.model_number}|${r.jan}|${days}`;
    const rnd = seedOf(key);

    // 相場は 0.86倍〜1.12倍 の間で動いたことにする。半分弱は予想価格に届かない。
    const ratio = 0.86 + rnd * 0.26;
    const price = Math.round(expected * ratio);
    // 売れるまでの日数も同じ種から振る。5日〜75日。
    const daysToSell = Math.round(5 + seedOf(`d${key}`) * 70);
    const soldCount = 1 + Math.floor(seedOf(`s${key}`) * 20);

    lines.push([
      String(r.venue), 'SELL', String(r.brand ?? ''), String(r.model_number ?? ''), String(r.jan ?? ''),
      String(price), '成約', String(soldCount), String(soldCount * 2),
      String(daysToSell), '0.1', observedAt, 'CSV_MANUAL',
    ].map((v) => esc(String(v))).join(','));
    if (price >= expected) reached++;
  }

  const csv = lines.join('\n') + '\n';
  const out = path.join(process.cwd(), 'samples', `followup_${days}d.csv`);
  fs.writeFileSync(out, csv, 'utf8');
  const res = await importMarketData(csv);

  console.log(`${days}日後の相場（架空）：${rows.length}行 → 取込${res.inserted}件 不備${res.invalid}件`);
  console.log(`  うち予想販売価格に届いたもの ${reached}件 / 届かなかったもの ${rows.length - reached}件`);
  console.log(`  出力：samples/followup_${days}d.csv（架空データ。実在サイトのものではありません）`);
  console.log(`次に  npm run verify -- --days=${days}  で答え合わせできます。`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
