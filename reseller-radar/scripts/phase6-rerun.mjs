// =====================================================================
// 第6フェーズ 再計測（安全設計①〜④実装後）
// ---------------------------------------------------------------------
//  ・凍結済みの2データセット（Phase5A 150件 / ADVERSARIAL 112件）を、
//    Keepaに再接続せず「新しい照合ロジックだけ」で再採点する。
//  ・入力の supplier_title / amazon_title / supplier_jan / eanList / upcList /
//    supplier_jan_source は収集時のまま（＝Keepaの実レスポンスを凍結して使う）。
//  ・本番 lookupProduct と同じ分岐（JAN経路 / 名前経路）を純粋に再現する。
//    JANの信頼度は crawler 由来（本文/detail regex）＝ low を既定にする。
//  ・GOLD ラベルは各 report スクリプトに埋め込まれた人手ラベルを再利用する。
//  ・出力：修正前/修正後の AUTO・TP・FP・Precision・Recall と、5FPの新判定。
// =====================================================================
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import {
  classifyMatch,
  classifyJanMatch,
  AUTO_ELIGIBLE_STATUSES,
} from "../lib/match.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS = "/Users/yokotaakiraju/Documents";

// 各 report スクリプトから `const GOLD = { ... };` ブロックだけを抜き出して評価する
// （report本体は実行しない＝副作用なし・ラベルの二重管理を避ける）。
function loadGold(reportFile) {
  const text = readFileSync(join(__dirname, reportFile), "utf8");
  const start = text.indexOf("const GOLD = {");
  if (start < 0) throw new Error("GOLD not found in " + reportFile);
  // "const GOLD = {" 以降、行頭 "};" までを取り出す
  const rest = text.slice(start);
  const end = rest.search(/\n};\s*\n/);
  const block = rest.slice(0, end + 3); // "};" を含める
  const fn = new Function(block + "\nreturn GOLD;");
  return fn();
}

function goldPid(gold, id) {
  const g = gold[id];
  if (!g) return "UNKNOWN";
  return g.pid || "UNKNOWN";
}

// 本番 lookupProduct の分岐を、凍結フィールドだけで純粋再現して
// { status, autoEligible } を返す。
function rescore(c) {
  const path = c.path || (c.supplier_jan ? "jan" : "name");
  if (path === "jan" && c.supplier_jan) {
    const codes = [...(c.eanList || []), ...(c.upcList || [])];
    // 収集時にJANでKeepaヒットしていた前提（凍結の eanList を使う）。
    const janConfidence = "low"; // 本文/detail regex 由来＝低信頼（本番crawlerも既定low）
    const jm = classifyJanMatch({
      supplierName: c.supplier_title,
      supplierJan: c.supplier_jan,
      supplierModel: c.supplier_model || null,
      candidateTitle: c.amazon_title,
      candidateCodes: codes,
      candidateModel: null,
      janConfidence,
    });
    return { status: jm.status, autoEligible: jm.autoEligible };
  }
  // 名前経路
  if (!c.amazon_title) return { status: "NO_CANDIDATE", autoEligible: false };
  const cls = classifyMatch({
    supplierName: c.supplier_title,
    supplierJan: c.supplier_jan || null,
    amazonTitle: c.amazon_title,
    amazonJan: null,
  });
  const autoEligible = AUTO_ELIGIBLE_STATUSES.has(cls.status);
  return { status: cls.status, autoEligible };
}

function confusion(cases, gold, getAuto) {
  let TP = 0, FP = 0, TN = 0, FN = 0;
  const fpList = [], newFn = [];
  for (const c of cases) {
    if (!c.asin && !c.amazon_title) continue; // 候補なしは対象外（両行列で除外）
    const pid = goldPid(gold, c.case_id);
    if (pid === "UNKNOWN") continue;
    const auto = getAuto(c);
    if (auto) {
      if (pid === "SAME") TP++;
      else if (pid === "DIFFERENT") { FP++; fpList.push(c); }
    } else {
      if (pid === "SAME") { FN++; }
      else if (pid === "DIFFERENT") { TN++; }
    }
  }
  const precision = TP + FP > 0 ? (TP / (TP + FP)) * 100 : 100;
  const recall = TP + FN > 0 ? (TP / (TP + FN)) * 100 : 0;
  return { TP, FP, TN, FN, precision, recall, fpList };
}

