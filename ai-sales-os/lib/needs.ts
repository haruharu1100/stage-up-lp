/**
 * 会社が抱えていそうな課題の種類。
 * ここのキーを、企業分析（need_flags）と商品カタログ（fit_needs）の共通語彙にする。
 * 語彙が共通なので「この会社に何を売るか」を機械で突き合わせられる。
 */
export const NEED_KEYS = [
  'LABOR_SHORTAGE',   // 人手不足
  'SALES',            // 新規営業ができていない
  'RESERVATION',      // 予約の取りこぼし
  'PHONE',            // 電話対応の負担
  'EC',               // ネット販売が弱い
  'AD',               // 広告が回っていない
  'CRM',              // 顧客管理ができていない
  'OPERATION',        // 事務作業が多い
  'AI_ADOPTION',      // AIを入れられる余地
  'BRANDING',         // 認知・集客の入口が無い
  'CONTENT',          // 発信するコンテンツが作れていない
] as const;

export type NeedKey = (typeof NEED_KEYS)[number];

export const NEED_LABEL: Record<NeedKey, string> = {
  LABOR_SHORTAGE: '人手不足',
  SALES: '新規営業の不足',
  RESERVATION: '予約の取りこぼし',
  PHONE: '電話対応の負担',
  EC: 'ネット販売の弱さ',
  AD: '広告運用の課題',
  CRM: '顧客管理の不足',
  OPERATION: '事務作業の多さ',
  AI_ADOPTION: 'AI導入の余地',
  BRANDING: '認知・集客の入口不足',
  CONTENT: '発信コンテンツの不足',
};

export function isNeedKey(v: string): v is NeedKey {
  return (NEED_KEYS as readonly string[]).includes(v);
}

export type NeedFlags = Partial<Record<NeedKey, number>>; // 0..100

export function topNeeds(flags: NeedFlags, n = 3): { key: NeedKey; score: number }[] {
  return Object.entries(flags)
    .filter(([k, v]) => isNeedKey(k) && typeof v === 'number' && v > 0)
    .map(([k, v]) => ({ key: k as NeedKey, score: v as number }))
    .sort((a, b) => b.score - a.score)
    .slice(0, n);
}
