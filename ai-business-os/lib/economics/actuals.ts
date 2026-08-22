import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../env';
import {
  confidenceOf,
  dataVolumeOf,
  type AcquisitionChannelKey,
  type DataVolume,
  type FunnelAssumption,
  type ValueSource,
} from '../types';
import { CHANNEL_MODELS, HOURLY_YEN } from './channels';

/**
 * 実際に営業した結果（実測）を読み込む唯一の入口。
 *
 * ここで一番大事なのは「1件の成約で全部を書き換えない」こと。
 * 実績3件で成約率33%と出ても、それは3件のうち1件が決まっただけで、
 * 本当の成約率が5%である可能性は十分残っている。
 * そのため、実績は
 *   ① 件数が少ないほど幅（信頼区間）を広く取る
 *   ② 件数が少ないほど仮定側へ引き戻す（縮小推定）
 * の2段構えで反映する。
 *
 * 分母が0の指標は 0 ではなく null にする。0にすると「実測して悪かった」と区別が付かない。
 */

const ACTUALS_FILE = path.join(DATA_DIR, 'sales-actuals.csv');

export const SALES_ACTUALS_PATH = ACTUALS_FILE;

/** 正式な列。この順番と名前を変えない（変えると過去の記録が読めなくなる） */
export const SALES_ACTUALS_COLUMNS = [
  'date',
  'idea_id',
  'vertical',
  'channel',
  'campaign_id',
  'leads',
  'reachable_leads',
  'calls',
  'emails',
  'replies',
  'positive_replies',
  'demo_requests',
  'meetings',
  'contracts',
  'revenue',
  'direct_cost',
  'sales_time_minutes',
] as const;

export const SALES_ACTUALS_TEMPLATE = `${SALES_ACTUALS_COLUMNS.join(',')}
# 実際にやった営業の結果を1行ずつ書く。分からない列は空欄にする（0と書かない）。
# channel: ${Object.keys(CHANNEL_MODELS).join(' / ')}
# leads=接触を試みた件数 / reachable_leads=実際に相手に届いた件数
# positive_replies=前向きな返信だけ（断り返信は含めない）
# revenue と direct_cost は円。sales_time_minutes は自分が使った分数（時給${HOURLY_YEN.toLocaleString()}円で費用に換算する）
# 個人情報（会社名・担当者名・電話番号・メールアドレス）はこのファイルに書かない
`;

export type SalesActual = {
  date: string;
  ideaId: string;
  vertical: string;
  channel: AcquisitionChannelKey;
  campaignId: string;
  leads: number;
  reachableLeads: number | null;
  calls: number | null;
  emails: number | null;
  replies: number;
  positiveReplies: number | null;
  demoRequests: number;
  meetings: number | null;
  contracts: number;
  revenue: number;
  directCost: number;
  salesTimeMinutes: number | null;
};

const CHANNEL_KEYS = Object.keys(CHANNEL_MODELS) as AcquisitionChannelKey[];

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * 列の位置ではなく列名で読む。
 * 途中に列が増えても過去の行が壊れないようにするため。
 */
export function parseSalesActuals(text: string): SalesActual[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  const head = lines.shift();
  if (!head) return [];
  const idx = new Map<string, number>();
  head.split(',').forEach((name, i) => idx.set(name.trim(), i));
  const at = (cols: string[], name: string) => {
    const i = idx.get(name);
    return i === undefined ? undefined : cols[i];
  };

  const out: SalesActual[] = [];
  for (const line of lines) {
    const c = line.split(',');
    const channel = (at(c, 'channel') ?? '').trim() as AcquisitionChannelKey;
    if (!CHANNEL_KEYS.includes(channel)) continue;
    const leads = num(at(c, 'leads'));
    const directCost = num(at(c, 'direct_cost'));
    // 母数と費用が無い行は集計に使えない。0で埋めない
    if (leads === null || leads <= 0 || directCost === null) continue;
    out.push({
      date: (at(c, 'date') ?? '').trim(),
      ideaId: (at(c, 'idea_id') ?? '').trim(),
      vertical: (at(c, 'vertical') ?? '').trim(),
      channel,
      campaignId: (at(c, 'campaign_id') ?? '').trim(),
      leads,
      reachableLeads: num(at(c, 'reachable_leads')),
      calls: num(at(c, 'calls')),
      emails: num(at(c, 'emails')),
      replies: num(at(c, 'replies')) ?? 0,
      positiveReplies: num(at(c, 'positive_replies')),
      demoRequests: num(at(c, 'demo_requests')) ?? 0,
      meetings: num(at(c, 'meetings')),
      contracts: num(at(c, 'contracts')) ?? 0,
      revenue: num(at(c, 'revenue')) ?? 0,
      directCost,
      salesTimeMinutes: num(at(c, 'sales_time_minutes')),
    });
  }
  return out;
}

