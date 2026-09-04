// =====================================================================
// 第3フェーズ バックテスト実行（オフライン／追加API通信なし）
// ---------------------------------------------------------------------
//  ・GOLD(正解付き)を本番と同じ判定パイプラインへ通す。
//  ・本番パイプライン(amazon.js lookupProduct)の判定順を忠実に再現する：
//      1) 仕入れJANあり → 候補の識別子一覧(codes)と janVerdict で3値判定
//           verified  → JAN_VERIFIED（自動対象）
//           conflict  → 候補を破棄(return null) = JAN_CONFLICT（自動対象外）
//           unknown   → JAN_LOOKUP_UNVERIFIED（自動対象外）
//      2) 仕入れJANなし → classifyMatch（amazonJan=null。本番と同じ）
//  ・結果を固定してJSON/MDに保存する。ここでロジックは一切変更しない。
//  ・Precision最優先。最重要指標＝AUTO_ELIGIBLE の False Positive 件数。
// =====================================================================
import { writeFileSync } from "node:fs";
import { classifyMatch, janVerdict } from "../lib/match.mjs";
import { GOLD } from "./backtest-gold.mjs";

const OUT_JSON = "/Users/yokotaakiraju/Documents/reseller-radar-backtest-phase3.json";
const OUT_MD = "/Users/yokotaakiraju/Documents/reseller-radar-backtest-phase3.md";

const AUTO_STATUSES = new Set(["JAN_VERIFIED", "MODEL_VERIFIED"]);

// 本番の lookupProduct と同じ順序で status/autoEligible を出す。
function productionJudge(c) {
  // 1) 仕入れJANあり → JAN照合（本番はここで確定し、名前照合へは落ちない）
  if (c.sjan) {
    const verdict = janVerdict(c.sjan, c.codes || []);
    if (verdict === "verified") {
      return { status: "JAN_VERIFIED", autoEligible: true, conflicts: [], reason: "JAN一致(識別子照合)", models_s: [], models_a: [] };
    }
    if (verdict === "conflict") {
      // 本番は return null で候補破棄。＝自動対象にも保存にも乗らない。
      return { status: "JAN_CONFLICT", autoEligible: false, conflicts: ["jan"], reason: "識別子不一致で候補破棄", models_s: [], models_a: [] };
    }
    return { status: "JAN_LOOKUP_UNVERIFIED", autoEligible: false, conflicts: [], reason: "識別子未取得で断定不可", models_s: [], models_a: [] };
  }
  // 2) 仕入れJANなし → classifyMatch（本番同様 amazonJan=null）
  const cls = classifyMatch({
    supplierName: c.supplier,
    supplierJan: null,
    amazonTitle: c.amazon,
    amazonJan: null,
    supplierModel: c.smodel || undefined,
    amazonModel: c.amodel || undefined,
  });
  return {
    status: cls.status,
    autoEligible: cls.autoEligible,
    conflicts: cls.conflicts || [],
    reason: cls.reason,
    models_s: [],
    models_a: [],
  };
}

// ---- 各ケース判定 ----
const rows = GOLD.map((c) => {
  const j = productionJudge(c);
  const auto = j.autoEligible && AUTO_STATUSES.has(j.status);
  return {
    id: c.id,
    genre: c.genre,
    supplier: c.supplier,
    amazon: c.amazon,
    sjan: c.sjan,
    smodel: c.smodel,
    amodel: c.amodel,
    codes: c.codes,
    expect: c.expect, // true / false / "unknown"
    diff_dim: c.diff_dim,
    label_reason: c.reason,
    evidence: c.evidence,
    actual_status: j.status,
    actual_autoEligible: auto,
    actual_conflicts: j.conflicts.length ? j.conflicts : null,
    actual_reason: j.reason,
  };
});

// ---- Confusion Matrix（AUTO_ELIGIBLE vs GROUND TRUTH） ----
// ground truth: expect===true を陽性(同一商品)とする。
// FP = 自動対象なのに expect===false （最重要：0であるべき）
// AUTO_ON_UNKNOWN = 自動対象なのに expect==="unknown" （真偽不明を自動化＝危険。0が望ましい）
let TP = 0, FP = 0, TN = 0, FN = 0, AUTO_ON_UNKNOWN = 0, UNKNOWN_MANUAL = 0;
const fpList = [], fnList = [], autoUnknownList = [];
for (const r of rows) {
  const auto = r.actual_autoEligible;
  if (r.expect === true) {
    if (auto) TP++;
    else { FN++; fnList.push(r); }
  } else if (r.expect === false) {
    if (auto) { FP++; fpList.push(r); }
    else TN++;
  } else {
    // unknown
    if (auto) { AUTO_ON_UNKNOWN++; autoUnknownList.push(r); }
    else UNKNOWN_MANUAL++;
  }
}
const precision = TP + FP > 0 ? TP / (TP + FP) : null;
const recall = TP + FN > 0 ? TP / (TP + FN) : null;

