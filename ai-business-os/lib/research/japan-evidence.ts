import type { ChannelResult } from './channels-ja';
import type { SearchJudgement } from './judge';

/**
 * JAPAN GAP CONFIDENCE（日本市場判定の確からしさ）
 *
 * 「日本語ページが何件ヒットしたか」だけで日本市場を判定しない。
 * ページ数は記事・まとめ・翻訳でいくらでも膨らみ、競合の多さを表さない。
 *
 * 見るのは次の8つ。取れなかった指標は 0 ではなく「未取得」として数え、
 * 取れた指標の数だけ確度を上げる。全部取れなければ確度は低いまま＝人の確認が要る。
 */

export type EvidenceKey =
  | 'DOMESTIC_SERVICES'
  | 'DOMESTIC_CORP'
  | 'CASE_STUDIES'
  | 'JAPANESE_LP'
  | 'PR_ARTICLES'
  | 'NOTE_VOLUME'
  | 'YOUTUBE_VOLUME'
  | 'FRESHNESS';

export const EVIDENCE_LABEL: Record<EvidenceKey, string> = {
  DOMESTIC_SERVICES: '実在する国内サービス数',
  DOMESTIC_CORP: '国内法人の実在',
  CASE_STUDIES: '国内の導入事例',
  JAPANESE_LP: '日本語の販売ページ（料金・プランがあるページ）',
  PR_ARTICLES: 'PR記事（プレスリリース）',
  NOTE_VOLUME: 'noteでの情報量',
  YOUTUBE_VOLUME: 'YouTubeでの情報量',
  FRESHNESS: '検索結果の新しさ',
};

export type EvidenceSignal = {
  key: EvidenceKey;
  label: string;
  /** 取れなければ null。0件と区別する */
  value: number | null;
  /** 何から取ったか。1種類の情報源だけで断定しないための記録 */
  source: string;
  status: 'MEASURED' | 'UNAVAILABLE';
  note: string;
};

export type JapanEvidence = {
  signals: EvidenceSignal[];
  measuredCount: number;
  totalCount: number;
  /** 実測に使えた情報源の種類（検索エンジン・YouTube など） */
  sources: string[];
  confidence: number;
  /** 「日本に競合がいない」と言い切ってよいか */
  canConcludeNoCompetitor: boolean;
  reason: string;
};

export const EVIDENCE_KEYS: EvidenceKey[] = [
  'DOMESTIC_SERVICES',
  'DOMESTIC_CORP',
  'CASE_STUDIES',
  'JAPANESE_LP',
  'PR_ARTICLES',
  'NOTE_VOLUME',
  'YOUTUBE_VOLUME',
  'FRESHNESS',
];

/** 1種類の情報源だけで「日本に無い」と断定しない。最低これだけ要る */
export const MIN_SOURCE_KINDS = 2;

/** 新しさの判定。過去この日数以内のページを「新しい」と数える */
export const FRESH_DAYS = 365;

function freshCount(search: SearchJudgement): number | null {
  const dates = search.records
    .flatMap((r) => r.topResults)
    .map((i) => i.publishedAt)
    .filter((d): d is string => Boolean(d));
  if (dates.length === 0) return null;
  const limit = Date.now() - FRESH_DAYS * 86_400_000;
  return dates.filter((d) => {
    const t = Date.parse(d);
    return Number.isFinite(t) && t >= limit;
  }).length;
}

function fromChannel(
  key: EvidenceKey,
  ch: ChannelResult | undefined,
  sourceLabel: string
): EvidenceSignal {
  if (!ch || ch.hits === null) {
    return {
      key,
      label: EVIDENCE_LABEL[key],
      value: null,
      source: sourceLabel,
      status: 'UNAVAILABLE',
      note: ch?.note ?? '未取得（0件ではない）',
    };
  }
  return {
    key,
    label: EVIDENCE_LABEL[key],
    value: ch.hits,
    source: sourceLabel,
    status: 'MEASURED',
    note: ch.note,
  };
}

export type EvidenceInput = {
  search: SearchJudgement;
  channels: ChannelResult[];
  /** 導入事例・料金ページなど、site指定の補助検索の結果（無ければ空） */
  caseStudyHits?: number | null;
  japaneseLpHits?: number | null;
  prArticleHits?: number | null;
  noteHits?: number | null;
};

