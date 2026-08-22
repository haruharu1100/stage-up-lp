import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from '../env';
import type { SalesFitKey } from '../viability';

/**
 * 販売チャネルごとに検証を完全に分ける。
 *
 * ここが分かれていないと、致命的な取り違えが起きる。
 * 「前向きな返信8%以上」は電話・メール営業の合格ラインであって、
 * 無料noteの合格ラインではない。noteには「返信」という段が存在しない。
 * 同じ物差しを当てると、良いコンテンツを不合格にし、悪い営業を合格にしてしまう。
 *
 * もう一つ大事なのが「100件」の意味。
 * 100件が営業リスト100社なのか、note訪問者100人なのか、デモ訪問者100人なのかで
 * 必要な件数も合格ラインも全く違う。だから件数は必ず単位付きで持ち、
 * 画面にも「Sample Size = 100」とは絶対に書かない。
 */

/** 売り方。実測を集める単位がチャネルごとに違うため、必ずどれか1つに決める */
export type ValidationChannelKey =
  | 'OUTBOUND_CALL'
  | 'OUTBOUND_EMAIL'
  | 'FORM_OUTREACH'
  | 'X_CONTENT'
  | 'NOTE_CONTENT'
  | 'SEO'
  | 'PAID_ADS'
  | 'REFERRAL'
  | 'PARTNERSHIP';

export const VALIDATION_CHANNEL_KEYS: ValidationChannelKey[] = [
  'OUTBOUND_CALL',
  'OUTBOUND_EMAIL',
  'FORM_OUTREACH',
  'X_CONTENT',
  'NOTE_CONTENT',
  'SEO',
  'PAID_ADS',
  'REFERRAL',
  'PARTNERSHIP',
];

/**
 * ファネルの型。
 * OUTBOUND …… こちらから接触する。リスト → 到達 → 返信 → 前向き返信 → デモ → 商談 → 契約
 * CONTENT  …… 相手から来る。表示 → クリック → note閲覧 → CTA → デモ開始 → デモ完了 → 問い合わせ → 商談 → 契約
 */
export type FunnelKind = 'OUTBOUND' | 'CONTENT';

/** 「100件」が何の100件なのか。これを省略した表示を作らない */
export type TestUnitKey =
  | 'OUTBOUND_LEADS'
  | 'NOTE_VISITORS'
  | 'X_IMPRESSIONS'
  | 'SEO_VISITORS'
  | 'AD_CLICKS'
  | 'INTRODUCTIONS'
  | 'PARTNER_LEADS';

export type TestUnit = {
  key: TestUnitKey;
  /** 画面とObsidianにそのまま出す英字表記。例: 100 NOTE VISITORS */
  en: string;
  ja: string;
  /** 何を1と数えるのか。数え方の取り違えを防ぐ */
  whatCounts: string;
};

export const TEST_UNITS: Record<TestUnitKey, TestUnit> = {
  OUTBOUND_LEADS: {
    key: 'OUTBOUND_LEADS',
    en: 'OUTBOUND LEADS',
    ja: '営業リストの件数',
    whatCounts: '接触を試みた会社の件数。実際に届いたかどうかは reachable_leads で別に数える',
  },
  NOTE_VISITORS: {
    key: 'NOTE_VISITORS',
    en: 'NOTE VISITORS',
    ja: '無料noteを読んだ人数',
    whatCounts: '無料noteを開いた人数。Xの表示回数でも、noteの表示回数でもない',
  },
  X_IMPRESSIONS: {
    key: 'X_IMPRESSIONS',
    en: 'X IMPRESSIONS',
    ja: 'Xの表示回数',
    whatCounts: '投稿が画面に出た回数。人数ではない（同じ人が何度も見る）',
  },
  SEO_VISITORS: {
    key: 'SEO_VISITORS',
    en: 'SEO VISITORS',
    ja: '検索から来た人数',
    whatCounts: '検索結果を経由して記事を開いた人数',
  },
  AD_CLICKS: {
    key: 'AD_CLICKS',
    en: 'AD CLICKS',
    ja: '広告のクリック数',
    whatCounts: '広告費を実際に払ったクリックの数。表示回数ではない',
  },
  INTRODUCTIONS: {
    key: 'INTRODUCTIONS',
    en: 'INTRODUCTIONS',
    ja: '紹介してもらった件数',
    whatCounts: '知人・既存顧客から実際に引き合わせてもらった件数',
  },
  PARTNER_LEADS: {
    key: 'PARTNER_LEADS',
    en: 'PARTNER LEADS',
    ja: '提携先から回ってきた件数',
    whatCounts: '提携先が実際に送ってきた見込み客の件数',
  },
};

