// 投稿を12属性に分解して「何が効いた可能性が高いか」を出す。
//   npm run learn:attributes
//   npm run learn:attributes -- --week 1   … その週だけ
//
// ★このスクリプトは「原因」を断定しない。
//   実績のある投稿が30本に届くまでは全部 CONTINUE（継続）としか書かない。
//   どの数字にも必ず n（本数）を並べて出す。母数の無い数字は判断材料にならないため。

import {
  METRIC_LABEL,
  MIN_SAMPLE,
  analyzeAttributes,
  metricValue,
  type GroupStat,
  type RankMetric,
} from "../lib/attributes.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return undefined;
  const v = process.argv[i + 1];
  return v && !v.startsWith("--") ? v : "true";
}

const weekArg = arg("week");
const week = weekArg && /^\d+$/.test(weekArg) ? Number(weekArg) : undefined;

const DIM_LABEL: Record<string, string> = {
  CHARACTER: "キャラクター",
  HOOK: "冒頭のつかみ",
  TOPIC: "話題",
  OUTFIT: "服装",
  BACKGROUND: "背景",
  ENGLISH_STYLE: "英文の型",
  POST_LENGTH: "本文の長さ",
  CTA: "締めの誘導",
  TIME: "投稿時間帯",
  GEO: "狙う地域",
  AFFILIATE: "案件",
};

function fmtMetric(g: GroupStat, m: RankMetric): string {
  const v = metricValue(g, m);
  if (m === "NET_RPM") return `$${v.toFixed(3)}`;
  if (m === "PROFILE_CLICKS_PER_10K") return g.profileClicksPer10k === null ? "未取得" : v.toFixed(1);
  return `${(v * 100).toFixed(2)}%`;
}

const r = await analyzeAttributes(week);

console.log("");
console.log("=".repeat(76));
console.log(`属性別の学習レポート${week ? `（第${week}週のみ）` : "（全期間）"}`);
console.log("=".repeat(76));
console.log("");

console.log("■ 母数");
console.log(`  実績が取れた投稿        ${r.totalPostsWithMetrics}本`);
console.log(
  `  実績が取れていない投稿  ${r.load.notFetched.length}本` +
    (r.load.notFetched.length > 0 ? " ← 0ではなく「不明」として集計から除外" : ""),
);
console.log(`  累計インプレッション    ${r.totalImpressions.toLocaleString()}`);
console.log(`  承認済み売上            $${r.totalRevenueUsd.toFixed(2)}`);
console.log(`  API実費（投稿単位）     $${r.totalCostUsd.toFixed(3)}`);
console.log(
  `  RPM  $${r.overallRpm.toFixed(3)} / API費控除後 $${r.overallNetRpm.toFixed(3)}` +
    `  ＝ 売上 ÷ 表示 × 1000`,
);
console.log(`  並べ替えに使った指標    ${METRIC_LABEL[r.metric]}`);
console.log("");

// ★結論を書いてよい状態かどうかを最初に宣言する
const canConclude = r.totalPostsWithMetrics >= MIN_SAMPLE.POST_PATTERN;
console.log("■ 判定");
if (canConclude) {
  console.log(
    `  RESULT: 実績のある投稿が ${r.totalPostsWithMetrics}本（必要 ${MIN_SAMPLE.POST_PATTERN}本）に達しました。`,
  );
  console.log("  以下は「効いた可能性が最も高い属性」です。断定ではなく、次の検証で確かめる対象です。");
} else {
  console.log(
    `  CONTINUE: 実績のある投稿は ${r.totalPostsWithMetrics}本。` +
      `原因を書いてよい ${MIN_SAMPLE.POST_PATTERN}本 に届いていません。`,
  );
  console.log("  この段階では、どの属性についても勝ち負けを決めません。検証を続けてください。");
  console.log("  （下の表は途中経過です。少ない本数の差はほとんど偶然です）");
}
console.log("");

