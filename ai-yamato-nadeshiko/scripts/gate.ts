/**
 * 今なにをしてよくて、なにをしてはいけないかを1画面で出す。
 *
 * 実行: npm run gate
 *
 * ★このスクリプトは何も書き換えない。状態を読んで表示するだけ。
 */
import {
  ACTION_LABEL,
  can,
  currentState,
  nextStepFor,
  orderedSteps,
  type Action,
} from "../lib/phases.js";
import { CHARACTER_IDENTITY } from "../lib/identity.js";
import { SCREENING_CSV, loadScreening, remainingRequired } from "../lib/screening.js";

const bar = (n = 78) => "─".repeat(n);
const state = currentState();
const items = loadScreening();
const remaining = remainingRequired(items);

console.log(bar());
console.log(`AI YAMATO NADESHIKO — 今どこまで進んでよいか`);
console.log(bar());
console.log(`  名前   ${CHARACTER_IDENTITY.full_name}（${CHARACTER_IDENTITY.full_name_ja}）: ${CHARACTER_IDENTITY.identity_status}`);
console.log(`  基準顔 ${CHARACTER_IDENTITY.reference_face_status}`);
console.log(`  顔一致の実測処理: ${state.faceMatcherReady ? "あり" : "まだ無い"}`);

console.log(`\n${bar()}\n進み具合（この順番以外では進めない）\n${bar()}`);
const steps = orderedSteps(state);
for (const s of steps) {
  const who = s.humanOnly ? "人" : "機械";
  console.log(`  ${s.done ? "済" : "未"} ${String(s.step).padStart(2)}. [${who}] ${s.label}`);
}
const doneCount = steps.filter((s) => s.done).length;
console.log(`\n  ${doneCount}/${steps.length} 完了`);

console.log(`\n${bar()}\n操作ごとの可否\n${bar()}`);
const ACTIONS: Action[] = [
  "WRITE_DRAFTS_AND_TESTS",
  "LOCK_IDENTITY",
  "GENERATE_FACE_CANDIDATES",
  "LOCK_REFERENCE_FACE",
  "BUILD_FACE_MATCHER",
  "GENERATE_WEEK_POSTS",
  "PREPARE_X_PROFILE",
];
for (const a of ACTIONS) {
  const v = can(a, state);
  console.log(`  ${v.allowed ? "⭕ できる  " : "✕ できない"} ${ACTION_LABEL[a]}`);
  if (!v.allowed) for (const b of v.blockers) console.log(`              └ ${b}`);
}

if (remaining.length > 0) {
  console.log(`\n${bar()}\n★いま止まっている本当の原因（コードではない）\n${bar()}`);
  console.log(`  商標・同名調査の必須項目が ${remaining.length}件 未実測です。`);
  console.log(`  ここが埋まるまで、機能を足しても前に進みません。\n`);
  for (const r of remaining) {
    const it = items.find((i) => i.id === r.id);
    console.log(`  ？ ${r.id.padEnd(18)} ${r.registry}`);
    if (it?.note) console.log(`       ${it.note}`);
  }
  console.log(`\n  書き込む場所: ${SCREENING_CSV}`);
  console.log(`  書き方: status を CLEAR か CONFLICT にし、checked_at（確認日）と source_url（出典）を必ず埋める`);
  console.log(`         → どちらかが空だと自動で UNKNOWN に戻します（根拠の無い「問題なし」を残さないため）`);
}

console.log(`\n${bar()}\n次にやること（1つだけ）\n${bar()}`);
console.log(`  ${nextStepFor(state)}`);
console.log("");
