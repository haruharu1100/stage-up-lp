// 30日検証エンジン（90枠の生成 + 7日ずつのローリング本文確定）
//
// ★この実装が守っている決めごと（事業Vault/03_X/30日検証設計.md, 06_EXPERIMENTS/EXP-001）
//   1. 90「枠」は先に全部作る。本文は7日(21投稿)ずつしか確定させない
//   2. 先に固定するもの = 日付・時刻・曜日・EXP-001のA/B割当(15対15)・10カテゴリの30日総本数
//      → これらは途中で絶対に変えない（変えると比較が壊れる）
//   3. A/Bは投稿日ごとに交互。ランダムにしない
//   4. 前週の実測が無いまま次週の本文を書かない（学習ループが機能しなくなる）

import { getDb, nowIso, notify } from "./db.js";
import {
  AFFILIATE_ENTRIES,
  DISCLOSURE_AFFILIATE,
  DISCLOSURE_LP,
  AFFILIATE_OPENERS,
  LONG_CLOSINGS,
  REPLY_TEMPLATES,
  SELF_HOOKS,
  TOPIC_BANK,
  type AffiliateEntry,
  type Background,
  type Outfit,
  type TopicEntry,
} from "./content-bank.js";
import {
  analyzeAttributes,
  chooseTilt,
  saveAttributes,
  usedTopics,
  type AttributeReport,
  type Tilt,
} from "./attributes.js";
import { CHARACTER_NAME, NAME_IS_PLACEHOLDER } from "./character.js";

// ---------------------------------------------------------------------------
// 枠組みの定数（ここを変える = 比較の枠組みを変える。変更には人間の判断が要る）
// ---------------------------------------------------------------------------

export const TOTAL_DAYS = 30;
export const POSTS_PER_DAY = 3;
export const TOTAL_SLOTS = TOTAL_DAYS * POSTS_PER_DAY; // 90
export const LINK_SLOTS = 30; // 案件関連6 + LP誘導24
export const AB_PER_GROUP = 15; // A案15 / B案15。途中で変えない
export const DAYS_PER_WEEK = 7;
export const DEFAULT_START_DATE = "2026-09-01";

export type TimeSlotKey = "ASIA_EVENING" | "US_MORNING" | "EU_EVENING";
export type ExpGroup = "A" | "B" | "NONE";
export type EnglishStyle = "ACQUISITION" | "RELATIONSHIP" | "REVENUE";
export type HookKind = "SCENE" | "FACT" | "QUESTION_FIRST" | "SELF";
export type LengthBucket = "SHORT" | "MEDIUM" | "LONG";
export type CtaKind = "QUESTION" | "LP_LINK" | "AFFILIATE_LINK" | "NONE";

// slot_of_day は UTC の時刻順に振る（cronが素直に回るようにするため）
export const TIME_SLOTS: readonly {
  key: TimeSlotKey;
  label: string;
  utcHour: number;
  geo: string;
}[] = [
  { key: "ASIA_EVENING", label: "アジアの夜", utcHour: 11, geo: "ASIA" }, // 20:00 JST
  { key: "US_MORNING", label: "米国東部の朝", utcHour: 12, geo: "US" }, // 08:00 America/New_York (EDT)
  { key: "EU_EVENING", label: "欧州の夜", utcHour: 18, geo: "EU" }, // 20:00 CEST
];

export type CategoryKey =
  | "KIMONO"
  | "YUKATA"
  | "CULTURE"
  | "FOOD"
  | "KYOTO"
  | "DAILY"
  | "TRIVIA"
  | "QUESTION"
  | "AI_CREATOR"
  | "AFFILIATE";

// 30日検証設計 §2 の表をそのまま持つ。合計90。この本数は途中で変えない
export const CATEGORY_PLAN: readonly { key: CategoryKey; label: string; total: number }[] = [
  { key: "KIMONO", label: "着物", total: 10 },
  { key: "YUKATA", label: "浴衣", total: 8 },
  { key: "CULTURE", label: "日本文化", total: 14 },
  { key: "FOOD", label: "日本の食", total: 12 },
  { key: "KYOTO", label: "京都", total: 10 },
  { key: "DAILY", label: "日常", total: 10 },
  { key: "TRIVIA", label: "豆知識", total: 8 },
  { key: "QUESTION", label: "問いかけ", total: 8 },
  { key: "AI_CREATOR", label: "AIであることの話", total: 4 },
  { key: "AFFILIATE", label: "案件関連", total: 6 },
];

export const WEEKDAY_JA = ["日", "月", "火", "水", "木", "金", "土"];

export const X_API_UNIT_USD = {
  postNoUrl: 0.015,
  postWithUrl: 0.2,
} as const;
export const X_API_PRICE_CHECKED_AT = "2026-08-22"; // scripts/cost-simulator.mjs と同じ出典

export function weekOfDay(dayIndex: number): number {
  return Math.floor((dayIndex - 1) / DAYS_PER_WEEK) + 1;
}

export function daysOfWeek(week: number): number[] {
  const days: number[] = [];
  for (let d = (week - 1) * DAYS_PER_WEEK + 1; d <= week * DAYS_PER_WEEK && d <= TOTAL_DAYS; d++) {
    days.push(d);
  }
  return days;
}

export const TOTAL_WEEKS = weekOfDay(TOTAL_DAYS); // 5（第5週はDay29-30の6投稿）

// ---------------------------------------------------------------------------
// 正規化レーベンシュタイン類似度（0〜1）。外部依存なし。aura/lib/guard.ts と同じ実装
// ---------------------------------------------------------------------------

export const DUP_THRESHOLD = 0.9;

