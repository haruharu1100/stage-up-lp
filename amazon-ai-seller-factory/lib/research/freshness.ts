import type { DataFreshness } from '../types';

/**
 * DATA_FRESHNESS ＝ そのデータがいつ取られたものか。
 *
 * ★ユーザー指定の絶対ルール：「古すぎるデータの商品をAランクにしないでください。」
 * ここは判定の材料を出すだけで、Aランクを実際に落とすのは researchScore 側。
 */

const HOUR = 3600_000;

/** 「2時間前」「1日前」のように、人が読める日本語にする */
export function ageLabel(hours: number | null): string {
  if (hours === null) return '取得日時が分かりません';
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}分前`;
  if (hours < 48) return `${Math.round(hours)}時間前`;
  return `${Math.round(hours / 24)}日前`;
}

function hoursSince(iso: string | null | undefined, now: number): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.max(0, (now - t) / HOUR);
}

export interface FreshnessInput {
  /** Amazon価格の取得日時 */
  priceFetchedAt?: string | null;
  /** Sales Rank の取得日時（普通は価格と同じ） */
  bsrFetchedAt?: string | null;
  /** 仕入価格の取得日時 */
  supplierFetchedAt?: string | null;
  /** これを超えたら「古すぎる」 */
  maxAgeHours: number;
}

export function calcFreshness(input: FreshnessInput, now = Date.now()): DataFreshness {
  const defs: { field: string; at: string | null | undefined }[] = [
    { field: '価格', at: input.priceFetchedAt },
    { field: 'Sales Rank', at: input.bsrFetchedAt ?? input.priceFetchedAt },
    { field: '仕入価格', at: input.supplierFetchedAt },
  ];

  const parts = defs.map((d) => {
    const h = hoursSince(d.at, now);
    return {
      field: d.field,
      fetchedAt: d.at ?? null,
      hours: h,
      label: `${d.field} ${ageLabel(h)}`,
    };
  });

  // 取得日時が分からないものは「古い扱い」にする（推測で新しいことにしない）
  const known = parts.map((p) => p.hours).filter((h): h is number => h !== null);
  const anyUnknown = parts.some((p) => p.hours === null);
  const worstHours = known.length ? Math.max(...known) : Number.POSITIVE_INFINITY;

  const stale = anyUnknown || worstHours > input.maxAgeHours;
  const label = anyUnknown
    ? '取得日時が分からない項目があります'
    : parts.map((p) => p.label).join(' / ');

  return {
    worstHours: Number.isFinite(worstHours) ? Math.round(worstHours * 10) / 10 : -1,
    label,
    parts,
    stale,
  };
}
