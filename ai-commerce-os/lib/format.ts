export function yen(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return `${Math.round(n).toLocaleString('ja-JP')}円`;
}

export function pct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined) return '—';
  return `${(n * 100).toFixed(digits)}%`;
}

export function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—';
  return Math.round(n).toLocaleString('ja-JP');
}

export const DECISION_JA: Record<string, string> = {
  STRONG_BUY: 'STRONG BUY',
  BUY: 'BUY',
  WATCH: 'WATCH',
  LOW_PRIORITY: 'LOW PRIORITY',
  SKIP: 'SKIP',
};

export const DECISION_CLASS: Record<string, string> = {
  STRONG_BUY: 'badge strong',
  BUY: 'badge buy',
  WATCH: 'badge watch',
  LOW_PRIORITY: 'badge low',
  SKIP: 'badge skip',
};

export const CONDITION_JA: Record<string, string> = {
  N: '新品・未使用',
  S: '未使用に近い',
  A: '目立った傷や汚れなし',
  B: 'やや傷や汚れあり',
  C: '傷や汚れあり',
  D: '状態が悪い・ジャンク',
};
