import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../env';
import { confidenceOf, dataVolumeOf, type DataVolume, type ValueSource } from '../types';
import {
  TEST_UNITS,
  VALIDATION_CHANNELS,
  VALIDATION_CHANNEL_KEYS,
  type TestUnitKey,
  type ValidationChannelKey,
} from '../validation/channels';
import { HOURLY_YEN } from './channels';
import { NOTE_FEE_RATE } from './content-funnel';

/**
 * コンテンツ（X → note → デモ）の実測を読み込む入口。
 *
 * アウトバウンド営業（sales-actuals.csv）とは別ファイルにしてある。
 * 同じ表に入れると「返信率」と「CTAクリック率」が同じ列に混ざり、
 * どちらの物差しで合否を付けたのか分からなくなるため。
 *
 * 分母が0の指標は 0 ではなく null。0にすると「やって駄目だった」と区別が付かない。
 */

const CONTENT_FILE = path.join(DATA_DIR, 'content-actuals.csv');

export const CONTENT_ACTUALS_PATH = CONTENT_FILE;

/**
 * noteの目的。noteを「売る商品」だけとして扱わないための分類。
 * 1記事が複数の目的を持ってよい（縦棒区切りで複数書ける）。
 */
export type NotePurpose = 'DIRECT_REVENUE' | 'LEAD_GENERATION' | 'AUTHORITY_BUILDING';

export const NOTE_PURPOSES: NotePurpose[] = [
  'DIRECT_REVENUE',
  'LEAD_GENERATION',
  'AUTHORITY_BUILDING',
];

export const NOTE_PURPOSE_LABEL: Record<NotePurpose, string> = {
  DIRECT_REVENUE: 'note自体で売上を出す',
  LEAD_GENERATION: '見込み客を集める',
  AUTHORITY_BUILDING: '信用を作る（すぐには売上にならない）',
};

/**
 * 目的ごとに「成功」の意味が違う。
 * 信用作りのnoteをデモ申込数で評価すると、良い記事を捨てることになる。
 */
export const NOTE_PURPOSE_SUCCESS: Record<NotePurpose, string> = {
  DIRECT_REVENUE: '有料noteの購入数と手取り',
  LEAD_GENERATION: 'デモ開始数と問い合わせ数',
  AUTHORITY_BUILDING: '読了と再訪。短期のデモ数では評価しない',
};

export const CONTENT_ACTUALS_COLUMNS = [
  'date',
  'idea_id',
  'vertical',
  'channel',
  'campaign_id',
  'note_purpose',
  'impressions',
  'clicks',
  'free_note_views',
  'free_note_cta_clicks',
  'paid_note_views',
  'paid_note_purchases',
  'paid_note_revenue',
  'demo_starts',
  'demo_completes',
  'leads',
  'meetings',
  'contracts',
  'buyer_demo_starts',
  'buyer_contracts',
  'saas_revenue',
  'direct_cost',
  'content_time_minutes',
] as const;

export const CONTENT_ACTUALS_TEMPLATE = `${CONTENT_ACTUALS_COLUMNS.join(',')}
# X → note → デモ の実測を1行ずつ書く。分からない列は空欄（0と書かない）。
# channel: ${VALIDATION_CHANNEL_KEYS.filter((k) => VALIDATION_CHANNELS[k].funnelKind === 'CONTENT').join(' / ')}
# note_purpose: ${NOTE_PURPOSES.join(' / ')}（複数ある場合は縦棒で区切る 例 LEAD_GENERATION|AUTHORITY_BUILDING）
# impressions/clicks = 上流の表示回数とクリック数（X投稿・検索結果・広告のいずれも同じ列に書く）
# free_note_views = 無料noteを読んだ人数（表示回数ではない）
# paid_note_* = 有料note。無料noteとは別イベントとして必ず分けて書く
# buyer_demo_starts / buyer_contracts = 有料noteを買った人だけのデモ開始・契約（購入者の確度を別に測るため）
# saas_revenue = AIシステムの売上。paid_note_revenue とは混ぜない
# content_time_minutes = 制作にかけた分数（時給${HOURLY_YEN.toLocaleString()}円で費用に換算する）
# 個人情報（会社名・担当者名・電話番号・メールアドレス）はこのファイルに書かない
`;

