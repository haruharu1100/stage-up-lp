// 商品照合エンジンの単体テスト（node:test）
// 実行: node --test scripts/test-matching.mjs   または   npm test
//
// Precision（誤仕入れ防止）最優先：似た別商品は必ず CONFLICT で弾く。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMatch,
  modelRelation,
  extractModels,
  extractCapacities,
  extractConnectivity,
  extractPackCount,
  extractGeneration,
  detectConflicts,
  extractAttributes,
} from "../lib/match.mjs";

function classify(sup, amz, extra = {}) {
  return classifyMatch({ supplierName: sup, amazonTitle: amz, ...extra });
}

// ── 必須: HARD CONFLICT で弾くべきケース ─────────────────────

test("SPF-040 vs SPF-040U（HORI 有線 vs 無線バリアント）→ CONFLICT", () => {
  const r = classify(
    "HORI ホリ コントローラー SPF-040 有線",
    "HORI ワイヤレスコントローラー SPF-040U 無線 for PS5"
  );
  assert.equal(r.status, "CONFLICT");
  assert.equal(r.autoEligible, false);
});

test("512GB vs 1TB（容量違い）→ CONFLICT", () => {
  const r = classify(
    "SanDisk microSD 512GB Extreme",
    "SanDisk microSD 1TB Extreme サンディスク"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("capacity"));
});

test("1個 vs 2個セット（セット数違い）→ CONFLICT", () => {
  const r = classify(
    "エレコム USBケーブル 1本",
    "エレコム USBケーブル 2本セット"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("packCount"));
});

test("有線 vs 無線（接続方式違い）→ CONFLICT", () => {
  const r = classify(
    "ロジクール マウス 有線 M100",
    "ロジクール マウス ワイヤレス M200 無線"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("connectivity") || r.conflicts.includes("model"));
});

test("旧世代 vs 新世代（世代違い）→ CONFLICT", () => {
  const r = classify(
    "Anker PowerCore 第2世代",
    "Anker PowerCore 第3世代"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("generation"));
});

test("色違い（ブラック vs ホワイト）→ CONFLICT", () => {
  const r = classify(
    "Apple Magic Keyboard ブラック",
    "Apple Magic Keyboard ホワイト 白"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("color"));
});

test("対応機種違い（PS5 vs PS4）→ CONFLICT", () => {
  const r = classify(
    "コントローラー for PS5 プレステ5",
    "コントローラー for PS4 プレステ4"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("device"));
});

// ── 必須: 一致として通すべきケース ─────────────────────────

test("完全同一型番 → MODEL_VERIFIED（自動対象）", () => {
  const r = classify(
    "SanDisk Extreme SDSQXAV-256G サンディスク",
    "サンディスク SanDisk SDSQXAV-256G microSD"
  );
  assert.equal(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, true);
});

test("JAN完全一致 → JAN_VERIFIED（最優先・自動対象）", () => {
  const r = classifyMatch({
    supplierName: "何かの商品 A",
    supplierJan: "4901234567894",
    amazonTitle: "全く違う名前に見えるが同一 B",
    amazonJan: "4901234567894",
  });
  assert.equal(r.status, "JAN_VERIFIED");
  assert.equal(r.autoEligible, true);
});

test("JAN不一致 → CONFLICT（名前が似ていても別商品）", () => {
  const r = classifyMatch({
    supplierName: "SanDisk microSD 256GB",
    supplierJan: "4901234567894",
    amazonTitle: "SanDisk microSD 256GB",
    amazonJan: "4988755123456",
  });
  assert.equal(r.status, "CONFLICT");
  assert.equal(r.autoEligible, false);
});

test("JANなし+型番一致 → MODEL_VERIFIED", () => {
  const r = classify(
    "バッファロー 外付けSSD SSD-PGM480U3-B",
    "BUFFALO ポータブルSSD SSD-PGM480U3-B バッファロー"
  );
  assert.equal(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, true);
});

test("JANなし+名前だけ一致 → NAME_UNVERIFIED（自動対象外）", () => {
  const r = classify(
    "おしゃれ 収納 ボックス 折りたたみ",
    "折りたたみ 収納 ボックス 便利"
  );
  assert.ok(["NAME_UNVERIFIED", "ATTRIBUTE_VERIFIED", "NO_MATCH"].includes(r.status));
  assert.equal(r.autoEligible, false);
});

// ── 補助: 個別関数の単体確認 ───────────────────────────────

test("modelRelation: 接頭辞関係は conflict", () => {
  assert.equal(modelRelation(["spf040"], ["spf040u"]), "conflict");
  assert.equal(modelRelation(["sdsqunr128g"], ["sdsqunr256g"]), "conflict");
  assert.equal(modelRelation(["sdsqxav256g"], ["sdsqxav256g"]), "exact");
  assert.equal(modelRelation([], ["sdsqxav256g"]), "unknown");
});

test("extractModels: 英数字混在5文字以上のみ", () => {
  const m = extractModels("HORI SPF-040U for PS5");
  assert.ok(m.includes("spf040u"));
});

test("extractCapacities: TB→GB換算", () => {
  assert.deepEqual(extractCapacities("1TB").sort(), [1000]);
  assert.deepEqual(extractCapacities("512GB").sort(), [512]);
});

test("extractConnectivity: 有線/無線", () => {
  assert.equal(extractConnectivity("有線コントローラー"), "wired");
  assert.equal(extractConnectivity("ワイヤレス 無線"), "wireless");
  assert.equal(extractConnectivity("普通の商品"), null);
});

test("extractPackCount: 明示なしは1", () => {
  assert.equal(extractPackCount("USBケーブル"), 1);
  assert.equal(extractPackCount("USBケーブル 2本セット"), 2);
  assert.equal(extractPackCount("マスク ×3"), 3);
});

test("detectConflicts: 片方だけ属性ありは conflict にしない", () => {
  const sup = extractAttributes("SanDisk microSD 256GB");
  const amz = extractAttributes("SanDisk microSD"); // 容量不明
  const { conflicts } = detectConflicts(sup, amz);
  assert.ok(!conflicts.includes("capacity"));
});
