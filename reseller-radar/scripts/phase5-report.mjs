// =====================================================================
// 第5フェーズ ライブ・バックテスト採点＆レポート
// ---------------------------------------------------------------------
//  ・phase5-collect.mjs が実サイトから集めた実データ(112件)を採点する。
//  ・GOLD LABEL は Claude が「機械的な根拠(JAN/型番/容量/数量/色/版/機種)」で付与。
//    断定できない場合は UNKNOWN（推測でSAMEにしない）。
//  ・match.mjs / amazon.js は一切変更しない（計測中の過学習防止＝⑬）。
//  ・出力: reseller-radar-phase5-scored.json / .md（凍結）。
// =====================================================================
import { readFileSync, writeFileSync } from "node:fs";

const SRC = "/Users/yokotaakiraju/Documents/reseller-radar-phase5-cases.json";
const data = JSON.parse(readFileSync(SRC, "utf8"));
const cases = data.cases;

// ---------------------------------------------------------------------
// GOLD LABEL（人手=Claudeが根拠つきで付与。UNKNOWNは精度計算から除外）
//   pid : 商品同一性 SAME / DIFFERENT / UNKNOWN
//   sel : ASIN選択  CORRECT / ALTERNATIVE / WRONG / UNKNOWN
//   cause: 誤り(FP/FN)の原因（該当時のみ）
//   note : 判定根拠（日本語）
// ---------------------------------------------------------------------
const GOLD = {
  // ===== AUTO_ELIGIBLE（自動仕入れ対象＝FP=0の最重要集合） =====
  C003: { pid: "UNKNOWN", sel: "UNKNOWN", cause: "CAPACITY", note: "多容量まとめ出品(16/32/64/128GB)＋Ultra vs Ultra Lite。詳細から拾ったJANは128GBを指すが表示価格2000円は別容量の疑い＝断定不可" },
  C005: { pid: "SAME", sel: "CORRECT", note: "両方 SanDisk Extreme 128GB。ただし多容量まとめ出品で表示価格8827円は上位容量の値の疑い(価格要注意)" },
  C006: { pid: "SAME", sel: "CORRECT", note: "両方 SanDisk Extreme 128GB(SDSQXAA相当)" },
  C007: { pid: "SAME", sel: "CORRECT", note: "型番SDSQQNR-128G-GN6IA 完全一致" },
  C014: { pid: "SAME", sel: "CORRECT", note: "型番SDSSDE30-1T00 一致(ポータブルSSD 1TB)" },
  C026: { pid: "SAME", sel: "CORRECT", note: "互換 IC4CL62 4色パック 同士" },
  C028: { pid: "DIFFERENT", sel: "WRONG", cause: "JAN_SOURCE", note: "★FP: 仕入れは『純正EPSON IC4CL62 箱袋なし』、Amazonは『JIT リサイクルインク JIT-E624P 2箱セット』。詳細ページから拾ったJANが別商品(JITリサイクル)を指し、それに一致してしまった" },
  C029: { pid: "SAME", sel: "CORRECT", note: "互換 IC4CL62 4色パック×10セット 同士" },
  C035: { pid: "DIFFERENT", sel: "WRONG", cause: "MODEL_EXTRACTION", note: "★FP: 仕入れは『BC-345XL+BC-346XL(キヤノン)』、Amazonは『BCI-331+330/5MP』。全く別のインク型番。拾ったJANが別商品に一致" },
  C047: { pid: "SAME", sel: "CORRECT", note: "Switch2 Proコントローラー JAN4902370552843 純正一致" },
  C048: { pid: "SAME", sel: "CORRECT", note: "Switch2 Proコントローラー 純正一致" },
  C049: { pid: "SAME", sel: "CORRECT", note: "Switch2 Proコントローラー 純正一致" },
  C052: { pid: "SAME", sel: "CORRECT", note: "Switch2 Proコントローラー 純正一致" },
  C053: { pid: "SAME", sel: "CORRECT", note: "Switch Proコントローラー(旧型) JAN4902370535730 純正一致" },
  C071: { pid: "DIFFERENT", sel: "WRONG", cause: "MODEL_EXTRACTION", note: "★FP: 仕入れは『M550(Signature)』、Amazonは『M650MGR』。M550≠M650。拾ったJANが別型番に一致" },
  C073: { pid: "DIFFERENT", sel: "WRONG", cause: "MODEL_EXTRACTION", note: "★FP: 仕入れは『G304』、Amazonは『G703h』。G304≠G703。拾ったJANが別型番に一致" },
  C074: { pid: "DIFFERENT", sel: "WRONG", cause: "DEVICE", note: "★FP: 仕入れは『MX ANYWHERE 3S マウス(MX1800)』、Amazonは『MX KEYS mini キーボード(KX700)』。マウスとキーボードで別物。拾ったJANが別商品に一致" },
  C081: { pid: "SAME", sel: "CORRECT", note: "エネループ 単3 8本(BK-3MCC/8C相当) JAN一致。バラ売り表記だがセル同一" },
  C082: { pid: "SAME", sel: "CORRECT", note: "BK-3MCDK/4H 単3 4本 同士" },
  C083: { pid: "SAME", sel: "CORRECT", note: "BK-3MCDK/8H 単3 8本 同士" },
  C087: { pid: "SAME", sel: "CORRECT", note: "BK-3MCDK/4H 単3 4本 同士" },
  C088: { pid: "SAME", sel: "CORRECT", note: "BK-3MCDK/8H 単3 8本 同士" },
  C090: { pid: "SAME", sel: "CORRECT", note: "型番BK-3MCDK/8H＋数量8本一致(型番経路MODEL_VERIFIED)" },
  C095: { pid: "SAME", sel: "CORRECT", note: "LEGO 10698 黄色のアイデアボックス スペシャル 同士" },
  C097: { pid: "SAME", sel: "CORRECT", note: "LEGO クラシック カラフルなアイデアボックス 11045 同士" },
  C100: { pid: "SAME", sel: "CORRECT", note: "LEGO 11014 アイデアパーツ<ホイール> 同士" },
  C105: { pid: "SAME", sel: "CORRECT", note: "SONY WH-CH720N ブラック 同士" },
  C106: { pid: "SAME", sel: "CORRECT", note: "SONY WH-ULT900N(ULT WEAR) オフホワイト 同士(仕入れ表記WH-UTL900Nは誤植)" },

  // ===== 候補ありだが自動対象外（FN/TN判定用） =====
  C004: { pid: "UNKNOWN", sel: "UNKNOWN", note: "Ultra(SDSQUNR) vs Ultra Lite。別ラインの疑い＝断定不可。ASIN_REVIEWで自動除外は妥当" },
  C009: { pid: "SAME", note: "Ultra microSDXC 128GB 同士(CONFLICT扱い=取りこぼしFN)" },
  C010: { pid: "DIFFERENT", note: "MAX ENDURANCE vs High Endurance(SDSQQNR-GH3IA)＝別グレード。正しく除外" },
  C011: { pid: "DIFFERENT", note: "microSDXC vs フルサイズSDカード(SDSDXXD)＝形状違い。正しく除外" },
  C012: { pid: "SAME", note: "Extreme ポータブルSSD SDSSDE61-1T00 同士(JAN_CONFLICTで取りこぼしFN)" },
  C016: { pid: "UNKNOWN", note: "SDSSDE61-1T00 だがブランドがWD表記。リブランド同一の可能性ありも断定不可。除外は安全側" },
  C019: { pid: "DIFFERENT", note: "SDSSDE30 vs SDSSDE70＝別モデル。正しく除外" },
  C020: { pid: "UNKNOWN", note: "Extreme Portable 1TB だが型番不明瞭 vs E70。断定不可" },
  C021: { pid: "SAME", note: "SDDDE1-1T00 Slim Dual Drive 同士(CONFLICTで取りこぼしFN)" },
  C031: { pid: "SAME", note: "純正 IC4CL62A1 4色パック 同士(MODEL_UNVERIFIEDで取りこぼしFN)" },
  C032: { pid: "DIFFERENT", note: "IC4CL62 vs IC4CL42＝別型番。正しく除外" },
  C034: { pid: "DIFFERENT", note: "BC-345+346セット vs BC-345黒のみ3個セット。正しく除外" },
  C036: { pid: "DIFFERENT", note: "BC-345+346 2個 vs BC-345黒3個。正しく除外" },
  C037: { pid: "DIFFERENT", note: "BC-345黒単品 vs BC-345黒3個セット＝数量違い。正しく除外" },
  C042: { pid: "DIFFERENT", note: "BC-345+346 2パック vs BC-345黒3個。正しく除外" },
  C043: { pid: "SAME", note: "エコリカ BC-345XL 対応 同士(MODEL_UNVERIFIEDで取りこぼしFN)" },
  C045: { pid: "SAME", note: "エコリカ BC-346XL 対応 同士(MODEL_UNVERIFIEDで取りこぼしFN)" },
  C051: { pid: "DIFFERENT", note: "HELEC Switchコントローラー vs メディキュット(全く無関係)。拾ったJANが無関係商品を指す。正しく除外" },
  C054: { pid: "DIFFERENT", note: "同上(HELEC vs メディキュット)。ASIN_REVIEWで自動除外は妥当" },
  C055: { pid: "DIFFERENT", note: "純正Joy-Con vs アローン製Switch2コントローラー。正しく除外" },
  C056: { pid: "DIFFERENT", note: "純正Switch Proコン vs Onefun Switch2互換。正しく除外" },
  C057: { pid: "DIFFERENT", note: "X-Design Switchコン vs zpxxpフライトジョイスティック。正しく除外" },
  C068: { pid: "DIFFERENT", note: "Anker 10000mAh ブルー vs ブラック＝色違いSKU。正しく除外" },
  C069: { pid: "SAME", note: "M240GR Silent 同士(JAN_CONFLICTで取りこぼしFN)" },
  C070: { pid: "SAME", note: "M840L Signature Comfort 同士(FN)" },
  C072: { pid: "SAME", note: "MX ANYWHERE 3S MX1800GR 同士(FN)" },
  C076: { pid: "DIFFERENT", note: "M221CG 単品 vs ×10個セット＝数量違い。正しく除外" },
  C077: { pid: "SAME", note: "G502 X ワイヤレス G502XWL-CRBK 同士(FN)" },
  C078: { pid: "SAME", note: "M221CG 同士(MODEL_UNVERIFIEDで取りこぼしFN)" },
  C079: { pid: "SAME", note: "ERGO M575SP トラックボール 同士(FN)" },
  C080: { pid: "SAME", note: "MX MASTER 4 同士(FN)" },
  C085: { pid: "DIFFERENT", note: "BK-3MCD/4H 選べる8本 vs 3セット計12本＝構成違い。正しく除外" },
  C086: { pid: "DIFFERENT", note: "BK-3HCD/4H 4本 vs 2セット計8本＝数量違い。正しく除外" },
  C089: { pid: "DIFFERENT", note: "BK-3HCD/4H 4本 vs 2セット計8本＝数量違い。正しく除外" },
  C091: { pid: "SAME", note: "eneloop pro BK-3HCD/4H 同士(CONFLICTで取りこぼしFN)" },
  C092: { pid: "DIFFERENT", note: "LEGO vs ハイセンス4Kテレビ。拾ったJANが無関係商品。正しく除外" },
  C093: { pid: "DIFFERENT", note: "LEGO vs ハイセンス4Kテレビ。正しく除外" },
  C094: { pid: "DIFFERENT", note: "LEGO vs ハイセンス4Kテレビ。正しく除外" },
  C099: { pid: "SAME", note: "LEGO 10698 同士(JAN_CONFLICTで取りこぼしFN)" },
  C102: { pid: "DIFFERENT", note: "LEGO 10696 クラシック vs デュプロ 10479。正しく除外" },
  C103: { pid: "UNKNOWN", note: "LEGO 11036 のりものをつくろう vs クリエイティブビークル。同一の可能性高いが番号非表示で断定不可" },
  C104: { pid: "SAME", note: "WH-1000XM5 同士(JAN_CONFLICTで取りこぼしFN)" },
  C107: { pid: "DIFFERENT", note: "WH-1000XM5 vs 家電リサイクル券。拾ったJANが無関係。正しく除外" },
  C108: { pid: "SAME", note: "WH-1000XM5 同士(FN)" },
  C109: { pid: "SAME", note: "WH-1000XM5 同士(FN)" },
  C110: { pid: "SAME", note: "WF-C510 ホワイト 同士(MODEL_UNVERIFIEDで取りこぼしFN)" },
  C111: { pid: "DIFFERENT", note: "WI-C100 ホワイト vs ブラック＝色違いSKU。正しく除外" },
  C112: { pid: "SAME", note: "WH-1000XX(1000X THE COLLEXION) 同士(MODEL_UNVERIFIEDで取りこぼしFN)" },
};

