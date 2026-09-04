// 商品照合エンジンの単体テスト（node:test）
// 実行: node --test scripts/test-matching.mjs   または   npm test
//
// Precision（誤仕入れ防止）最優先：似た別商品は必ず CONFLICT で弾く。
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  classifyMatch,
  classifyJanMatch,
  modelRelation,
  extractModels,
  extractModelCandidates,
  extractCapacities,
  extractConnectivity,
  extractPackCount,
  extractGeneration,
  extractEdition,
  detectConflicts,
  extractAttributes,
  janMatchesCode,
  janVerdict,
  extractProductType,
  extractModelCores,
  modelCoreConflict,
  detectVariantListing,
  priceRatioSanity,
  SUSPICIOUS_RATIO,
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

test("明示品番の完全一致 → MODEL_VERIFIED（自動対象・高信頼）", () => {
  const r = classify(
    "SanDisk Extreme SDSQXAV-256G サンディスク",
    "サンディスク SanDisk SDSQXAV-256G microSD",
    { supplierModel: "SDSQXAV-256G", amazonModel: "SDSQXAV-256G" }
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

test("JANなし+明示品番一致 → MODEL_VERIFIED", () => {
  const r = classify(
    "バッファロー 外付けSSD SSD-PGM480U3-B",
    "BUFFALO ポータブルSSD SSD-PGM480U3-B バッファロー",
    { supplierModel: "SSD-PGM480U3-B", amazonModel: "SSD-PGM480U3-B" }
  );
  assert.equal(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, true);
});

test("JANなし+名前だけ一致 → 自動対象外（ATTRIBUTE_REVIEW/NAME_UNVERIFIED/NO_MATCH）", () => {
  const r = classify(
    "おしゃれ 収納 ボックス 折りたたみ",
    "折りたたみ 収納 ボックス 便利"
  );
  assert.ok(
    ["NAME_UNVERIFIED", "ATTRIBUTE_REVIEW", "NO_MATCH"].includes(r.status)
  );
  assert.equal(r.autoEligible, false);
});

// ── 補助: 個別関数の単体確認 ───────────────────────────────

test("modelRelation: 接頭辞関係は conflict", () => {
  assert.equal(modelRelation(["spf040"], ["spf040u"]), "conflict");
  assert.equal(modelRelation(["sdsqunr128g"], ["sdsqunr256g"]), "conflict");
  assert.equal(modelRelation(["sdsqxav256g"], ["sdsqxav256g"]), "exact");
  assert.equal(modelRelation([], ["sdsqxav256g"]), "unknown");
});

// P0-1: 別コードが exact でも、強い型番 conflict が1つあれば conflict を優先する。
test("modelRelation: exactが混じっても conflict を優先", () => {
  assert.equal(
    modelRelation(["abc12345", "spf040"], ["abc12345", "spf040u"]),
    "conflict"
  );
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

test("extractPackCount: 明示なしは null（1と決めつけない）", () => {
  assert.equal(extractPackCount("USBケーブル"), null);
  assert.equal(extractPackCount("USBケーブル 2本セット"), 2);
  assert.equal(extractPackCount("マスク ×3"), 3);
  assert.equal(extractPackCount("USBケーブル 1本"), 1);
});

test("detectConflicts: 片方だけ属性ありは conflict にしない", () => {
  const sup = extractAttributes("SanDisk microSD 256GB");
  const amz = extractAttributes("SanDisk microSD"); // 容量不明
  const { conflicts } = detectConflicts(sup, amz);
  assert.ok(!conflicts.includes("capacity"));
});

// ── ChatGPT監査で追加した「意地悪」回帰テスト（P0/P1）─────────

// P0-1: スペック表記を型番として拾わない
test("型番抽出: 256GB / USB3.2 / 500ml / V30 は型番にしない", () => {
  assert.deepEqual(extractModels("SanDisk microSDXC 256GB Extreme"), []);
  assert.deepEqual(extractModels("エレコム USB3.2 Type-C ケーブル"), []);
  assert.deepEqual(extractModels("タイガー 水筒 500ml"), []);
  assert.deepEqual(extractModels("SanDisk microSD V30 UHS-I"), []);
  // 本物の型番はちゃんと拾う
  assert.ok(extractModels("HORI SPF-040U for PS5").includes("spf040u"));
  assert.ok(extractModels("エプソン IC4CL62 純正インク").includes("ic4cl62"));
});

test("id63相当: 256GB Extreme vs 256GB Extreme PRO → MODEL_VERIFIED禁止", () => {
  const r = classify(
    "SanDisk microSDXC 256GB Extreme サンディスク",
    "サンディスク SanDisk microSDXC 256GB Extreme PRO"
  );
  assert.notEqual(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, false);
});

test("USB3.2 だけ共通 → MODEL_VERIFIED禁止", () => {
  const r = classify(
    "エレコム USB3.2 ケーブル 商品A",
    "エレコム USB3.2 ケーブル 商品B"
  );
  assert.notEqual(r.status, "MODEL_VERIFIED");
});

test("V30 共通 → MODEL_VERIFIED禁止・世代扱いしない", () => {
  assert.equal(extractGeneration("SanDisk microSD V30"), null);
  const r = classify(
    "サンディスク microSD V30 タイプA",
    "キオクシア microSD V30 タイプB"
  );
  assert.notEqual(r.status, "MODEL_VERIFIED");
});

test("500ml 共通 → MODEL_VERIFIED禁止", () => {
  const r = classify("タイガー 水筒 500ml 保温", "サーモス 水筒 500ml 保冷");
  assert.notEqual(r.status, "MODEL_VERIFIED");
});

test("ABC-100 vs ABC-1000（接頭辞関係）→ CONFLICT", () => {
  const r = classify("メーカー部品 ABC-100", "メーカー部品 ABC-1000");
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("model"));
});

test("ABC123-BK vs ABC123-WH（枝番違い）→ CONFLICTまたは自動対象外", () => {
  const r = classify("パーツ ABC123-BK", "パーツ ABC123-WH");
  assert.equal(r.autoEligible, false);
  assert.ok(r.status === "CONFLICT" || r.status !== "MODEL_VERIFIED");
});

// P1-2: 数量不明 vs セット品は自動対象にしない
test("型番一致でも 数量不明 vs 2個セット → 自動対象禁止（MODEL_UNVERIFIED）", () => {
  const r = classify("エプソン 純正インク IC4CL62", "エプソン 純正インク IC4CL62 2個セット");
  assert.equal(r.status, "MODEL_UNVERIFIED");
  assert.equal(r.autoEligible, false);
});

// P1-1訂正: タイトル由来の型番一致は、数量とも未記載なら自動対象にしない。
test("タイトル由来型番一致・数量とも未記載 → MODEL_UNVERIFIED（自動対象外）", () => {
  const r = classify("エプソン 純正インク IC4CL62", "エプソン 純正インク IC4CL62");
  assert.equal(r.status, "MODEL_UNVERIFIED");
  assert.equal(r.autoEligible, false);
});

// 明示品番なら数量未記載でも自動対象（高信頼）。
test("明示品番の型番一致・数量とも未記載 → MODEL_VERIFIED（高信頼）", () => {
  const r = classify("エプソン 純正インク IC4CL62", "エプソン 純正インク IC4CL62", {
    supplierModel: "IC4CL62",
    amazonModel: "IC4CL62",
  });
  assert.equal(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, true);
});

// タイトル由来でも数量が両側一致していれば MODEL_VERIFIED（十分に安全）。
test("タイトル由来型番一致・数量も両側一致 → MODEL_VERIFIED", () => {
  const r = classify(
    "エプソン 純正インク IC4CL62 2個セット",
    "エプソン 純正インク IC4CL62 2個パック"
  );
  assert.equal(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, true);
});

// P0-2: JANは識別子で実照合できた時だけ一致
test("janMatchesCode: 識別子一覧にJANが有る時だけ true", () => {
  assert.equal(janMatchesCode("4901234567894", ["4901234567894"]), true);
  assert.equal(janMatchesCode("4901234567894", ["49-01234-567894"]), true); // 記号あり
  assert.equal(janMatchesCode("4901234567894", ["4988755123457"]), false); // 別コード
  assert.equal(janMatchesCode("4901234567894", []), false); // 取得不可
  assert.equal(janMatchesCode("4901234567894", null), false);
  assert.equal(janMatchesCode("", ["4901234567894"]), false);
});

// ── 第2回ChatGPT監査で追加した回帰テスト（P0-1/P0-2/P1-1/P1-2/P1-3）──

// 1. 共通ノイズ(USB3.1 Gen1)が一致しても、本物の型番違い(SPF-040 vs SPF-040U)を隠さない
test("USB3.1 Gen1 共通 + SPF-040 vs SPF-040U → CONFLICT（MODEL_VERIFIED禁止）", () => {
  const r = classify(
    "HORI USB3.1 Gen1 コントローラー SPF-040 有線",
    "HORI USB3.1 Gen1 ワイヤレスコントローラー SPF-040U"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("model"));
  assert.equal(r.autoEligible, false);
});

// 2. 読み書き速度(R:190MB/s)は型番にしない → 共通でも MODEL_VERIFIED禁止
test("R:190MB/s は型番にせず、共通でも MODEL_VERIFIED禁止", () => {
  assert.deepEqual(extractModels("SanDisk R:190MB/s W:130MB/s microSD"), []);
  const r = classify(
    "サンディスク microSD 256GB Extreme R:190MB/s",
    "キオクシア microSD 256GB EXCERIA R:190MB/s"
  );
  assert.notEqual(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, false);
});

// 3. 対応OS/機種の連結(PlayStation5 Windows)は型番にしない → MODEL_VERIFIED禁止
test("PlayStation5 Windows は型番にせず、共通でも MODEL_VERIFIED禁止", () => {
  assert.deepEqual(extractModels("for PlayStation5、Windows PC ファイトパッド"), []);
  const r = classify(
    "ファイティングコマンダー for PlayStation5、Windows PC",
    "別メーカー ファイトパッド for PlayStation5、Windows"
  );
  assert.notEqual(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, false);
});

// 4. Edition違い（Standard vs Deluxe）→ CONFLICT
test("Standard Edition vs Deluxe Edition → CONFLICT（edition）", () => {
  const r = classify(
    "ゲームソフト タイトルX Standard Edition 通常版",
    "ゲームソフト タイトルX Deluxe Edition デラックス"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("edition"));
});
test("extractEdition: 版の識別", () => {
  assert.deepEqual(extractEdition("通常版 Standard"), ["standard"]);
  assert.deepEqual(extractEdition("限定版").sort(), ["limited"]);
  assert.deepEqual(extractEdition("ダウンロード版"), ["digital"]);
  assert.deepEqual(extractEdition("普通の商品"), []);
});

// 5. 同一の高信頼model + 双方packCount不明 → MODEL_VERIFIED（方針通り）
test("高信頼model一致 + 数量双方不明 → MODEL_VERIFIED", () => {
  const r = classify("エプソン インク IC6CL50", "エプソン インク IC6CL50", {
    supplierModel: "IC6CL50",
    amazonModel: "IC6CL50",
  });
  assert.equal(r.status, "MODEL_VERIFIED");
  assert.equal(r.autoEligible, true);
});

// 6. 低信頼のタイトル由来model一致 + 数量不明 → 自動対象禁止（MODEL_UNVERIFIED）
test("低信頼title model一致 + 数量不明 → MODEL_UNVERIFIED（自動対象外）", () => {
  const cand = extractModelCandidates("ガジェット a1b2c タイプA", null);
  assert.ok(cand.some((c) => c.value === "a1b2c" && c.confidence === "low"));
  const r = classify("ガジェット a1b2c タイプA", "ガジェット a1b2c タイプB");
  assert.equal(r.status, "MODEL_UNVERIFIED");
  assert.equal(r.autoEligible, false);
});

// 型番候補の信頼度：明示欄=high / タイトルの型番形=medium
test("extractModelCandidates: 信頼度の付与", () => {
  assert.equal(extractModelCandidates("IC4CL62", "high")[0].confidence, "high");
  const t = extractModelCandidates("HORI SPF-040U", null);
  assert.ok(t.some((c) => c.value === "spf040u" && c.confidence === "medium"));
});

// 7-9. JANの3値判定（未取得 / 一致 / 不一致）
test("janVerdict: 識別子未取得は unknown", () => {
  assert.equal(janVerdict("4901234567894", []), "unknown");
  assert.equal(janVerdict("4901234567894", null), "unknown");
  assert.equal(janVerdict("", ["4901234567894"]), "unknown");
});
test("janVerdict: 識別子ありで一致は verified", () => {
  assert.equal(janVerdict("4901234567894", ["4901234567894"]), "verified");
  assert.equal(janVerdict("4901234567894", ["49-01234-567894", "0885170123456"]), "verified");
});
test("janVerdict: 識別子ありで不一致は conflict（reject対象）", () => {
  assert.equal(janVerdict("4901234567894", ["4988755123457"]), "conflict");
  assert.equal(janVerdict("4901234567894", ["4988755123457", "0885170123456"]), "conflict");
});

// ── JAN一致とASIN選択の分離（classifyJanMatch）: 第4フェーズ実測の発見に対応 ──

// ⑨-6: JAN一致 + タイトル/型番も一致 → JAN_VERIFIED（productIdentityVerified=true・自動対象）
test("classifyJanMatch: JAN一致＋タイトル整合 → JAN_VERIFIED（両検証true）", () => {
  const r = classifyJanMatch({
    supplierName: "エプソン 純正 インク IC4CL62 4色パック",
    supplierJan: "4988617060852",
    candidateTitle: "エプソン 純正 インクカートリッジ IC4CL62 4色パック",
    candidateCodes: ["4988617060852"],
  });
  assert.equal(r.status, "JAN_VERIFIED");
  assert.equal(r.productIdentityVerified, true);
  assert.equal(r.asinSelectionVerified, true);
  assert.equal(r.autoEligible, true);
});

// ⑨-7: JAN一致 + 属性矛盾（容量違い） → JAN_CONFLICT（reject・自動対象外）
test("classifyJanMatch: JAN一致でも属性矛盾 → JAN_CONFLICT（reject）", () => {
  const r = classifyJanMatch({
    supplierName: "SanDisk microSD 512GB Extreme",
    supplierJan: "4901234567894",
    candidateTitle: "SanDisk microSD 1TB Extreme", // 容量が食い違う別ASIN
    candidateCodes: ["4901234567894"], // 同一JANだが別ASIN
  });
  assert.equal(r.status, "JAN_CONFLICT");
  assert.equal(r.productIdentityVerified, true);
  assert.equal(r.asinSelectionVerified, false);
  assert.equal(r.autoEligible, false);
});

// ⑨-8: JAN一致だがタイトル無関係 → JAN_VERIFIED_ASIN_REVIEW（自動最終確定禁止）
test("classifyJanMatch: JAN一致でもASIN選択の裏付け不足 → 自動対象外", () => {
  const r = classifyJanMatch({
    supplierName: "ノーブランド 便利グッズ",
    supplierJan: "4901234567894",
    candidateTitle: "全く別のカテゴリの商品タイトル 家具 収納 木製",
    candidateCodes: ["4901234567894"],
  });
  assert.equal(r.status, "JAN_VERIFIED_ASIN_REVIEW");
  assert.equal(r.productIdentityVerified, true);
  assert.equal(r.asinSelectionVerified, false);
  assert.equal(r.autoEligible, false);
});

// 識別子不一致 → JAN_CONFLICT（identityも立たない）
test("classifyJanMatch: 識別子不一致 → JAN_CONFLICT", () => {
  const r = classifyJanMatch({
    supplierName: "何かの商品",
    supplierJan: "4901234567894",
    candidateTitle: "別の商品",
    candidateCodes: ["4988755123457"],
  });
  assert.equal(r.status, "JAN_CONFLICT");
  assert.equal(r.productIdentityVerified, false);
  assert.equal(r.autoEligible, false);
});

// 識別子未取得 → JAN_LOOKUP_UNVERIFIED（自動対象外）
test("classifyJanMatch: 識別子未取得 → JAN_LOOKUP_UNVERIFIED", () => {
  const r = classifyJanMatch({
    supplierName: "何かの商品",
    supplierJan: "4901234567894",
    candidateTitle: "何かの商品",
    candidateCodes: [],
  });
  assert.equal(r.status, "JAN_LOOKUP_UNVERIFIED");
  assert.equal(r.productIdentityVerified, false);
  assert.equal(r.autoEligible, false);
});

// ═══════════════════════════════════════════════════════════════
// 第6フェーズ 安全設計①〜④ の回帰テスト
//   ADVERSARIAL #1 で判明した5誤検出(FP)を二度と自動対象に通さない。
//   ★特定商品名のブラックリストではなく、一般化した判定で弾く：
//     ① JAN出所の信頼度（low/medium は自動対象外）
//     ② JAN一致後のSECOND GATE（数字違い型番コア・商品種別の矛盾）
//     ③ 商品種別（product type）分類
//     ④ まとめ出品（多variant）検知
// ═══════════════════════════════════════════════════════════════

// ── 基礎関数 ──────────────────────────────────────────────────
test("extractProductType: マウス/キーボード/ハブ等を分類", () => {
  assert.ok(extractProductType("ロジクール ワイヤレスマウス M550").has("mouse"));
  assert.ok(extractProductType("MX KEYS mini キーボード").has("keyboard"));
  assert.ok(extractProductType("エレコム USBハブ 4ポート").has("hub"));
  assert.ok(extractProductType("エプソン インクカートリッジ IC4CL62").has("ink"));
  assert.equal(extractProductType("なにか汎用グッズ").size, 0); // 不明は推測しない
});

test("extractModelCores + modelCoreConflict: 数字だけ違う型番は別モデル", () => {
  assert.ok(extractModelCores("ロジクール M550 マウス").includes("m550"));
  assert.equal(modelCoreConflict(["m550"], ["m650mgr", "m650"]), true); // M550↔M650
  assert.equal(modelCoreConflict(["g304"], ["g703h"]), true);          // G304↔G703
  assert.equal(modelCoreConflict(["m650"], ["m650mgr", "m650"]), false); // 完全一致コアあり→矛盾にしない
  assert.equal(modelCoreConflict([], ["m650"]), false);                // 片方不明→矛盾にしない
});

test("detectVariantListing: まとめ出品（容量選択）を検知", () => {
  assert.equal(detectVariantListing("microSD 64GB/128GB/256GB お選びください"), true);
  assert.equal(detectVariantListing("SanDisk microSD 128GB Extreme"), false); // 単一容量は誤検知しない
});

// ── ① JAN出所の信頼度：low/medium は自動対象にしない ─────────────
test("① 低信頼JAN（本文/detail由来）はタイトル整合でも自動対象にしない", () => {
  const base = {
    supplierName: "エプソン 純正 インク IC4CL62 4色パック",
    supplierJan: "4988617060852",
    candidateTitle: "エプソン 純正 インクカートリッジ IC4CL62 4色パック",
    candidateCodes: ["4988617060852"],
  };
  const hi = classifyJanMatch({ ...base, janConfidence: "high" });
  assert.equal(hi.status, "JAN_VERIFIED");
  assert.equal(hi.autoEligible, true);
  const lo = classifyJanMatch({ ...base, janConfidence: "low" });
  assert.equal(lo.status, "JAN_SOURCE_UNVERIFIED");
  assert.equal(lo.autoEligible, false);
  const md = classifyJanMatch({ ...base, janConfidence: "medium" });
  assert.equal(md.autoEligible, false); // MEDIUM も原則自動禁止
});

// ── ⑤-C028 純正 vs リサイクル（低信頼JAN）→ 自動対象外 ───────────
test("C028: 純正EPSON vs JITリサイクル（低信頼JAN）→ 自動対象外", () => {
  const r = classifyJanMatch({
    supplierName: "EPSON エプソン 純正 IC4CL62 箱袋なし",
    supplierJan: "4530966710492",
    candidateTitle: "JIT リサイクル インク JIT-E624P エプソン用 2箱セット",
    candidateCodes: ["4530966710492"],
    janConfidence: "low",
  });
  assert.equal(r.autoEligible, false);
});

// ── ⑤-C035 BC-345XL vs BCI-331（低信頼JAN）→ 自動対象外 ──────────
test("C035: キヤノン BC-345XL vs BCI-331（低信頼JAN）→ 自動対象外", () => {
  const r = classifyJanMatch({
    supplierName: "キヤノン BC-345XL BC-346XL 大容量 純正",
    supplierJan: "4549292245837",
    candidateTitle: "Canon 純正 BCI-331+330/5MP 5色マルチパック",
    candidateCodes: ["4549292245837"],
    janConfidence: "low",
  });
  assert.equal(r.autoEligible, false);
});

// ── ⑤-C071 M550 vs M650 → ② SECOND GATE で高信頼JANでも弾く ─────
test("C071: ロジクール M550 vs M650（数字違い型番）→ 高信頼JANでも JAN_CONFLICT", () => {
  const r = classifyJanMatch({
    supplierName: "マウス ワイヤレス ロジクール M550 Signature 無線 静音",
    supplierJan: "4943765055976",
    candidateTitle: "ロジクール ワイヤレスマウス Signature M650MGR M650 国内正規品",
    candidateCodes: ["4943765055976"],
    janConfidence: "high", // ★出所が高信頼でも、型番の明白な矛盾で止める
  });
  assert.equal(r.status, "JAN_CONFLICT");
  assert.equal(r.autoEligible, false);
});

// ── ⑤-C073 G304 vs G703 → ② SECOND GATE で弾く ─────────────────
test("C073: Logicool G304 vs G703（数字違い型番）→ 高信頼JANでも JAN_CONFLICT", () => {
  const r = classifyJanMatch({
    supplierName: "Logicool G ゲーミングマウス G304 LIGHTSPEED 無線",
    supplierJan: "4943765049869",
    candidateTitle: "ロジクール G703h LIGHTSPEED ワイヤレス ゲーミングマウス",
    candidateCodes: ["4943765049869"],
    janConfidence: "high",
  });
  assert.equal(r.status, "JAN_CONFLICT");
  assert.equal(r.autoEligible, false);
});

// ── ⑤-C074 マウス vs キーボード → ③ 商品種別で弾く ──────────────
test("C074: MX ANYWHERE 3S(マウス) vs MX KEYS mini(キーボード)→ 高信頼JANでも JAN_CONFLICT", () => {
  const r = classifyJanMatch({
    supplierName: "ロジクール MX ANYWHERE 3S ワイヤレスマウス",
    supplierJan: "4943765056560",
    candidateTitle: "ロジクール MX KEYS mini ワイヤレスキーボード",
    candidateCodes: ["4943765056560"],
    janConfidence: "high", // ★商品種別（マウス↔キーボード）の矛盾で止める
  });
  assert.equal(r.status, "JAN_CONFLICT");
  assert.equal(r.autoEligible, false);
});

// ── ② 名前経路でも数字違い型番は CONFLICT ───────────────────────
test("名前経路: M550 vs M650 → CONFLICT（model）", () => {
  const r = classify(
    "ロジクール ワイヤレスマウス M550 無線",
    "ロジクール ワイヤレスマウス M650 無線"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("model"));
});

// ── ③ 名前経路でも商品種別違いは CONFLICT ───────────────────────
test("名前経路: マウス vs キーボード → CONFLICT（productType）", () => {
  const r = classify(
    "ロジクール MX ワイヤレスマウス",
    "ロジクール MX ワイヤレスキーボード"
  );
  assert.equal(r.status, "CONFLICT");
  assert.ok(r.conflicts.includes("productType"));
});

// ── ④ まとめ出品は型番一致でも自動対象外（VARIANT_PRICE_UNVERIFIED）──
test("④ まとめ出品（容量選択）は型番一致でも自動対象外", () => {
  // 型番(SDSSDE61)は両側一致するが、仕入れ側が容量を1ページで選ばせる多variant出品。
  // 表示価格が対象variantと一意に結び付かない→自動対象外(VARIANT_PRICE_UNVERIFIED)。
  const r = classify(
    "SanDisk SDSSDE61 ポータブルSSD 500GB/1TB/2TB 容量をお選びください",
    "SanDisk SDSSDE61 ポータブルSSD 1TB"
  );
  assert.equal(r.status, "VARIANT_PRICE_UNVERIFIED");
  assert.equal(r.autoEligible, false);
});

// ── 正しいJANは引き続き強く通す（過剰killの回帰防止）──────────────
test("高信頼JAN＋種別/型番とも整合 → JAN_VERIFIED（正しいものは通す）", () => {
  const r = classifyJanMatch({
    supplierName: "パナソニック エネループ 単3形 8本 BK-3MCDK/8H",
    supplierJan: "4549077496324",
    candidateTitle: "Panasonic eneloop 単3形 8本パック BK-3MCDK/8H",
    candidateCodes: ["4549077496324"],
    janConfidence: "high",
  });
  assert.equal(r.status, "JAN_VERIFIED");
  assert.equal(r.autoEligible, true);
});

// ── 価格比の異常検知（誤マッチ由来の「安く仕入れて超高値で売れる」偽利益を弾く）──
// クレーム/賠償防止：型番・名前だけの弱い照合で売値が仕入値の何倍にもなる案件は
// 「本当は別商品」の可能性が高い。JANで裏取りできているものは倍率が高くても通す。
test("名前照合＋売値が仕入の3倍超 → reject（自動通知させない）", () => {
  const r = priceRatioSanity({ buyPrice: 1000, salePrice: 7400, verified: "name" });
  assert.equal(r.ok, false);
  assert.equal(r.action, "reject");
});

test("名前照合＋正常な倍率（3倍以内）→ keep", () => {
  const r = priceRatioSanity({ buyPrice: 1000, salePrice: 2500, verified: "name" });
  assert.equal(r.ok, true);
  assert.equal(r.action, "keep");
});

test("型番照合＋売値が仕入の8倍超 → downgrade（要確認に落とす）", () => {
  const r = priceRatioSanity({ buyPrice: 500, salePrice: 5000, verified: "model" });
  assert.equal(r.ok, false);
  assert.equal(r.action, "downgrade");
});

test("型番照合＋倍率が8倍以内 → keep（正常な型番一致は通す）", () => {
  const r = priceRatioSanity({ buyPrice: 1000, salePrice: 6000, verified: "model" });
  assert.equal(r.ok, true);
  assert.equal(r.action, "keep");
});

test("JAN照合はどれだけ倍率が高くても keep（裏取り済みは信頼する）", () => {
  const r = priceRatioSanity({ buyPrice: 300, salePrice: 9000, verified: "jan" });
  assert.equal(r.ok, true);
  assert.equal(r.action, "keep");
});

test("仕入値/売値が0や不明のときは keep（誤った除外をしない）", () => {
  assert.equal(priceRatioSanity({ buyPrice: 0, salePrice: 5000, verified: "name" }).action, "keep");
  assert.equal(priceRatioSanity({ buyPrice: 1000, salePrice: 0, verified: "name" }).action, "keep");
  assert.equal(priceRatioSanity({ buyPrice: null, salePrice: null, verified: "model" }).action, "keep");
});

test("しきい値は name=3 / model=8（設定値の回帰防止）", () => {
  assert.equal(SUSPICIOUS_RATIO.name, 3);
  assert.equal(SUSPICIOUS_RATIO.model, 8);
  // 境界値：ちょうど3倍・8倍は許容、少しでも超えたらNG
  assert.equal(priceRatioSanity({ buyPrice: 1000, salePrice: 3000, verified: "name" }).ok, true);
  assert.equal(priceRatioSanity({ buyPrice: 1000, salePrice: 3001, verified: "name" }).ok, false);
  assert.equal(priceRatioSanity({ buyPrice: 1000, salePrice: 8000, verified: "model" }).ok, true);
  assert.equal(priceRatioSanity({ buyPrice: 1000, salePrice: 8001, verified: "model" }).ok, false);
});
