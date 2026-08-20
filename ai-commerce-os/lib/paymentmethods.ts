/**
 * 仕入（BUY）の支払方法と、その手数料の決め方。
 *
 * 【なぜ支払方法を持つのか】
 * ユーザー指摘：「メルカリで仕入れる側の支払い手数料も固定ではありません。
 * クレジットカード払い、メルペイ残高払い、Apple Pay、FamiPay などは現在無料ですが、
 * コンビニ・ATM・キャリア決済では金額に応じた手数料があります。」
 *
 * つまり同じ商品を同じ値段で買っても、支払方法が違えば仕入総額が変わる。
 * 「たぶん手数料なし」で計算すると、コンビニ払いで買った瞬間に計算が外れる。
 *
 * 【安い方法を勝手に選ばない】
 * ユーザー指示：「『最も安い支払方法を勝手に選ぶ』のではなく、
 * 実際に当社が使う支払方法 を基準にしてください。」
 * だからこのファイルには「最安を探す」関数を置かない。置けば、いつか誰かが使う。
 *
 * 【このファイルには外部依存を一切書かないこと】
 * 管理画面（'use client' の部品）から支払方法の一覧を読むため。
 * lib/listing.ts と同じ約束（CLAUDE.md ルール37）。
 */

export const BUY_PAYMENT_METHODS = [
  { code: 'CREDIT_CARD', ja: 'クレジットカード払い' },
  { code: 'MERCARI_BALANCE', ja: 'メルペイ残高・売上金払い' },
  { code: 'APPLE_PAY', ja: 'Apple Pay' },
  { code: 'FAMIPAY', ja: 'FamiPay' },
  { code: 'CONVENIENCE_STORE', ja: 'コンビニ払い' },
  { code: 'ATM', ja: 'ATM払い' },
  { code: 'CARRIER_PAYMENT', ja: 'キャリア決済' },
  { code: 'OTHER', ja: 'その他' },
] as const;

export type BuyPaymentMethodCode = (typeof BUY_PAYMENT_METHODS)[number]['code'];

export const BUY_PAYMENT_METHOD_JA: Record<string, string> = Object.fromEntries(
  BUY_PAYMENT_METHODS.map((m) => [m.code, m.ja]),
);

export function buyPaymentMethodJa(code: string | null | undefined): string {
  if (!code) return '未設定';
  return BUY_PAYMENT_METHOD_JA[code] ?? code;
}

export function isBuyPaymentMethod(code: string): code is BuyPaymentMethodCode {
  return BUY_PAYMENT_METHODS.some((m) => m.code === code);
}

/**
 * 金額帯ごとの手数料ルール1件。
 *
 * `feeFixed` / `feeRate` が null＝「まだ調べていない」。0円ではない。
 * ここを0で埋めると、費用を少なく見積もって利益を多く見せることになる。
 */
export type PaymentFeeRule = {
  venueCode: string;
  side: 'BUY';
  methodCode: string;
  methodJa: string;
  /** この金額帯の下限（この額を含む）。 */
  minAmount: number;
  /** この金額帯の上限（この額を含む）。上限なしは null。 */
  maxAmount: number | null;
  feeFixed: number | null;
  feeRate: number | null;
  /** VERIFIED / ESTIMATED / UNKNOWN。UNKNOWN のときは金額が入っていない。 */
  feeStatus: 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN';
  sourceUrl: string | null;
  sourceName: string | null;
  verifiedAt: string | null;
  verifiedBy: string | null;
  note: string;
};

export type ResolvedPaymentFee = {
  methodCode: string;
  methodJa: string;
  /** 手数料（円）。分からなければ null。**null を 0 に読み替えないこと。** */
  fee: number | null;
  known: boolean;
  status: 'VERIFIED' | 'ESTIMATED' | 'UNKNOWN';
  note: string;
};

/**
 * 支払方法と支払額から、仕入時の決済手数料を決める。
 *
 * 【分からなければ null を返す。0円にしない】
 * ユーザー指示「分からないなら買わない」の手前の段階。
 * ここで0円を返すと、その先の判定は「手数料ゼロで確定した」と信じてしまう。
 * 呼び出し側は known=false を見て、STRONG BUY へ上げないようにする。
 */
