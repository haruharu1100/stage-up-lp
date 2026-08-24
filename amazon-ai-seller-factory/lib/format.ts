export function yen(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return `${Math.round(Number(v)).toLocaleString()}円`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || !Number.isFinite(Number(v))) return '—';
  return `${(Number(v) * 100).toFixed(digits)}%`;
}

/**
 * 日本時間での「今日の日付」（YYYY-MM-DD）。
 *
 * ★発送期限も週の区切りも日本時間で動く。
 *   世界標準時のまま計算すると、日本の朝9時までは前日扱いになり、
 *   「今日発送」の注文を「明日発送」と誤って出してしまう。
 */
export function jstToday(now: Date = new Date()): string {
  return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10);
}

export function jstDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('ja-JP', { hour12: false });
}