export function similarity(a: string, b: string): number {
  const s = a.trim();
  const t = b.trim();
  if (!s && !t) return 1;
  const m = s.length;
  const n = t.length;
  if (m === 0 || n === 0) return 0;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return 1 - dp[m]![n]! / Math.max(m, n);
}

// ---------------------------------------------------------------------------
// 90枠の生成
// ---------------------------------------------------------------------------

export type PlannedSlot = {
  dayIndex: number;
  weekIndex: number;
  slotOfDay: number;
  scheduledAt: string;
  weekday: number;
  timeSlot: TimeSlotKey;
  category: CategoryKey;
  expGroup: ExpGroup;
  hasLink: boolean;
};

function isoDate(start: string, addDays: number): Date {
  const [y, m, d] = start.split("-").map((v) => Number(v));
  return new Date(Date.UTC(y!, m! - 1, d! + addDays));
}

/** 案件関連6本を置く日。30日に均等に散らす（3,8,13,18,23,28 → A3本/B3本） */
function affiliateDays(): number[] {
  const days: number[] = [];
  for (let i = 0; i < 6; i++) {
    days.push(Math.round(((i + 0.5) * TOTAL_DAYS) / 6));
  }
  return days;
}

/**
 * カテゴリを均等に散らす順序を作る。
 * 各カテゴリの i 本目に (i+0.5)/n というキーを与えて全体を昇順に並べる。
 * 同じカテゴリが固まらず、かつ順序が完全に決定的になる（乱数を使わない）。
 */
function spreadSequence(counts: { key: CategoryKey; n: number }[]): CategoryKey[] {
  const items: { key: CategoryKey; sortKey: number; tie: number }[] = [];
  counts.forEach((c, ci) => {
    for (let i = 0; i < c.n; i++) {
      items.push({ key: c.key, sortKey: (i + 0.5) / c.n, tie: ci });
    }
  });
  items.sort((a, b) => a.sortKey - b.sortKey || a.tie - b.tie);
  return items.map((i) => i.key);
}

export function buildSlots(startDate: string = DEFAULT_START_DATE): PlannedSlot[] {
  const affDays = new Set(affiliateDays());
  const slots: PlannedSlot[] = [];

  for (let day = 1; day <= TOTAL_DAYS; day++) {
    const date = isoDate(startDate, day - 1);
    // リンク付き投稿は1日1本。どの時間枠に置くかを3日周期で回すと、
    // 奇数日(A群)・偶数日(B群)ともに各時間枠5本ずつになる
    const linkSlotOfDay = ((day - 1) % 3) + 1;
    for (let s = 1; s <= POSTS_PER_DAY; s++) {
      const ts = TIME_SLOTS[s - 1]!;
      const hasLink = s === linkSlotOfDay;
      slots.push({
        dayIndex: day,
        weekIndex: weekOfDay(day),
        slotOfDay: s,
        scheduledAt: `${date.toISOString().slice(0, 10)}T${String(ts.utcHour).padStart(2, "0")}:00:00Z`,
        weekday: date.getUTCDay(),
        timeSlot: ts.key,
        category: "CULTURE", // 下で確定させる
        // ★投稿日ごとに交互。ランダムにしない（15本では曜日・時間帯が偏るため）
        expGroup: hasLink ? (day % 2 === 1 ? "A" : "B") : "NONE",
        hasLink,
      });
    }
  }

  // カテゴリ確定 1: 案件関連6本は必ずリンク枠に置く
  for (const day of affDays) {
    const slot = slots.find((s) => s.dayIndex === day && s.hasLink)!;
    slot.category = "AFFILIATE";
  }

  // カテゴリ確定 2: 残り84枠へ9カテゴリを均等に散らす
  const rest = slots.filter((s) => s.category !== "AFFILIATE");
  const seq = spreadSequence(
    CATEGORY_PLAN.filter((c) => c.key !== "AFFILIATE").map((c) => ({ key: c.key, n: c.total })),
  );
  rest.forEach((s, i) => {
    s.category = seq[i]!;
  });

  balanceLinkCategories(slots);
  return slots;
}

/**
 * リンク付き30本のカテゴリ構成をA群とB群で揃える。
 * 揃えないと「リンク配置の差」なのか「カテゴリの差」なのか分離できない。
 * 入れ替えるのはリンク枠どうしのカテゴリだけなので、
 * カテゴリの30日総本数・A/B配分・日付・時刻は一切動かない。
 */
function balanceLinkCategories(slots: PlannedSlot[]): void {
  const links = slots.filter((s) => s.hasLink && s.category !== "AFFILIATE");
  for (let pass = 0; pass < 50; pass++) {
    const diff = new Map<CategoryKey, number>();
    for (const s of links) {
      const d = diff.get(s.category) ?? 0;
      diff.set(s.category, d + (s.expGroup === "A" ? 1 : -1));
    }
    let over: CategoryKey | null = null;
    let under: CategoryKey | null = null;
    for (const [k, v] of diff) {
      if (v >= 2 && (over === null || v > (diff.get(over) ?? 0))) over = k;
      if (v <= -2 && (under === null || v < (diff.get(under) ?? 0))) under = k;
    }
    if (over === null || under === null) break;
    const a = links.find((s) => s.expGroup === "A" && s.category === over)!;
    const b = links.find((s) => s.expGroup === "B" && s.category === under)!;
    const tmp = a.category;
    a.category = b.category;
    b.category = tmp;
  }
}

// ---------------------------------------------------------------------------
// 90枠の検証（機械で通らなければ保存しない）
// ---------------------------------------------------------------------------

