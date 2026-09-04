// =====================================================================
// 第7フェーズ 利益計算の単体テスト（calculateProfit 正本の検証）
//  ・費用項目 / 手数料 / 送料 / 税区分 / ポイント / 利益 / 利益率 / ROI /
//    損益分岐 / 価格下落(-5/-10/-15%) / 手数料上振れ(+300/+500) /
//    不足データ / 赤字 / 推定利益 / 自動対象 の各観点。
//  ・item14の「検証したい事故」をテスト事故シナリオとして再現する。
// =====================================================================
import { test } from "node:test";
import assert from "node:assert/strict";
import { calculateProfit, PROFIT_CLASS, PROFIT_CONFIG } from "../lib/profit.mjs";

// 全費用が確定した黒字（安全マージン超）→ CONFIRMED かつ自動候補になり得る
const fullConfirmed = {
  salePrice: 8000,
  buyPrice: 3000,
  referralFee: 800,
  referralConfirmed: true,
  shipMethod: "FBA",
  fbaFee: 600,
  fbaConfirmed: true,
  supplierShipping: 200,
  inboundShipping: 150,
  otherCost: 0,
};

test("基本：粗利益＝売価−全経費−仕入値", () => {
  const p = calculateProfit(fullConfirmed);
  // 8000 - (800+600+200+150) - 3000 = 3250
  assert.equal(p.grossProfit, 3250);
  assert.equal(p.fees, 800 + 600 + 200 + 150);
});

test("利益率＝粗利益/売価 ×100（小数第1位）", () => {
  const p = calculateProfit(fullConfirmed);
  assert.equal(p.profitRate, Math.round((3250 / 8000) * 1000) / 10);
});

test("ROI＝粗利益/(仕入値+仕入送料+納品送料) ×100", () => {
  const p = calculateProfit(fullConfirmed);
  const invested = 3000 + 200 + 150;
  assert.equal(p.roi, Math.round((3250 / invested) * 1000) / 10);
});

test("損益分岐販売価格：固定費/(1-手数料率)", () => {
  const p = calculateProfit({
    salePrice: 8000,
    buyPrice: 3000,
    referralRate: 0.1,
    referralConfirmed: true,
    shipMethod: "FBA",
    fbaFee: 600,
    fbaConfirmed: true,
    supplierShipping: 200,
    inboundShipping: 150,
  });
  const fixed = 600 + 200 + 150 + 3000;
  assert.equal(p.breakevenSalePrice, Math.round(fixed / (1 - 0.1)));
});

test("全費用確定＆安全マージン超 → PROFIT_CONFIRMED・自動候補OK", () => {
  const p = calculateProfit(fullConfirmed);
  assert.equal(p.class, PROFIT_CLASS.CONFIRMED);
  assert.equal(p.autoBuyEligible, true);
});

test("推定利益：手数料が推定なら PROFIT_ESTIMATED・自動候補NG", () => {
  const p = calculateProfit({
    ...fullConfirmed,
    referralConfirmed: false, // 率が推定
    referralFee: undefined,
    referralRate: 0.1,
  });
  assert.equal(p.class, PROFIT_CLASS.ESTIMATED);
  assert.equal(p.autoBuyEligible, false);
  assert.ok(p.estimatedItems.includes("referralFee"));
});

// ── item14 事故シナリオ ────────────────────────────────

test("事故1：売価は黒字だが手数料込みで赤字 → LOSS", () => {
  // 売価2200 仕入2000（一見+200）だが手数料220+送料300で赤字。
  const p = calculateProfit({
    salePrice: 2200,
    buyPrice: 2000,
    referralFee: 220,
    referralConfirmed: true,
    shipMethod: "self",
    outboundShipping: 300,
    supplierShipping: 0,
  });
  assert.equal(p.class, PROFIT_CLASS.LOSS);
  assert.ok(p.grossProfit < 0);
});

