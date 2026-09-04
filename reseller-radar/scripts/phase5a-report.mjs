// 第5フェーズA 採点＆レポート（本番忠実データ150件）
//  GOLD LABELはClaudeが機械的根拠(型番/容量/数量/色/版/機種/ブランド)で付与。UNKNOWNは精度から除外。
//  match.mjs/amazon.jsは変更しない（計測凍結）。
import { readFileSync, writeFileSync } from "node:fs";
const data = JSON.parse(readFileSync("/Users/yokotaakiraju/Documents/reseller-radar-phase5a-cases.json", "utf8"));
const cases = data.cases;

// pid: SAME/DIFFERENT/UNKNOWN
const GOLD = {
  // ---- AUTO_ELIGIBLE(6) ----
  A094: { pid: "SAME", note: "BK-3MCDK/8H 8本 同士(型番完全一致)" },
  A096: { pid: "SAME", note: "BK-3MCDK/8H 8本 同士" },
  A098: { pid: "SAME", note: "K-KJ85MCD40 急速充電器セット単3 4本 同士" },
  A143: { pid: "SAME", note: "U3H-MSD3007BBK 同士(型番完全一致)" },
  A146: { pid: "SAME", note: "U3HC-T070SV 同士" },
  A149: { pid: "SAME", note: "U3HC-H041PBK 同士" },
  // ---- 候補ありだが自動対象外(66) ----
  A002: { pid: "SAME", note: "Ultra 128GB SDSQUAB-128G-GN6MN 同士(取りこぼしFN)" },
  A003: { pid: "DIFFERENT", note: "多容量Ultra vs 高耐久SDSQQNR 64GB＝別容量/別品。除外正" },
  A004: { pid: "DIFFERENT", note: "SanDisk vs KIOXIA＝別ブランド。除外正" },
  A005: { pid: "UNKNOWN", note: "多容量まとめ出品 vs 256GB Extreme。対象容量不定" },
  A006: { pid: "SAME", note: "SanDisk Extreme 128GB 同士(FN)" },
  A008: { pid: "SAME", note: "SDSQQNR-128G-GN6IA 高耐久 同士(FN)" },
  A011: { pid: "DIFFERENT", note: "microSDXC vs フルサイズSD(SDSDXXD)＝形状違い。除外正" },
  A012: { pid: "UNKNOWN", note: "SDSQXH9 Extreme micro vs 汎用Extreme。型番裏付け不足" },
  A015: { pid: "SAME", note: "SDSSDE30-1T00 ポータブルSSD1TB 同士(FN)" },
  A023: { pid: "SAME", note: "SDSSDE62P-1T00 PS5対応 同士(FN)" },
  A024: { pid: "UNKNOWN", note: "純正IC4CL62 vs 純正IC4CL62A1。62と62A1の同一性不確定" },
  A027: { pid: "UNKNOWN", note: "互換IC4CL62 vs 互換IC61/IC62混在。構成不確定" },
  A032: { pid: "SAME", note: "IC4CL62A1 純正 同士(FN)" },
  A033: { pid: "SAME", note: "IC4CL62A1 純正 同士(FN)" },
  A035: { pid: "DIFFERENT", note: "JIT-KE624P vs JIT-NE624P＝別品番(顔料/染料)。除外正" },
  A036: { pid: "SAME", note: "プレジール PLE-E624P 同士(FN)" },
  A046: { pid: "SAME", note: "エコリカ BC-345XL ECI-C345XLB-V 同士(FN)" },
  A048: { pid: "SAME", note: "エコリカ BC-346XL ECI-C346XLC-V 同士(FN)" },
  A049: { pid: "UNKNOWN", note: "サンワ詰め替えINK-CBCM4S30S(未確認)" },
  A050: { pid: "DIFFERENT", note: "汎用Switchコン vs HELEC PAD SIRIUS＝別品。除外正" },
  A051: { pid: "SAME", note: "Switch2 Proコン純正 vs 任天堂純正Switch2 Pro 同一(FN)" },
  A052: { pid: "SAME", note: "Switch2 Proコン BEE-A-FSSKA vs 任天堂純正 同一(FN)" },
  A053: { pid: "DIFFERENT", note: "純正Switch2 Pro vs BIGBIG WON CHOCO＝別品。除外正" },
  A055: { pid: "DIFFERENT", note: "HELEC 2個セット vs 汎用背面ボタンコン＝別品。除外正" },
  A057: { pid: "DIFFERENT", note: "純正Switch Pro vs Onefun Switch2。除外正" },
  A058: { pid: "DIFFERENT", note: "HELEC vs アローン。除外正" },
  A059: { pid: "DIFFERENT", note: "純正Joy-Con vs アローン。除外正" },
  A060: { pid: "DIFFERENT", note: "純正Switch Pro vs Onefun。除外正" },
  A062: { pid: "DIFFERENT", note: "純正Switch2 Pro vs Onefun。除外正" },
  A063: { pid: "SAME", note: "Anker MagGo 10000 Slim A1664 同士(FN)" },
  A064: { pid: "DIFFERENT", note: "Anker 10000/30W vs Anker Prime 9600/65W。除外正" },
  A065: { pid: "UNKNOWN", note: "汎用anker10000 vs Anker 10000 22.5W。型番不定" },
  A066: { pid: "DIFFERENT", note: "Zolo 20000 vs Zolo 10K＝容量違い。除外正" },
  A068: { pid: "DIFFERENT", note: "Zolo 20000/45W vs Zolo 10K/30W。除外正" },
  A069: { pid: "SAME", note: "Anker Nano Power Bank 30W 同士(FN)" },
  A070: { pid: "SAME", note: "Anker 20000/87W Built-in USB-C 同士(FN)" },
  A078: { pid: "SAME", note: "Logicool G G304 同士(FN)" },
  A083: { pid: "SAME", note: "M221CG 同士(FN)" },
  A086: { pid: "SAME", note: "Signature M650(M650MGR) 同士(FN)" },
  A099: { pid: "DIFFERENT", note: "LEGO 10698 vs 11045。除外正" },
  A100: { pid: "UNKNOWN", note: "LEGO 11036 vs クリエイティブビークル(番号非表示)。同一濃厚も不確定" },
  A101: { pid: "DIFFERENT", note: "LEGO 10696 vs 11045。除外正" },
  A102: { pid: "DIFFERENT", note: "LEGO 10698 vs 11045。除外正" },
  A103: { pid: "DIFFERENT", note: "LEGO 10696 vs 11045。除外正" },
  A104: { pid: "SAME", note: "カラフルなアイデアボックス(11045) 同士(FN)" },
  A105: { pid: "DIFFERENT", note: "互換レゴ vs MRG互換ブロック＝別メーカー。除外正" },
  A106: { pid: "DIFFERENT", note: "LEGO 10698 vs 11045。除外正" },
  A107: { pid: "DIFFERENT", note: "LEGO 11040 vs 11045。除外正" },
  A109: { pid: "DIFFERENT", note: "LEGO 10696 vs デュプロ10479。除外正" },
  A110: { pid: "UNKNOWN", note: "LEGO 11036 vs クリエイティブビークル。不確定" },
  A111: { pid: "SAME", note: "LEGO 11045 同士(FN)" },
  A112: { pid: "DIFFERENT", note: "WH-1000XM5 vs WH-CH720N＝別モデル。除外正" },
  A118: { pid: "SAME", note: "WF-C510 同士(FN)" },
  A120: { pid: "SAME", note: "1000X THE COLLEXION(WH-1000XX) 同士(FN)" },
  A121: { pid: "SAME", note: "WH-1000XM6 同士(FN)" },
  A124: { pid: "SAME", note: "WF-1000XM5 同士(FN)" },
  A125: { pid: "SAME", note: "WF-1000XM5 同士(FN)" },
  A127: { pid: "SAME", note: "WF-1000XM5 同士(FN)" },
  A129: { pid: "SAME", note: "WF-1000XM5 プラチナシルバー 同士(FN)" },
  A130: { pid: "DIFFERENT", note: "WF-1000XM6 vs WF-C700N＝別モデル。除外正" },
  A131: { pid: "SAME", note: "EP-NI1010M イヤーピース 同士(FN)" },
  A132: { pid: "SAME", note: "INZONE Buds WF-G700N 同士(FN)" },
  A138: { pid: "SAME", note: "RUF3-KEV64G-BK 同士(FN)" },
  A142: { pid: "SAME", note: "DST-W01 同士(FN)" },
  A144: { pid: "SAME", note: "U3HC-C040PBK 同士(FN)" },
  A150: { pid: "SAME", note: "U3H-MSD3007BBK 同士(FN)" },
};
const g = (id) => GOLD[id] || { pid: "UNKNOWN", note: "(未ラベル)" };