export type VerifyIssue = { level: "ERROR" | "WARN"; message: string };

export type VerifyReport = {
  ok: boolean;
  issues: VerifyIssue[];
  categoryCounts: { key: CategoryKey; label: string; want: number; got: number }[];
  groupCounts: Record<ExpGroup, number>;
  weekdayMatrix: { weekday: number; a: number; b: number }[];
  timeMatrix: { time: TimeSlotKey; a: number; b: number }[];
  linkCategoryMatrix: { category: CategoryKey; a: number; b: number }[];
  weekMatrix: { week: number; slots: number; counts: Record<string, number> }[];
};

export function verifySlots(slots: PlannedSlot[]): VerifyReport {
  const issues: VerifyIssue[] = [];
  const err = (m: string) => issues.push({ level: "ERROR", message: m });
  const warn = (m: string) => issues.push({ level: "WARN", message: m });

  if (slots.length !== TOTAL_SLOTS) err(`枠の総数が ${slots.length} 件（${TOTAL_SLOTS}件であるべき）`);

  const seen = new Set<string>();
  for (const s of slots) {
    const k = `${s.dayIndex}-${s.slotOfDay}`;
    if (seen.has(k)) err(`枠が重複: Day${s.dayIndex} 枠${s.slotOfDay}`);
    seen.add(k);
    if (s.weekIndex !== weekOfDay(s.dayIndex)) err(`週番号が不正: Day${s.dayIndex}`);
  }

  // 1. カテゴリの30日総本数
  const categoryCounts = CATEGORY_PLAN.map((c) => ({
    key: c.key,
    label: c.label,
    want: c.total,
    got: slots.filter((s) => s.category === c.key).length,
  }));
  for (const c of categoryCounts) {
    if (c.want !== c.got) err(`カテゴリ本数が違う: ${c.label} 実際${c.got}本 / 設計${c.want}本`);
  }

  // 2. リンク付き投稿とA/B配分
  const links = slots.filter((s) => s.hasLink);
  if (links.length !== LINK_SLOTS) err(`リンク付き投稿が ${links.length}本（${LINK_SLOTS}本であるべき）`);
  const groupCounts: Record<ExpGroup, number> = { A: 0, B: 0, NONE: 0 };
  for (const s of slots) groupCounts[s.expGroup]++;
  if (groupCounts.A !== AB_PER_GROUP) err(`A案が ${groupCounts.A}本（${AB_PER_GROUP}本であるべき）`);
  if (groupCounts.B !== AB_PER_GROUP) err(`B案が ${groupCounts.B}本（${AB_PER_GROUP}本であるべき）`);
  if (groupCounts.NONE !== TOTAL_SLOTS - LINK_SLOTS) err(`リンク無し投稿の数が不正: ${groupCounts.NONE}本`);
  for (const s of slots) {
    if (s.hasLink && s.expGroup === "NONE") err(`リンク付きなのに群が無い: Day${s.dayIndex}`);
    if (!s.hasLink && s.expGroup !== "NONE") err(`リンク無しなのに群が付いている: Day${s.dayIndex}`);
    // 投稿日ごとに交互であること
    if (s.hasLink && s.expGroup !== (s.dayIndex % 2 === 1 ? "A" : "B")) {
      err(`A/Bが交互になっていない: Day${s.dayIndex} = ${s.expGroup}`);
    }
  }
  for (let d = 1; d <= TOTAL_DAYS; d++) {
    const n = slots.filter((s) => s.dayIndex === d && s.hasLink).length;
    if (n !== 1) err(`Day${d} のリンク付き投稿が ${n}本（1本であるべき）`);
  }

  // 3. 案件関連は必ずリンク付き
  for (const s of slots) {
    if (s.category === "AFFILIATE" && !s.hasLink) err(`案件関連なのにリンク枠でない: Day${s.dayIndex}`);
  }

  // 4. 曜日のバランス（15本を7曜日へ分けるので 2 or 3 が理論上の最良）
  const weekdayMatrix = [0, 1, 2, 3, 4, 5, 6].map((w) => ({
    weekday: w,
    a: links.filter((s) => s.weekday === w && s.expGroup === "A").length,
    b: links.filter((s) => s.weekday === w && s.expGroup === "B").length,
  }));
  for (const w of weekdayMatrix) {
    if (Math.abs(w.a - w.b) > 1) {
      err(`曜日が偏っている: ${WEEKDAY_JA[w.weekday]}曜 A${w.a}本 / B${w.b}本`);
    }
    if (w.a < 2 || w.a > 3 || w.b < 2 || w.b > 3) {
      err(`曜日ごとの本数が2〜3本の範囲外: ${WEEKDAY_JA[w.weekday]}曜 A${w.a} / B${w.b}`);
    }
  }

  // 5. 時間帯のバランス（3枠へ15本 = 各5本ちょうど）
  const timeMatrix = TIME_SLOTS.map((t) => ({
    time: t.key,
    a: links.filter((s) => s.timeSlot === t.key && s.expGroup === "A").length,
    b: links.filter((s) => s.timeSlot === t.key && s.expGroup === "B").length,
  }));
  for (const t of timeMatrix) {
    if (t.a !== 5 || t.b !== 5) err(`時間帯が均等でない: ${t.time} A${t.a}本 / B${t.b}本`);
  }

  // 6. リンク付き投稿のカテゴリ構成がA/Bで揃っているか
  const linkCategoryMatrix = CATEGORY_PLAN.map((c) => ({
    category: c.key,
    a: links.filter((s) => s.category === c.key && s.expGroup === "A").length,
    b: links.filter((s) => s.category === c.key && s.expGroup === "B").length,
  })).filter((r) => r.a + r.b > 0);
  for (const r of linkCategoryMatrix) {
    if (Math.abs(r.a - r.b) > 1) {
      err(`リンク投稿のカテゴリがA/Bで偏っている: ${r.category} A${r.a}本 / B${r.b}本`);
    }
  }

  // 7. 週ごとの構成（警告のみ。週21本に同じカテゴリが集中しすぎていないか）
  const weekMatrix: VerifyReport["weekMatrix"] = [];
  for (let w = 1; w <= TOTAL_WEEKS; w++) {
    const ws = slots.filter((s) => s.weekIndex === w);
    const counts: Record<string, number> = {};
    for (const s of ws) counts[s.category] = (counts[s.category] ?? 0) + 1;
    weekMatrix.push({ week: w, slots: ws.length, counts });
    for (const [k, v] of Object.entries(counts)) {
      if (w <= 4 && v > 5) warn(`第${w}週に ${k} が ${v}本 偏っています`);
    }
  }

  // 8. 同じカテゴリの連投
  let streak = 1;
  for (let i = 1; i < slots.length; i++) {
    if (slots[i]!.category === slots[i - 1]!.category) {
      streak++;
      if (streak >= 3) warn(`同じカテゴリが3枠連続: ${slots[i]!.category}（Day${slots[i]!.dayIndex}）`);
    } else {
      streak = 1;
    }
  }

  return {
    ok: !issues.some((i) => i.level === "ERROR"),
    issues,
    categoryCounts,
    groupCounts,
    weekdayMatrix,
    timeMatrix,
    linkCategoryMatrix,
    weekMatrix,
  };
}

