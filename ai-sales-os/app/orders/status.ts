/** 受注の状態の日本語表示。受注一覧と制作中の画面で同じ言葉を使うために1か所に置く。 */
export const ORDER_STATUS_JA: Record<string, { label: string; kind: 'ok' | 'warn' | 'stop' | 'mute' }> = {
  IN_PROGRESS: { label: '制作中', kind: 'warn' },
  REVIEW: { label: '確認中', kind: 'warn' },
  READY_TO_DELIVER: { label: '納品待ち', kind: 'ok' },
  DELIVERED: { label: '納品済み', kind: 'ok' },
  CANCELED: { label: '取消', kind: 'stop' },
};