function runSet(name, casesFile, reportFile) {
  const data = JSON.parse(readFileSync(join(DOCS, casesFile), "utf8"));
  const gold = loadGold(reportFile);
  const cases = data.cases;

  const before = confusion(cases, gold, (c) => !!c.actual_autoEligible);
  // 修正後の status を各ケースに付ける
  for (const c of cases) {
    const r = rescore(c);
    c._new_status = r.status;
    c._new_auto = r.autoEligible;
  }
  const after = confusion(cases, gold, (c) => !!c._new_auto);

  // 修正前AUTO→修正後の遷移
  const dropped = cases.filter((c) => c.actual_autoEligible && !c._new_auto);
  const newAuto = cases.filter((c) => !c.actual_autoEligible && c._new_auto);

  console.log(`\n================= ${name} =================`);
  console.log(`件数=${cases.length}`);
  const fmt = (x) => `TP=${x.TP} FP=${x.FP} TN=${x.TN} FN=${x.FN} Precision=${x.precision.toFixed(1)}% Recall=${x.recall.toFixed(1)}%`;
  console.log("修正前:", fmt(before));
  console.log("修正後:", fmt(after));
  console.log(`AUTO件数: 前=${cases.filter((c)=>c.actual_autoEligible).length} → 後=${cases.filter((c)=>c._new_auto).length}`);
  console.log(`修正でAUTOから外れた件数: ${dropped.length} / 新規にAUTO入りした件数: ${newAuto.length}`);
  if (after.fpList.length) {
    console.log("！修正後もFP:", after.fpList.map((c) => c.case_id).join(","));
  } else {
    console.log("修正後FP: 0 ✅");
  }
  return { cases, gold, before, after, dropped, newAuto };
}

// ── ADVERSARIAL 112件 ─────────────────────────────────────────
const adv = runSet(
  "ADVERSARIAL #1（低信頼JAN 112件）",
  "reseller-radar-phase5-adversarial-low-confidence-jan-cases.json",
  "phase5-report.mjs"
);

// 5FP（C028/C035/C071/C073/C074）の新判定
const FP5 = ["C028", "C035", "C071", "C073", "C074"];
console.log("\n--- 5誤検出(FP)の修正後判定 ---");
for (const id of FP5) {
  const c = adv.cases.find((x) => x.case_id === id);
  if (!c) { console.log(`${id}: (見つからず)`); continue; }
  console.log(`${id}: 前=${c.actual_status}(auto=${c.actual_autoEligible}) → 後=${c._new_status}(auto=${c._new_auto})`);
}

// 修正でAUTOから外れた「本来正しかった(SAME)」件数＝新FN（過剰kill確認）
const advNewFn = adv.dropped.filter((c) => goldPid(adv.gold, c.case_id) === "SAME");
console.log(`\nADVERSARIAL 過剰kill確認: AUTOから外れたSAME(正しかった自動)= ${advNewFn.length}件`);
console.log("  該当:", advNewFn.map((c) => c.case_id).join(",") || "(なし)");

// ── Phase5A 150件 ─────────────────────────────────────────────
const p5a = runSet(
  "Phase5A（本番忠実 150件）",
  "reseller-radar-phase5a-cases.json",
  "phase5a-report.mjs"
);

// 6件のAUTO(TP)が壊れていないか
const AUTO6 = ["A094", "A096", "A098", "A143", "A146", "A149"];
console.log("\n--- Phase5A 6件AUTO(TP)の修正後判定 ---");
for (const id of AUTO6) {
  const c = p5a.cases.find((x) => x.case_id === id);
  if (!c) { console.log(`${id}: (見つからず)`); continue; }
  console.log(`${id}: 前=${c.actual_status}(auto=${c.actual_autoEligible}) → 後=${c._new_status}(auto=${c._new_auto})`);
}

console.log("\n================= 合否 =================");
const pass =
  p5a.after.FP === 0 &&
  Math.abs(p5a.after.precision - 100) < 0.01 &&
  adv.after.FP === 0 &&
  FP5.every((id) => {
    const c = adv.cases.find((x) => x.case_id === id);
    return c && !c._new_auto;
  });
console.log(pass ? "✅ PASS（両データセットで合格基準を満たす）" : "❌ FAIL");
