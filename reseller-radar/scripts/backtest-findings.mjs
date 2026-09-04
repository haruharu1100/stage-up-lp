// 実データ・オフライン・バックテスト（Keepa 呼び出しゼロ＝トークン消費なし）
//
// 目的：既存 findings を新・照合エンジンで再判定し、
//       「旧: match_type」→「新: match_status」の変化を可視化する。
// 使い方: node scripts/backtest-findings.mjs [findings.jsonのパス]
//
// 注意：正解ラベル（正しいASIN/誤ったASIN）は未付与のため、
//       “真の” FP/FN は出せない。ここでは
//       ・新エンジンが CONFLICT で弾いた件数（誤仕入れ回避の候補）
//       ・自動対象(auto-eligible)から外れた件数
//       ・判定不能(UNKNOWN=amazon_title欠損)の件数
//       を集計する。ラベルが用意され次第、真の精度評価へ拡張する。

import { readFileSync } from "node:fs";
import { classifyMatch, priceRatioSanity } from "../lib/match.mjs";

const path = process.argv[2] || "/Users/yokotaakiraju/Documents/reseller-radar-findings.json";
const raw = JSON.parse(readFileSync(path, "utf8"));
const findings = Array.isArray(raw) ? raw : raw.findings || raw.rows || [];

const rows = [];
const counts = {
  total: findings.length,
  newStatus: {},
  oldType: {},
  nowConflict: 0,
  wasAutoNowNot: 0,
  unknown: 0, // amazon_title 欠損で判定不能
  autoEligibleNew: 0,
  priceReject: 0, // 価格比が異常で reject（名前照合で3倍超）
  priceDowngrade: 0, // 価格比が異常で downgrade（型番照合で8倍超）
};

const OLD_AUTO = new Set(["jan", "model"]); // 旧仕様で通知対象だったもの

for (const f of findings) {
  const oldType = f.match_type || "null";
  counts.oldType[oldType] = (counts.oldType[oldType] || 0) + 1;

  if (!f.amazon_title) {
    counts.unknown++;
  }

  const res = classifyMatch({
    supplierName: f.product_name || f.supplier_product_name || "",
    supplierJan: f.jan || f.supplier_jan || null,
    amazonTitle: f.amazon_title || "",
    amazonJan: f.amazon_jan || null,
  });

  counts.newStatus[res.status] = (counts.newStatus[res.status] || 0) + 1;
  if (res.status === "CONFLICT") counts.nowConflict++;
  if (res.autoEligible) counts.autoEligibleNew++;
  const wasAuto = OLD_AUTO.has(oldType);
  if (wasAuto && !res.autoEligible) counts.wasAutoNowNot++;

  // 価格比の異常検知（誤マッチ由来の偽利益を弾く新ロジック）を適用する。
  // 照合の強さ：JAN一致→"jan"、型番検証済→"model"、それ以外→"name"。
  const verified =
    f.jan || res.status.startsWith("JAN")
      ? "jan"
      : res.status === "MODEL_VERIFIED"
      ? "model"
      : "name";
  const sanity = priceRatioSanity({
    buyPrice: f.buy_price,
    salePrice: f.amazon_price,
    verified,
  });
  let priceFlag = "-";
  if (!sanity.ok && sanity.action === "reject") {
    counts.priceReject++;
    priceFlag = `REJECT(${sanity.ratio?.toFixed(1)}x)`;
  } else if (!sanity.ok && sanity.action === "downgrade") {
    counts.priceDowngrade++;
    priceFlag = `DOWN(${sanity.ratio?.toFixed(1)}x)`;
  }

  rows.push({
    id: f.id,
    name: (f.product_name || "").slice(0, 42),
    hasTitle: f.amazon_title ? "有" : "無",
    old: oldType,
    new: res.status,
    auto: res.autoEligible ? "○" : "×",
    price: priceFlag,
    conflicts: res.conflicts.join(",") || "-",
    reason: res.reason,
  });
}

// 表示
console.log("=".repeat(96));
console.log("バックテスト（オフライン / Keepa消費0）:", path);
console.log("=".repeat(96));
const pad = (s, n) => String(s).padEnd(n).slice(0, n);
console.log(
  pad("id", 6),
  pad("商品名", 44),
  pad("Amz名", 6),
  pad("旧", 6),
  pad("新status", 18),
  pad("自動", 4),
  pad("価格比", 12),
  pad("矛盾/理由", 20)
);
console.log("-".repeat(96));
for (const r of rows) {
  console.log(
    pad(r.id, 6),
    pad(r.name, 44),
    pad(r.hasTitle, 6),
    pad(r.old, 6),
    pad(r.new, 18),
    pad(r.auto, 4),
    pad(r.price, 12),
    pad(r.conflicts === "-" ? r.reason : r.conflicts, 20)
  );
}
console.log("=".repeat(96));
console.log("■ 集計");
console.log("  総件数:", counts.total);
console.log("  旧 match_type 分布:", JSON.stringify(counts.oldType));
console.log("  新 match_status 分布:", JSON.stringify(counts.newStatus));
console.log("  新たに CONFLICT で弾いた件数:", counts.nowConflict);
console.log("  旧・自動対象→新・自動対象外になった件数:", counts.wasAutoNowNot);
console.log("  判定不能(UNKNOWN: Amazon名欠損)件数:", counts.unknown);
console.log("  新・自動対象(JAN/MODEL)件数:", counts.autoEligibleNew);
console.log("  価格比 異常で REJECT（名前照合で3倍超・偽利益）件数:", counts.priceReject);
console.log("  価格比 異常で DOWNGRADE（型番照合で8倍超・要確認）件数:", counts.priceDowngrade);
console.log("=".repeat(96));
console.log(
  "※正解ラベル未付与のため“真のFP/FN”は未算出。ラベルCSV受領後に精度評価へ拡張する。"
);