// ---- ステータス別 precision（そのstatusに割り当てた中で expect===true の割合） ----
function statusStats(status) {
  const inStatus = rows.filter((r) => r.actual_status === status);
  const t = inStatus.filter((r) => r.expect === true).length;
  const f = inStatus.filter((r) => r.expect === false).length;
  const u = inStatus.filter((r) => r.expect === "unknown").length;
  const denom = t + f; // unknown は precision分母から除外
  return {
    count: inStatus.length,
    correct_same: t,
    wrong_diff: f,
    unknown: u,
    precision: denom > 0 ? t / denom : null, // 「同一商品だと言ったら何%当たりか」
  };
}
const ALL_STATUSES = [
  "JAN_VERIFIED", "MODEL_VERIFIED", "MODEL_UNVERIFIED", "ATTRIBUTE_REVIEW",
  "NAME_UNVERIFIED", "CONFLICT", "NO_MATCH", "JAN_LOOKUP_UNVERIFIED", "JAN_CONFLICT",
];
const perStatus = {};
for (const s of ALL_STATUSES) perStatus[s] = statusStats(s);

// ---- MANUALステータスの「実際は何%が正商品だったか」 ----
const manualValue = {};
for (const s of ["MODEL_UNVERIFIED", "ATTRIBUTE_REVIEW", "NAME_UNVERIFIED"]) {
  const st = perStatus[s];
  manualValue[s] = {
    count: st.count,
    same_rate: st.count > 0 ? st.correct_same / st.count : null,
    detail: `同一${st.correct_same}/別${st.wrong_diff}/不明${st.unknown}`,
  };
}

// ---- 誤判定原因ランキング（FPは diff_dim を原因として集計） ----
const causeCount = {};
for (const r of fpList) {
  const dim = r.diff_dim || "UNKNOWN";
  causeCount[dim] = (causeCount[dim] || 0) + 1;
}
const causeRanking = Object.entries(causeCount).sort((a, b) => b[1] - a[1]);

// ---- ジャンル別精度 ----
const genreStats = {};
for (const r of rows) {
  const g = r.genre;
  genreStats[g] = genreStats[g] || { n: 0, auto: 0, fp: 0, tp: 0, tn: 0, fn: 0, auto_unknown: 0 };
  const s = genreStats[g];
  s.n++;
  if (r.actual_autoEligible) s.auto++;
  if (r.expect === true && r.actual_autoEligible) s.tp++;
  else if (r.expect === false && r.actual_autoEligible) { s.fp++; }
  else if (r.expect === false && !r.actual_autoEligible) s.tn++;
  else if (r.expect === true && !r.actual_autoEligible) s.fn++;
  else if (r.expect === "unknown" && r.actual_autoEligible) s.auto_unknown++;
}

// ---- 合格判定 ----
// FP=0 かつ AUTO_ON_UNKNOWN=0 → PASS候補
// FP=0 だが recall が極端に低い等 → CONDITIONAL PASS
// FP>0 → FAIL
let verdict;
if (FP > 0) verdict = "FAIL";
else if (AUTO_ON_UNKNOWN > 0) verdict = "CONDITIONAL PASS"; // 真偽不明の自動化は要是正
else verdict = "PASS";

const labelDist = {
  true: rows.filter((r) => r.expect === true).length,
  false: rows.filter((r) => r.expect === false).length,
  unknown: rows.filter((r) => r.expect === "unknown").length,
};
const statusDist = {};
for (const r of rows) statusDist[r.actual_status] = (statusDist[r.actual_status] || 0) + 1;

const summary = {
  provenance:
    "ライブ取得ではない。実在ブランド/型番体系/タイトル揺れを反映した人手構成の正解付きコーパス（照合ロジック精度測定用）。実用化可否の最終判定は第4フェーズの実Keepa監査後。",
  total: rows.length,
  label_dist: labelDist,
  auto_count: TP + FP + AUTO_ON_UNKNOWN,
  confusion: { TP, FP, TN, FN, AUTO_ON_UNKNOWN, UNKNOWN_MANUAL },
  precision,
  recall,
  most_important_metric: { name: "AUTO_ELIGIBLE False Positive", value: FP, target: 0 },
  status_dist: statusDist,
  per_status: perStatus,
  manual_value: manualValue,
  cause_ranking: causeRanking,
  genre_stats: genreStats,
  verdict,
};

writeFileSync(
  OUT_JSON,
  JSON.stringify({ summary, fp: fpList, fn: fnList, auto_on_unknown: autoUnknownList, rows }, null, 2),
  "utf8"
);

