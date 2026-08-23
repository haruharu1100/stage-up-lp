import { getDb, nowIso, notify } from "./db.js";

// url_link_clicks と profile_clicks は投稿から30日で永久に取得不能になる。
// 「30日目ちょうどに読む」設計はその日にMacが落ちていたら終わるので、
// 30日以内の全投稿を毎日読む。読み取りは$0.001/回で30日405円。取り逃す方が高い。
export const RETENTION_DAYS = 30;
export const WARN_AFTER_DAYS = 27; // 残り3日の猶予がある間に人へ届ける

export interface MetricSnapshot {
  postId: number;
  impressions: number | null;
  likes: number | null;
  replies: number | null;
  reposts: number | null;
  bookmarks: number | null;
  profileClicks: number | null;
  urlLinkClicks: number | null;
  engagements: number | null;
  fetchedOk: boolean;
  errorDetail?: string;
}

export interface LivePost {
  id: number;
  xPostId: string;
  publishedAt: string;
  daysSincePost: number;
}

export async function postsWithinRetention(): Promise<LivePost[]> {
  const db = getDb();
  const rs = await db.execute({
    sql: `SELECT id, x_post_id, published_at
          FROM posts
          WHERE status='published' AND published_at IS NOT NULL
            AND julianday('now') - julianday(published_at) <= ?
          ORDER BY published_at ASC`,
    args: [RETENTION_DAYS],
  });
  return rs.rows.map((r) => {
    const publishedAt = String(r.published_at);
    const days = Math.floor(
      (Date.now() - new Date(publishedAt).getTime()) / 86400000,
    );
    return {
      id: Number(r.id),
      xPostId: String(r.x_post_id ?? ""),
      publishedAt,
      daysSincePost: days,
    };
  });
}

// スナップショット方式。上書きしない
export async function saveSnapshot(s: MetricSnapshot, daysSincePost: number): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO post_metrics
            (post_id, snapshot_at, days_since_post, impressions, likes, replies,
             reposts, bookmarks, profile_clicks, url_link_clicks, engagements,
             fetched_ok, error_detail)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      s.postId, nowIso(), daysSincePost,
      s.impressions, s.likes, s.replies, s.reposts, s.bookmarks,
      s.profileClicks, s.urlLinkClicks, s.engagements,
      s.fetchedOk ? 1 : 0, s.errorDetail ?? null,
    ],
  });
}

export interface RiskRow {
  postId: number;
  daysSincePost: number;
  daysLeft: number;
  lastOkAt: string | null;
  consecutiveFailures: number;
}

// 取り逃しそうな投稿を出す。ここが人へ届かないと30日で消えて終わる
export async function atRiskPosts(): Promise<RiskRow[]> {
  const db = getDb();
  const posts = await postsWithinRetention();
  const out: RiskRow[] = [];

  for (const p of posts) {
    const ok = await db.execute({
      sql: `SELECT MAX(snapshot_at) AS last_ok FROM post_metrics
            WHERE post_id=? AND fetched_ok=1 AND url_link_clicks IS NOT NULL`,
      args: [p.id],
    });
    const lastOkAt = ok.rows[0]?.last_ok ? String(ok.rows[0].last_ok) : null;

    const recent = await db.execute({
      sql: `SELECT fetched_ok FROM post_metrics WHERE post_id=?
            ORDER BY snapshot_at DESC LIMIT 5`,
      args: [p.id],
    });
    let consecutiveFailures = 0;
    for (const r of recent.rows) {
      if (Number(r.fetched_ok) === 0) consecutiveFailures++;
      else break;
    }

    const needsWarning =
      (lastOkAt === null && p.daysSincePost >= WARN_AFTER_DAYS) ||
      consecutiveFailures >= 2;

    if (needsWarning) {
      out.push({
        postId: p.id,
        daysSincePost: p.daysSincePost,
        daysLeft: RETENTION_DAYS - p.daysSincePost,
        lastOkAt,
        consecutiveFailures,
      });
    }
  }
  return out;
}

export async function raiseRiskNotifications(rows: RiskRow[]): Promise<void> {
  for (const r of rows) {
    const critical = r.daysLeft <= 3;
    await notify(
      critical ? "CRITICAL" : "WARN",
      critical ? "METRICS_EXPIRY_IMMINENT" : "METRICS_FETCH_FAILING",
      critical
        ? `投稿#${r.postId} のリンククリック数が未取得のまま残り${r.daysLeft}日です。` +
          `この期限を過ぎると二度と取得できません。`
        : `投稿#${r.postId} の取得が${r.consecutiveFailures}回連続で失敗しています（経過${r.daysSincePost}日）。`,
    );
  }
}

// fetched_ok=0 は集計から外す。未取得と0を混ぜない
export async function rpmForPost(postId: number): Promise<{
  rpm: number | null;
  impressions: number | null;
  revenueUsd: number;
  costUsd: number;
  reason?: string;
}> {
  const db = getDb();
  const imp = await db.execute({
    sql: `SELECT MAX(impressions) AS impressions FROM post_metrics
          WHERE post_id=? AND fetched_ok=1 AND impressions IS NOT NULL`,
    args: [postId],
  });
  const impressions = imp.rows[0]?.impressions != null ? Number(imp.rows[0].impressions) : null;

  const rev = await db.execute({
    sql: `SELECT COALESCE(SUM(cv.payout_usd),0) AS revenue
          FROM conversions cv
          JOIN clicks c ON c.click_id = cv.click_id
          WHERE c.post_id=? AND cv.status='APPROVED'`,
    args: [postId],
  });
  const revenueUsd = Number(rev.rows[0]?.revenue ?? 0);

  const cost = await db.execute({
    sql: `SELECT COALESCE(SUM(amount_usd),0) AS cost FROM costs WHERE post_id=?`,
    args: [postId],
  });
  const costUsd = Number(cost.rows[0]?.cost ?? 0);

  if (impressions === null || impressions === 0) {
    return { rpm: null, impressions, revenueUsd, costUsd, reason: "インプレッション未取得" };
  }
  return {
    rpm: ((revenueUsd - costUsd) / impressions) * 1000,
    impressions,
    revenueUsd,
    costUsd,
  };
}