const g = (id) => GOLD[id] || { pid: "UNKNOWN", sel: "UNKNOWN", note: "(候補なし/未ラベル)" };

// ---------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------
const withCand = cases.filter((c) => c.asin);
const noCand = cases.filter((c) => !c.asin);

// 混同行列（陽性=システムがAUTO_ELIGIBLE）
let TP = 0, FP = 0, TN = 0, FN = 0, autoUnknown = 0;
const fpList = [], fnList = [];
for (const c of withCand) {
  const gold = g(c.case_id);
  const auto = !!c.actual_autoEligible;
  if (auto) {
    if (gold.pid === "SAME") TP++;
    else if (gold.pid === "DIFFERENT") { FP++; fpList.push(c); }
    else autoUnknown++;
  } else {
    if (gold.pid === "SAME") { FN++; fnList.push(c); }
    else TN++; // DIFFERENT / UNKNOWN はまとめて正しく除外側
  }
}
const precAuto = (TP + FP) ? (TP / (TP + FP)) : null;

// 状態別
const byStatus = {};
for (const c of withCand) byStatus[c.actual_status] = (byStatus[c.actual_status] || 0) + 1;

// JAN_VERIFIED 個別評価
const janVer = withCand.filter((c) => c.actual_status === "JAN_VERIFIED");
const janSame = janVer.filter((c) => g(c.case_id).pid === "SAME").length;
const janDiff = janVer.filter((c) => g(c.case_id).pid === "DIFFERENT").length;
const janUnk = janVer.filter((c) => g(c.case_id).pid === "UNKNOWN").length;
const janPrec = (janSame + janDiff) ? janSame / (janSame + janDiff) : null;