export function renderVerifyReport(r: VerifyReport): string {
  const out: string[] = [];
  out.push("■ カテゴリ配分（30日総本数・途中で変えない）");
  for (const c of r.categoryCounts) {
    const mark = c.want === c.got ? "OK" : "NG";
    out.push(`  ${mark}  ${c.label.padEnd(10, "　")} 設計${String(c.want).padStart(2)}本 / 実際${String(c.got).padStart(2)}本`);
  }
  out.push("");
  out.push("■ EXP-001 A/B配分（15対15・途中で変えない）");
  out.push(`  A案(本文リンク無し+リプライ) ${r.groupCounts.A}本 / B案(本文にリンク) ${r.groupCounts.B}本 / リンク無し ${r.groupCounts.NONE}本`);
  out.push("");
  out.push("■ 曜日バランス（リンク付き30本）");
  out.push(`  曜日  ${["日", "月", "火", "水", "木", "金", "土"].map((d) => d.padStart(3)).join("")}`);
  out.push(`  A案  ${r.weekdayMatrix.map((w) => String(w.a).padStart(3)).join("")}`);
  out.push(`  B案  ${r.weekdayMatrix.map((w) => String(w.b).padStart(3)).join("")}`);
  out.push("");
  out.push("■ 時間帯バランス（リンク付き30本）");
  for (const t of r.timeMatrix) {
    const label = TIME_SLOTS.find((x) => x.key === t.time)!.label;
    out.push(`  ${label.padEnd(8, "　")} A案 ${t.a}本 / B案 ${t.b}本`);
  }
  out.push("");
  out.push("■ リンク付き投稿のカテゴリ構成（A/Bで揃っているか）");
  for (const c of r.linkCategoryMatrix) {
    const label = CATEGORY_PLAN.find((x) => x.key === c.category)!.label;
    out.push(`  ${label.padEnd(10, "　")} A案 ${c.a}本 / B案 ${c.b}本`);
  }
  out.push("");
  out.push("■ 週ごとの枠数");
  for (const w of r.weekMatrix) {
    out.push(`  第${w.week}週  ${w.slots}枠`);
  }
  if (r.issues.length) {
    out.push("");
    out.push("■ 指摘");
    for (const i of r.issues) out.push(`  [${i.level}] ${i.message}`);
  }
  return out.join("\n");
}

// ---------------------------------------------------------------------------
// 保存 / 読み出し
// ---------------------------------------------------------------------------

export type StoredSlot = PlannedSlot & { id: number; filled: boolean; postId: number | null };

export async function loadSlots(): Promise<StoredSlot[]> {
  const db = getDb();
  const rs = await db.execute(
    `SELECT id, day_index, week_index, slot_of_day, scheduled_at, weekday, category, exp_group, has_link, filled, post_id
       FROM post_slots ORDER BY day_index, slot_of_day`,
  );
  return rs.rows.map((r) => ({
    id: Number(r.id),
    dayIndex: Number(r.day_index),
    weekIndex: Number(r.week_index),
    slotOfDay: Number(r.slot_of_day),
    scheduledAt: String(r.scheduled_at),
    weekday: Number(r.weekday),
    timeSlot: TIME_SLOTS[Number(r.slot_of_day) - 1]!.key,
    category: String(r.category) as CategoryKey,
    expGroup: String(r.exp_group) as ExpGroup,
    hasLink: Number(r.has_link) === 1,
    filled: Number(r.filled) === 1,
    postId: r.post_id === null ? null : Number(r.post_id),
  }));
}

export async function saveSlots(slots: PlannedSlot[]): Promise<void> {
  const db = getDb();
  await db.batch(
    [
      { sql: `DELETE FROM post_slots`, args: [] },
      ...slots.map((s) => ({
        sql: `INSERT INTO post_slots
                (day_index, week_index, slot_of_day, scheduled_at, weekday, category, exp_group, has_link, filled, post_id)
              VALUES (?,?,?,?,?,?,?,?,0,NULL)`,
        args: [
          s.dayIndex,
          s.weekIndex,
          s.slotOfDay,
          s.scheduledAt,
          s.weekday,
          s.category,
          s.expGroup,
          s.hasLink ? 1 : 0,
        ],
      })),
    ],
    "write",
  );
}

