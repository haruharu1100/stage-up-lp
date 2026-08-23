// 投稿属性の学習（docs/12_Phase1計画.md §9）
//
// ★この実装が守っている決めごと
//   1. 「この投稿が伸びた」で終わらせない。「何が伸びる原因だった可能性が高いか」を出す
//   2. 最低サンプル未満では寄与を断定しない（CONTINUE のみ）
//   3. 取得できなかった実績（fetched_ok=0）を0として集計に入れない
//   4. 比較する2群で複数の属性が同時に変わっていたら、原因を特定できないので警告する

import { getDb } from "./db.js";

/**
 * 12属性。うち RPM だけは「保存する値」ではなく
 * 上の11属性で切って post_metrics × conversions × costs から都度算出する成果指標。
 */
export const ATTRIBUTE_KEYS = [
  "CHARACTER",
  "HOOK",
  "TOPIC",
  "OUTFIT",
  "BACKGROUND",
  "ENGLISH_STYLE",
  "POST_LENGTH",
  "CTA",
  "TIME",
  "GEO",
  "AFFILIATE",
  "RPM",
] as const;
export type AttributeKey = (typeof ATTRIBUTE_KEYS)[number];

/** 切り口として使う11属性（RPMは成果指標なので除く） */
export const DIMENSIONS = ATTRIBUTE_KEYS.filter((k) => k !== "RPM") as readonly Exclude<
  AttributeKey,
  "RPM"
>[];

/** 本文を書き換えて動かせる属性（日付・時刻・A/B・カテゴリは枠組みなので動かさない） */
export const ROLLABLE_DIMENSIONS = [
  "HOOK",
  "OUTFIT",
  "BACKGROUND",
  "ENGLISH_STYLE",
  "POST_LENGTH",
] as const;
export type RollableDimension = (typeof ROLLABLE_DIMENSIONS)[number];

// 05_ANALYTICS/収益モデル3本.md §5 の最低サンプル表
export const MIN_SAMPLE = {
  /** 投稿パターンの優劣を書いてよい最低投稿数 */
  POST_PATTERN: 30,
  /** X CTR の結論に必要な累計インプレッション */
  X_CTR_IMPRESSIONS: 100_000,
  /** 案件の優劣に必要な成約数 */
  OFFER_CONVERSIONS: 20,
  /** CVR の結論に必要なアフィリクリック（律速） */
  CVR_AFFILIATE_CLICKS: 500,
} as const;

/**
 * 次の週の本文を「どちらへ寄せるか」を決めてよい最低本数。
 * ★これは結論ではない。HYPOTHESIS として次週の生成に反映するだけで、
 *   MIN_SAMPLE.POST_PATTERN に届くまで「これが原因だ」とは書かない。
 */
export const EXPLORATORY_MIN_POSTS = 3;

export type LengthBucket = "SHORT" | "MEDIUM" | "LONG";

export function lengthBucket(n: number): LengthBucket {
  if (n < 120) return "SHORT";
  if (n < 200) return "MEDIUM";
  return "LONG";
}

// ---------------------------------------------------------------------------
// 保存
// ---------------------------------------------------------------------------

export type PostAttributeInput = {
  postId: number;
  characterName: string;
  hook: string;
  topic: string;
  outfit: string;
  background: string;
  englishStyle: string;
  postLength: number;
  cta: string;
  timeSlot: string;
  geo: string;
  affiliateOfferId: string | null;
};

