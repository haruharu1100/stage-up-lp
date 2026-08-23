/**
 * 名前の状態を点検する。
 *
 * 見るのは3つ。
 *   1. 商標調査台帳（data/identity-screening.csv）が LOCK してよい状態か
 *   2. lib/identity.ts の identity_status が、その台帳と食い違っていないか
 *   3. 名前と顔が別々に管理されているか（片方が決まっても、もう片方を自動で決めない）
 *
 * ★このスクリプトは identity_status を書き換えない。
 *   人が lib/identity.ts を編集して確定させ、ここは食い違いを見つけて止めるだけにする。
 *   機械が自分で「確定」にできると、調べ終わっていないのに前へ進んでしまう。
 *
 * 実行: npm run identity:check
 */
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHARACTER_IDENTITY,
  POST_LOCK_STEPS,
  decideLock,
  displayName,
  publishGate,
  NAME_POLICY,
  SURFACE_LABEL,
  type ScreeningItem,
  type ScreeningStatus,
} from "../lib/identity.js";
import { SCREENING_CSV, loadScreening } from "../lib/screening.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");
const CSV = SCREENING_CSV;

const bar = (n = 88) => "─".repeat(n);
const MARK: Record<ScreeningStatus, string> = { CLEAR: "⭕", CONFLICT: "✕", UNKNOWN: "？" };

// --- 台帳を読む -------------------------------------------------------------
// 読み込みは lib/screening.ts に一本化している。
// ここで自前にパースし直すと、gate と identity:check で結論が食い違う。

const items: ScreeningItem[] = loadScreening(CSV);
if (!existsSync(CSV)) {
  console.log(`商標調査台帳がありません: ${CSV}`);
  console.log("（台帳が無い＝まだ何も調べていない、として扱います）");
}

// --- 出力 -------------------------------------------------------------------

let ng = 0;
const fail = (msg: string) => { ng++; console.log(`  ✕ ${msg}`); };

console.log(bar());
console.log(`名前の状態: ${CHARACTER_IDENTITY.full_name}（${CHARACTER_IDENTITY.full_name_ja}）`);
console.log(bar());
console.log(`  正式名 full_name   : ${CHARACTER_IDENTITY.full_name}`);
console.log(`  下の名前 given_name : ${CHARACTER_IDENTITY.given_name}`);
console.log(`  姓 family_name      : ${CHARACTER_IDENTITY.family_name}`);
console.log(`  identity_status       : ${CHARACTER_IDENTITY.identity_status}`);
console.log(`    理由: ${CHARACTER_IDENTITY.identity_status_reason}`);
console.log(`  reference_face_status : ${CHARACTER_IDENTITY.reference_face_status}`);
console.log(`    理由: ${CHARACTER_IDENTITY.reference_face_status_reason}`);
console.log(`  表示名（確定後に使う）: ${displayName()}`);

console.log(`\n${bar()}\n商標・同名の調査台帳（${CSV.replace(root + "/", "")}）\n${bar()}`);
if (items.length === 0) {
  console.log("  1件も記入されていません。");
} else {
  for (const it of items) {
    const req = it.required ? "必須" : "任意";
    console.log(
      `  ${MARK[it.status]} [${req}] ${it.id.padEnd(18)} ${it.registry}` +
        (it.checkedAt ? `（${it.checkedAt}）` : "（未確認）"),
    );
    if (it.note) console.log(`        ${it.note}`);
  }
}

const decision = decideLock(items);
console.log(`\n  台帳から見た、あるべき状態: ${decision.suggested}`);
console.log(`  ${decision.reason}`);

console.log(`\n${bar()}\n食い違いの検査\n${bar()}`);

if (CHARACTER_IDENTITY.identity_status === "LOCKED" && !decision.canLock) {
  fail(
    `identity_status が LOCKED になっていますが、台帳はまだ ${decision.suggested} です。` +
      `調べ終わっていない項目を「問題なし」として先へ進めることになります`,
  );
} else if (CHARACTER_IDENTITY.identity_status !== "REJECTED" && decision.suggested === "REJECTED") {
  fail(`台帳に重大な衝突があります。identity_status を REJECTED にして名前候補フェーズへ戻してください`);
} else {
  console.log(`  ⭕ identity_status（${CHARACTER_IDENTITY.identity_status}）と台帳（${decision.suggested}）に食い違いなし`);
}

if (decision.canLock && CHARACTER_IDENTITY.identity_status === "PROVISIONAL") {
  console.log("  ！ 台帳は揃っています。lib/identity.ts の identity_status を LOCKED にしてよい状態です（変更は人が行う）");
}

// 名前が確定しても顔は自動で確定しない
if (
  CHARACTER_IDENTITY.identity_status === "LOCKED" &&
  CHARACTER_IDENTITY.reference_face_status === "LOCKED"
) {
  console.log("  ⭕ 名前も基準顔も確定済み");
} else {
  console.log(
    `  ⭕ 名前と顔は別々に管理されています（名前=${CHARACTER_IDENTITY.identity_status} / 顔=${CHARACTER_IDENTITY.reference_face_status}）`,
  );
}

console.log(`\n${bar()}\n名前の書き方のルール（使用場所別）\n${bar()}`);
const strict = Object.entries(NAME_POLICY).filter(([, p]) => p === "BRAND_IDENTITY_STRICT");
const natural = Object.entries(NAME_POLICY).filter(([, p]) => p === "CONTENT_NATURAL");
console.log(`  必ずフルネーム（BRAND_IDENTITY_STRICT）${strict.length}箇所:`);
for (const [k] of strict) console.log(`    - ${SURFACE_LABEL[k as keyof typeof SURFACE_LABEL]}`);
console.log(`  下の名前だけでもよい（CONTENT_NATURAL）${natural.length}箇所:`);
for (const [k] of natural) console.log(`    - ${SURFACE_LABEL[k as keyof typeof SURFACE_LABEL]}`);
console.log(`  ※ 別姓・別名（例 "${CHARACTER_IDENTITY.given_name} Tanaka"）は場所を問わず常にBLOCK`);

console.log(`\n${bar()}\n本番公開してよいか\n${bar()}`);
// 台帳を渡す。渡さないと ACCOUNT ゲート（IDが取れるか）を見ないまま
// 「顔さえ決まれば公開できる」ように読めてしまう。
const gate = publishGate(CHARACTER_IDENTITY, { screenings: items });
console.log(`  ${gate.ok ? "⭕" : "✕"} 本番公開${gate.ok ? "可" : "不可"}`);
for (const b of gate.blockers) console.log(`     - ${b}`);
if (gate.ok) console.log(`     ${gate.message}`);

console.log(`\n${bar()}\n名前が確定した後の順番\n${bar()}`);
for (const s of POST_LOCK_STEPS) {
  console.log(`  ${s.done ? "済" : "未"} ${String(s.step).padStart(2)}. ${s.label}`);
}

console.log(`\n${bar()}`);
if (ng > 0) {
  console.log(`❌ ${ng}件の食い違いがあります。直すまで先へ進まないでください。`);
  process.exit(1);
}
console.log("✅ 食い違いはありません。");
