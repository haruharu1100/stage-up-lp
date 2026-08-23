// 実績取得まわりの受入テスト。本番DBには触らない（一時ファイルへ作る）
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

const dir = mkdtempSync(resolve(tmpdir(), "yamato-metrics-"));
process.env.DATABASE_URL = `file:${resolve(dir, "test.db")}`;

const { getDb, nowIso } = await import("../lib/db.js");
const {
  postsWithinRetention,
  saveSnapshot,
  atRiskPosts,
  raiseRiskNotifications,
  rpmForPost,
  RETENTION_DAYS,
} = await import("../lib/metrics.js");
const { appendEntry, VAULT, WRITABLE } = await import("../lib/obsidian.js");

const db = getDb();
const schema = readFileSync(resolve(import.meta.dirname, "../lib/db/schema.sql"), "utf8");
for (const stmt of schema
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean)) {
  await db.execute(stmt);
}

let failures = 0;
function check(label: string, cond: boolean, detail = ""): void {
  if (cond) console.log(`  OK   ${label}`);
  else {
    console.log(`  NG   ${label}${detail ? ` — ${detail}` : ""}`);
    failures++;
  }
}

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86400000).toISOString();
}

async function makePost(xPostId: string, publishedDaysAgo: number): Promise<number> {
  const rs = await db.execute({
    sql: `INSERT INTO posts (status, text, x_post_id, published_at, created_at)
          VALUES ('published',?,?,?,?)`,
    args: [`test ${xPostId}`, xPostId, daysAgo(publishedDaysAgo), nowIso()],
  });
  return Number(rs.lastInsertRowid);
}

console.log(`\n=== 30日以内の投稿だけを対象にする ===`);
const fresh = await makePost("x-fresh", 5);
const expired = await makePost("x-expired", 40);
const near = await makePost("x-near", 28);
const failing = await makePost("x-failing", 10);

const live = await postsWithinRetention();
const liveIds = live.map((p) => p.id);
check(`5日前の投稿は対象`, liveIds.includes(fresh));
check(`${RETENTION_DAYS}日を過ぎた投稿は対象外`, !liveIds.includes(expired));
check(`経過日数を計算している`, live.find((p) => p.id === fresh)?.daysSincePost === 5);

console.log(`\n=== スナップショットは上書きせず積む ===`);
const base = {
  impressions: 1000,
  likes: 10,
  replies: 1,
  reposts: 2,
  bookmarks: 3,
  profileClicks: 20,
  urlLinkClicks: 5,
  engagements: 13,
  fetchedOk: true,
};
await saveSnapshot({ postId: fresh, ...base }, 4);
await saveSnapshot({ postId: fresh, ...base, impressions: 2000 }, 5);
const rows = await db.execute({
  sql: `SELECT impressions FROM post_metrics WHERE post_id=? ORDER BY id`,
  args: [fresh],
});
check(`同じ投稿でも2行に積まれる`, rows.rows.length === 2, `${rows.rows.length}行`);
check(`古い値が残っている`, Number(rows.rows[0]?.impressions) === 1000);

console.log(`\n=== 取り逃しそうな投稿を人へ出す ===`);
// 28日経過・一度も取得できていない → 残り2日
const risky1 = await atRiskPosts();
check(`28日経過で未取得の投稿が出る`, risky1.some((r) => r.postId === near));
check(`残り日数を出す`, risky1.find((r) => r.postId === near)?.daysLeft === 2);
check(`取得済みの投稿は出さない`, !risky1.some((r) => r.postId === fresh));

// 2連続失敗 → 経過日数が浅くても出す
const ng = {
  impressions: null,
  likes: null,
  replies: null,
  reposts: null,
  bookmarks: null,
  profileClicks: null,
  urlLinkClicks: null,
  engagements: null,
  fetchedOk: false,
  errorDetail: "テスト",
};
await saveSnapshot({ postId: failing, ...ng }, 9);
await saveSnapshot({ postId: failing, ...ng }, 10);
const risky2 = await atRiskPosts();
check(`2回連続で失敗した投稿が出る`, risky2.some((r) => r.postId === failing));

await raiseRiskNotifications(risky2);
const notes = await db.execute(`SELECT severity, code FROM notifications ORDER BY id`);
check(
  `残り3日以内は CRITICAL`,
  notes.rows.some((r) => r.severity === "CRITICAL" && r.code === "METRICS_EXPIRY_IMMINENT"),
);
check(
  `連続失敗は WARN`,
  notes.rows.some((r) => r.severity === "WARN" && r.code === "METRICS_FETCH_FAILING"),
);

console.log(`\n=== 未取得と0を混ぜない ===`);
const noData = await makePost("x-nodata", 3);
await saveSnapshot({ postId: noData, ...ng }, 3);
const r1 = await rpmForPost(noData);
check(`取得失敗しかない投稿の RPM は null`, r1.rpm === null);
check(`理由を返す`, r1.reason === "インプレッション未取得");
check(`インプレッションを0と書かない`, r1.impressions === null);

console.log(`\n=== RPM は承認済みの報酬から費用を引いて出す ===`);
await db.execute({
  sql: `INSERT INTO clicks (click_id, post_id, created_at) VALUES ('c1',?,?)`,
  args: [fresh, nowIso()],
});
await db.execute({
  sql: `INSERT INTO clicks (click_id, post_id, created_at) VALUES ('c2',?,?)`,
  args: [fresh, nowIso()],
});
await db.execute({
  sql: `INSERT INTO conversions (click_id, status, payout_usd, converted_at) VALUES ('c1','APPROVED',40,?)`,
  args: [nowIso()],
});
await db.execute({
  sql: `INSERT INTO conversions (click_id, status, payout_usd, converted_at) VALUES ('c2','PENDING',40,?)`,
  args: [nowIso()],
});
await db.execute({
  sql: `INSERT INTO costs (kind, amount_usd, detail, post_id, occurred_at)
        VALUES ('X_API',20,'テスト',?,?)`,
  args: [fresh, nowIso()],
});
const r2 = await rpmForPost(fresh);
check(`未承認の報酬を売上に入れない`, r2.revenueUsd === 40, `$${r2.revenueUsd}`);
check(`費用を引く`, r2.costUsd === 20);
check(`RPM = (40-20)/2000*1000 = 10`, r2.rpm !== null && Math.abs(r2.rpm - 10) < 1e-9, `${r2.rpm}`);

console.log(`\n=== Obsidian への書き込みは追記だけ ===`);
check(`Vault が見つかる`, existsSync(VAULT));
for (const [key, rel] of Object.entries(WRITABLE)) {
  check(`書き込み先が実在する: ${rel}`, existsSync(resolve(VAULT, rel)), key);
}
let threw = false;
try {
  appendEntry("analytics", { kind: "FACT", title: "出典なしの事実", body: "x" });
} catch {
  threw = true;
}
check(`出典の無い FACT は書けない`, threw);

console.log("");
if (failures === 0) {
  console.log(`✅ すべて合格（実績取得・期限監視・RPM・Obsidian追記）`);
} else {
  console.log(`❌ ${failures}件が不合格`);
  process.exit(1);
}
