// 90日相場・値崩れ判定の単体テスト
// 実行: node --test scripts/test-price-risk.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractKeepaMetrics,
  computePriceRisk,
  analyzePrice,
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