const withCand = cases.filter((c) => c.asin);
const noCand = cases.filter((c) => !c.asin);

let TP = 0, FP = 0, TN = 0, FN = 0, autoUnknown = 0;
const fpList = [], fnList = [];
for (const c of withCand) {
  const pid = g(c.case_id).pid;
  if (c.actual_autoEligible) {
    if (pid === "SAME") TP++;
    else if (pid === "DIFFERENT") { FP++; fpList.push(c); }
    else autoUnknown++;
  } else {
    if (pid === "SAME") { FN++; fnList.push(c); }
    else TN++;
  }
}
const precision = (TP + FP) ? TP / (TP + FP) : null;
const recall = (TP + FN) ? TP / (TP + FN) : null;

const byStatus = {};
for (const c of withCand) byStatus[c.actual_status] = (byStatus[c.actual_status] || 0) + 1;

const janVer = withCand.filter((c) => c.actual_status === "JAN_VERIFIED");
const modVer = withCand.filter((c) => c.actual_status === "MODEL_VERIFIED");
const modSame = modVer.filter((c) => g(c.case_id).pid === "SAME").length;
const modDiff = modVer.filter((c) => g(c.case_id).pid === "DIFFERENT").length;
const modUnk = modVer.filter((c) => g(c.case_id).pid === "UNKNOWN").length;
const modPrec = (modSame + modDiff) ? modSame / (modSame + modDiff) : null;