for (const d of r.dimensions) {
  const label = DIM_LABEL[d.dimension] ?? d.dimension;
  console.log(`── ${d.dimension}（${label}） [${d.verdict}] ` + "─".repeat(Math.max(0, 40 - label.length * 2)));
  if (d.groups.length === 0) {
    console.log("   データなし");
    console.log("");
    continue;
  }
  console.log(
    `   ${"値".padEnd(22)} ${"n".padStart(4)} ${"表示".padStart(9)} ${"指標".padStart(10)} ` +
      `${"EG率".padStart(7)} ${"P/1万".padStart(7)} ${"RPM".padStart(9)}`,
  );
  // 値が多すぎる切り口（話題など）は上位下位だけ出す。全部並べても読めない
  const many = d.groups.length > 12;
  const shown = many ? [...d.groups.slice(0, 5), null, ...d.groups.slice(-5)] : d.groups;
  for (const g of shown) {
    if (g === null) {
      console.log(`   … 中間 ${d.groups.length - 10}件 は省略`);
      continue;
    }
    const flag = g.posts < 3 ? " ←本数不足" : "";
    console.log(
      `   ${g.value.slice(0, 22).padEnd(22)} ${String(g.posts).padStart(4)} ` +
        `${g.impressions.toLocaleString().padStart(9)} ${fmtMetric(g, r.metric).padStart(10)} ` +
        `${(g.engagementRate * 100).toFixed(2).padStart(6)}% ` +
        `${(g.profileClicksPer10k === null ? "—" : g.profileClicksPer10k.toFixed(1)).padStart(7)} ` +
        `${("$" + g.netRpm.toFixed(3)).padStart(9)}${flag}`,
    );
  }
  if (d.leadHypothesis) {
    const h = d.leadHypothesis;
    const top = d.groups.find((g) => g.value === h.value);
    const low = d.groups.find((g) => g.value === h.runnerUp);
    if (canConclude) {
      console.log(
        `   → 効いた可能性が最も高いのは ${h.value}（n=${top?.posts ?? 0}本）。` +
          `${h.runnerUp}（n=${low?.posts ?? 0}本）より ${h.gapPct.toFixed(1)}% 高い。`,
      );
    } else {
      console.log(
        `   → 途中経過: ${h.value}（n=${top?.posts ?? 0}本）が ${h.runnerUp}（n=${low?.posts ?? 0}本）より ` +
          `${h.gapPct.toFixed(1)}% 高い。★まだ結論にしません。`,
      );
    }
  }
  for (const w of d.warnings) console.log(`   ⚠ ${w}`);
  console.log("");
}

// ── EXP-001（リンクをどこに置くか）────────────────────────────
console.log("── EXP-001 リンク配置のA/B " + "─".repeat(40));
console.log(
  `   ${"群".padEnd(24)} ${"n".padStart(4)} ${"表示".padStart(9)} ${"RPM(API費控除後)".padStart(18)} ${"P/1万".padStart(7)}`,
);
for (const a of r.ab) {
  const name = a.group === "A" ? "A案 本文にリンク無し" : "B案 本文にリンク有り";
  console.log(
    `   ${name.padEnd(24, "　")} ${String(a.posts).padStart(4)} ${a.impressions.toLocaleString().padStart(9)} ` +
      `${("$" + a.netRpm.toFixed(3)).padStart(18)} ` +
      `${(a.profileClicksPer10k === null ? "—" : a.profileClicksPer10k.toFixed(1)).padStart(7)}`,
  );
}
const abPosts = r.ab.reduce((s, a) => s + a.posts, 0);
if (abPosts < MIN_SAMPLE.POST_PATTERN) {
  console.log(
    `   ⚠ リンク有りの投稿は合計 ${abPosts}本 です。A/Bの勝ち負けを決めてよいのは ${MIN_SAMPLE.POST_PATTERN}本 からです（30日で30本の設計）。`,
  );
}
console.log("   ※ A案はリプライ分のAPI費が上乗せされます。判定は必ずAPI費控除後のRPMで行います。");
console.log("");

if (r.globalWarnings.length > 0) {
  console.log("■ 全体の注意");
  for (const w of r.globalWarnings) console.log(`  ⚠ ${w}`);
  console.log("");
}

if (r.load.notFetched.length > 0) {
  console.log(`■ 実績が取れていない投稿（先頭10件 / 全${r.load.notFetched.length}件）`);
  for (const n of r.load.notFetched.slice(0, 10)) {
    console.log(`  ・post#${n.postId}${n.dayIndex ? ` Day${n.dayIndex}` : ""}: ${n.reason}`);
  }
  console.log("  ※ 投稿から30日を過ぎるとリンククリック等は永久に取得できなくなります。");
  console.log("");
}

console.log("=".repeat(76));
console.log(
  canConclude
    ? "上の RESULT は「原因の最有力候補」です。確定させるには、その1属性だけを変えた次の検証が要ります。"
    : "CONTINUE: まだ何も結論づけていません。投稿を続けて実績を貯めてください。",
);
console.log("=".repeat(76));
console.log("");