/**
 * DBの枠が buildSlots の出力と一致しているかを確認する。
 * ローリングで本文を足しても「比較の枠組み」は1文字も動いてはいけない。
 * 動いていたら例外を投げて止める（黙って続けると30日分のデータが使えなくなる）。
 */
export async function assertFrameworkIntact(): Promise<StoredSlot[]> {
  const stored = await loadSlots();
  if (stored.length === 0) {
    throw new Error("枠がまだありません。先に `npm run plan:slots` を実行してください。");
  }
  const startDate = stored[0]!.scheduledAt.slice(0, 10);
  const expected = buildSlots(startDate);
  if (expected.length !== stored.length) {
    throw new Error(`枠の数が変わっています（DB ${stored.length}件 / 設計 ${expected.length}件）`);
  }
  for (let i = 0; i < expected.length; i++) {
    const e = expected[i]!;
    const s = stored[i]!;
    const diff: string[] = [];
    if (e.dayIndex !== s.dayIndex || e.slotOfDay !== s.slotOfDay) diff.push("日付/枠番号");
    if (e.scheduledAt !== s.scheduledAt) diff.push(`時刻(${s.scheduledAt}→設計${e.scheduledAt})`);
    if (e.weekday !== s.weekday) diff.push("曜日");
    if (e.category !== s.category) diff.push(`カテゴリ(${s.category}→設計${e.category})`);
    if (e.expGroup !== s.expGroup) diff.push(`A/B割当(${s.expGroup}→設計${e.expGroup})`);
    if (e.hasLink !== s.hasLink) diff.push("リンク有無");
    if (diff.length) {
      throw new Error(
        `比較の枠組みが変更されています: Day${s.dayIndex} 枠${s.slotOfDay} の ${diff.join(" / ")}。` +
          `A/B配分とカテゴリ総本数は30日間変更禁止です。`,
      );
    }
  }
  const report = verifySlots(stored.map((s) => ({ ...s })));
  if (!report.ok) {
    throw new Error(
      `保存済みの枠が検証を通りません:\n${report.issues
        .filter((i) => i.level === "ERROR")
        .map((i) => "  - " + i.message)
        .join("\n")}`,
    );
  }
  return stored;
}

// ---------------------------------------------------------------------------
// 前週の実測が入っているか（入っていなければ次週の本文を書かせない）
// ---------------------------------------------------------------------------

export type WeekReadiness = {
  week: number;
  ok: boolean;
  reasons: string[];
  hints: string[];
  prevWeek: number | null;
  prevFilled: number;
  prevWithMetrics: number;
  missing: string[];
};

export async function weekReadiness(week: number): Promise<WeekReadiness> {
  const db = getDb();
  const reasons: string[] = [];
  const hints: string[] = [];
  const slots = await loadSlots();

  if (week < 1 || week > TOTAL_WEEKS) {
    reasons.push(`第${week}週は存在しません（1〜${TOTAL_WEEKS}週）`);
    return { week, ok: false, reasons, hints, prevWeek: null, prevFilled: 0, prevWithMetrics: 0, missing: [] };
  }

  const thisWeek = slots.filter((s) => s.weekIndex === week);
  const alreadyFilled = thisWeek.filter((s) => s.filled);
  if (alreadyFilled.length === thisWeek.length && thisWeek.length > 0) {
    reasons.push(`第${week}週の本文は既に ${alreadyFilled.length}件 確定済みです`);
    hints.push("確定済みの本文を書き直すと、同じ枠で条件が変わり、実績の意味が変わります。");
    hints.push("直したい本文がある場合は、その1件だけを承認画面で人間が直してください。");
    return {
      week,
      ok: false,
      reasons,
      hints,
      prevWeek: week - 1 || null,
      prevFilled: 0,
      prevWithMetrics: 0,
      missing: [],
    };
  }

  if (week === 1) {
    return { week, ok: true, reasons, hints, prevWeek: null, prevFilled: 0, prevWithMetrics: 0, missing: [] };
  }

  // ★前週の実測が無い状態で次週を書かない。
  //   90本を先に書かない設計の目的そのものが「実測を次の21本へ反映すること」だから。
  const prev = week - 1;
  const prevSlots = slots.filter((s) => s.weekIndex === prev);
  const prevFilledSlots = prevSlots.filter((s) => s.filled && s.postId !== null);
  if (prevFilledSlots.length < prevSlots.length) {
    reasons.push(
      `第${prev}週の本文が ${prevFilledSlots.length}/${prevSlots.length}件 しか確定していません`,
    );
    hints.push(`先に npm run plan:week -- --week ${prev} を実行してください。`);
  }

  const missing: string[] = [];
  let withMetrics = 0;
  for (const s of prevFilledSlots) {
    const rs = await db.execute({
      sql: `SELECT COUNT(*) AS n FROM post_metrics WHERE post_id = ? AND fetched_ok = 1`,
      args: [s.postId],
    });
    if (Number(rs.rows[0]?.n ?? 0) > 0) withMetrics++;
    else missing.push(`Day${s.dayIndex} 枠${s.slotOfDay}（${s.category}）`);
  }
  if (missing.length > 0) {
    reasons.push(
      `第${prev}週の ${prevFilledSlots.length}投稿のうち、実績が取れているのは ${withMetrics}件 です（不足 ${missing.length}件）`,
    );
    hints.push("第" + prev + "週を投稿し、実績を取り込んでから、もう一度このコマンドを実行してください。");
    hints.push("リンククリック・プロフィールクリックは投稿から30日で永久に取得不能になります。");
  }

  return {
    week,
    ok: reasons.length === 0,
    reasons,
    hints,
    prevWeek: prev,
    prevFilled: prevFilledSlots.length,
    prevWithMetrics: withMetrics,
    missing,
  };
}