export async function saveAttributes(a: PostAttributeInput): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO post_attributes
            (post_id, character_name, hook, topic, outfit, background,
             english_style, post_length, cta, time_slot, geo, affiliate_offer_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(post_id) DO UPDATE SET
            character_name=excluded.character_name, hook=excluded.hook, topic=excluded.topic,
            outfit=excluded.outfit, background=excluded.background,
            english_style=excluded.english_style, post_length=excluded.post_length,
            cta=excluded.cta, time_slot=excluded.time_slot, geo=excluded.geo,
            affiliate_offer_id=excluded.affiliate_offer_id`,
    args: [
      a.postId,
      a.characterName,
      a.hook,
      a.topic,
      a.outfit,
      a.background,
      a.englishStyle,
      a.postLength,
      a.cta,
      a.timeSlot,
      a.geo,
      a.affiliateOfferId,
    ],
  });
}

/** 既に使ったトピック（同じトピックを2回書かないため） */
export async function usedTopics(): Promise<Set<string>> {
  const rs = await getDb().execute(`SELECT topic FROM post_attributes WHERE topic IS NOT NULL`);
  return new Set(rs.rows.map((r) => String(r.topic)));
}

// ---------------------------------------------------------------------------
// 集計
// ---------------------------------------------------------------------------

export type PostFact = {
  postId: number;
  slotId: number | null;
  dayIndex: number | null;
  weekIndex: number | null;
  expGroup: string;
  category: string;
  values: Record<string, string>;
  impressions: number;
  engagements: number;
  profileClicks: number | null;
  linkClicks: number | null;
  revenueUsd: number;
  costUsd: number;
  snapshotAt: string;
};

export type FactLoad = {
  facts: PostFact[];
  /** 実績がまだ取れていない投稿（0として集計に入れてはいけない） */
  notFetched: { postId: number; dayIndex: number | null; reason: string }[];
  publishedCount: number;
  /** どの投稿にも紐付かない承認済み成果（post単位のRPMには入れられない） */
  unattributedRevenueUsd: number;
  unattributedConversions: number;
};

export async function loadPostFacts(week?: number): Promise<FactLoad> {
  const db = getDb();

  const postsRs = await db.execute({
    sql: `SELECT p.id AS post_id, p.status, p.category, p.published_at,
                 s.id AS slot_id, s.day_index, s.week_index, s.exp_group,
                 a.character_name, a.hook, a.topic, a.outfit, a.background,
                 a.english_style, a.post_length, a.cta, a.time_slot, a.geo, a.affiliate_offer_id
            FROM post_attributes a
            JOIN posts p ON p.id = a.post_id
            LEFT JOIN post_slots s ON s.post_id = p.id
           WHERE (? IS NULL OR s.week_index = ?)
           ORDER BY s.day_index, s.slot_of_day`,
    args: [week ?? null, week ?? null],
  });

  // ★最新スナップショットだけを使う。積み上げ値なので複数行を足すと二重計上になる。
  //   fetched_ok=0 の行は最初から見ない（未取得を0として混ぜない）
  const metricsRs = await db.execute(
    `SELECT m.post_id, m.snapshot_at, m.impressions, m.likes, m.replies, m.reposts,
            m.bookmarks, m.profile_clicks, m.url_link_clicks, m.engagements
       FROM post_metrics m
       JOIN (SELECT post_id, MAX(snapshot_at) AS s FROM post_metrics
              WHERE fetched_ok = 1 GROUP BY post_id) t
         ON t.post_id = m.post_id AND t.s = m.snapshot_at
      WHERE m.fetched_ok = 1`,
  );
  const metrics = new Map<number, (typeof metricsRs.rows)[number]>();
  for (const r of metricsRs.rows) metrics.set(Number(r.post_id), r);

  const revenueRs = await db.execute(
    `SELECT c.post_id, SUM(cv.payout_usd) AS revenue
       FROM conversions cv JOIN clicks c ON c.click_id = cv.click_id
      WHERE cv.status = 'APPROVED' AND c.post_id IS NOT NULL
      GROUP BY c.post_id`,
  );
  const revenue = new Map<number, number>();
  for (const r of revenueRs.rows) revenue.set(Number(r.post_id), Number(r.revenue ?? 0));

  const costRs = await db.execute(
    `SELECT post_id, SUM(amount_usd) AS cost FROM costs WHERE post_id IS NOT NULL GROUP BY post_id`,
  );
  const cost = new Map<number, number>();
  for (const r of costRs.rows) cost.set(Number(r.post_id), Number(r.cost ?? 0));

  const unattrRs = await db.execute(
    `SELECT COUNT(*) AS n, COALESCE(SUM(cv.payout_usd),0) AS revenue
       FROM conversions cv LEFT JOIN clicks c ON c.click_id = cv.click_id
      WHERE cv.status = 'APPROVED' AND (cv.click_id IS NULL OR c.post_id IS NULL)`,
  );

  const facts: PostFact[] = [];
  const notFetched: FactLoad["notFetched"] = [];
  let publishedCount = 0;

  for (const p of postsRs.rows) {
    const postId = Number(p.post_id);
    if (String(p.status) === "published") publishedCount++;
    const m = metrics.get(postId);
    if (!m) {
      notFetched.push({
        postId,
        dayIndex: p.day_index === null ? null : Number(p.day_index),
        reason: String(p.status) === "published" ? "実績が1回も取れていない" : `未投稿(${String(p.status)})`,
      });
      continue;
    }
    if (m.impressions === null) {
      notFetched.push({
        postId,
        dayIndex: p.day_index === null ? null : Number(p.day_index),
        reason: "インプレッションが未取得",
      });
      continue;
    }
    const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
    facts.push({
      postId,
      slotId: p.slot_id === null ? null : Number(p.slot_id),
      dayIndex: p.day_index === null ? null : Number(p.day_index),
      weekIndex: p.week_index === null ? null : Number(p.week_index),
      expGroup: p.exp_group === null ? "NONE" : String(p.exp_group),
      category: String(p.category ?? "UNKNOWN"),
      values: {
        CHARACTER: String(p.character_name),
        HOOK: String(p.hook ?? "UNKNOWN"),
        TOPIC: String(p.topic ?? "UNKNOWN"),
        OUTFIT: String(p.outfit ?? "UNKNOWN"),
        BACKGROUND: String(p.background ?? "UNKNOWN"),
        ENGLISH_STYLE: String(p.english_style ?? "UNKNOWN"),
        POST_LENGTH: lengthBucket(Number(p.post_length ?? 0)),
        CTA: String(p.cta ?? "UNKNOWN"),
        TIME: String(p.time_slot ?? "UNKNOWN"),
        GEO: String(p.geo ?? "UNKNOWN"),
        AFFILIATE: p.affiliate_offer_id === null ? "NONE" : String(p.affiliate_offer_id),
      },
      impressions: Number(m.impressions),
      engagements:
        m.engagements !== null
          ? Number(m.engagements)
          : num(m.likes) + num(m.replies) + num(m.reposts) + num(m.bookmarks),
      profileClicks: m.profile_clicks === null ? null : Number(m.profile_clicks),
      linkClicks: m.url_link_clicks === null ? null : Number(m.url_link_clicks),
      revenueUsd: revenue.get(postId) ?? 0,
      costUsd: cost.get(postId) ?? 0,
      snapshotAt: String(m.snapshot_at),
    });
  }

  const u = unattrRs.rows[0];
  return {
    facts,
    notFetched,
    publishedCount,
    unattributedConversions: u ? Number(u.n) : 0,
    unattributedRevenueUsd: u ? Number(u.revenue) : 0,
  };
}

// ---------------------------------------------------------------------------
// 属性ごとの集計
// ---------------------------------------------------------------------------

export type GroupStat = {
  value: string;
  posts: number;
  impressions: number;
  engagements: number;
  /** profile_clicks が取れた投稿だけの合計と、その母数 */
  profileClicks: number;
  profileClickImpressions: number;
  linkClicks: number;
  linkClickImpressions: number;
  revenueUsd: number;
  costUsd: number;
  /** 収益 ÷ 表示 × 1000 */
  rpm: number;
  /** (収益 − API費) ÷ 表示 × 1000。判定に使うのはこちら（EXP-001 §3） */
  netRpm: number;
  engagementRate: number;
  /** 1万表示あたりプロフィールクリック。30日検証の主目的 */
  profileClicksPer10k: number | null;
};

export function groupBy(facts: PostFact[], dimension: string): GroupStat[] {
  const buckets = new Map<string, PostFact[]>();
  for (const f of facts) {
    const v = f.values[dimension] ?? "UNKNOWN";
    const list = buckets.get(v);
    if (list) list.push(f);
    else buckets.set(v, [f]);
  }
  const out: GroupStat[] = [];
  for (const [value, list] of buckets) {
    const impressions = list.reduce((s, f) => s + f.impressions, 0);
    const engagements = list.reduce((s, f) => s + f.engagements, 0);
    const revenueUsd = list.reduce((s, f) => s + f.revenueUsd, 0);
    const costUsd = list.reduce((s, f) => s + f.costUsd, 0);
    const withProfile = list.filter((f) => f.profileClicks !== null);
    const withLink = list.filter((f) => f.linkClicks !== null);
    const profileImp = withProfile.reduce((s, f) => s + f.impressions, 0);
    out.push({
      value,
      posts: list.length,
      impressions,
      engagements,
      profileClicks: withProfile.reduce((s, f) => s + (f.profileClicks ?? 0), 0),
      profileClickImpressions: profileImp,
      linkClicks: withLink.reduce((s, f) => s + (f.linkClicks ?? 0), 0),
      linkClickImpressions: withLink.reduce((s, f) => s + f.impressions, 0),
      revenueUsd,
      costUsd,
      rpm: impressions > 0 ? (revenueUsd / impressions) * 1000 : 0,
      netRpm: impressions > 0 ? ((revenueUsd - costUsd) / impressions) * 1000 : 0,
      engagementRate: impressions > 0 ? engagements / impressions : 0,
      profileClicksPer10k:
        profileImp > 0
          ? (withProfile.reduce((s, f) => s + (f.profileClicks ?? 0), 0) / profileImp) * 10000
          : null,
    });
  }
  return out.sort((a, b) => b.posts - a.posts || a.value.localeCompare(b.value));
}

/** 判定に使う指標。収益がまだ1件も無い期間は RPM が全部0になるので、主目的の指標へ落とす */
export type RankMetric = "NET_RPM" | "PROFILE_CLICKS_PER_10K" | "ENGAGEMENT_RATE";

export function pickRankMetric(facts: PostFact[]): RankMetric {
  if (facts.some((f) => f.revenueUsd > 0)) return "NET_RPM";
  if (facts.some((f) => f.profileClicks !== null && f.profileClicks > 0)) return "PROFILE_CLICKS_PER_10K";
  return "ENGAGEMENT_RATE";
}

export function metricValue(g: GroupStat, m: RankMetric): number {
  if (m === "NET_RPM") return g.netRpm;
  if (m === "PROFILE_CLICKS_PER_10K") return g.profileClicksPer10k ?? 0;
  return g.engagementRate;
}

export const METRIC_LABEL: Record<RankMetric, string> = {
  NET_RPM: "RPM（API費控除後・$/1000表示）",
  PROFILE_CLICKS_PER_10K: "1万表示あたりプロフィールクリック",
  ENGAGEMENT_RATE: "エンゲージメント率",
};

/**
 * 2つの群の間で、その属性以外にも同時に変わっている属性を探す。
 * 見つかったら「その属性が原因だ」とは言えない（何が効いたか分離できない）。
 */
export function coChangedDimensions(
  facts: PostFact[],
  dimension: string,
  valueA: string,
  valueB: string,
): { dimension: string; detail: string }[] {
  const ga = facts.filter((f) => (f.values[dimension] ?? "UNKNOWN") === valueA);
  const gb = facts.filter((f) => (f.values[dimension] ?? "UNKNOWN") === valueB);
  const out: { dimension: string; detail: string }[] = [];
  for (const d of DIMENSIONS) {
    if (d === dimension) continue;
    if (d === "TOPIC") continue; // トピックは1投稿1回なので必ず全部違う。比較対象にしない
    const dist = (list: PostFact[]) => {
      const m = new Map<string, number>();
      for (const f of list) {
        const v = f.values[d] ?? "UNKNOWN";
        m.set(v, (m.get(v) ?? 0) + 1);
      }
      return m;
    };
    const da = dist(ga);
    const db = dist(gb);
    if (da.size === 0 || db.size === 0) continue;
    const keys = new Set([...da.keys(), ...db.keys()]);
    let tvd = 0;
    for (const k of keys) {
      tvd += Math.abs((da.get(k) ?? 0) / ga.length - (db.get(k) ?? 0) / gb.length);
    }
    tvd /= 2; // total variation distance（0=同じ構成 / 1=完全に別物）
    if (tvd >= 0.34) {
      const topA = [...da.entries()].sort((x, y) => y[1] - x[1])[0]!;
      const topB = [...db.entries()].sort((x, y) => y[1] - x[1])[0]!;
      out.push({
        dimension: d,
        detail: `${valueA}側は ${topA[0]} が多く(${topA[1]}/${ga.length})、${valueB}側は ${topB[0]} が多い(${topB[1]}/${gb.length}) 差=${(tvd * 100).toFixed(0)}%`,
      });
    }
  }
  return out;
}

export type DimensionReport = {
  dimension: string;
  groups: GroupStat[];
  /** 最低サンプルに届くまでは必ず CONTINUE */
  verdict: "CONTINUE" | "RESULT";
  /** 「原因だった可能性が高い」候補。断定はしない */
  leadHypothesis: { value: string; runnerUp: string; gapPct: number } | null;
  warnings: string[];
};

export type AttributeReport = {
  metric: RankMetric;
  totalPostsWithMetrics: number;
  totalImpressions: number;
  totalRevenueUsd: number;
  totalCostUsd: number;
  overallRpm: number;
  overallNetRpm: number;
  dimensions: DimensionReport[];
  load: FactLoad;
  ab: { group: string; posts: number; impressions: number; netRpm: number; profileClicksPer10k: number | null }[];
  globalWarnings: string[];
};

export async function analyzeAttributes(week?: number): Promise<AttributeReport> {
  const load = await loadPostFacts(week);
  const facts = load.facts;
  const metric = pickRankMetric(facts);

  const dimensions: DimensionReport[] = [];
  for (const d of DIMENSIONS) {
    const groups = groupBy(facts, d).sort(
      (a, b) => metricValue(b, metric) - metricValue(a, metric) || b.posts - a.posts,
    );
    const warnings: string[] = [];
    let leadHypothesis: DimensionReport["leadHypothesis"] = null;

    const comparable = groups.filter((g) => g.posts >= EXPLORATORY_MIN_POSTS);
    if (comparable.length >= 2) {
      const top = comparable[0]!;
      const second = comparable[comparable.length - 1]!;
      const tv = metricValue(top, metric);
      const sv = metricValue(second, metric);
      if (tv > 0 && tv !== sv) {
        leadHypothesis = {
          value: top.value,
          runnerUp: second.value,
          gapPct: sv > 0 ? ((tv - sv) / sv) * 100 : 100,
        };
        const co = coChangedDimensions(facts, d, top.value, second.value);
        for (const c of co) {
          warnings.push(
            `${top.value} と ${second.value} では ${c.dimension} も同時に変わっています（${c.detail}）。どちらが原因かは分離できません`,
          );
        }
      }
    }
    if (facts.length < MIN_SAMPLE.POST_PATTERN) {
      warnings.push(
        `実績のある投稿が ${facts.length}本 です。投稿パターンの優劣を書いてよいのは ${MIN_SAMPLE.POST_PATTERN}本 からです`,
      );
    }
    if (d === "TOPIC") {
      // 話題は1件につき1回しか使わない設計なので、値ごとの本数不足を並べても意味がない
      warnings.push(
        "話題は同じものを2回使わない設計です。話題単位の勝ち負けは原理的に判定できません（上位は参考のみ）",
      );
    } else {
      for (const g of groups) {
        if (g.posts < EXPLORATORY_MIN_POSTS) {
          warnings.push(`${g.value} は ${g.posts}本 しかありません（比較対象に入れていません）`);
        }
      }
    }
    dimensions.push({
      dimension: d,
      groups,
      verdict: facts.length >= MIN_SAMPLE.POST_PATTERN ? "RESULT" : "CONTINUE",
      leadHypothesis,
      warnings,
    });
  }

  const totalImpressions = facts.reduce((s, f) => s + f.impressions, 0);
  const totalRevenueUsd = facts.reduce((s, f) => s + f.revenueUsd, 0);
  const totalCostUsd = facts.reduce((s, f) => s + f.costUsd, 0);

  const ab = ["A", "B"].map((g) => {
    const list = facts.filter((f) => f.expGroup === g);
    const imp = list.reduce((s, f) => s + f.impressions, 0);
    const rev = list.reduce((s, f) => s + f.revenueUsd, 0);
    const cost = list.reduce((s, f) => s + f.costUsd, 0);
    const withProfile = list.filter((f) => f.profileClicks !== null);
    const pImp = withProfile.reduce((s, f) => s + f.impressions, 0);
    return {
      group: g,
      posts: list.length,
      impressions: imp,
      netRpm: imp > 0 ? ((rev - cost) / imp) * 1000 : 0,
      profileClicksPer10k:
        pImp > 0 ? (withProfile.reduce((s, f) => s + (f.profileClicks ?? 0), 0) / pImp) * 10000 : null,
    };
  });

  const globalWarnings: string[] = [];
  if (load.notFetched.length > 0) {
    globalWarnings.push(
      `実績が取れていない投稿が ${load.notFetched.length}本 あります。0として集計には入れていません（未取得と0は別物）`,
    );
  }
  if (load.unattributedConversions > 0) {
    globalWarnings.push(
      `どの投稿にも紐付かない承認済み成果が ${load.unattributedConversions}件（$${load.unattributedRevenueUsd.toFixed(2)}）あります。投稿別RPMには入っていません`,
    );
  }
  if (totalImpressions < MIN_SAMPLE.X_CTR_IMPRESSIONS) {
    globalWarnings.push(
      `累計インプレッションが ${totalImpressions.toLocaleString()} です。X CTR の結論には ${MIN_SAMPLE.X_CTR_IMPRESSIONS.toLocaleString()} 必要です`,
    );
  }
  if (totalRevenueUsd === 0) {
    globalWarnings.push(
      "承認済みの売上がまだ0です。RPMでは差が出ないため、30日検証の主目的である「1万表示あたりプロフィールクリック」で並べています",
    );
  }

  return {
    metric,
    totalPostsWithMetrics: facts.length,
    totalImpressions,
    totalRevenueUsd,
    totalCostUsd,
    overallRpm: totalImpressions > 0 ? (totalRevenueUsd / totalImpressions) * 1000 : 0,
    overallNetRpm:
      totalImpressions > 0 ? ((totalRevenueUsd - totalCostUsd) / totalImpressions) * 1000 : 0,
    dimensions,
    load,
    ab,
    globalWarnings,
  };
}

/**
 * 次の週で「1つだけ」寄せる属性を選ぶ。
 * ★1回に複数属性を同時に変えない（docs/12_Phase1計画.md §9）。
 *   同時に2つ変えると、次の週の結果からどちらが効いたか分からなくなる。
 */
export type Tilt = {
  dimension: RollableDimension;
  value: string;
  runnerUp: string;
  metric: RankMetric;
  leaderPosts: number;
  runnerUpPosts: number;
  gapPct: number;
  coChanged: { dimension: string; detail: string }[];
};

export function chooseTilt(report: AttributeReport): Tilt | null {
  const facts = report.load.facts;
  let best: Tilt | null = null;
  for (const d of ROLLABLE_DIMENSIONS) {
    const dim = report.dimensions.find((x) => x.dimension === d);
    if (!dim) continue;
    const comparable = dim.groups.filter((g) => g.posts >= EXPLORATORY_MIN_POSTS);
    if (comparable.length < 2) continue;
    const top = comparable[0]!;
    const low = comparable[comparable.length - 1]!;
    const tv = metricValue(top, report.metric);
    const lv = metricValue(low, report.metric);
    if (!(tv > lv)) continue;
    const gapPct = lv > 0 ? ((tv - lv) / lv) * 100 : 100;
    if (best === null || gapPct > best.gapPct) {
      best = {
        dimension: d,
        value: top.value,
        runnerUp: low.value,
        metric: report.metric,
        leaderPosts: top.posts,
        runnerUpPosts: low.posts,
        gapPct,
        coChanged: coChangedDimensions(facts, d, top.value, low.value),
      };
    }
  }
  return best;
}