test("事故2：FBA手数料が不明 → FEE_UNKNOWN・REVIEW_REQUIRED（利益確定させない）", () => {
  const p = calculateProfit({
    salePrice: 8000,
    buyPrice: 3000,
    referralRate: 0.1,
    shipMethod: "FBA",
    fbaFee: undefined, // サイズ/重量不明でFBA費用が取れない
    supplierShipping: 0,
    inboundShipping: 0,
  });
  assert.equal(p.feeStatus, "FEE_UNKNOWN");
  assert.equal(p.class, PROFIT_CLASS.REVIEW);
  assert.equal(p.autoBuyEligible, false);
});

test("事故3：送料抜け（仕入送料UNKNOWN）→ REVIEW_REQUIRED（0円で握りつぶさない）", () => {
  const p = calculateProfit({
    salePrice: 8000,
    buyPrice: 3000,
    referralFee: 800,
    referralConfirmed: true,
    shipMethod: "FBA",
    fbaFee: 600,
    fbaConfirmed: true,
    // supplierShipping / inboundShipping を渡さない＝UNKNOWN
  });
  assert.equal(p.class, PROFIT_CLASS.REVIEW);
  assert.ok(p.unknownItems.includes("supplierShipping"));
});

test("事故4：ポイント抜け（付与ありなのに原資UNKNOWN）→ REVIEW_REQUIRED", () => {
  const p = calculateProfit({
    salePrice: 8000,
    buyPrice: 3000,
    referralFee: 800,
    referralConfirmed: true,
    shipMethod: "FBA",
    fbaFee: 600,
    fbaConfirmed: true,
    supplierShipping: 200,
    inboundShipping: 150,
    pointsApply: true, // ポイント付与が発生するのに
    pointsCost: undefined, // 原資が不明
  });
  assert.equal(p.class, PROFIT_CLASS.REVIEW);
  assert.ok(p.unknownItems.includes("pointsCost"));
});

test("ポイント原資を渡すと粗利益から差し引かれる（実質負担を反映）", () => {
  const base = calculateProfit(fullConfirmed);
  const withPoints = calculateProfit({
    ...fullConfirmed,
    pointsApply: true,
    pointsCost: 400,
  });
  assert.equal(withPoints.grossProfit, base.grossProfit - 400);
});

test("事故5：税区分違い（税込/税抜混在）はしない＝入力は税込で統一し数値どおり計算", () => {
  // 税抜売価8000（税込8800）を誤って税込扱いすると利益が過大になる。
  // 正本は渡された数値をそのまま使う＝呼び出し側が税区分を統一する契約。
  const taxExclMistake = calculateProfit({ ...fullConfirmed, salePrice: 8000 });
  const taxInclCorrect = calculateProfit({ ...fullConfirmed, salePrice: 8800 });
  assert.notEqual(taxExclMistake.grossProfit, taxInclCorrect.grossProfit);
});

test("事故6：価格下落で赤字 → RISK_HIGH（-5%で赤字）", () => {
  // 薄利：8000売価/7200仕入、手数料込みでギリ黒字。-5%(=7600)で赤字。
  const p = calculateProfit({
    salePrice: 8000,
    buyPrice: 7200,
    referralFee: 400,
    referralConfirmed: true,
    shipMethod: "self",
    outboundShipping: 100,
    supplierShipping: 0,
  });
  assert.ok(p.grossProfit > 0); // 現状は黒字
  const drop5 = p.stress.priceDrops.find((d) => Math.abs(d.drop - 0.05) < 1e-9);
  assert.equal(drop5.profitable, false);
  assert.equal(p.riskLevel, "HIGH");
});

test("価格下落テストは -5/-10/-15% の3点を返す", () => {
  const p = calculateProfit(fullConfirmed);
  assert.deepEqual(
    p.stress.priceDrops.map((d) => d.drop),
    [0.05, 0.1, 0.15]
  );
});