// ---------------------------------------------------------------------------
// 本文の組み立て（LLMもネットワークも使わない。ローカルの素材から組む）
// ---------------------------------------------------------------------------

// ★名前は lib/character.ts の1か所だけが持つ。ここで別に定義しない。
//   以前ここに "HANA" を直接書いていたため、character.ts 側の
//   「まだ決まっていない」という印（NAME_IS_PLACEHOLDER）を素通りしていた。

function lpBase(): string {
  return process.env.LP_BASE_URL ?? "https://lp.example.com";
}

export type Draft = {
  slot: StoredSlot;
  text: string;
  replyText: string | null;
  hook: HookKind;
  style: EnglishStyle;
  topic: string;
  outfit: Outfit;
  background: Background;
  cta: CtaKind;
  imagePrompt: string | null;
  campaignId: string;
  offerId: string | null;
  lengthTarget: LengthBucket;
};

function composeTopic(
  e: TopicEntry,
  style: EnglishStyle,
  hook: HookKind,
  len: LengthBucket,
  rotate: number,
): string {
  // ★英語として意味が通る順番だけを作る。
  //   scene と meaning は「何の話か」を出す行で、feeling / question / SELF_HOOKS は
  //   それ単体では主語が無い。主語を出す行を必ず1本は残すこと。
  const flavor = style === "RELATIONSHIP" ? e.feeling : e.meaning;
  let lines: string[];
  switch (hook) {
    case "FACT":
      // meaning は自己完結した1文にしてある（content-bank 側の決めごと）。
      // 2行目は文体で変える。ここを共通にすると ACQUISITION と RELATIONSHIP が
      // 同じ本文になり、ENGLISH_STYLE の比較が成立しなくなる
      lines = [e.meaning, style === "RELATIONSHIP" ? e.feeling : e.scene, e.question];
      break;
    case "QUESTION_FIRST":
      lines = [e.question, e.scene, flavor];
      break;
    case "SELF":
      lines = [SELF_HOOKS[rotate % SELF_HOOKS.length]!, e.scene, flavor, e.question];
      break;
    default: // SCENE
      lines = [e.scene, flavor, e.question];
  }
  // 短文は先頭2行だけ残す。「先頭と末尾」にすると SELF で
  // 「つかみ＋質問」だけになり、何の話か書かれていない投稿ができる
  if (len === "SHORT") lines = lines.slice(0, 2);
  if (len === "LONG") {
    lines = [...lines, LONG_CLOSINGS[rotate % LONG_CLOSINGS.length]!];
  }
  return [...new Set(lines)].join("\n");
}

function composeAffiliate(
  e: AffiliateEntry,
  hook: HookKind,
  len: LengthBucket,
  rotate: number,
): string {
  // ★facts は "First / Second / Third" のように順番に意味がある。並べ替えない。
  //   つかみの違いは、先頭に1行足すかどうかで作る
  const facts = len === "SHORT" ? [e.facts[0]!] : [...e.facts];
  const head = hook === "FACT" ? [] : [AFFILIATE_OPENERS[rotate % AFFILIATE_OPENERS.length]!];
  return [...head, ...facts, e.closing].join("\n");
}

function imagePromptOf(outfit: Outfit, background: Background): string | null {
  if (outfit === "NONE" && background === "NONE") return null;
  // HANA_PROFILE.md §3 の撮影スタイルを固定で載せる
  return [
    // 名前が未確定のうちは画像指示に名前を入れない。仮名を焼き込むと差し替え漏れが残る
    `${NAME_IS_PLACEHOLDER ? "" : CHARACTER_NAME + ", "}mid-20s adult woman, long straight black hair, natural makeup, gentle expression`,
    outfit === "NONE" ? "scenery only" : `wearing ${outfit.toLowerCase()}`,
    background === "NONE" ? "plain background" : `background: ${background.toLowerCase()}`,
    "photorealistic, DSLR, 85mm, shallow depth of field, natural light, film grain",
  ].join(", ");
}

// ---------------------------------------------------------------------------
// 1週間（21投稿）だけ確定させる
// ---------------------------------------------------------------------------

export type FillResult = {
  week: number;
  drafts: Draft[];
  tilt: Tilt | null;
  tiltNote: string[];
  costUsd: number;
  rejectedDuplicates: number;
};