export function readSalesActuals(): SalesActual[] {
  if (!fs.existsSync(ACTUALS_FILE)) return [];
  return parseSalesActuals(fs.readFileSync(ACTUALS_FILE, 'utf8'));
}

/**
 * 実測から出す指標。すべて分母が0なら null。
 * 率の分母は次のように固定する（後から都合よく変えない）:
 *   返信率・前向き返信率 …… 届いた件数（reachable_leads。無ければ leads）
 *   デモ率・商談率・成約率 …… 接触件数（leads）
 * 成約率を「商談のうち何%」にすると母数が小さくなりすぎて毎回跳ねるため、リード基準で固定する。
 */
export type SalesMetrics = {
  key: string;
  ideaId: string | null;
  channel: AcquisitionChannelKey | null;
  rows: number;
  leads: number;
  reachableLeads: number;
  replies: number;
  positiveReplies: number;
  demoRequests: number;
  meetings: number;
  contracts: number;
  revenue: number;
  directCost: number;
  salesTimeMinutes: number;
  /** 直接費 ＋ 営業時間を時給換算した金額 */
  totalCost: number;

  replyRate: number | null;
  positiveReplyRate: number | null;
  demoRate: number | null;
  meetingRate: number | null;
  closeRate: number | null;
  revenuePerLead: number | null;
  costPerLead: number | null;
  costPerReply: number | null;
  costPerDemo: number | null;
  cac: number | null;
  roas: number | null;
  salesTimePerContract: number | null;

  /** モンテカルロに渡す段階ごとの率（リード→返信→デモ→契約） */
  stageReplyRate: number | null;
  stageDemoRate: number | null;
  stageCloseRate: number | null;

  source: ValueSource;
  sampleSize: number;
  dataVolume: DataVolume;
  confidence: number;
};

function emptyMetrics(key: string, ideaId: string | null, channel: AcquisitionChannelKey | null): SalesMetrics {
  return {
    key,
    ideaId,
    channel,
    rows: 0,
    leads: 0,
    reachableLeads: 0,
    replies: 0,
    positiveReplies: 0,
    demoRequests: 0,
    meetings: 0,
    contracts: 0,
    revenue: 0,
    directCost: 0,
    salesTimeMinutes: 0,
    totalCost: 0,
    replyRate: null,
    positiveReplyRate: null,
    demoRate: null,
    meetingRate: null,
    closeRate: null,
    revenuePerLead: null,
    costPerLead: null,
    costPerReply: null,
    costPerDemo: null,
    cac: null,
    roas: null,
    salesTimePerContract: null,
    stageReplyRate: null,
    stageDemoRate: null,
    stageCloseRate: null,
    source: 'MEASURED',
    sampleSize: 0,
    dataVolume: 'NO_DATA',
    confidence: 0,
  };
}

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const yenPer = (a: number, b: number): number | null => (b > 0 ? Math.round(a / b) : null);
const r3 = (v: number | null): number | null => (v === null ? null : Math.round(v * 1000) / 1000);

