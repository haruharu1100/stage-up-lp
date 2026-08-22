import { all, nowIso, run } from './db/client';
import { config } from './env';
import type { ConversionEventType } from './types';

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
  xClickToNote: Rate;
  noteViewToPurchase: Rate;
  demoToMeeting: Rate;
  meetingToContract: Rate;
  revenueYen: number;
};

const ALL_EVENTS: ConversionEventType[] = [
  'X_CLICK', 'NOTE_VIEW', 'NOTE_PURCHASE', 'LP_VIEW', 'DEMO_START', 'DEMO_COMPLETE',
  'INQUIRY', 'MEETING', 'CONTRACT', 'RETENTION', 'CHURN',
];

export async function funnelSnapshot(days: number | null): Promise<FunnelSnapshot> {
  const since = days === null ? undefined : daysAgoIso(days);
  const counts = {} as Record<ConversionEventType, number>;
  for (const t of ALL_EVENTS) counts[t] = await countBy(t, since);

  const revenue = (await sumAmount('NOTE_PURCHASE', since)) + (await sumAmount('CONTRACT', since));

  return {
    window: days === null ? '累計' : `直近${days}日`,
    counts,
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
    "SELECT SUM(amount_yen) as s FROM conversion_events WHERE event_type = 'INQUIRY' AND amount_yen > 0"
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