// ---- Markdownレポート ----
const pct = (x) => (x == null ? "—" : (x * 100).toFixed(1) + "%");
let md = "";
md += "# Reseller Radar 第3フェーズ バックテスト結果（固定）\n\n";
md += `- データ出所: ${summary.provenance}\n`;
md += `- 総件数: **${summary.total}**\n`;
md += `- 正解ラベル: true(同一)=${labelDist.true} / false(別)=${labelDist.false} / unknown=${labelDist.unknown}\n`;
md += `- 自動対象(AUTO_ELIGIBLE)件数: **${summary.auto_count}**\n\n`;
md += "## Confusion Matrix（AUTO_ELIGIBLE × 正解）\n\n";
md += `| | expect=同一 | expect=別 | expect=不明 |\n|---|---|---|---|\n`;
md += `| **自動対象** | TP=${TP} | **FP=${FP}** | AUTO_ON_UNKNOWN=${AUTO_ON_UNKNOWN} |\n`;
md += `| 非自動 | FN=${FN} | TN=${TN} | 不明(手動)=${UNKNOWN_MANUAL} |\n\n`;
md += `- **Precision = ${pct(precision)}**（TP/(TP+FP)）\n`;
md += `- Recall = ${pct(recall)}（TP/(TP+FN)）\n`;
md += `- 🎯 最重要: 自動対象のFalse Positive = **${FP}件**（目標0）\n\n`;
md += "## ステータス別 precision\n\n";
md += `| status | 件数 | 同一 | 別 | 不明 | precision |\n|---|---|---|---|---|---|\n`;
for (const s of ALL_STATUSES) {
  const st = perStatus[s];
  md += `| ${s} | ${st.count} | ${st.correct_same} | ${st.wrong_diff} | ${st.unknown} | ${pct(st.precision)} |\n`;
}
md += "\n## MANUALステータスの実際の正商品率（将来のUI優先度用）\n\n";
for (const [s, v] of Object.entries(manualValue)) {
  md += `- ${s}: ${pct(v.same_rate)}（${v.detail}）\n`;
}
md += "\n## 誤判定原因ランキング（FP）\n\n";
if (causeRanking.length === 0) md += "- （FPなし）\n";
for (const [dim, n] of causeRanking) md += `- ${dim}: ${n}件\n`;
md += "\n## ジャンル別\n\n";
md += `| genre | n | 自動 | TP | FP | TN | FN | 自動×不明 |\n|---|---|---|---|---|---|---|---|\n`;
for (const [g, s] of Object.entries(genreStats)) {
  md += `| ${g} | ${s.n} | ${s.auto} | ${s.tp} | ${s.fp} | ${s.tn} | ${s.fn} | ${s.auto_unknown} |\n`;
}
md += "\n## FP全件（別商品なのに自動対象になった）\n\n";
if (fpList.length === 0) md += "- **なし（0件）**\n";
for (const r of fpList) md += `- [${r.id}] ${r.actual_status} 原因=${r.diff_dim} / ${r.supplier} ≠ ${r.amazon}\n`;
md += "\n## FN全件（同一なのに自動対象にならなかった＝取り逃し・許容）\n\n";
if (fnList.length === 0) md += "- なし\n";
for (const r of fnList) md += `- [${r.id}] ${r.actual_status} / ${r.supplier}\n`;
md += "\n## 自動対象×正解不明（要是正）\n\n";
if (autoUnknownList.length === 0) md += "- なし（0件）\n";
for (const r of autoUnknownList) md += `- [${r.id}] ${r.actual_status} / ${r.supplier}\n`;
md += `\n## 現在の自動化可否: **${verdict}**\n`;

writeFileSync(OUT_MD, md, "utf8");

// ---- コンソール要約 ----
console.log("=== 第3フェーズ バックテスト（固定結果） ===");
console.log("総件数:", summary.total, "| ラベル:", JSON.stringify(labelDist));
console.log("自動対象:", summary.auto_count, "| TP:", TP, "FP:", FP, "TN:", TN, "FN:", FN, "| 自動×不明:", AUTO_ON_UNKNOWN);
console.log("Precision:", pct(precision), "| Recall:", pct(recall));
console.log("🎯 自動対象のFalse Positive =", FP, "（目標0）");
console.log("status分布:", JSON.stringify(statusDist));
console.log("MANUAL正商品率:", Object.fromEntries(Object.entries(manualValue).map(([k, v]) => [k, pct(v.same_rate)])));
console.log("FP原因:", JSON.stringify(causeRanking));
console.log("判定:", verdict);
console.log("保存:", OUT_JSON);
console.log("保存:", OUT_MD);