export type ContentActual = {
  date: string;
  ideaId: string;
  vertical: string;
  channel: ValidationChannelKey;
  campaignId: string;
  notePurposes: NotePurpose[];
  impressions: number | null;
  clicks: number | null;
  freeNoteViews: number | null;
  freeNoteCtaClicks: number | null;
  paidNoteViews: number | null;
  paidNotePurchases: number | null;
  paidNoteRevenue: number | null;
  demoStarts: number | null;
  demoCompletes: number | null;
  leads: number | null;
  meetings: number | null;
  contracts: number | null;
  buyerDemoStarts: number | null;
  buyerContracts: number | null;
  saasRevenue: number | null;
  directCost: number | null;
  contentTimeMinutes: number | null;
};

const CONTENT_CHANNELS = VALIDATION_CHANNEL_KEYS.filter(
  (k) => VALIDATION_CHANNELS[k].funnelKind === 'CONTENT'
);

function num(s: string | undefined): number | null {
  if (s === undefined) return null;
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

function purposes(s: string | undefined): NotePurpose[] {
  if (!s) return [];
  return s
    .split('|')
    .map((p) => p.trim() as NotePurpose)
    .filter((p) => NOTE_PURPOSES.includes(p));
}

/** 列の位置ではなく列名で読む。列が増えても過去の行が壊れないようにするため */
export function parseContentActuals(text: string): ContentActual[] {
  const lines = text.split('\n').filter((l) => l.trim() !== '' && !l.trim().startsWith('#'));
  const head = lines.shift();
  if (!head) return [];
  const idx = new Map<string, number>();
  head.split(',').forEach((name, i) => idx.set(name.trim(), i));
  const at = (cols: string[], name: string) => {
    const i = idx.get(name);
    return i === undefined ? undefined : cols[i];
  };

  const out: ContentActual[] = [];
  for (const line of lines) {
    const c = line.split(',');
    const channel = (at(c, 'channel') ?? '').trim() as ValidationChannelKey;
    if (!CONTENT_CHANNELS.includes(channel)) continue;
    out.push({
      date: (at(c, 'date') ?? '').trim(),
      ideaId: (at(c, 'idea_id') ?? '').trim(),
      vertical: (at(c, 'vertical') ?? '').trim(),
      channel,
      campaignId: (at(c, 'campaign_id') ?? '').trim(),
      notePurposes: purposes(at(c, 'note_purpose')),
      impressions: num(at(c, 'impressions')),
      clicks: num(at(c, 'clicks')),
      freeNoteViews: num(at(c, 'free_note_views')),
      freeNoteCtaClicks: num(at(c, 'free_note_cta_clicks')),
      paidNoteViews: num(at(c, 'paid_note_views')),
      paidNotePurchases: num(at(c, 'paid_note_purchases')),
      paidNoteRevenue: num(at(c, 'paid_note_revenue')),
      demoStarts: num(at(c, 'demo_starts')),
      demoCompletes: num(at(c, 'demo_completes')),
      leads: num(at(c, 'leads')),
      meetings: num(at(c, 'meetings')),
      contracts: num(at(c, 'contracts')),
      buyerDemoStarts: num(at(c, 'buyer_demo_starts')),
      buyerContracts: num(at(c, 'buyer_contracts')),
      saasRevenue: num(at(c, 'saas_revenue')),
      directCost: num(at(c, 'direct_cost')),
      contentTimeMinutes: num(at(c, 'content_time_minutes')),
    });
  }
  return out;
}

export function readContentActuals(): ContentActual[] {
  if (!fs.existsSync(CONTENT_FILE)) return [];
  return parseContentActuals(fs.readFileSync(CONTENT_FILE, 'utf8'));
}

export type ContentMetrics = {
  key: string;
  ideaId: string | null;
  channel: ValidationChannelKey | null;
  rows: number;
  notePurposes: NotePurpose[];

  impressions: number;
  clicks: number;
  freeNoteViews: number;
  freeNoteCtaClicks: number;
  paidNoteViews: number;
  paidNotePurchases: number;
  paidNoteRevenue: number;
  demoStarts: number;
  demoCompletes: number;
  leads: number;
  meetings: number;
  contracts: number;
  buyerDemoStarts: number;
  buyerContracts: number;
  saasRevenue: number;
  directCost: number;
  contentTimeMinutes: number;
  /** 直接費 ＋ 制作時間を時給換算した金額 */
  totalCost: number;
  /** 有料noteの手取り（手数料を引いた後） */
  paidNoteNetYen: number;

  /** 表示 → クリック（XのCTR） */
  ctr: number | null;
  /** クリック → 無料note到達 */
  noteArrivalRate: number | null;
  /** 無料note閲覧 → CTAクリック */
  noteCtaCtr: number | null;
  /** CTAクリック → デモ開始（段階率） */
  stageDemoStartRate: number | null;
  /** デモ開始 → デモ完了 */
  demoCompletionRate: number | null;
  /** デモ完了 → 問い合わせ */
  leadConversion: number | null;
  /** 問い合わせ → 商談 */
  meetingConversion: number | null;
  /** 商談 → 契約 */
  contractConversion: number | null;

  /** 合否に使う率。分母はすべて「テスト単位」で揃える */
  testUnit: TestUnitKey | null;
  testUnitSample: number;
  ctaClickRate: number | null;
  demoStartRate: number | null;
  leadRate: number | null;
  contractRate: number | null;

  /** 有料note閲覧 → 購入 */
  paidNoteBuyRate: number | null;
  /** 有料note購入者 → デモ開始 */
  buyerToDemoRate: number | null;
  /** 有料note購入者 → AIシステム契約。「どんな情報商品を買った人が契約するか」の中心指標 */
  buyerToSaasRate: number | null;

  source: ValueSource;
  sampleSize: number;
  dataVolume: DataVolume;
  confidence: number;
};

const div = (a: number, b: number): number | null => (b > 0 ? a / b : null);
const r4 = (v: number | null): number | null => (v === null ? null : Math.round(v * 10000) / 10000);

function empty(key: string, ideaId: string | null, channel: ValidationChannelKey | null): ContentMetrics {
  return {
    key,
    ideaId,
    channel,
    rows: 0,
    notePurposes: [],
    impressions: 0,
    clicks: 0,
    freeNoteViews: 0,
    freeNoteCtaClicks: 0,
    paidNoteViews: 0,
    paidNotePurchases: 0,
    paidNoteRevenue: 0,
    demoStarts: 0,
    demoCompletes: 0,
    leads: 0,
    meetings: 0,
    contracts: 0,
    buyerDemoStarts: 0,
    buyerContracts: 0,
    saasRevenue: 0,
    directCost: 0,
    contentTimeMinutes: 0,
    totalCost: 0,
    paidNoteNetYen: 0,
    ctr: null,
    noteArrivalRate: null,
    noteCtaCtr: null,
    stageDemoStartRate: null,
    demoCompletionRate: null,
    leadConversion: null,
    meetingConversion: null,
    contractConversion: null,
    testUnit: null,
    testUnitSample: 0,
    ctaClickRate: null,
    demoStartRate: null,
    leadRate: null,
    contractRate: null,
    paidNoteBuyRate: null,
    buyerToDemoRate: null,
    buyerToSaasRate: null,
    source: 'MEASURED',
    sampleSize: 0,
    dataVolume: 'NO_DATA',
    confidence: 0,
  };
}

/** テスト単位の件数を取り出す。チャネルによって「100」の中身が違う */
export function testUnitSampleOf(m: ContentMetrics, unit: TestUnitKey): number {
  switch (unit) {
    case 'X_IMPRESSIONS':
      return m.impressions;
    case 'AD_CLICKS':
      return m.clicks;
    case 'NOTE_VISITORS':
    case 'SEO_VISITORS':
      return m.freeNoteViews;
    default:
      return 0;
  }
}

function finalize(m: ContentMetrics): ContentMetrics {
  m.totalCost = Math.round(m.directCost + (m.contentTimeMinutes / 60) * HOURLY_YEN);
  m.paidNoteNetYen = Math.round(m.paidNoteRevenue * (1 - NOTE_FEE_RATE));

  m.ctr = r4(div(m.clicks, m.impressions));
  m.noteArrivalRate = r4(div(m.freeNoteViews, m.clicks));
  m.noteCtaCtr = r4(div(m.freeNoteCtaClicks, m.freeNoteViews));
  m.stageDemoStartRate = r4(div(m.demoStarts, m.freeNoteCtaClicks));
  m.demoCompletionRate = r4(div(m.demoCompletes, m.demoStarts));
  m.leadConversion = r4(div(m.leads, m.demoCompletes));
  m.meetingConversion = r4(div(m.meetings, m.leads));
  m.contractConversion = r4(div(m.contracts, m.meetings));

  m.testUnit = m.channel === null ? null : VALIDATION_CHANNELS[m.channel].testUnit;
  m.testUnitSample = m.testUnit === null ? 0 : testUnitSampleOf(m, m.testUnit);

  // 合否に使う率は、分母をすべてテスト単位に揃える。段階率と混ぜない
  const base = m.testUnitSample;
  m.ctaClickRate = r4(div(m.freeNoteCtaClicks, base));
  m.demoStartRate = r4(div(m.demoStarts, base));
  m.leadRate = r4(div(m.leads, base));
  m.contractRate = r4(div(m.contracts, base));

  m.paidNoteBuyRate = r4(div(m.paidNotePurchases, m.paidNoteViews));
  m.buyerToDemoRate = r4(div(m.buyerDemoStarts, m.paidNotePurchases));
  m.buyerToSaasRate = r4(div(m.buyerContracts, m.paidNotePurchases));

  m.sampleSize = m.testUnitSample;
  m.dataVolume = dataVolumeOf(m.testUnitSample);
  m.confidence = confidenceOf(m.testUnitSample);
  return m;
}

export function aggregateContent(
  rows: ContentActual[],
  keyOf: (r: ContentActual) => string,
  meta: (r: ContentActual) => { ideaId: string | null; channel: ValidationChannelKey | null }
): Map<string, ContentMetrics> {
  const out = new Map<string, ContentMetrics>();
  for (const r of rows) {
    const key = keyOf(r);
    const info = meta(r);
    const m = out.get(key) ?? empty(key, info.ideaId, info.channel);
    m.rows += 1;
    for (const p of r.notePurposes) if (!m.notePurposes.includes(p)) m.notePurposes.push(p);
    m.impressions += r.impressions ?? 0;
    m.clicks += r.clicks ?? 0;
    m.freeNoteViews += r.freeNoteViews ?? 0;
    m.freeNoteCtaClicks += r.freeNoteCtaClicks ?? 0;
    m.paidNoteViews += r.paidNoteViews ?? 0;
    m.paidNotePurchases += r.paidNotePurchases ?? 0;
    m.paidNoteRevenue += r.paidNoteRevenue ?? 0;
    m.demoStarts += r.demoStarts ?? 0;
    m.demoCompletes += r.demoCompletes ?? 0;
    m.leads += r.leads ?? 0;
    m.meetings += r.meetings ?? 0;
    m.contracts += r.contracts ?? 0;
    m.buyerDemoStarts += r.buyerDemoStarts ?? 0;
    m.buyerContracts += r.buyerContracts ?? 0;
    m.saasRevenue += r.saasRevenue ?? 0;
    m.directCost += r.directCost ?? 0;
    m.contentTimeMinutes += r.contentTimeMinutes ?? 0;
    out.set(key, m);
  }
  for (const m of out.values()) finalize(m);
  return out;
}

/** 案件×チャネル別。検証カードはこの単位で判定する */
export function contentByIdeaChannel(
  rows: ContentActual[] = readContentActuals()
): Map<string, ContentMetrics> {
  return aggregateContent(
    rows,
    (r) => `${r.ideaId}:${r.channel}`,
    (r) => ({ ideaId: r.ideaId, channel: r.channel })
  );
}

/** 案件別（チャネルをまたいだ合計）。P&Lに使う */
export function contentByIdea(rows: ContentActual[] = readContentActuals()): Map<string, ContentMetrics> {
  return aggregateContent(
    rows,
    (r) => r.ideaId,
    (r) => ({ ideaId: r.ideaId, channel: null })
  );
}

/** 全体合計。P&Lの総計に使う */
export function contentTotal(rows: ContentActual[] = readContentActuals()): ContentMetrics {
  const map = aggregateContent(
    rows,
    () => 'ALL',
    () => ({ ideaId: null, channel: null })
  );
  return map.get('ALL') ?? finalize(empty('ALL', null, null));
}

/** 単位つきの件数表示。数字だけを裸で出さない */
export function describeSample(m: ContentMetrics): string {
  if (m.testUnit === null) return `${m.testUnitSample}件（単位未確定）`;
  return `${m.testUnitSample} ${TEST_UNITS[m.testUnit].en}`;
}