export function resolvePaymentFee(
  rules: PaymentFeeRule[],
  methodCode: string,
  amount: number,
): ResolvedPaymentFee {
  const ja = buyPaymentMethodJa(methodCode);
  const candidates = rules.filter(
    (r) => r.methodCode === methodCode
      && amount >= r.minAmount
      && (r.maxAmount === null || amount <= r.maxAmount),
  );
  if (candidates.length === 0) {
    return {
      methodCode, methodJa: ja, fee: null, known: false, status: 'UNKNOWN',
      note: `${ja}の手数料が登録されていない。金額不明のまま計算しない`,
    };
  }
  // 金額帯が重なっているときは、下限がいちばん大きい（＝より具体的な）行を使う。
  const rule = candidates.sort((a, b) => b.minAmount - a.minAmount)[0];
  if (rule.feeFixed === null && rule.feeRate === null) {
    return {
      methodCode, methodJa: ja, fee: null, known: false, status: 'UNKNOWN',
      note: rule.note || `${ja}は金額に応じて手数料が変わる。実額が未確認`,
    };
  }
  const fee = Math.ceil(amount * (rule.feeRate ?? 0)) + (rule.feeFixed ?? 0);
  return {
    methodCode, methodJa: ja, fee, known: true,
    status: rule.feeStatus === 'VERIFIED' ? 'VERIFIED' : 'ESTIMATED',
    note: rule.note,
  };
}

/**
 * メルカリの支払方法の初期登録。
 *
 * 【無料の4つを VERIFIED にしない理由】
 * 「クレジットカード・メルペイ残高・Apple Pay・FamiPay は現在無料」というのは
 * 運用者からの申告であって、こちらが公式の料金ページを開いて確認した数字ではない。
 * 確認していないものを確認済みと書けば、この台帳の意味が無くなる。
 * だから ESTIMATED（概算・出典なし）で登録し、
 * 人間が公式ページを見た日に VERIFIED へ上げる。
 *
 * 【コンビニ・ATM・キャリア決済を空にしてある理由】
 * 「金額に応じた手数料がある」ことは分かっているが、いくらかは確認していない。
 * それらしい金額を書けば、その瞬間に「AIが推測で埋めた数字」が利益計算へ入る。
 * ユーザー指示「推測で埋めない。不明は『不明』と書く」に従い、null のままにする。
 */
export const MERCARI_PAYMENT_RULES: PaymentFeeRule[] = [
  ...(['CREDIT_CARD', 'MERCARI_BALANCE', 'APPLE_PAY', 'FAMIPAY'] as const).map((code) => ({
    venueCode: 'MERCARI',
    side: 'BUY' as const,
    methodCode: code,
    methodJa: BUY_PAYMENT_METHOD_JA[code],
    minAmount: 0,
    maxAmount: null,
    feeFixed: 0,
    feeRate: 0,
    feeStatus: 'ESTIMATED' as const,
    sourceUrl: null,
    sourceName: null,
    verifiedAt: null,
    verifiedBy: null,
    note: '運用者の申告では手数料なし（2026-08-20時点）。公式の料金ページでの確認はまだ取れていないため概算のまま。',
  })),
  ...(['CONVENIENCE_STORE', 'ATM', 'CARRIER_PAYMENT'] as const).map((code) => ({
    venueCode: 'MERCARI',
    side: 'BUY' as const,
    methodCode: code,
    methodJa: BUY_PAYMENT_METHOD_JA[code],
    minAmount: 0,
    maxAmount: null,
    feeFixed: null,
    feeRate: null,
    feeStatus: 'UNKNOWN' as const,
    sourceUrl: null,
    sourceName: null,
    verifiedAt: null,
    verifiedBy: null,
    note: '購入金額に応じて手数料がかかる。金額帯ごとの実額が未確認のため、金額を入れていない（推測で埋めない）。',
  })),
  {
    venueCode: 'MERCARI',
    side: 'BUY',
    methodCode: 'OTHER',
    methodJa: BUY_PAYMENT_METHOD_JA.OTHER,
    minAmount: 0,
    maxAmount: null,
    feeFixed: null,
    feeRate: null,
    feeStatus: 'UNKNOWN',
    sourceUrl: null,
    sourceName: null,
    verifiedAt: null,
    verifiedBy: null,
    note: '支払方法が特定できていない。手数料も特定できない。',
  },
];
