// 第N週の21本だけ本文を確定する。
//   npm run plan:week -- --week 1
//   npm run plan:week -- --week 2 --dry-run   … 本文を見るだけ（DBに書かない）
//
// 前週の実測が入っていなければ拒否する。90本を先に書かない設計の目的が
// 「前の7日の実測を次の7日へ反映すること」なので、実測が無いなら書く意味がない。

import {
  CATEGORY_PLAN,
  TIME_SLOTS,
  TOTAL_WEEKS,
  WEEKDAY_JA,
  daysOfWeek,
  fillWeek,
} from "../lib/planner.js";
import { EXPLORATORY_MIN_POSTS, METRIC_LABEL, MIN_SAMPLE } from "../lib/attributes.js";
import { requireAllowed } from "../lib/phases.js";

// 名前・基準顔・顔一致の実測処理が揃うまで本文を作らない。
// 先に作っても、上流（名前や顔）が動いた瞬間に全部書き直しになる。
// --dry-run も止める。捨てることが決まっている文章を読む時間が無駄になるため。
requireAllowed("GENERATE_WEEK_POSTS");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

const weekArg = arg("week");
const dryRun = arg("dry-run") === "true";

if (!weekArg || !/^\d+$/.test(weekArg)) {
  console.error(`週の指定が必要です: npm run plan:week -- --week 1  （1〜${TOTAL_WEEKS}）`);
  process.exit(1);
}
const week = Number(weekArg);

const catLabel = (k: string) => CATEGORY_PLAN.find((c) => c.key === k)?.label ?? k;
const timeLabel = (k: string) => TIME_SLOTS.find((t) => t.key === k)?.label ?? k;

const outcome = await fillWeek(week, { dryRun });

console.log("");
console.log("=".repeat(72));
console.log(`第${week}週の本文確定  Day${daysOfWeek(week)[0]}〜Day${daysOfWeek(week).at(-1)}`);
console.log("=".repeat(72));
console.log("");

if (!outcome.ok) {
  const r = outcome.readiness;
  console.error("[拒否] 第" + week + "週の本文は作れません。DBには何も書いていません。");
  console.error("");
  console.error("■ 理由");
  for (const reason of r.reasons) console.error(`  ・${reason}`);
  if (r.missing.length > 0) {
    console.error("");
    console.error(`■ 実績が取れていない投稿（${r.missing.length}件）`);
    for (const m of r.missing.slice(0, 10)) console.error(`  ・${m}`);
    if (r.missing.length > 10) console.error(`  ・ほか ${r.missing.length - 10}件`);
  }
  if (r.hints.length > 0) {
    console.error("");
    console.error("■ 次にやること");
    for (const h of r.hints) console.error(`  ・${h}`);
  }
  console.error("");
  console.error("この拒否は不具合ではありません。前の7日の結果を見ないまま次の7日を書くと、");
  console.error("30日走らせても『何が効いたのか』が最後まで分からないまま終わります。");
  process.exit(1);
}

const { result, report } = outcome;

// ── 前週までの実績をどう反映したか ────────────────────────────────
console.log("■ 前週までの実績の反映");
if (week === 1) {
  console.log("  第1週は実績がまだ無いので、どこにも寄せずに全パターンを均等に配ります。");
} else if (!result.tilt) {
  console.log("  寄せられる差が見つかりませんでした（比較できる本数に届いた属性が無い）。");
  console.log(`  実績のある投稿 ${report.totalPostsWithMetrics}本 / 判定指標 ${METRIC_LABEL[report.metric]}`);
} else {
  const t = result.tilt;
  console.log(`  判定指標: ${METRIC_LABEL[t.metric]}`);
  console.log(
    `  寄せる属性: ${t.dimension} = ${t.value}（n=${t.leaderPosts}本） ` +
      `↔ ${t.runnerUp}（n=${t.runnerUpPosts}本） 差 ${t.gapPct.toFixed(1)}%`,
  );
  if (report.totalPostsWithMetrics < MIN_SAMPLE.POST_PATTERN) {
    console.log(
      `  ★これは結論ではありません。実績のある投稿は ${report.totalPostsWithMetrics}本 で、` +
        `原因を書いてよい ${MIN_SAMPLE.POST_PATTERN}本 に届いていません。`,
    );
  } else {
    console.log(
      `  ★これは「原因の最有力候補」です（実績のある投稿 ${report.totalPostsWithMetrics}本）。` +
        `断定ではなく、次の7日で確かめにいきます。`,
    );
  }
  console.log(
    `  ★寄せたのは1属性だけ、しかも3枠に1枠は元の型を残しています（同時に2つ変えると原因が分からなくなるため）。`,
  );
  if (t.coChanged.length > 0) {
    console.log("  ⚠ 比べた2群では、次の属性も同時に変わっています（どちらが効いたか分離できません）:");
    for (const c of t.coChanged) console.log(`     ・${c.dimension}: ${c.detail}`);
  }
  if (t.leaderPosts < EXPLORATORY_MIN_POSTS || t.runnerUpPosts < EXPLORATORY_MIN_POSTS) {
    console.log(`  ⚠ 比較した群の本数が ${EXPLORATORY_MIN_POSTS}本 未満です。ほぼ偶然の可能性があります。`);
  }
}
console.log("");

