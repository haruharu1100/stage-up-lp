/**
 * 仕入候補を「仕入価格 → Amazon販売」まで一本につないで結果を出す。
 *
 *   npm run phase4:route            … 計算して表示するだけ（保存しない）
 *   npm run phase4:route -- --save  … 計算結果を凍結して保存する
 *
 * ------------------------------------------------------------------
 * 【Keepaの枠を使わない】
 *
 * ここでやるのは、すでに保存してあるAmazon側データとの突き合わせだけである。
 * 新しく取りに行かないので、何度実行しても枠は1つも減らない。
 * Amazon側を増やしたいときは、別のコマンド（keepa:*）で明示的に取りに行く。
 *
 * ご本人の指示（原文・§29）：
 *   10商品を入れたら、商品名／仕入先／仕入価格／Amazon想定販売価格／
 *   Amazon需要／保守純利益／保守ROI／判定 を表示できること。
 */

import { migrate } from '../lib/db/client';
import { DROP_REASON_ACTION_JA, checkFunnelBeforeScaling, computeKpis, rankDropReasons } from '../lib/phase4/funnel';
import { formatPriceWatch } from '../lib/phase4/route';
import { runAllOfferRoutes } from '../lib/phase4/store';
import { PHASE4_REAL_LISTING_IMPLEMENTED, PHASE4_REAL_PURCHASE_IMPLEMENTED } from '../lib/phase4/supplier';

const W = 78;
const hr = (c = '=') => console.log(c.repeat(W));

/** 全角を2文字ぶんとして数えて列をそろえる。padEnd だけだとずれる。 */
function pad(text: string, width: number): string {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) < 128 ? 1 : 2;
  return text + ' '.repeat(Math.max(1, width - w));
}

function yen(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${v.toLocaleString()}円`;
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

const DECISION_JA: Record<string, string> = {
  BUY: '買ってよい',
  WATCH: '価格を見張る',
  REVIEW: '人が確認',
  SKIP: '見送り',
};

async function main() {
  const save = process.argv.slice(2).includes('--save');

  await migrate();

  hr();
  console.log('仕入価格 → Amazon販売  ルート検証');
  hr('-');
  console.log('  ★Keepaへは通信しません。保存済みのAmazon側データだけで計算します（枠は減りません）。');
  console.log(save ? '  ★計算結果を保存します（あとから見返せます）。' : '  ★今回は表示するだけで、保存しません。');
  console.log('');

  const { results, funnel } = await runAllOfferRoutes({ save });

  if (results.length === 0) {
    console.log('仕入候補がまだ1件も入っていません。');
    console.log('   npm run phase4:template  → 表を作る');
    console.log('   npm run phase4:import    → 表を取り込む');
    hr();
    return;
  }

  /* ---------- 1件ずつの結果（§29の8項目） ---------- */

  hr('-');
  console.log('■ 1件ずつの結果');
  hr('-');

  for (const r of results) {
    const o = r.offer;
    console.log('');
    console.log(`【${o.productName}】${o.isSample ? '  ※見本データ' : ''}`);
    console.log(`  仕入先          ${o.supplierName}`);
    console.log(`  仕入価格        ${yen(o.purchasePrice)}${o.shippingCostToUs === null ? '（送料は不明）' : `（＋送料 ${yen(o.shippingCostToUs)}）`}`);
    console.log(`  Amazon商品      ${r.asin ?? '見つかりませんでした'}  照合の確からしさ：${r.matchScore ?? '—'}点／候補${r.candidateCount}件`);
    console.log(`  想定販売価格    ${yen(r.sellPrice?.conservativeSellPrice)}（保守）／${yen(r.sellPrice?.rawExpectedSellPrice)}（そのまま）`);

    // ★「◯個以上」を、ぴったりの数として書かない（ルール115）。
    const sold = r.keepa.monthlySoldAtLeast;
    console.log(`  Amazonの需要    30日の値下がり回数 ${r.keepa.rankDrops30 ?? '—'}回${sold === null ? '' : ` ／ Keepa表示「月${sold}個以上」`}`);
    console.log(`  保守の純利益    ${yen(r.profit?.conservativeNetProfit)}   保守のROI ${pct(r.profit?.conservativeRoi)}`);

    const watch = formatPriceWatch(o.purchasePrice, r.profit?.maxBuyPrice ?? null);
    console.log(`  買ってよい上限  ${watch.maxBuyPriceJa}  →  ${watch.gapJa}`);
    console.log(`  判定            ${DECISION_JA[r.decision.decision] ?? r.decision.decision}（${r.decision.decision}）`);
    console.log(`  仕入先ページ    ${r.canOpenSupplierPage ? '開けます' : `開けません（${r.supplierUrlReasonJa}）`}`);
    console.log(`  理由            ${r.reasonJa}`);
  }

  /* ---------- ファネル（§22） ---------- */

  console.log('');
  hr('-');
  console.log('■ どこまで進んで、どこで落ちたか');
  hr('-');
  const c = funnel.counts;
  const steps: [string, number][] = [
    ['仕入候補として入れた', c.SUPPLIER_OFFERS],
    ['Amazon側に候補が見つかった', c.ASIN_CANDIDATES],
    ['同じ商品だと言い切れた', c.HIGH_MATCH],
    ['Amazonの売れ行きまで見えた', c.AMAZON_DATA],
    ['利益が計算できた', c.PROFIT_CALCULABLE],
    ['買う候補として残った', c.BUY_OR_WATCH],
  ];
  for (const [label, n] of steps) console.log(`  ${pad(label, 30)}${String(n).padStart(3)}件`);
  if (funnel.excludedSamples > 0) {
    console.log('');
    console.log(`  ※見本データ ${funnel.excludedSamples}件は、上の数から外しています。`);
  }

  /* ---------- 落ちた理由（§23） ---------- */

  const drops = rankDropReasons(funnel.drops);
  if (drops.length > 0) {
    console.log('');
    hr('-');
    console.log('■ 落ちた理由と、次にやること');
    hr('-');
    for (const d of drops) {
      console.log(`  ${String(d.count).padStart(2)}件  ${d.labelJa}`);
      console.log(`        → ${DROP_REASON_ACTION_JA[d.reason]}`);
    }
  }

  /* ---------- 4つのKPI（§24） ---------- */

  console.log('');
  hr('-');
  console.log('■ 4つの数字');
  hr('-');
  for (const k of computeKpis(c)) {
    console.log(`  ${k.labelJa}`);
    console.log(`      ${k.displayJa}`);
  }

  /* ---------- 件数を増やす前に止まる（§21） ---------- */

  const gate = checkFunnelBeforeScaling(c);
  console.log('');
  hr('-');
  console.log('■ 件数を増やしてよいか');
  hr('-');
  console.log(`  ${gate.shouldStop ? '★ここで一度止まります。' : '（まだ判断できません）'}`);
  console.log(`  ${gate.reasonJa}`);

  console.log('');
  hr('-');
  console.log('■ まだやらないこと');
  hr('-');
  console.log(`  実際の購入：${PHASE4_REAL_PURCHASE_IMPLEMENTED ? '実装あり' : '実装していません（人が買います）'}`);
  console.log(`  実際の出品：${PHASE4_REAL_LISTING_IMPLEMENTED ? '実装あり' : '実装していません'}`);
  console.log('  このコマンドがするのは、判断の材料を出すところまでです。');
  hr();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
