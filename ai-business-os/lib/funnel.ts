import { all, nowIso, run } from './db/client';
import { config } from './env';
import { EVENT_TYPES, type Attribution, type ConversionEventType } from './types';

/** 少ない件数で結論を出さないための型。分母が足りなければ率を返さない。 */
export type Rate = {
  numerator: number;
  denominator: number;
  rate: number | null;
  status: 'OK' | 'INSUFFICIENT_DATA';
};

export function rate(numerator: number, denominator: number, minSample = config.minSampleSize): Rate {
  if (denominator < minSample) {
    return { numerator, denominator, rate: null, status: 'INSUFFICIENT_DATA' };
  }
  return { numerator, denominator, rate: numerator / denominator, status: 'OK' };
}

export async function recordEvent(input: {
  type: ConversionEventType;
  ideaId?: string | null;
  productId?: string | null;
  contentId?: string | null;
  utmCampaign?: string | null;
  utmContent?: string | null;
  amountYen?: number;
  note?: string;
  occurredAt?: string;
}): Promise<void> {
  await run(
    `INSERT INTO conversion_events
      (event_type, idea_id, product_id, content_id, utm_campaign, utm_content, amount_yen, occurred_at, note)
     VALUES (?,?,?,?,?,?,?,?,?)`,
    [
      input.type,
      input.ideaId ?? null,
      input.productId ?? null,
      input.contentId ?? null,
      input.utmCampaign ?? null,
      input.utmContent ?? null,
      input.amountYen ?? 0,
      input.occurredAt ?? nowIso(),
      input.note ?? '',
    ]
  );
}

async function countBy(type: ConversionEventType, sinceIso?: string): Promise<number> {
  const rows = sinceIso
    ? await all<{ c: number }>(
        'SELECT COUNT(*) as c FROM conversion_events WHERE event_type = ? AND occurred_at >= ?',
        [type, sinceIso]
      )
    : await all<{ c: number }>('SELECT COUNT(*) as c FROM conversion_events WHERE event_type = ?', [type]);
  return Number(rows[0]?.c ?? 0);
}

async function sumAmount(type: ConversionEventType, sinceIso?: string): Promise<number> {
  const rows = sinceIso
    ? await all<{ s: number | null }>(
        'SELECT SUM(amount_yen) as s FROM conversion_events WHERE event_type = ? AND occurred_at >= ?',
        [type, sinceIso]
      )
    : await all<{ s: number | null }>('SELECT SUM(amount_yen) as s FROM conversion_events WHERE event_type = ?', [type]);
  return Number(rows[0]?.s ?? 0);
}

function daysAgoIso(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString();
}

export type FunnelSnapshot = {
  window: string;
  counts: Record<ConversionEventType, number>;
  impressionToClick: Rate;
  xClickToNote: Rate;
  noteViewToPurchase: Rate;
  demoToMeeting: Rate;
  meetingToContract: Rate;
  revenueYen: number;
};

export async function funnelSnapshot(days: number | null): Promise<FunnelSnapshot> {
  const since = days === null ? undefined : daysAgoIso(days);
  const counts = {} as Record<ConversionEventType, number>;
  for (const t of EVENT_TYPES) counts[t] = await countBy(t, since);

  const revenue =
    (await sumAmount('NOTE_PURCHASE', since)) +
    (await sumAmount('CONTRACT', since)) +
    (await sumAmount('REVENUE', since));

  return {
    window: days === null ? '累計' : `直近${days}日`,
    counts,
    impressionToClick: rate(counts.X_CLICK, counts.X_IMPRESSION),
    xClickToNote: rate(counts.NOTE_VIEW, counts.X_CLICK),
    noteViewToPurchase: rate(counts.NOTE_PURCHASE, counts.NOTE_VIEW),
    demoToMeeting: rate(counts.MEETING, counts.DEMO_COMPLETE),
    meetingToContract: rate(counts.CONTRACT, counts.MEETING),
    revenueYen: revenue,
  };
}

export type SaasKpi = {
  activeContracts: number;
  mrrYen: number;
  arrYen: number;
  churnRate: Rate;
  ltvYen: number | null;
  cacYen: number | null;
  ltvCac: number | null;
  paybackMonths: number | null;
  status: 'OK' | 'INSUFFICIENT_DATA';
};

