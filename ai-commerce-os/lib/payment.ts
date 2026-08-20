import { all, nowIso, run } from './db/client';
import {
  MERCARI_PAYMENT_RULES, resolvePaymentFee,
  type PaymentFeeRule, type ResolvedPaymentFee,
} from './paymentmethods';

/**
 * 支払方法ごとの手数料の読み書き（Phase 3.7）。
 *
 * 言葉の定義と判定ロジックは lib/paymentmethods.ts（外部依存ゼロ）にある。
 * ここはデータベースとのやりとりだけ。
 */

let ensured = false;

/**
 * 支払方法の初期登録。何度実行しても同じ結果になる（冪等）。
 *
 * 【上書きしない】
 * 既にある行には触らない。人間が公式ページを見て VERIFIED に直したものを、
 * 次のseedで概算へ戻してしまわないため。
 */
export async function ensurePaymentMethods(): Promise<void> {
  if (ensured) return;
  const rows = await all('SELECT venue_code, side, method_code, min_amount FROM venue_method_fee_rules');
  const existing = new Set(rows.map((r) => `${r.venue_code}|${r.side}|${r.method_code}|${r.min_amount}`));
  const now = nowIso();
  for (const r of MERCARI_PAYMENT_RULES) {
    const key = `${r.venueCode}|${r.side}|${r.methodCode}|${r.minAmount}`;
    if (existing.has(key)) continue;
    await run(
      `INSERT INTO venue_method_fee_rules
        (venue_code, side, method_code, method_ja, min_amount, max_amount,
         fee_fixed, fee_rate, fee_status, source_url, source_name, verified_at, verified_by,
         note, created_at, updated_at)
       VALUES (?,?,?,?,?,?, ?,?,?, ?,?,?,?, ?,?,?)`,
      [
        r.venueCode, r.side, r.methodCode, r.methodJa, r.minAmount, r.maxAmount,
        r.feeFixed, r.feeRate, r.feeStatus,
        r.sourceUrl, r.sourceName, r.verifiedAt, r.verifiedBy,
        r.note, now, now,
      ],
    );
  }
  ensured = true;
}

export async function loadPaymentRules(venueCode?: string): Promise<PaymentFeeRule[]> {
  await ensurePaymentMethods();
  const rows = venueCode
    ? await all('SELECT * FROM venue_method_fee_rules WHERE venue_code = ? ORDER BY method_code, min_amount', [venueCode])
    : await all('SELECT * FROM venue_method_fee_rules ORDER BY venue_code, method_code, min_amount');
  return rows.map((r) => ({
    venueCode: String(r.venue_code),
    side: 'BUY' as const,
    methodCode: String(r.method_code),
    methodJa: String(r.method_ja),
    minAmount: Number(r.min_amount ?? 0),
    maxAmount: r.max_amount === null || r.max_amount === undefined ? null : Number(r.max_amount),
    feeFixed: r.fee_fixed === null || r.fee_fixed === undefined ? null : Number(r.fee_fixed),
    feeRate: r.fee_rate === null || r.fee_rate === undefined ? null : Number(r.fee_rate),
    feeStatus: (String(r.fee_status) as PaymentFeeRule['feeStatus']) || 'UNKNOWN',
    sourceUrl: r.source_url ? String(r.source_url) : null,
    sourceName: r.source_name ? String(r.source_name) : null,
    verifiedAt: r.verified_at ? String(r.verified_at) : null,
    verifiedBy: r.verified_by ? String(r.verified_by) : null,
    note: r.note ? String(r.note) : '',
  }));
}

/**
 * 「この市場でこの金額を払うとき、実際に使う支払方法の手数料はいくらか」を返す。
 *
 * 支払方法が登録されていない市場（メルカリ以外）は null を返す。
 * その場合、呼び出し側は従来通り「支払方法という考え方を使わない」計算になる。
 * 勝手に0円を足したり引いたりしない。
 */
export async function buyPaymentFeeFor(
  venueCode: string, methodCode: string, amount: number,
): Promise<ResolvedPaymentFee | null> {
  const rules = await loadPaymentRules(venueCode);
  if (rules.length === 0) return null;
  return resolvePaymentFee(rules, methodCode, amount);
}

export type PaymentMethodCoverage = {
  total: number;
  known: number;
  unknown: number;
  /** 実際に使う設定になっている支払方法。 */
  defaultMethod: string;
  defaultKnown: boolean;
  defaultNote: string;
  rows: PaymentFeeRule[];
};

/** 画面用。どの支払方法の手数料が分かっていないのかを正直に出す。 */
export async function paymentMethodCoverage(
  venueCode: string, defaultMethod: string,
): Promise<PaymentMethodCoverage> {
  const rows = await loadPaymentRules(venueCode);
  const known = rows.filter((r) => r.feeFixed !== null || r.feeRate !== null).length;
  const def = rows.find((r) => r.methodCode === defaultMethod);
  return {
    total: rows.length,
    known,
    unknown: rows.length - known,
    defaultMethod,
    defaultKnown: Boolean(def && (def.feeFixed !== null || def.feeRate !== null)),
    defaultNote: def?.note ?? 'この支払方法は登録されていない',
    rows,
  };
}

export { resolvePaymentFee };
export type { PaymentFeeRule, ResolvedPaymentFee };