/** アウトバウンド（電話・メール・フォーム・紹介・提携）の合否ライン */
export type OutboundThresholds = {
  pass: { positiveReplyRate: number; meetingRate: number; closeRate: number };
  fail: { positiveReplyRate: number; enoughLeadsForZeroContract: number };
  kill: { leads: number; positiveReplyRate: number; demoRequests: number };
  earlyStop: { leads: number; positiveReplies: number };
};

/** コンテンツ（X・note・SEO・広告）の合否ライン */
export type ContentThresholds = {
  /** 合格：CTAクリック率とデモ開始率の両方を満たす */
  pass: { ctaClickRate: number; demoStartRate: number };
  /** 強い合格：どちらか一方を満たせばよい */
  strongPass: { demoStartRate: number; leadRate: number };
  /** 不合格：この人数を集めてもCTAが押されない */
  fail: { visitors: number; ctaClickRate: number };
  /** 撤退：この人数を集めてデモ開始0 */
  kill: { visitors: number; demoStarts: number };
};

export type ChannelValidationSpec = {
  key: ValidationChannelKey;
  label: string;
  funnelKind: FunnelKind;
  testUnit: TestUnitKey;
  /** 段階検証。段の途中で結論を出さない */
  steps: readonly number[];
  /** 1回のテストで許容する最大損失。これを超えるテストは推薦しない */
  maxTestLossYen: number;
  outbound?: OutboundThresholds;
  content?: ContentThresholds;
  /** このラインをどうやって決めたか。実測から出したものは1つも無い */
  basis: 'ASSUMPTION';
  note: string;
};

/** 1回のテストで許容する最大損失の選択肢 */
export const MAX_TEST_LOSS_OPTIONS = [10000, 30000, 50000] as const;
export type MaxTestLoss = (typeof MAX_TEST_LOSS_OPTIONS)[number];

const OUTBOUND_STEPS = [50, 100, 200, 500] as const;
const CONTENT_STEPS = [100, 250, 500, 1000] as const;
const RELATIONSHIP_STEPS = [10, 20, 50, 100] as const;

/** 電話・メール・フォーム営業の共通ライン（2026-08-22に凍結したもの） */
const STANDARD_OUTBOUND: OutboundThresholds = {
  pass: { positiveReplyRate: 0.08, meetingRate: 0.04, closeRate: 0.01 },
  fail: { positiveReplyRate: 0.02, enoughLeadsForZeroContract: 100 },
  kill: { leads: 200, positiveReplyRate: 0.02, demoRequests: 0 },
  earlyStop: { leads: 100, positiveReplies: 0 },
};

/**
 * 紹介・提携は母数が桁違いに少ない代わりに、1件あたりの確度が高い。
 * 同じ「100件やって契約0なら撤退」を当てると、20件しか回ってこない紹介が永久に判定不能になる。
 */
const RELATIONSHIP_OUTBOUND: OutboundThresholds = {
  pass: { positiveReplyRate: 0.3, meetingRate: 0.2, closeRate: 0.05 },
  fail: { positiveReplyRate: 0.1, enoughLeadsForZeroContract: 20 },
  kill: { leads: 50, positiveReplyRate: 0.1, demoRequests: 0 },
  earlyStop: { leads: 20, positiveReplies: 0 },
};

/** X→note→デモの共通ライン */
const STANDARD_CONTENT: ContentThresholds = {
  pass: { ctaClickRate: 0.03, demoStartRate: 0.01 },
  strongPass: { demoStartRate: 0.03, leadRate: 0.02 },
  fail: { visitors: 100, ctaClickRate: 0.01 },
  kill: { visitors: 500, demoStarts: 0 },
};

/** 広告は1クリックごとに実費が出るので、同じ人数でも損失が早く積み上がる */
const PAID_CONTENT: ContentThresholds = {
  pass: { ctaClickRate: 0.05, demoStartRate: 0.02 },
  strongPass: { demoStartRate: 0.05, leadRate: 0.03 },
  fail: { visitors: 100, ctaClickRate: 0.02 },
  kill: { visitors: 300, demoStarts: 0 },
};

/**
 * チャネルごとの検証設定。
 * 数値はここ1か所にまとめてあり、直接書き換えられる（ハードコードを散らさない）。
 * ただし結果を見てから緩めた場合に分かるよう、変更は data/validation-overrides.json で行い、
 * 変更した事実・日付・理由を画面とObsidianに必ず表示する。
 */