function finalize(m: SalesMetrics): SalesMetrics {
  m.totalCost = Math.round(m.directCost + (m.salesTimeMinutes / 60) * HOURLY_YEN);
  // 届いた件数が未記入なら接触件数で代用する（0扱いにはしない）
  const reach = m.reachableLeads > 0 ? m.reachableLeads : m.leads;

  m.replyRate = r3(div(m.replies, reach));
  m.positiveReplyRate = r3(div(m.positiveReplies, reach));
  m.demoRate = r3(div(m.demoRequests, m.leads));
  m.meetingRate = r3(div(m.meetings, m.leads));
  m.closeRate = r3(div(m.contracts, m.leads));
  m.revenuePerLead = yenPer(m.revenue, m.leads);
  m.costPerLead = yenPer(m.totalCost, m.leads);
  m.costPerReply = yenPer(m.totalCost, m.replies);
  m.costPerDemo = yenPer(m.totalCost, m.demoRequests);
  m.cac = yenPer(m.totalCost, m.contracts);
  m.roas = m.totalCost > 0 ? Math.round((m.revenue / m.totalCost) * 100) / 100 : null;
  m.salesTimePerContract = m.contracts > 0 ? Math.round(m.salesTimeMinutes / m.contracts) : null;

  m.stageReplyRate = r3(div(m.replies, reach));
  m.stageDemoRate = r3(div(m.demoRequests, m.replies));
  m.stageCloseRate = r3(div(m.contracts, m.demoRequests));

  m.sampleSize = m.leads;
  m.dataVolume = dataVolumeOf(m.leads);
  m.confidence = confidenceOf(m.leads);
  return m;
}

export function aggregate(
  rows: SalesActual[],
  keyOf: (r: SalesActual) => string,
  meta: (r: SalesActual) => { ideaId: string | null; channel: AcquisitionChannelKey | null }
): Map<string, SalesMetrics> {
  const out = new Map<string, SalesMetrics>();
  for (const r of rows) {
    const key = keyOf(r);
    const info = meta(r);
    const m = out.get(key) ?? emptyMetrics(key, info.ideaId, info.channel);
    m.rows += 1;
    m.leads += r.leads;
    m.reachableLeads += r.reachableLeads ?? 0;
    m.replies += r.replies;
    m.positiveReplies += r.positiveReplies ?? 0;
    m.demoRequests += r.demoRequests;
    m.meetings += r.meetings ?? 0;
    m.contracts += r.contracts;
    m.revenue += r.revenue;
    m.directCost += r.directCost;
    m.salesTimeMinutes += r.salesTimeMinutes ?? 0;
    out.set(key, m);
  }
  for (const m of out.values()) finalize(m);
  return out;
}

/** チャネル別。モンテカルロの前提更新に使う */
export function aggregateByChannel(
  rows: SalesActual[] = readSalesActuals()
): Partial<Record<AcquisitionChannelKey, SalesMetrics>> {
  const map = aggregate(
    rows,
    (r) => r.channel,
    (r) => ({ ideaId: null, channel: r.channel })
  );
  const out: Partial<Record<AcquisitionChannelKey, SalesMetrics>> = {};
  for (const [k, v] of map) out[k as AcquisitionChannelKey] = v;
  return out;
}

/** 案件別。検証カードと判定に使う */
export function aggregateByIdea(rows: SalesActual[] = readSalesActuals()): Map<string, SalesMetrics> {
  return aggregate(
    rows,
    (r) => r.ideaId,
    (r) => ({ ideaId: r.ideaId, channel: null })
  );
}

/** 案件×チャネル別。どの売り方が効いたかの比較に使う */
export function aggregateByIdeaChannel(
  rows: SalesActual[] = readSalesActuals()
): Map<string, SalesMetrics> {
  return aggregate(
    rows,
    (r) => `${r.ideaId}:${r.channel}`,
    (r) => ({ ideaId: r.ideaId, channel: r.channel })
  );
}

/**
 * 実測の率を「幅」に変える。件数が少ないほど幅を広く取る。
 * 95%信頼区間（正規近似）に、母数が極端に少ないときの上乗せを加える。
 */
export function rateRange(successes: number, trials: number, fallback: [number, number]): [number, number] {
  if (trials <= 0) return fallback;
  const p = successes / trials;
  const half = 1.96 * Math.sqrt(Math.max(p * (1 - p), 0.01) / trials);
  const lo = Math.max(0.0005, p - half);
  const hi = Math.min(0.95, p + half);
  return [lo, hi];
}

