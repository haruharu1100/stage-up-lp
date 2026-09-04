// 90日相場・値崩れ判定の単体テスト
// 実行: node --test scripts/test-price-risk.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractKeepaMetrics,
  computePriceRisk,
  analyzePrice,
  computeConservativeSalePrice,
} from "../lib/price-risk.mjs";

// Keepa stats を模したダミー（index: 0=Amazon本体,1=新品,2=中古,3=rank,18=BuyBox,11=出品者数）
function mkProduct({ cur = [], avg30 = [], avg90 = [], drops = null, offerNew = null } = {}) {
  return { stats: { current: cur, avg30, avg90, salesRankDrops30: drops, offerCountNew: offerNew } };
}

test("欠損が多い（相場データ無し）→ usable=false / 危険側に寄る", () => {
  const p = mkProduct({ cur: [-1, 5000, -1, 1000] }); // 現在新品のみ
  const { risk } = analyzePrice(p);
  assert.equal(risk.usable, false);
  assert.ok(risk.missing.includes("avg90"));
});

test("平均近辺・出品者少・よく売れる → 低リスク", () => {
  const p = mkProduct({
    cur: [-1, 5000, -1, 1000, /*...*/],
    avg30: [-1, 5000],
    avg90: [-1, 5000],
    drops: 50,
    offerNew: 3,
  });
  const m = extractKeepaMetrics(p);
  m.newOfferCount = 3; // offerCountNew 経由
  const risk = computePriceRisk(m);
  assert.equal(risk.level, "low");
  assert.ok(risk.score < 40);
});

test("現在価格が90日平均を大きく上回る → 高値づかみでリスク上昇", () => {
  const p = mkProduct({
    cur: [-1, 7000],
    avg30: [-1, 6000],
    avg90: [-1, 5000], // 現在7000は+40%
    drops: 2, // ほとんど売れない
    offerNew: 20, // 出品者多い
  });
  const m = extractKeepaMetrics(p);
  m.newOfferCount = 20;
  const risk = computePriceRisk(m);
  assert.equal(risk.level, "high");
  assert.ok(risk.score >= 70);
  assert.equal(risk.factors.pricePosition.diffPct > 0, true);
});

test("しきい値は設定で上書きできる（ハードコードでない）", () => {
  const p = mkProduct({ cur: [-1, 5300], avg30: [-1, 5000], avg90: [-1, 5000], drops: 50, offerNew: 3 });
  const m = extractKeepaMetrics(p);
  m.newOfferCount = 3;
  // +6% を「高リスク扱い」にする厳しめ設定
  const strict = computePriceRisk(m, { aboveAvgHighPct: 0.05 });
  const loose = computePriceRisk(m, { aboveAvgHighPct: 0.5 });
  assert.ok(strict.score > loose.score);
});

test("取得不可の値は null のまま（でっち上げない）", () => {
  const p = mkProduct({ cur: [-1, 5000] });
  const m = extractKeepaMetrics(p);
  assert.equal(m.avg90New, null);
  assert.equal(m.monthlySales, null);
  assert.equal(m.newOfferCount, null);
});

// ── 保守的販売想定価格（conservativeSalePrice）: 第4フェーズ実測仕様 ──

// ⑨-1: Amazon本体15000 / Marketplace New11000 / avg30=10500 → 10500（低い方）
test("conservativeSalePrice: 本体高くてもMarketplace Newと30日平均の低い方", () => {
  assert.equal(computeConservativeSalePrice(11000, 10500), 10500);
  // metrics 経由でも同じ（current[0]=15000 は無視される）
  const p = mkProduct({ cur: [15000, 11000], avg30: [-1, 10500], avg90: [-1, 10800] });
  const m = extractKeepaMetrics(p);
  assert.equal(m.marketNewPrice, 11000);
  assert.equal(m.conservativeSalePrice, 10500);
});

// ⑨-2: Marketplace New11000 / avg30欠損 → 11000
test("conservativeSalePrice: avg30欠損なら現在Marketplace New価格", () => {
  assert.equal(computeConservativeSalePrice(11000, null), 11000);
  const p = mkProduct({ cur: [-1, 11000] });
  assert.equal(extractKeepaMetrics(p).conservativeSalePrice, 11000);
});

// ⑨-3: Amazon本体のみ / Marketplace New欠損 → null（自動仕入れ不可）
test("conservativeSalePrice: Marketplace New欠損なら null（自動仕入れ対象外）", () => {
  assert.equal(computeConservativeSalePrice(null, 12000), null);
  const p = mkProduct({ cur: [15000, -1] }); // 本体のみ・新品最安なし
  const m = extractKeepaMetrics(p);
  assert.equal(m.marketNewPrice, null);
  assert.equal(m.amazonPrice, 15000);
  assert.equal(m.conservativeSalePrice, null);
});

// ⑨-4: current[0]（Amazon本体）が高くても利益基準価格には使わない
test("conservativeSalePrice: Amazon本体価格を保守価格に混ぜない", () => {
  const p = mkProduct({ cur: [99999, 8000], avg30: [-1, 8200] });
  const m = extractKeepaMetrics(p);
  assert.equal(m.conservativeSalePrice, 8000); // 99999 は無視
  assert.notEqual(m.conservativeSalePrice, 99999);
});

// ⑨-5: avg90（stats=30でも取得できる実測値）をリスク計算へ反映
test("avg90をリスク計算に利用（現在価格が90日平均を大きく上回る→高リスク）", () => {
  const p = mkProduct({
    cur: [-1, 9000], // 現在9000
    avg30: [-1, 7000],
    avg90: [-1, 6000], // 90日平均6000＝+50%
    drops: 2,
    offerNew: 20,
  });
  const m = extractKeepaMetrics(p);
  m.newOfferCount = 20;
  assert.equal(m.avg90New, 6000); // avg90は取得できている
  const risk = computePriceRisk(m);
  assert.ok(risk.factors.pricePosition.diffPct > 0);
  assert.equal(risk.level, "high");
});

// salesActivity30 は monthlySales(legacy) と同値（実売数ではない）
test("salesActivity30: legacy monthlySales と同値", () => {
  const p = mkProduct({ cur: [-1, 5000], drops: 27 });
  const m = extractKeepaMetrics(p);
  assert.equal(m.salesActivity30, 27);
  assert.equal(m.monthlySales, 27);
});