export async function buildWeekDrafts(week: number, tilt: Tilt | null): Promise<FillResult> {
  const db = getDb();
  const slots = await loadSlots();
  const target = slots.filter((s) => s.weekIndex === week && !s.filled);

  const used = await usedTopics();
  const bodiesRs = await db.execute(
    // リプライは定型文なので重複判定の対象にしない。防ぎたいのは「本文の使い回し」
    `SELECT text FROM posts WHERE pattern_id IS NULL OR pattern_id <> 'EXP001_A_REPLY'`,
  );
  const corpus = bodiesRs.rows.map((r) => String(r.text));

  const offersRs = await db.execute(
    `SELECT id, category FROM offers WHERE approval_status IN ('APPROVED','PENDING','NOT_APPLIED') ORDER BY id`,
  );
  const offerByCategory = new Map<string, string>();
  for (const r of offersRs.rows) {
    const c = String(r.category);
    if (!offerByCategory.has(c)) offerByCategory.set(c, String(r.id));
  }

  // A/Bで型・画像の分布を揃えるための群内連番（EXP-001 §2）
  const linkOrder = new Map<number, number>();
  const counter: Record<string, number> = { A: 0, B: 0 };
  for (const s of slots) {
    if (!s.hasLink || s.category === "AFFILIATE") continue;
    linkOrder.set(s.id, counter[s.expGroup]!++);
  }
  const nonLinkOrder = new Map<number, number>();
  let nonLinkCounter = 0;
  for (const s of slots) if (!s.hasLink) nonLinkOrder.set(s.id, nonLinkCounter++);

  const drafts: Draft[] = [];
  let rejected = 0;
  let affiliateSeen = 0;
  for (const s of slots) {
    if (s.category === "AFFILIATE" && s.weekIndex < week) affiliateSeen++;
  }

  for (const slot of target) {
    const globalIndex = (slot.dayIndex - 1) * POSTS_PER_DAY + slot.slotOfDay - 1;
    const isAffiliate = slot.category === "AFFILIATE";

    // 型（ENGLISH_STYLE）と画像の有無は、A群B群で同じ比率になるように群内連番で決める
    const order = isAffiliate
      ? affiliateSeen
      : slot.hasLink
        ? linkOrder.get(slot.id)!
        : nonLinkOrder.get(slot.id)!;
    let style: EnglishStyle = isAffiliate
      ? "REVENUE"
      : order % 2 === 0
        ? "ACQUISITION"
        : "RELATIONSHIP";
    let hook: HookKind = isAffiliate
      ? (["SCENE", "FACT"] as const)[globalIndex % 2]!
      : (["SCENE", "FACT", "QUESTION_FIRST", "SELF"] as const)[globalIndex % 4]!;
    let lengthTarget: LengthBucket = (["MEDIUM", "MEDIUM", "LONG", "SHORT"] as const)[globalIndex % 4]!;

    // ★寄せてよいのは1属性だけ。3枠に1枠は元の型を残して探索を止めない
    const explore = globalIndex % 3 === 2;
    let outfitPref: string | null = null;
    let backgroundPref: string | null = null;
    if (tilt && !explore) {
      if (tilt.dimension === "ENGLISH_STYLE" && !isAffiliate && tilt.value !== "REVENUE") {
        style = tilt.value as EnglishStyle;
      } else if (tilt.dimension === "HOOK") {
        if (!isAffiliate || tilt.value === "SCENE" || tilt.value === "FACT") hook = tilt.value as HookKind;
      } else if (tilt.dimension === "POST_LENGTH") {
        lengthTarget = tilt.value as LengthBucket;
      } else if (tilt.dimension === "OUTFIT") {
        outfitPref = tilt.value;
      } else if (tilt.dimension === "BACKGROUND") {
        backgroundPref = tilt.value;
      }
    }

    let text = "";
    let topicKey = "";
    let outfit: Outfit = "MODERN";
    let background: Background = "NONE";
    let offerId: string | null = null;

    if (isAffiliate) {
      const entry = AFFILIATE_ENTRIES.find((e) => !used.has(e.key));
      if (!entry) throw new Error("案件関連トピックが足りません（6本しか用意していません）");
      text = composeAffiliate(entry, hook, lengthTarget, globalIndex);
      topicKey = entry.key;
      outfit = "NONE";
      background = "NONE";
      offerId = offerByCategory.get(entry.offerCategory) ?? null;
      affiliateSeen++;
    } else {
      const bank = TOPIC_BANK[slot.category];
      if (!bank) throw new Error(`カテゴリ ${slot.category} のトピックがありません`);
      const pool = bank.filter((e) => !used.has(e.key));
      if (pool.length === 0) throw new Error(`カテゴリ ${slot.category} のトピックを使い切りました`);
      pool.sort((a, b) => {
        const sa = (outfitPref && a.outfit === outfitPref ? -2 : 0) + (backgroundPref && a.background === backgroundPref ? -1 : 0);
        const sb = (outfitPref && b.outfit === outfitPref ? -2 : 0) + (backgroundPref && b.background === backgroundPref ? -1 : 0);
        return sa - sb;
      });
      let chosen: TopicEntry | null = null;
      for (const cand of pool) {
        const body = composeTopic(cand, style, hook, lengthTarget, globalIndex);
        const dup = corpus.find((c) => similarity(c, body) >= DUP_THRESHOLD);
        if (dup) {
          rejected++;
          continue;
        }
        chosen = cand;
        text = body;
        break;
      }
      if (!chosen) throw new Error(`Day${slot.dayIndex} 枠${slot.slotOfDay}: 重複しない本文を作れませんでした`);
      topicKey = chosen.key;
      outfit = chosen.outfit;
      background = chosen.background;
    }

    const campaignId = `w${week}d${slot.dayIndex}s${slot.slotOfDay}`;
    const url = `${lpBase()}/go?c=${campaignId}`;
    let replyText: string | null = null;
    let cta: CtaKind = text.trimEnd().endsWith("?") ? "QUESTION" : "NONE";

    if (slot.hasLink) {
      cta = isAffiliate ? "AFFILIATE_LINK" : "LP_LINK";
      const disclosure = isAffiliate ? DISCLOSURE_AFFILIATE : DISCLOSURE_LP;
      if (slot.expGroup === "B") {
        // B案: 本文にリンク。開示はリンクより前に置く（FTC）
        text = `${text}\n\n${disclosure}\n${url}`;
      } else {
        // A案: 本文にURLを入れず、直後のリプライで届ける
        const tpl = REPLY_TEMPLATES[globalIndex % REPLY_TEMPLATES.length]!;
        replyText = `${disclosure}\n${tpl}\n${url}`;
      }
    }

    used.add(topicKey);
    corpus.push(text);

    drafts.push({
      slot,
      text,
      replyText,
      hook,
      style,
      topic: topicKey,
      outfit,
      background,
      cta,
      imagePrompt: imagePromptOf(outfit, background),
      campaignId,
      offerId,
      lengthTarget,
    });
  }

  const costUsd = drafts.reduce((sum, d) => {
    const body = d.text.includes("http") ? X_API_UNIT_USD.postWithUrl : X_API_UNIT_USD.postNoUrl;
    return sum + body + (d.replyText ? X_API_UNIT_USD.postWithUrl : 0);
  }, 0);

  return { week, drafts, tilt, tiltNote: [], costUsd, rejectedDuplicates: rejected };
}