export const VALIDATION_CHANNELS: Record<ValidationChannelKey, ChannelValidationSpec> = Object.freeze({
  OUTBOUND_CALL: {
    key: 'OUTBOUND_CALL',
    label: '電話営業',
    funnelKind: 'OUTBOUND',
    testUnit: 'OUTBOUND_LEADS',
    steps: OUTBOUND_STEPS,
    maxTestLossYen: 30000,
    outbound: STANDARD_OUTBOUND,
    basis: 'ASSUMPTION',
    note: '架電は自分の時間が最大の費用。時間を時給換算して損失に含める',
  },
  OUTBOUND_EMAIL: {
    key: 'OUTBOUND_EMAIL',
    label: 'メール営業',
    funnelKind: 'OUTBOUND',
    testUnit: 'OUTBOUND_LEADS',
    steps: OUTBOUND_STEPS,
    maxTestLossYen: 10000,
    outbound: STANDARD_OUTBOUND,
    basis: 'ASSUMPTION',
    note: '届かない（不達・迷惑メール）件数を0にせず reachable_leads で分けて数える',
  },
  FORM_OUTREACH: {
    key: 'FORM_OUTREACH',
    label: '問い合わせフォーム営業',
    funnelKind: 'OUTBOUND',
    testUnit: 'OUTBOUND_LEADS',
    steps: OUTBOUND_STEPS,
    maxTestLossYen: 30000,
    outbound: STANDARD_OUTBOUND,
    basis: 'ASSUMPTION',
    note: '送信先の規約違反にならない範囲だけ。自動送信の実装は持たない',
  },
  X_CONTENT: {
    key: 'X_CONTENT',
    label: 'X（投稿からの流入）',
    funnelKind: 'CONTENT',
    testUnit: 'X_IMPRESSIONS',
    steps: [3000, 10000, 30000, 100000],
    maxTestLossYen: 10000,
    content: STANDARD_CONTENT,
    basis: 'ASSUMPTION',
    note: 'Xは表示回数で数える。表示が伸びてもクリックが無ければ問題は文面（HOOK）側にある',
  },
  NOTE_CONTENT: {
    key: 'NOTE_CONTENT',
    label: 'note（無料note→デモ）',
    funnelKind: 'CONTENT',
    testUnit: 'NOTE_VISITORS',
    steps: CONTENT_STEPS,
    maxTestLossYen: 10000,
    content: STANDARD_CONTENT,
    basis: 'ASSUMPTION',
    note: '読んだ人数で数える。表示回数で数えると合格ラインが実態より甘くなる',
  },
  SEO: {
    key: 'SEO',
    label: 'SEO（検索流入）',
    funnelKind: 'CONTENT',
    testUnit: 'SEO_VISITORS',
    steps: CONTENT_STEPS,
    maxTestLossYen: 30000,
    content: STANDARD_CONTENT,
    basis: 'ASSUMPTION',
    note: '順位が付くまで数ヶ月かかる。短期の0件を「駄目だった」と読み替えない',
  },
  PAID_ADS: {
    key: 'PAID_ADS',
    label: '広告',
    funnelKind: 'CONTENT',
    testUnit: 'AD_CLICKS',
    steps: CONTENT_STEPS,
    maxTestLossYen: 50000,
    content: PAID_CONTENT,
    basis: 'ASSUMPTION',
    note: '1クリックごとに実費が出る。最大損失に到達したら人の判断を待つ',
  },
  REFERRAL: {
    key: 'REFERRAL',
    label: '紹介',
    funnelKind: 'OUTBOUND',
    testUnit: 'INTRODUCTIONS',
    steps: RELATIONSHIP_STEPS,
    maxTestLossYen: 10000,
    outbound: RELATIONSHIP_OUTBOUND,
    basis: 'ASSUMPTION',
    note: '件数は少ないが確度が高い。他チャネルと同じ合格ラインを当てない',
  },
  PARTNERSHIP: {
    key: 'PARTNERSHIP',
    label: '提携',
    funnelKind: 'OUTBOUND',
    testUnit: 'PARTNER_LEADS',
    steps: RELATIONSHIP_STEPS,
    maxTestLossYen: 30000,
    outbound: RELATIONSHIP_OUTBOUND,
    basis: 'ASSUMPTION',
    note: '提携先の都合で件数が決まる。自分で件数を増やせない前提で判定する',
  },
});

