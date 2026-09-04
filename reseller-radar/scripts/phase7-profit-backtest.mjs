// =====================================================================
// 第7フェーズ 利益計算バックテスト（凍結2データセットで再採点）
// ---------------------------------------------------------------------
//  ・Phase6で凍結した「本番忠実150件」「意地悪112件」を、Keepa非接続で
//    利益計算の正本 calculateProfit() に通し、判定クラスの内訳を出す。
//  ・入力：buyPrice=supplier_price / salePrice=conservativeSalePrice（凍結値）。
//    手数料はSP-API未接続＝推定、仕入送料/納品送料/ポイントは収集経路が無い＝UNKNOWN。
//  ・利益情報が十分な件だけを対象化し、不足は INSUFFICIENT_DATA として扱う
//    （全件に無理やり利益を付けない）。
//  ・合成データは作らない＝システムが実際に取得して凍結したフィールドのみ使用。
// =====================================================================
import { readFileSync } from "node:fs";
import { calculateProfit, PROFIT_CLASS } from "../lib/profit.mjs";

const DOCS = "/Users/yokotaakiraju/Documents";

// 本番既定の設定（推定の元）。ハードコードではなくDB既定値に一致させる。
const SETTINGS = { referralRate: 0.1, fbaFee: 450, shipMethod: "FBA" };

function scoreCase(c) {
  const salePrice = c.conservativeSalePrice;
  const buyPrice = c.supplier_price;
  // 販売想定価格が無い＝利益情報不足。無理に利益を付けない。
  if (!salePrice || !buyPrice) {
    return { class: PROFIT_CLASS.INSUFFICIENT, p: null };
  }
  const p = calculateProfit({
    salePrice,
    buyPrice,
    referralRate: SETTINGS.referralRate, // 推定（カテゴリ未確定）
    shipMethod: SETTINGS.shipMethod,
    fbaFee: { value: SETTINGS.fbaFee, estimated: true }, // サイズ/重量未確定＝推定
    // 仕入送料・納品送料・ポイントは収集経路が無い＝UNKNOWN（0で握りつぶさない）
    supplierShipping: undefined,
    inboundShipping: undefined,
    otherCost: 0,
  });
  return { class: p.class, p };
}

function runSet(name, file) {
  const data = JSON.parse(readFileSync(`${DOCS}/${file}`, "utf8"));
  const counts = {
    PROFIT_CONFIRMED: 0,
    PROFIT_ESTIMATED: 0,
    REVIEW_REQUIRED: 0,
    LOSS: 0,
    INSUFFICIENT_DATA: 0,
  };
  let autoBuy = 0;
  let riskHigh = 0;
  for (const c of data.cases) {
    const r = scoreCase(c);
    counts[r.class]++;
    if (r.p && r.p.autoBuyEligible) autoBuy++;
    if (r.p && r.p.riskLevel === "HIGH") riskHigh++;
  }
  console.log(`\n================= ${name} =================`);
  console.log(`件数=${data.cases.length}`);
  console.log(
    `PROFIT_CONFIRMED=${counts.PROFIT_CONFIRMED} PROFIT_ESTIMATED=${counts.PROFIT_ESTIMATED} REVIEW_REQUIRED=${counts.REVIEW_REQUIRED} LOSS=${counts.LOSS} INSUFFICIENT_DATA=${counts.INSUFFICIENT_DATA}`
  );
  console.log(`自動仕入れ候補(AUTO_BUY_ELIGIBLE)=${autoBuy}  価格下落リスク高(RISK_HIGH)=${riskHigh}`);
  return { counts, autoBuy };
}

const p5a = runSet("Phase5A（本番忠実 150件）", "reseller-radar-phase5a-cases.json");
const adv = runSet(
  "ADVERSARIAL #1（意地悪 112件）",
  "reseller-radar-phase5-adversarial-low-confidence-jan-cases.json"
);

console.log("\n================= 合否 =================");
// 現状（SP-API未接続・手数料/送料/ポイント未取得）では、確定利益は原理的に0のはず。
// 偽の精度で自動仕入れ候補を出していないこと＝AUTO_BUY=0 を合格条件にする。
const pass =
  p5a.counts.PROFIT_CONFIRMED === 0 &&
  adv.counts.PROFIT_CONFIRMED === 0 &&
  p5a.autoBuy === 0 &&
  adv.autoBuy === 0;
console.log(
  pass
    ? "✅ PASS（不足費用を0で握りつぶさず、確定利益/自動仕入れ候補は0＝偽の精度なし）"
    : "❌ FAIL（未取得費用があるのに利益を確定させている）"
);
