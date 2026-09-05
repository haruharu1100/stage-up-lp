/**
 * 決済の送り口（Provider）の、共通の約束ごと。
 *
 * ═══════════════════════════════════════════════════════
 * ★この形にしている理由は、たった1つ
 * ═══════════════════════════════════════════════════════
 *
 *   「練習用の決済のまま、本番を開けてしまう」を、
 *   起こせなくするためです。
 *
 *   練習用（Mock）のままだと、こうなります。
 *
 *     ・「支払ったことにする」ボタンが本番の画面に出る
 *     ・お客様が押すと、1円も払わずにポイントが増える
 *     ・エラーは1つも出ない。画面はきれいに動く
 *     ・気づくのは、決算のとき
 *
 *   ですので、Mock と本物を型の上で区別して、
 *   「本番なのに Mock」を1か所で必ず止めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで決めている、いちばん大事な約束
 * ═══════════════════════════════════════════════════════
 *
 *   ① 失敗を戻り値で表さない。例外にする。
 *      戻り値だと、見落としたときに「払えた」として先へ進みます。
 *
 *   ② Mock は canCredit（ポイントを足してよい）を true にしない。
 *      足してよいのは「決済会社の確定通知」だけです。
 *      Mock の場合だけ、本番以外に限って専用の入口が開きます。
 *
 *   ③ preflight（下見）は投げない。調べるだけ。
 *      管理画面が「いま何が足りないか」を表示するために使います。
 */

/** 決済業者の名前。増やすときは、必ずここへ足すこと */
export type PaymentProviderName = "mock" | "stripe" | "gmo";

/** 下見の結果。だめなときは、足りない設定の名前も返す */
export type PaymentPreflight =
  | { ok: true; provider: string; note: string }
  | {
      ok: false;
      provider: string;
      code: string;
      message: string;
      missing: string[];
    };

export interface PaymentProviderImpl {
  /** 表示用の名前 */
  readonly name: PaymentProviderName;
  /** 練習用か、本物か */
  readonly kind: "MOCK" | "REAL";
  /** 設定がそろっているかを、通信せずに調べる */
  preflight(env: NodeJS.ProcessEnv): PaymentPreflight;
}

/**
 * 設定が足りなくて、決済を有効にできないときの例外。
 *
 * ★code は、そのまま画面のHTTP状態に使えるよう固定の文字列にすること。
 *   文言だけで判断すると、日本語を直した日に分岐が壊れます。
 */
export class PaymentNotConfiguredError extends Error {
  readonly code: string;
  readonly missing: string[];

  constructor(code: string, message: string, missing: string[] = []) {
    super(message);
    this.name = "PaymentNotConfiguredError";
    this.code = code;
    this.missing = missing;
  }
}

/* ══════════════════════════════════════════════
   止める理由（コード一覧）
   ══════════════════════════════════════════════ */

/**
 * ★ここに無いコードを、その場で作らないこと。
 *   画面側のHTTP状態の対応表とずれて、
 *   「500 エラー」としか出ない画面になります。
 */
export const PAYMENT_CODES = {
  /** PAYMENT_PROVIDER の値が mock / stripe / gmo のどれでもない */
  UNKNOWN: "PAYMENT_PROVIDER_UNKNOWN",
  /** 本番なのに練習用のまま */
  MOCK_IN_PRODUCTION: "PAYMENT_PROVIDER_IS_MOCK_IN_PRODUCTION",
  /** APIの鍵が無い */
  KEY_MISSING: "PAYMENT_API_KEY_MISSING",
  /** 確定通知（Webhook）の鍵が無い */
  WEBHOOK_SECRET_MISSING: "PAYMENT_WEBHOOK_SECRET_MISSING",
  /** 本番の保存先につながっていない */
  DB_NOT_PRODUCTION: "PAYMENT_PRODUCTION_DB_NOT_CONNECTED",
} as const;