export const VALIDATION_CHANNEL_LABEL: Record<ValidationChannelKey, string> = Object.fromEntries(
  VALIDATION_CHANNEL_KEYS.map((k) => [k, VALIDATION_CHANNELS[k].label])
) as Record<ValidationChannelKey, string>;

/** 「Sample Size = 100」と書かないための、単位つきの件数表示 */
export function sampleLabel(channel: ValidationChannelKey, n: number): string {
  return `${n} ${TEST_UNITS[VALIDATION_CHANNELS[channel].testUnit].en}`;
}

/** 日本語側。何を1と数えるかまで書く */
export function sampleLabelJa(channel: ValidationChannelKey, n: number): string {
  const u = TEST_UNITS[VALIDATION_CHANNELS[channel].testUnit];
  return `${u.ja} ${n.toLocaleString()}（${u.whatCounts}）`;
}

/** 今いる段。段の途中で結論を出さないための区切り */
export function currentStepOf(channel: ValidationChannelKey, sample: number): number {
  const steps = VALIDATION_CHANNELS[channel].steps;
  for (const s of steps) if (sample <= s) return s;
  return steps[steps.length - 1];
}

/** 次の段。まだ1件も無いなら最初の段。最終段まで来ていたら null */
export function nextStepOf(channel: ValidationChannelKey, sample: number): number | null {
  const steps = VALIDATION_CHANNELS[channel].steps;
  if (sample <= 0) return steps[0];
  const cur = currentStepOf(channel, sample);
  const i = steps.indexOf(cur);
  return i >= 0 && i + 1 < steps.length ? steps[i + 1] : null;
}

/** 最初のチェックポイント（この件数までは合否を付けない） */
export function firstCheckpointOf(channel: ValidationChannelKey): number {
  return VALIDATION_CHANNELS[channel].steps[0];
}

/**
 * 適性判定（SalesFitKey）から検証チャネルへ変換する。
 * 「無料note」を選んだ案件にアウトバウンドの合格ラインを当てないための対応表。
 */
export function channelFromSalesFit(fit: SalesFitKey | null): ValidationChannelKey {
  switch (fit) {
    case 'x':
      return 'X_CONTENT';
    case 'freeNote':
    case 'paidNote':
    case 'pdfCourse':
    case 'template':
      return 'NOTE_CONTENT';
    case 'consulting':
    case 'managedService':
      return 'REFERRAL';
    case 'saas':
    case 'aiStaff':
      return 'OUTBOUND_EMAIL';
    default:
      return 'NOTE_CONTENT';
  }
}

/**
 * 合否ラインの変更。
 *
 * 「設定可能にする」と「結果を見てから緩めない」を両立させるための仕組み。
 * data/validation-overrides.json を置けば数値を差し替えられるが、
 * 変更した事実・日付・理由を必ず持たせ、画面とObsidianに出す。
 * 黙って緩めることはできない。
 */
export type CriteriaOverride = {
  changedAt: string;
  reason: string;
  channels: Partial<Record<ValidationChannelKey, Partial<Pick<ChannelValidationSpec, 'steps' | 'maxTestLossYen'>> & {
    outbound?: Partial<OutboundThresholds>;
    content?: Partial<ContentThresholds>;
  }>>;
};

const OVERRIDE_FILE = path.join(DATA_DIR, 'validation-overrides.json');

export function readCriteriaOverride(): CriteriaOverride | null {
  if (!fs.existsSync(OVERRIDE_FILE)) return null;
  try {
    const raw = JSON.parse(fs.readFileSync(OVERRIDE_FILE, 'utf8')) as Partial<CriteriaOverride>;
    // 日付と理由が無い変更は受け付けない（誰がいつ何のために緩めたか分からなくなるため）
    if (!raw.changedAt || !raw.reason || !raw.channels) return null;
    return { changedAt: raw.changedAt, reason: raw.reason, channels: raw.channels };
  } catch {
    return null;
  }
}

/** 変更ファイルを適用した最終的な設定。変更が無ければ凍結値をそのまま返す */
export function channelSpec(
  channel: ValidationChannelKey,
  override: CriteriaOverride | null = readCriteriaOverride()
): ChannelValidationSpec {
  const base = VALIDATION_CHANNELS[channel];
  const o = override?.channels?.[channel];
  if (!o) return base;
  return {
    ...base,
    steps: o.steps ?? base.steps,
    maxTestLossYen: o.maxTestLossYen ?? base.maxTestLossYen,
    outbound: base.outbound ? { ...base.outbound, ...o.outbound } : base.outbound,
    content: base.content ? { ...base.content, ...o.content } : base.content,
  };
}