test("事故7：仕入値変動で赤字（仕入が上振れると自動候補から外れる）", () => {
  const cheap = calculateProfit({ ...fullConfirmed, buyPrice: 3000 });
  const pricey = calculateProfit({ ...fullConfirmed, buyPrice: 6900 });
  assert.equal(cheap.autoBuyEligible, true);
  assert.equal(pricey.autoBuyEligible, false); // 利益が安全マージン未満
});

test("手数料上振れテストは +300/+500 の2点を返し、粗利益を減らす", () => {
  const p = calculateProfit(fullConfirmed);
  const inc = p.stress.feeIncreases;
  assert.deepEqual(inc.map((f) => f.increase), [300, 500]);
  assert.equal(inc[0].grossProfit, p.grossProfit - 300);
});

test("事故8：利益率は高いが利益額が小さい → 安全マージン(最低利益額)で自動候補NG", () => {
  // 売価1000/仕入500/手数料100 → 利益400（率40%）だが額が1500未満。
  const p = calculateProfit({
    salePrice: 1000,
    buyPrice: 500,
    referralFee: 100,
    referralConfirmed: true,
    shipMethod: "self",
    outboundShipping: 0,
    supplierShipping: 0,
  });
  assert.ok(p.profitRate >= 30);
  assert.equal(p.passesMargin, false); // 利益額400 < 1500
  assert.equal(p.autoBuyEligible, false);
});

test("事故9：ROIが低い（利益額は足りるがROI不足）→ 自動候補NG", () => {
  // 高額商品：売価60000/仕入50000/手数料6000 → 利益4000, 率6.7%, ROI8%。
  const p = calculateProfit({
    salePrice: 60000,
    buyPrice: 50000,
    referralFee: 6000,
    referralConfirmed: true,
    shipMethod: "FBA",
    fbaFee: 0,
    fbaConfirmed: true,
    supplierShipping: 0,
    inboundShipping: 0,
  });
  assert.ok(p.grossProfit >= PROFIT_CONFIG.minProfitAmount); // 利益額はOK
  assert.ok(p.roi < PROFIT_CONFIG.minRoi); // ROI不足
  assert.equal(p.autoBuyEligible, false);
});

test("不足データ：売価なし → INSUFFICIENT_DATA", () => {
  const p = calculateProfit({ buyPrice: 2000 });
  assert.equal(p.class, PROFIT_CLASS.INSUFFICIENT);
  assert.equal(p.autoBuyEligible, false);
  assert.equal(p.grossProfit, null);
});

test("偽の精度禁止：不明費用があるとき利益を CONFIRMED にしない", () => {
  const p = calculateProfit({
    salePrice: 8000,
    buyPrice: 3000,
    referralRate: 0.1,
    shipMethod: "FBA",
    fbaFee: { value: 450, estimated: true },
    // 送料UNKNOWN
  });
  assert.notEqual(p.class, PROFIT_CLASS.CONFIRMED);
});

test("安全マージンは設定で上書きできる（ハードコードしない）", () => {
  const strict = calculateProfit(fullConfirmed, { minProfitAmount: 100000 });
  assert.equal(strict.autoBuyEligible, false); // 3250 < 100000
  const loose = calculateProfit(fullConfirmed, {
    minProfitAmount: 100,
    minProfitRate: 1,
    minRoi: 1,
  });
  assert.equal(loose.autoBuyEligible, true);
});

test("手数料を含めない設定相当（全経費0・確定）→ 売価−仕入値そのもの", () => {
  const p = calculateProfit({
    salePrice: 5000,
    buyPrice: 2000,
    referralFee: 0,
    referralConfirmed: true,
    shipMethod: "FBA",
    fbaFee: 0,
    fbaConfirmed: true,
    supplierShipping: 0,
    inboundShipping: 0,
  });
  assert.equal(p.grossProfit, 3000);
  assert.equal(p.class, PROFIT_CLASS.CONFIRMED);
});