/**
 * 8つの指標から日本市場判定の確からしさを出す。
 * 取れた指標が多いほど確度が上がる。取れていない指標は0扱いにしない。
 */
export function buildJapanEvidence(input: EvidenceInput): JapanEvidence {
  const ch = (key: string) => input.channels.find((c) => c.key === key);
  const searchMeasured = input.search.records.some((r) => r.status === 'DATA_AVAILABLE');

  const manual = (
    key: EvidenceKey,
    value: number | null | undefined,
    source: string,
    unavailableNote: string
  ): EvidenceSignal =>
    value === null || value === undefined
      ? { key, label: EVIDENCE_LABEL[key], value: null, source, status: 'UNAVAILABLE', note: unavailableNote }
      : { key, label: EVIDENCE_LABEL[key], value, source, status: 'MEASURED', note: `${value}件を実測` };

  const fresh = freshCount(input.search);

  const signals: EvidenceSignal[] = [
    searchMeasured
      ? {
          key: 'DOMESTIC_SERVICES',
          label: EVIDENCE_LABEL.DOMESTIC_SERVICES,
          value: input.search.domesticCompetitors.length,
          source: input.search.providersUsed.join('・') || '検索',
          status: 'MEASURED',
          note: `同じ会社は1社に統合して数えた（延べ${input.search.domesticCompetitors.reduce((a, c) => a + c.pages, 0)}ページ）`,
        }
      : {
          key: 'DOMESTIC_SERVICES',
          label: EVIDENCE_LABEL.DOMESTIC_SERVICES,
          value: null,
          source: '検索',
          status: 'UNAVAILABLE',
          note: '検索を実行できなかったため未取得（0社ではない）',
        },
    fromChannel('DOMESTIC_CORP', ch('corp'), '国税庁法人番号システム'),
    manual('CASE_STUDIES', input.caseStudyHits, '検索（導入事例）', '導入事例の検索を実行していないため未取得'),
    manual('JAPANESE_LP', input.japaneseLpHits, '検索（料金・プラン）', '販売ページの検索を実行していないため未取得'),
    manual('PR_ARTICLES', input.prArticleHits, '検索（PR TIMES）', 'PR記事の検索を実行していないため未取得'),
    manual('NOTE_VOLUME', input.noteHits, '検索（note）', 'noteの検索を実行していないため未取得'),
    fromChannel('YOUTUBE_VOLUME', ch('youtube'), 'YouTube Data API'),
    fresh === null
      ? {
          key: 'FRESHNESS',
          label: EVIDENCE_LABEL.FRESHNESS,
          value: null,
          source: '検索',
          status: 'UNAVAILABLE',
          note: '検索エンジンがページの日付を返さなかったため未取得',
        }
      : {
          key: 'FRESHNESS',
          label: EVIDENCE_LABEL.FRESHNESS,
          value: fresh,
          source: '検索',
          status: 'MEASURED',
          note: `上位結果のうち直近${FRESH_DAYS}日以内のページ数`,
        },
  ];

  const measured = signals.filter((s) => s.status === 'MEASURED');
  const sources = [...new Set(measured.map((s) => s.source))];

  // 取れた指標の数で確度を決める。件数の多さでは上げない
  let confidence = Math.round((0.3 + 0.6 * (measured.length / signals.length)) * 100) / 100;
  const canConclude = sources.length >= MIN_SOURCE_KINDS;
  if (!canConclude) confidence = Math.min(confidence, 0.5);
  if (measured.length === 0) confidence = 0;

  const missing = signals.filter((s) => s.status === 'UNAVAILABLE').map((s) => s.label);
  const reason =
    `日本市場の確からしさは、8つの指標のうち${measured.length}個を実測できたことで決めた` +
    `（情報源${sources.length}種類：${sources.join('・') || 'なし'}）。` +
    (missing.length > 0 ? `未取得：${missing.join('・')}（0件ではない）。` : '全指標を実測。') +
    (canConclude ? '' : '情報源が1種類しか無いため「日本に競合がいない」とは断定しない。');

  return {
    signals,
    measuredCount: measured.length,
    totalCount: signals.length,
    sources,
    confidence,
    canConcludeNoCompetitor: canConclude,
    reason,
  };
}
