// 90枠を生成して検証する。
//   npm run plan:slots               … 既定の開始日で生成
//   npm run plan:slots -- --start 2026-09-01
//   npm run plan:slots -- --dry-run  … 検証だけしてDBに書かない
//
// 検証を1つでも落としたら保存しない。偏った計画を黙って作らないため。

import {
  DEFAULT_START_DATE,
  TOTAL_SLOTS,
  WEEKDAY_JA,
  buildSlots,
  loadSlots,
  renderVerifyReport,
  saveSlots,
  verifySlots,
  CATEGORY_PLAN,
  TIME_SLOTS,
} from "../lib/planner.js";
import { notify } from "../lib/db.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

const startDate = arg("start") ?? process.env.PLAN_START_DATE ?? DEFAULT_START_DATE;
const dryRun = arg("dry-run") === "true";

if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
  console.error(`開始日の形式が不正です: ${startDate}（例: 2026-09-01）`);
  process.exit(1);
}

const existing = await loadSlots();
const filled = existing.filter((s) => s.filled);
if (filled.length > 0 && !dryRun) {
  console.error(
    [
      "[拒否] 枠の作り直しはできません。",
      `理由: 既に ${filled.length}件 の本文が確定しています（第${Math.min(
        ...filled.map((s) => s.weekIndex),
      )}週〜第${Math.max(...filled.map((s) => s.weekIndex))}週）。`,
      "A/B配分(15対15)とカテゴリの30日総本数は、検証期間の途中で変えてはいけない決まりです。",
      "枠を作り直すと、それまでに取った実績が比較できなくなります。",
    ].join("\n"),
  );
  process.exit(1);
}

const slots = buildSlots(startDate);
const report = verifySlots(slots);

console.log("");
console.log("=".repeat(72));
console.log(`30日検証 投稿枠  ${TOTAL_SLOTS}枠  開始日 ${startDate}（${WEEKDAY_JA[slots[0]!.weekday]}曜）`);
console.log("=".repeat(72));
console.log("");
console.log(renderVerifyReport(report));
console.log("");

// 先頭7日分を目視できるように出す
console.log("■ 第1週の枠（本文はまだ空。plan:week で7日ずつ確定させる）");
for (const s of slots.filter((x) => x.weekIndex === 1)) {
  const cat = CATEGORY_PLAN.find((c) => c.key === s.category)!.label;
  const time = TIME_SLOTS.find((t) => t.key === s.timeSlot)!.label;
  const link = s.hasLink ? `リンク有(${s.expGroup}案)` : "リンク無";
  console.log(
    `  Day${String(s.dayIndex).padStart(2)} (${WEEKDAY_JA[s.weekday]}) ${time.padEnd(8, "　")} ${cat.padEnd(10, "　")} ${link}`,
  );
}
console.log("");

if (!report.ok) {
  console.error("=".repeat(72));
  console.error("[失敗] 90枠が検証を通りませんでした。DBには何も書いていません。");
  console.error("偏った計画のまま30日走らせると、何が原因で伸びたか永久に分からなくなります。");
  console.error("=".repeat(72));
  process.exit(1);
}

if (dryRun) {
  console.log("[dry-run] 検証のみ。DBには書いていません。");
  process.exit(0);
}

await saveSlots(slots);
await notify("INFO", "PLAN_SLOTS_CREATED", `30日検証の${TOTAL_SLOTS}枠を作成（開始 ${startDate}）`);

console.log("=".repeat(72));
console.log(`[合格] ${TOTAL_SLOTS}枠を保存しました。`);
console.log("次にやること: npm run plan:week -- --week 1  （第1週の21本の本文を確定）");
console.log("=".repeat(72));
console.log("");