// ── この週の21本 ─────────────────────────────────────────────
console.log(`■ この週の枠と本文（${result.drafts.length}本）`);
console.log(
  `  ${"日".padEnd(6)} ${"時間帯".padEnd(8, "　")} ${"カテゴリ".padEnd(10, "　")} ${"型".padEnd(12)} ${"フック".padEnd(14)} ${"文字数".padStart(5)}  リンク`,
);
for (const d of result.drafts) {
  const s = d.slot;
  const link = s.hasLink ? (s.expGroup === "A" ? "A案(リプライ)" : "B案(本文内)") : "—";
  console.log(
    `  Day${String(s.dayIndex).padStart(2)}(${WEEKDAY_JA[s.weekday]}) ${timeLabel(s.timeSlot).padEnd(8, "　")} ` +
      `${catLabel(s.category).padEnd(10, "　")} ${d.style.padEnd(12)} ${d.hook.padEnd(14)} ` +
      `${String(d.text.length).padStart(5)}  ${link}`,
  );
}
console.log("");

// 先頭3本は全文を出す（人が中身を見ないまま承認しないため）
console.log("■ 本文サンプル（先頭3本。全文は承認画面で確認してください）");
for (const d of result.drafts.slice(0, 3)) {
  console.log("  " + "-".repeat(68));
  console.log(`  Day${d.slot.dayIndex} 枠${d.slot.slotOfDay} ${catLabel(d.slot.category)} / ${d.style}`);
  for (const line of d.text.split("\n")) console.log(`    ${line}`);
  if (d.replyText) {
    console.log(`    ── A案リプライ ──`);
    for (const line of d.replyText.split("\n")) console.log(`    ${line}`);
  }
}
console.log("  " + "-".repeat(68));
console.log("");

const withLink = result.drafts.filter((d) => d.slot.hasLink).length;
console.log("■ この週の予定コスト（X API・投稿1件ごとに1行で記録）");
console.log(`  投稿 ${result.drafts.length}本（うちリンク有 ${withLink}本） 予定 $${result.costUsd.toFixed(3)}`);
console.log(`  1本あたり平均 $${(result.costUsd / Math.max(1, result.drafts.length)).toFixed(4)}`);
console.log("");

if (result.rejectedDuplicates > 0) {
  console.log(`■ 重複として捨てた案: ${result.rejectedDuplicates}件（既存本文との類似度0.9以上）`);
  console.log("");
}

if (dryRun) {
  console.log("[dry-run] 本文を組んだだけで、DBには書いていません。");
  process.exit(0);
}

console.log("=".repeat(72));
console.log(`[完了] 第${week}週 ${result.drafts.length}本を下書き(draft)で保存しました。`);
console.log("  ※ compliance_passed=0 です。投稿前に必ずコンプラチェックと人の承認を通してください。");
const next = week + 1;
if (next <= TOTAL_WEEKS) {
  console.log(`  次にやること: 第${week}週を投稿 → 実績を取り込む → npm run plan:week -- --week ${next}`);
} else {
  console.log("  これで30日分の本文が全部そろいました。npm run learn:attributes で最終集計へ。");
}
console.log("=".repeat(72));
console.log("");
