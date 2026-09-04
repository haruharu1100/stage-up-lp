// =====================================================================
// Keepa手数料の取り込みテスト（keepaFeesFrom / 利益計算への反映）
//  ・目的：SP-API無しでも、Keepaが返す「カテゴリ別の販売手数料率」と
//    「FBA配送代行手数料(pickAndPackFee)」を使い、一律10%・450円より
//    精度の高い“推定”手数料で利益を出せることを検証する。
//  ・合成データではなく、実際にKeepaから取得して保存した実レスポンス
//    （$HOME/Documents/keepa-raw-*.json）でも突き合わせる（ファイルが
//    無い環境ではその検証だけスキップし、純粋関数の検証は必ず走る）。
//  ★Keepaの手数料は“推定”であり“確定”ではない。よって利益は
//    PROFIT_CONFIRMED に格上げされず PROFIT_ESTIMATED 止まりになること、
//    ＝偽の精度を出さないことも併せて検証する。
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { keepaFeesFrom, calculateProfit, PROFIT_CLASS } from "../lib/profit.mjs";

// ── 純粋関数：keepaFeesFrom ──────────────────────────────
test("referralFeePercentage（正確な率）を優先して率へ変換", () => {
  const f = keepaFeesFrom({ referralFeePercentage: 10.4, referralFeePercent: 10 });
  assert.equal(f.referralPercentage, 10.4);
  assert.ok(Math.abs(f.referralRate - 0.104) < 1e-9);
});

test("referralFeePercentage が無ければ referralFeePercent にフォールバック", () => {
  const f = keepaFeesFrom({ referralFeePercent: 8 });
  assert.equal(f.referralPercentage, 8);
  assert.equal(f.referralRate, 0.08);
});

test("fbaFees.pickAndPackFee をFBA手数料(円)として取り出す", () => {
  const f = keepaFeesFrom({ fbaFees: { pickAndPackFee: 415 } });
  assert.equal(f.fbaFee, 415);
});

test("手数料が取れないときは全て null（0で握りつぶさない）", () => {
  const f = keepaFeesFrom({});
  assert.equal(f.referralRate, null);
  assert.equal(f.referralPercentage, null);
  assert.equal(f.fbaFee, null);
  const g = keepaFeesFrom(null);
  assert.equal(g.referralRate, null);
  assert.equal(g.fbaFee, null);
});

test("0や負値は無効として null 扱い", () => {
  const f = keepaFeesFrom({ referralFeePercentage: 0, fbaFees: { pickAndPackFee: 0 } });
  assert.equal(f.referralRate, null);
  assert.equal(f.fbaFee, null);
});

// ── Keepa手数料を利益計算に流したときの挙動 ──────────────
test("Keepaの率でreferralが計算され、推定(ESTIMATED)のままになる", () => {
  const f = keepaFeesFrom({ referralFeePercentage: 15.4, fbaFees: { pickAndPackFee: 430 } });
  const p = calculateProfit({
    salePrice: 12900,
    buyPrice: 7000,
    referralRate: f.referralRate, // Keepa由来（推定）
    shipMethod: "FBA",
    fbaFee: { value: f.fbaFee, estimated: true }, // Keepa由来（推定）
    supplierShipping: 0,
    inboundShipping: 0,
  });
  // 販売手数料 = 12900 × 0.154 = 1986.6 → 1987
  assert.equal(p.costItems.referralFee.amount, Math.round(12900 * 0.154));
  assert.equal(p.costItems.fbaFee.amount, 430);
  // Keepaは推定なので確定にはしない（偽の精度を出さない）。
  assert.notEqual(p.class, PROFIT_CLASS.CONFIRMED);
  assert.equal(p.class, PROFIT_CLASS.ESTIMATED);
  assert.ok(p.estimatedItems.includes("referralFee"));
  assert.ok(p.estimatedItems.includes("fbaFee"));
});

test("一律10%より精度が上がる：同じ商品でKeepa率(8.39%)と一律10%は結果が変わる", () => {
  const salePrice = 5980;
  const keepa = calculateProfit({
    salePrice,
    buyPrice: 3000,
    referralRate: keepaFeesFrom({ referralFeePercentage: 8.39 }).referralRate,
    shipMethod: "FBA",
    fbaFee: { value: 415, estimated: true },
    supplierShipping: 0,
    inboundShipping: 0,
  });
  const flat = calculateProfit({
    salePrice,
    buyPrice: 3000,
    referralRate: 0.1,
    shipMethod: "FBA",
    fbaFee: { value: 450, estimated: true },
    supplierShipping: 0,
    inboundShipping: 0,
  });
  assert.notEqual(keepa.grossProfit, flat.grossProfit);
  // 率が低い方(8.39%)の手数料は一律10%より安い＝利益は大きい。
  assert.ok(keepa.costItems.referralFee.amount < flat.costItems.referralFee.amount);
});

// ── 実データ突き合わせ（保存済みKeepa実レスポンス）──────────
// ファイルが無い環境ではスキップ（純粋関数テストは上で担保済み）。
const DOCS = join(homedir(), "Documents");
const REAL = [
  { file: "keepa-raw-B004LVNZVK.json", pct: 8.39, fba: 415 },
  { file: "keepa-raw-B07FYVGG9K.json", pct: 15.4, fba: 430 },
  { file: "keepa-raw-B07KZGRLDT.json", pct: 10.4, fba: 288 },
  { file: "keepa-raw-B08P4CN4YC.json", pct: 10.4, fba: 430 },
];
for (const r of REAL) {
  test(`実データ: ${r.file} からKeepa手数料を正しく取り出す`, (t) => {
    const path = join(DOCS, r.file);
    if (!existsSync(path)) {
      t.skip(`実レスポンス未配置のためスキップ: ${path}`);
      return;
    }
    const d = JSON.parse(readFileSync(path, "utf8"));
    const product = (d.products && d.products[0]) || d;
    const f = keepaFeesFrom(product);
    assert.equal(f.referralPercentage, r.pct);
    assert.equal(f.fbaFee, r.fba);
    assert.ok(Math.abs(f.referralRate - r.pct / 100) < 1e-9);
  });
}