export async function persistWeek(result: FillResult): Promise<void> {
  const db = getDb();
  const now = nowIso();
  for (const d of result.drafts) {
    const ins = await db.execute({
      sql: `INSERT INTO posts
              (slot_id, status, lang, text, category, hook, cta, offer_id, campaign_id,
               image_prompt, outfit, scene, compliance_passed, compliance_notes, pattern_id, created_at)
            VALUES (?,'draft','en',?,?,?,?,?,?,?,?,?,0,?,?,?)`,
      args: [
        d.slot.id,
        d.text,
        d.slot.category,
        d.hook,
        d.cta,
        d.offerId,
        d.campaignId,
        d.imagePrompt,
        d.outfit,
        d.background,
        "未チェック。承認画面へ出す前に lib/compliance.ts を通すこと",
        `${d.style}/${d.lengthTarget}`,
        now,
      ],
    });
    const postId = Number(ins.lastInsertRowid);

    if (d.replyText) {
      // リプライはX上でも別の投稿なので、行も分ける。分析からは pattern_id で除外する
      await db.execute({
        sql: `INSERT INTO posts (slot_id, status, lang, text, category, cta, offer_id, campaign_id,
                                 compliance_passed, pattern_id, created_at)
              VALUES (?,'draft','en',?,?,?,?,?,0,'EXP001_A_REPLY',?)`,
        args: [d.slot.id, d.replyText, d.slot.category, d.cta, d.offerId, d.campaignId, now],
      });
    }

    await saveAttributes({
      postId,
      characterName: CHARACTER_NAME,
      hook: d.hook,
      topic: d.topic,
      outfit: d.outfit,
      background: d.background,
      englishStyle: d.style,
      postLength: d.text.length,
      cta: d.cta,
      timeSlot: d.slot.timeSlot,
      geo: TIME_SLOTS.find((t) => t.key === d.slot.timeSlot)!.geo,
      affiliateOfferId: d.offerId,
    });

    // ★API実費は投稿1件ごとに1行。月末に按分しない（EXP-001のA/B比較が崩れる）
    const bodyUsd = d.text.includes("http") ? X_API_UNIT_USD.postWithUrl : X_API_UNIT_USD.postNoUrl;
    await db.execute({
      sql: `INSERT INTO costs (kind, amount_usd, detail, post_id, occurred_at) VALUES ('X_API',?,?,?,?)`,
      args: [
        bodyUsd,
        `本文(${d.text.includes("http") ? "URLあり" : "URLなし"}) 予定単価 checked_at ${X_API_PRICE_CHECKED_AT}`,
        postId,
        d.slot.scheduledAt,
      ],
    });
    if (d.replyText) {
      // リプライの費用も親投稿へ付ける（この枠1本を届けるのにかかった額をまとめて見るため）
      await db.execute({
        sql: `INSERT INTO costs (kind, amount_usd, detail, post_id, occurred_at) VALUES ('X_API',?,?,?,?)`,
        args: [
          X_API_UNIT_USD.postWithUrl,
          `A案リプライ(URLあり) 予定単価 checked_at ${X_API_PRICE_CHECKED_AT}`,
          postId,
          d.slot.scheduledAt,
        ],
      });
    }

    await db.execute({
      sql: `UPDATE post_slots SET filled = 1, post_id = ? WHERE id = ?`,
      args: [postId, d.slot.id],
    });
  }
}

/** 第N週の21本を確定させる。前週の実測が無ければ何も書かずに拒否する */
export async function fillWeek(week: number, opts: { dryRun?: boolean } = {}): Promise<
  { ok: false; readiness: WeekReadiness } | { ok: true; readiness: WeekReadiness; result: FillResult; report: AttributeReport }
> {
  await assertFrameworkIntact();
  const readiness = await weekReadiness(week);
  if (!readiness.ok) {
    await notify(
      "WARN",
      "PLAN_WEEK_BLOCKED",
      `第${week}週の本文確定を拒否: ${readiness.reasons.join(" / ")}`,
    );
    return { ok: false, readiness };
  }

  const report = await analyzeAttributes();
  const tilt = week === 1 ? null : chooseTilt(report);
  const result = await buildWeekDrafts(week, tilt);

  if (!opts.dryRun) {
    await persistWeek(result);
    // ★本文を足したあとで枠組みが動いていないことを必ず確認する
    await assertFrameworkIntact();
    await notify(
      "INFO",
      "PLAN_WEEK_FILLED",
      `第${week}週 ${result.drafts.length}本の本文を確定（予定API費 $${result.costUsd.toFixed(3)}）`,
    );
  }
  return { ok: true, readiness, result, report };
}