// MODEL_VERIFIED 個別評価
const modVer = withCand.filter((c) => c.actual_status === "MODEL_VERIFIED");
const modSame = modVer.filter((c) => g(c.case_id).pid === "SAME").length;
const modDiff = modVer.filter((c) => g(c.case_id).pid === "DIFFERENT").length;
const modUnk = modVer.filter((c) => g(c.case_id).pid === "UNKNOWN").length;
const modPrec = (modSame + modDiff) ? modSame / (modSame + modDiff) : null;

// サイト別精度（AUTO_ELIGIBLEのみ）
const siteStat = {};
for (const c of withCand) {
  if (!c.actual_autoEligible) continue;
  const s = c.site;
  siteStat[s] = siteStat[s] || { auto: 0, same: 0, diff: 0, unk: 0 };
  siteStat[s].auto++;
  const pid = g(c.case_id).pid;
  if (pid === "SAME") siteStat[s].same++;
  else if (pid === "DIFFERENT") siteStat[s].diff++;
  else siteStat[s].unk++;
}

// 自動化率 = AUTO_ELIGIBLE(かつSAME) / 全SAME
const allSame = withCand.filter((c) => g(c.case_id).pid === "SAME").length;
const autoSame = TP;
const autoRate = allSame ? autoSame / allSame : null;

