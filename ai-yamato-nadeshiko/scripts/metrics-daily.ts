import { getDb, nowIso, notify } from "../lib/db.js";
import {
  postsWithinRetention,
  saveSnapshot,
  atRiskPosts,
  raiseRiskNotifications,
  RETENTION_DAYS,
  type MetricSnapshot,
} from "../lib/metrics.js";
import { fetchMetrics, xToken, READ_COST_USD } from "../lib/x.js";
import { appendDaily } from "../lib/obsidian.js";

// 毎日1回まわす。30日以内の全投稿を読み直す。
// 「取れなかった」も1行として積む。空欄のままにすると取り逃しに気づけない。
const posts = await postsWithinRetention();

if (posts.length === 0) {
  console.log(`30日以内の公開投稿はありません（対象0件）。`);
  process.exit(0);
}

const token = xToken();

if (!token) {
  // 鍵が無いのは「失敗」ではなく「まだ配線されていない」。
  // ただし黙って終わると期限切れに気づけないので、必ず人へ出す
  await notify(
    "WARN",
    "X_CREDENTIALS_MISSING",
    `X_USER_ACCESS_TOKEN が未設定のため、${posts.length}件の実績を取得できませんでした。` +
      `X の実績は投稿から${RETENTION_DAYS}日で永久に取得できなくなります。`,
  );
  const risky = await atRiskPosts();
  await raiseRiskNotifications(risky);
  console.log(`X_USER_ACCESS_TOKEN が未設定です。取得をスキップしました。`);
  console.log(`  対象投稿: ${posts.length}件 / 期限が近い投稿: ${risky.length}件`);
  process.exit(0);
}

const idMap = new Map<string, number>();
for (const p of posts) {
  if (p.xPostId) idMap.set(p.xPostId, p.id);
}

const { snapshots, requests, errors } = await fetchMetrics(idMap);

let ok = 0;
let ng = 0;

for (const p of posts) {
  const got = snapshots.get(p.id);
  const snap: MetricSnapshot = got ?? {
    postId: p.id,
    impressions: null,
    likes: null,
    replies: null,
    reposts: null,
    bookmarks: null,
    profileClicks: null,
    urlLinkClicks: null,
    engagements: null,
    fetchedOk: false,
    errorDetail: p.xPostId
      ? "APIから当該投稿が返らなかった（削除・非公開・権限のいずれか）"
      : "x_post_id が未登録",
  };
  await saveSnapshot(snap, p.daysSincePost);
  if (snap.fetchedOk) ok++;
  else ng++;
}

// 読み取り課金は投稿ごとに1行で積む。月末按分にしない
const db = getDb();
for (const p of posts) {
  await db.execute({
    sql: `INSERT INTO costs (kind, amount_usd, detail, post_id, occurred_at)
          VALUES ('X_API', ?, ?, ?, ?)`,
    args: [READ_COST_USD, "実績の日次取得（1投稿1回）", p.id, nowIso()],
  });
}

for (const e of errors) {
  await notify("WARN", "X_METRICS_FETCH_ERROR", e);
}

const risky = await atRiskPosts();
await raiseRiskNotifications(risky);

const costUsd = posts.length * READ_COST_USD;

// 今日ぶんの合計。取得できた投稿だけを足す（未取得を0として混ぜない）
const totals = await db.execute({
  sql: `SELECT SUM(impressions) AS imp, SUM(url_link_clicks) AS clicks
        FROM post_metrics
        WHERE fetched_ok=1 AND substr(snapshot_at,1,10)=substr(?,1,10)`,
  args: [nowIso()],
});
const impressions = totals.rows[0]?.imp != null ? Number(totals.rows[0].imp) : null;
const urlLinkClicks = totals.rows[0]?.clicks != null ? Number(totals.rows[0].clicks) : null;

const logPath = appendDaily({
  date: nowIso().slice(0, 10),
  posts: posts.length,
  fetchedOk: ok,
  fetchedNg: ng,
  impressions,
  urlLinkClicks,
  costUsd,
  atRisk: risky.length,
});

console.log(`実績の日次取得 完了（${nowIso().slice(0, 10)}）`);
console.log(`  対象投稿: ${posts.length}件 / リクエスト: ${requests}回`);
console.log(`  取得できた: ${ok}件 / 取得できなかった: ${ng}件`);
console.log(`  今回の読み取り費用: $${costUsd.toFixed(3)}`);
if (errors.length) console.log(`  APIエラー: ${errors.length}件（通知済み）`);
if (risky.length) {
  console.log(`  ★期限が近い/失敗が続く投稿: ${risky.length}件 → 通知済み。人が対応してください`);
} else {
  console.log(`  期限が近い投稿: なし`);
}
console.log(`  Obsidianへ追記: ${logPath}`);