const siteStat = {};
for (const c of withCand) {
  if (!c.actual_autoEligible) continue;
  siteStat[c.site] = siteStat[c.site] || { auto: 0, same: 0, diff: 0, unk: 0 };
  siteStat[c.site].auto++;
  const pid = g(c.case_id).pid;
  if (pid === "SAME") siteStat[c.site].same++; else if (pid === "DIFFERENT") siteStat[c.site].diff++; else siteStat[c.site].unk++;
}

const allSame = withCand.filter((c) => g(c.case_id).pid === "SAME").length;
const unknownCount = withCand.filter((c) => g(c.case_id).pid === "UNKNOWN").length;
const bySite = {}; for (const c of cases) bySite[c.site] = (bySite[c.site] || 0) + 1;

let verdict = "FAIL";
if (cases.length >= 100 && FP === 0 && (modPrec === null || modPrec === 1)) {
  verdict = recall != null && recall < 0.5 ? "CONDITIONAL PASS" : "PASS";
}

const scored = {
  dataset: "phase5a-production-faithful",
  provenance: data.provenance,
  scored_at: new Date().toISOString(),
  label_source: "Claudeが機械的根拠で付与。UNKNOWNは精度計算から除外。人間/ChatGPT最終確認前提。",
  totals: { cases: cases.length, withCandidate: withCand.length, noCandidate: noCand.length, keepaCalls: data.totals.keepaCalls, bySite, listingJan: cases.filter(c=>c.supplier_jan).length },
  byStatus,
  confusion: { TP, FP, TN, FN, autoUnknown, precision, recall },
  janVerified: { count: janVer.length },
  modelVerified: { count: modVer.length, same: modSame, different: modDiff, unknown: modUnk, precision: modPrec },
  perSite: siteStat,
  unknownCount,
  automationRate: { allSame, autoSame: TP, rate: allSame ? TP / allSame : null },
  verdict,
  falsePositives: fpList.map((c) => ({ case_id: c.case_id, supplier_title: c.supplier_title, amazon_title: c.amazon_title, gold: g(c.case_id) })),
  falseNegatives: fnList.map((c) => ({ case_id: c.case_id, status: c.actual_status, supplier_title: c.supplier_title, amazon_title: c.amazon_title, gold: g(c.case_id) })),
  autoEligibleAll: withCand.filter((c) => c.actual_autoEligible).map((c) => ({ case_id: c.case_id, site: c.site, status: c.actual_status, supplier_title: c.supplier_title, amazon_title: c.amazon_title, supplier_price: c.supplier_price, conservativeSalePrice: c.conservativeSalePrice, gold: g(c.case_id) })),
};
writeFileSync("/Users/yokotaakiraju/Documents/reseller-radar-phase5a-scored.json", JSON.stringify(scored, null, 2), "utf8");

console.log("=== 第5フェーズA 採点（本番忠実）===");
console.log(`総件数=${cases.length} / 候補あり=${withCand.length} / 候補なし=${noCand.length} / Keepa=${data.totals.keepaCalls} / 一覧JAN=${scored.totals.listingJan}`);
console.log(`サイト別:`, JSON.stringify(bySite));
console.log(`状態別:`, JSON.stringify(byStatus));
console.log(`混同行列(陽性=AUTO): TP=${TP} FP=${FP} TN=${TN} FN=${FN} AUTO-UNKNOWN=${autoUnknown}`);
console.log(`Precision=${precision==null?"-":(precision*100).toFixed(1)+"%"}  Recall=${recall==null?"-":(recall*100).toFixed(1)+"%"}  ★FP=${FP}`);
console.log(`MODEL_VERIFIED: ${modVer.length}件 SAME=${modSame} DIFF=${modDiff} UNK=${modUnk} 精度=${modPrec==null?"-":(modPrec*100).toFixed(1)+"%"}`);
console.log(`JAN_VERIFIED: ${janVer.length}件 (本番一覧JAN=0のため0件が正常)`);
console.log(`サイト別AUTO:`, JSON.stringify(siteStat));
console.log(`自動化率= ${TP}/${allSame} = ${allSame?(TP/allSame*100).toFixed(1):"-"}%  UNKNOWN=${unknownCount}`);
console.log(`総合判定: ${verdict}`);
console.log(`保存: /Users/yokotaakiraju/Documents/reseller-radar-phase5a-scored.json`);