// 原因ランキング（FP）
const causeRank = {};
for (const c of fpList) {
  const cause = g(c.case_id).cause || "OTHER";
  causeRank[cause] = (causeRank[cause] || 0) + 1;
}

// conservativeSalePrice の健全性（⑧）
let nullConsv = 0, consvOk = 0, priceVariationTrap = 0;
for (const c of withCand) {
  if (c.conservativeSalePrice == null) nullConsv++;
  else consvOk++;
}
// 多容量まとめ出品の価格トラップ（実例）
const variationTrapIds = ["C003", "C005"];

// ---------------------------------------------------------------------
// 合否判定
// ---------------------------------------------------------------------
const pass = {
  count100: withCand.length >= 100 || cases.length >= 100,
  fpZero: FP === 0,
  janPrec100: janPrec === null || janPrec === 1,
  modPrec100: modPrec === null || modPrec === 1,
};
let verdict = "FAIL";
if (pass.fpZero && pass.janPrec100 && pass.modPrec100 && (cases.length >= 100)) verdict = "PASS";
else if (cases.length >= 100 && FP > 0) verdict = "FAIL";

const scored = {
  provenance: data.provenance,
  collected_at: data.collected_at,
  scored_at: new Date().toISOString(),
  label_source: "Claudeが機械的根拠(JAN/型番/容量/数量/色/版/機種)で付与。UNKNOWNは精度計算から除外。人間/ChatGPTの最終確認前提。",
  totals: {
    cases: cases.length,
    withCandidate: withCand.length,
    noCandidate: noCand.length,
    keepaCalls: data.totals.keepaCalls,
    sites: data.totals ? undefined : undefined,
  },
  byStatus,
  confusion: { TP, FP, TN, FN, autoUnknown, precisionAuto: precAuto },
  janVerified: { count: janVer.length, same: janSame, different: janDiff, unknown: janUnk, precision: janPrec },
  modelVerified: { count: modVer.length, same: modSame, different: modDiff, unknown: modUnk, precision: modPrec },
  perSite: siteStat,
  automationRate: { allSame, autoSame, rate: autoRate },
  causeRankingFP: causeRank,
  conservativeSalePrice: { nullCount: nullConsv, okCount: consvOk, variationPriceTrapExamples: variationTrapIds },
  passCriteria: pass,
  verdict,
  falsePositives: fpList.map((c) => ({
    case_id: c.case_id, site: c.site, status: c.actual_status, jan: c.supplier_jan, jan_source: c.supplier_jan_source,
    supplier_title: c.supplier_title, amazon_title: c.amazon_title,
    gold: g(c.case_id),
  })),
  falseNegatives: fnList.map((c) => ({
    case_id: c.case_id, site: c.site, status: c.actual_status,
    supplier_title: c.supplier_title, amazon_title: c.amazon_title, gold: g(c.case_id),
  })),
  autoEligibleAll: withCand.filter((c) => c.actual_autoEligible).map((c) => ({
    case_id: c.case_id, site: c.site, status: c.actual_status, path: c.path,
    jan: c.supplier_jan, jan_source: c.supplier_jan_source,
    supplier_title: c.supplier_title, amazon_title: c.amazon_title,
    supplier_price: c.supplier_price, conservativeSalePrice: c.conservativeSalePrice,
    gold: g(c.case_id),
  })),
};