/**
 * 実績が少ないうちは幅をさらに広げる。
 * 3件成約/80リード＝3.75% を、そのまま「3.75%です」と言い切らないための処置。
 * 実績が積み上がるほど広げ幅を戻し、最後は実測そのものに近づける。
 */
export function widenFor(volume: DataVolume): number {
  if (volume === 'HIGH_DATA') return 1;
  if (volume === 'MEDIUM_DATA') return 1.25;
  if (volume === 'LOW_DATA') return 1.6;
  return 2;
}

function widen(range: [number, number], factor: number): [number, number] {
  const c = (range[0] + range[1]) / 2;
  return [
    Math.max(0.0005, c - ((c - range[0]) * factor)),
    Math.min(0.95, c + ((range[1] - c) * factor)),
  ];
}

/** 実測値と仮定値を混ぜる。母数が少ないうちは仮定側に寄せる（縮小推定） */
function shrinkRange(
  measured: [number, number],
  assumed: [number, number],
  trials: number,
  halfWeightAt = 30
): [number, number] {
  const w = trials / (trials + halfWeightAt);
  return [measured[0] * w + assumed[0] * (1 - w), measured[1] * w + assumed[1] * (1 - w)];
}

function costRange(mean: number, samples: number, fallback: [number, number]): [number, number] {
  if (samples <= 0) return fallback;
  const spread = Math.min(0.8, 1 / Math.sqrt(samples));
  return [mean * (1 - spread), mean * (1 + spread)];
}

/**
 * チャネルの実績を前提に反映する。実績が無ければ仮定のまま返す。
 * 返り値の source / dataVolume を画面でそのまま表示し、実測か仮定かを必ず見せる。
 */
export function applyActuals(
  base: FunnelAssumption,
  channel: AcquisitionChannelKey = base.channel,
  metrics: Partial<Record<AcquisitionChannelKey, SalesMetrics>> = aggregateByChannel()
): FunnelAssumption {
  const m = metrics[channel];
  const model = CHANNEL_MODELS[channel];
  if (!m || m.leads <= 0) {
    return {
      ...base,
      channel,
      costPerLead: model.costPerLead,
      salesCostPerReply: model.salesCostPerReply,
      demoCostPerDemo: model.demoCostPerDemo,
      closingCostPerWin: model.closingCostPerWin,
      replyRate: model.replyRate,
      demoRate: model.demoRate,
      closeRate: model.closeRate,
      source: 'ASSUMPTION',
      sampleSize: 0,
      dataVolume: 'NO_DATA',
      confidence: 0,
    };
  }

  const f = widenFor(m.dataVolume);
  const reach = m.reachableLeads > 0 ? m.reachableLeads : m.leads;
  const replyRate = shrinkRange(
    widen(rateRange(m.replies, reach, model.replyRate), f),
    model.replyRate,
    reach
  );
  const demoRate =
    m.replies > 0
      ? shrinkRange(
          widen(rateRange(m.demoRequests, m.replies, model.demoRate), f),
          model.demoRate,
          m.replies
        )
      : model.demoRate;
  const closeRate =
    m.demoRequests > 0
      ? shrinkRange(
          widen(rateRange(m.contracts, m.demoRequests, model.closeRate), f),
          model.closeRate,
          m.demoRequests
        )
      : model.closeRate;

  return {
    ...base,
    channel,
    costPerLead: shrinkRange(
      costRange(m.costPerLead ?? 0, m.leads, model.costPerLead),
      model.costPerLead,
      m.leads
    ),
    salesCostPerReply: model.salesCostPerReply,
    demoCostPerDemo: model.demoCostPerDemo,
    closingCostPerWin: model.closingCostPerWin,
    replyRate,
    demoRate,
    closeRate,
    source: 'MEASURED',
    sampleSize: m.leads,
    dataVolume: m.dataVolume,
    confidence: m.confidence,
  };
}