export async function saasKpi(): Promise<SaasKpi> {
  const active = await all<{ c: number; s: number | null }>(
    'SELECT COUNT(*) as c, SUM(monthly_yen) as s FROM contracts WHERE ended_at IS NULL'
  );
  const ended = await all<{ c: number }>('SELECT COUNT(*) as c FROM contracts WHERE ended_at IS NOT NULL');
  const activeContracts = Number(active[0]?.c ?? 0);
  const mrr = Number(active[0]?.s ?? 0);
  const churned = Number(ended[0]?.c ?? 0);
  const total = activeContracts + churned;

  const churn = rate(churned, total, 10);

  // 広告費・営業費が未記録の間は CAC を推定しない（0にしない）
  const spendRows = await all<{ s: number | null }>(
    "SELECT SUM(amount_yen) as s FROM conversion_events WHERE event_type = 'LEAD' AND amount_yen > 0"
  );
  const spend = Number(spendRows[0]?.s ?? 0);
  const cac = spend > 0 && activeContracts > 0 ? spend / activeContracts : null;

  const monthlyGross = activeContracts > 0 ? (mrr / activeContracts) * 0.8 : 0;
  const ltv = churn.rate && churn.rate > 0 ? monthlyGross / churn.rate : null;
  const ltvCac = ltv !== null && cac !== null && cac > 0 ? ltv / cac : null;
  const payback = cac !== null && monthlyGross > 0 ? cac / monthlyGross : null;

  return {
    activeContracts,
    mrrYen: mrr,
    arrYen: mrr * 12,
    churnRate: churn,
    ltvYen: ltv === null ? null : Math.round(ltv),
    cacYen: cac === null ? null : Math.round(cac),
    ltvCac: ltvCac === null ? null : Math.round(ltvCac * 100) / 100,
    paybackMonths: payback === null ? null : Math.round(payback * 10) / 10,
    status: total < 3 ? 'INSUFFICIENT_DATA' : 'OK',
  };
}

/**
 * ATTRIBUTION：どの海外ネタから何円生まれたかを辿る。最重要データ。
 * 実測が無い段階では 0 が並ぶが、これは「まだ動かしていない」であって
 * 「成果が出なかった」ではない。chain 文にもその旨を書き分ける。
 */
export async function attributionByIdea(): Promise<Attribution[]> {
  const rows = await all<{
    idea_id: string;
    title: string;
    contents: number;
    x_impressions: number;
    x_clicks: number;
    note_views: number;
    note_purchases: number;
    demos: number;
    leads: number;
    meetings: number;
    contracts: number;
    revenue: number | null;
  }>(
    `SELECT i.id as idea_id, i.title as title,
            SUM(CASE WHEN e.event_type = 'CONTENT_PUBLISHED' THEN 1 ELSE 0 END) as contents,
            SUM(CASE WHEN e.event_type = 'X_IMPRESSION' THEN 1 ELSE 0 END) as x_impressions,
            SUM(CASE WHEN e.event_type = 'X_CLICK' THEN 1 ELSE 0 END) as x_clicks,
            SUM(CASE WHEN e.event_type = 'NOTE_VIEW' THEN 1 ELSE 0 END) as note_views,
            SUM(CASE WHEN e.event_type = 'NOTE_PURCHASE' THEN 1 ELSE 0 END) as note_purchases,
            SUM(CASE WHEN e.event_type = 'DEMO_COMPLETE' THEN 1 ELSE 0 END) as demos,
            SUM(CASE WHEN e.event_type = 'LEAD' THEN 1 ELSE 0 END) as leads,
            SUM(CASE WHEN e.event_type = 'MEETING' THEN 1 ELSE 0 END) as meetings,
            SUM(CASE WHEN e.event_type = 'CONTRACT' THEN 1 ELSE 0 END) as contracts,
            SUM(CASE WHEN e.event_type IN ('NOTE_PURCHASE','CONTRACT','REVENUE') THEN e.amount_yen ELSE 0 END) as revenue
     FROM ideas i
     LEFT JOIN conversion_events e ON e.idea_id = i.id
     GROUP BY i.id
     ORDER BY revenue DESC, contracts DESC`
  );

  return rows.map((r) => {
    const revenue = Number(r.revenue ?? 0);
    const n = (v: number) => Number(v ?? 0);
    const measured =
      n(r.contents) + n(r.x_clicks) + n(r.note_purchases) + n(r.contracts) + revenue > 0;
    const chain = measured
      ? `${r.title} → 公開${n(r.contents)} → Xクリック${n(r.x_clicks)} → note購入${n(r.note_purchases)} → デモ${n(r.demos)} → 契約${n(r.contracts)} → ${revenue.toLocaleString()}円`
      : `${r.title} → まだ1件も公開していないため未計測（成果ゼロではない）`;
    return {
      ideaId: r.idea_id,
      ideaTitle: r.title,
      contents: n(r.contents),
      xImpressions: n(r.x_impressions),
      xClicks: n(r.x_clicks),
      noteViews: n(r.note_views),
      notePurchases: n(r.note_purchases),
      demos: n(r.demos),
      leads: n(r.leads),
      meetings: n(r.meetings),
      contracts: n(r.contracts),
      revenueYen: revenue,
      chain,
    };
  });
}

/** どのX投稿から売れたかをUTMで辿る */
export async function revenueByCampaign() {
  return all<{ utm_campaign: string | null; utm_content: string | null; purchases: number; revenue: number }>(
    `SELECT utm_campaign, utm_content,
            SUM(CASE WHEN event_type IN ('NOTE_PURCHASE','CONTRACT') THEN 1 ELSE 0 END) as purchases,
            SUM(amount_yen) as revenue
     FROM conversion_events
     GROUP BY utm_campaign, utm_content
     HAVING purchases > 0
     ORDER BY revenue DESC`
  );
}