writeFileSync("/Users/yokotaakiraju/Documents/reseller-radar-phase5-scored.json", JSON.stringify(scored, null, 2), "utf8");

// コンソール要約
console.log("=== 第5フェーズ 採点結果 ===");
console.log(`総件数=${cases.length} / 候補あり=${withCand.length} / 候補なし=${noCand.length} / Keepa=${data.totals.keepaCalls}回`);
console.log(`状態別:`, JSON.stringify(byStatus));
console.log(`混同行列(陽性=AUTO): TP=${TP} FP=${FP} TN=${TN} FN=${FN} AUTO-UNKNOWN=${autoUnknown}`);
console.log(`AUTO_ELIGIBLE 精度(UNKNOWN除外)= ${precAuto == null ? "-" : (precAuto * 100).toFixed(1) + "%"}  ★FP=${FP}`);
console.log(`JAN_VERIFIED: ${janVer.length}件 SAME=${janSame} DIFF=${janDiff} UNK=${janUnk} 精度=${janPrec == null ? "-" : (janPrec * 100).toFixed(1) + "%"}`);
console.log(`MODEL_VERIFIED: ${modVer.length}件 SAME=${modSame} DIFF=${modDiff} UNK=${modUnk} 精度=${modPrec == null ? "-" : (modPrec * 100).toFixed(1) + "%"}`);
console.log(`サイト別(AUTO):`, JSON.stringify(siteStat));
console.log(`自動化率= ${autoSame}/${allSame} = ${autoRate == null ? "-" : (autoRate * 100).toFixed(1) + "%"}`);
console.log(`FP原因:`, JSON.stringify(causeRank));
console.log(`conservativeSalePrice: null=${nullConsv} 有効=${consvOk}`);
console.log(`総合判定: ${verdict}`);
console.log(`保存: /Users/yokotaakiraju/Documents/reseller-radar-phase5-scored.json`);
