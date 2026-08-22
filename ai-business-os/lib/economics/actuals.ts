import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../env';
import {
  dataVolumeOf,
  type AcquisitionChannelKey,
  type DataVolume,
  type FunnelAssumption,
  type ValueSource,
} from '../types';
import { CHANNEL_MODELS } from './channels';

/**
 * 実績があるならそちらを使う。無いなら仮定のまま。
 *
 * ここで一番大事なのは「1件の成約で全部を書き換えない」こと。
 * 実績3件で成約率33%と出ても、それは3件のうち1件が決まっただけで、
 * 本当の成約率が5%である可能性は十分残っている。
 * そのため、実績は
 *   ① 件数が少ないほど幅（信頼区間）を広く取る
 *   ② 件数が少ないほど仮定側へ引き戻す（縮小推定）
 * の2段構えで反映する。
 */

const ACTUALS_FILE = path.join(DATA_DIR, 'channel-actuals.csv');

export const CHANNEL_ACTUALS_PATH = ACTUALS_FILE;

export const CHANNEL_ACTUALS_TEMPLATE = `date,channel,campaign,leads,cost,calls,emails,replies,demos,meetings,contracts,revenue
# 実際にやった営業の結果を1行ずつ書く。分からない列は空欄にする（0と書かない）。
# channel: ${Object.keys(CHANNEL_MODELS).join(' / ')}
# cost と revenue は円。leads は接触した件数。
`;

export type ChannelActual = {
  date: string;
  channel: AcquisitionChannelKey;
  campaign: string;
  leads: number;
  cost: number;
  calls: number | null;
  emails: number | null;
  replies: number;
  demos: number;
  meetings: number | null;
  contracts: number;
  revenue: number;
};

const CHANNEL_KEYS = Object.keys(CHANNEL_MODELS) as AcquisitionChannelKey[];

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

export function readChannelActuals(): ChannelActual[] {
  if (!fs.existsSync(ACTUALS_FILE)) return [];
  const out: ChannelActual[] = [];
  for (const line of fs.readFileSync(ACTUALS_FILE, 'utf8').split('\n')) {
    if (!line.trim() || line.startsWith('#') || line.startsWith('date,')) continue;
    const c = line.split(',');
    const channel = (c[1] ?? '').trim() as AcquisitionChannelKey;
    if (!CHANNEL_KEYS.includes(channel)) continue;
    const leads = num(c[3]);
    const cost = num(c[4]);
    // 母数と費用が無い行は集計に使えない。0で埋めない
    if (leads === null || leads <= 0 || cost === null) continue;
    out.push({
      date: (c[0] ?? '').trim(),
      channel,
      campaign: (c[2] ?? '').trim(),
      leads,
      cost,
      calls: num(c[5]),
      emails: num(c[6]),
      replies: num(c[7]) ?? 0,
      demos: num(c[8]) ?? 0,
      meetings: num(c[9]),
      contracts: num(c[10]) ?? 0,
      revenue: num(c[11]) ?? 0,
    });
  }
  return out;
}

export type ChannelMetrics = {
  channel: AcquisitionChannelKey;
  rows: number;
  leads: number;
  replies: number;
  demos: number;
  contracts: number;
  cost: number;
  revenue: number;
  costPerLead: number;
  /** 返信・デモ・成約が0件のときは 0円ではなく null（まだ分からない） */
  costPerReply: number | null;
  costPerDemo: number | null;
  cac: number | null;
  replyRate: number;
  demoRate: number | null;
  closeRate: number | null;
  revenuePerLead: number;
  source: ValueSource;
  dataVolume: DataVolume;
};

export function aggregateActuals(
  rows: ChannelActual[] = readChannelActuals()
): Partial<Record<AcquisitionChannelKey, ChannelMetrics>> {
  const byChannel: Partial<Record<AcquisitionChannelKey, ChannelMetrics>> = {};
  for (const r of rows) {
    const m =
      byChannel[r.channel] ??
      (byChannel[r.channel] = {
        channel: r.channel,
        rows: 0,
        leads: 0,
        replies: 0,
        demos: 0,
        contracts: 0,
        cost: 0,
        revenue: 0,
        costPerLead: 0,
        costPerReply: null,
        costPerDemo: null,
        cac: null,
        replyRate: 0,
        demoRate: null,
        closeRate: null,
        revenuePerLead: 0,
        source: 'MEASURED',
        dataVolume: 'NO_DATA',
      });
    m.rows += 1;
    m.leads += r.leads;
    m.replies += r.replies;
    m.demos += r.demos;
    m.contracts += r.contracts;
    m.cost += r.cost;
    m.revenue += r.revenue;
  }
  for (const m of Object.values(byChannel)) {
    if (!m) continue;
    m.costPerLead = Math.round(m.cost / m.leads);
    m.costPerReply = m.replies > 0 ? Math.round(m.cost / m.replies) : null;
    m.costPerDemo = m.demos > 0 ? Math.round(m.cost / m.demos) : null;
    m.cac = m.contracts > 0 ? Math.round(m.cost / m.contracts) : null;
    m.replyRate = m.replies / m.leads;
    m.demoRate = m.replies > 0 ? m.demos / m.replies : null;
    m.closeRate = m.demos > 0 ? m.contracts / m.demos : null;
    m.revenuePerLead = Math.round(m.revenue / m.leads);
    m.dataVolume = dataVolumeOf(m.leads);
  }
  return byChannel;
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
  metrics: Partial<Record<AcquisitionChannelKey, ChannelMetrics>> = aggregateActuals()
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
    };
  }

  const replyRate = shrinkRange(
    rateRange(m.replies, m.leads, model.replyRate),
    model.replyRate,
    m.leads
  );
  const demoRate =
    m.replies > 0
      ? shrinkRange(rateRange(m.demos, m.replies, model.demoRate), model.demoRate, m.replies)
      : model.demoRate;
  const closeRate =
    m.demos > 0
      ? shrinkRange(rateRange(m.contracts, m.demos, model.closeRate), model.closeRate, m.demos)
      : model.closeRate;

  return {
    ...base,
    channel,
    costPerLead: shrinkRange(
      costRange(m.costPerLead, m.leads, model.costPerLead),
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
  };
}
