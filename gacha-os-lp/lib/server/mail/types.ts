/**
 * メールの送り口（共通の決めごと）。
 *
 * ═══════════════════════════════════════════════════════
 * ★「送信しました」と書いてよいのは、本当に送れたときだけ
 * ═══════════════════════════════════════════════════════
 *
 *   メールは、届かなくても静かです。
 *   エラー画面も出ませんし、お客様からの苦情も来ません。
 *   来ないまま、その方は二度と戻ってきません。
 *
 *   ですので、この仕組みでは次の3つを厳密に分けます。
 *
 *     LOG      … 記録に書いただけ。外へは1バイトも出していない
 *     SENT     … 配信会社が受け取った（＝こちらの手は離れた）
 *     （失敗） … 例外を投げる。黙って成功を返さない
 *
 *   ★"SENT" を、Mock が返さないこと。
 *     ここを1度でも曖昧にすると、
 *     「送ったはずなのに届かない」の原因がずっと分からなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★本文を戻り値に入れないこと
 * ═══════════════════════════════════════════════════════
 *
 *   本文には、パスワード再設定のリンクが入ります。
 *   戻り値に入れると、呼び出し側がうっかり画面へ返せてしまいます。
 *   そうなると、メールアドレスを打っただけの人が
 *   他人になりすませます。
 */

/**
 * 何のメールか。
 *
 * ★種類を必ず付けること。「件名を見れば分かる」では足りません。
 *   件名は店舗ごとに変わります。あとから記録を読む人が
 *   「これは本人確認だったのか、宣伝だったのか」を
 *   判断できなくなります。
 */
export type MailKind =
  /** 会員登録の確認（本人しか開けないリンクが入る） */
  | "SIGNUP_VERIFY"
  /** すでに登録がある方へのお知らせ（画面には出さない） */
  | "SIGNUP_DUPLICATE"
  /** パスワードの再設定（本人しか開けないリンクが入る） */
  | "PASSWORD_RESET"
  /** 重要なアカウント通知（停止・権限変更・不審な操作など） */
  | "ACCOUNT_NOTICE"
  /** 発送に関するお知らせ */
  | "SHIPMENT_NOTICE";

/**
 * 本人しか開けないリンクが入る種類。
 *
 * ★この一覧を短くしないこと。
 *   ここに載っている種類は、
 *   「本番で送れない状態なら、処理そのものを止める」対象です。
 *   届かなければ、その方は自分では二度と入れません。
 */
export const CRITICAL_KINDS: MailKind[] = [
  "SIGNUP_VERIFY",
  "PASSWORD_RESET",
  "ACCOUNT_NOTICE",
];

export const MAIL_KIND_LABEL: Record<MailKind, string> = {
  SIGNUP_VERIFY: "会員登録の確認",
  SIGNUP_DUPLICATE: "登録済みのお知らせ",
  PASSWORD_RESET: "パスワードの再設定",
  ACCOUNT_NOTICE: "重要なアカウント通知",
  SHIPMENT_NOTICE: "発送のお知らせ",
};

/** 送るもの */
export type Mail = {
  kind: MailKind;
  to: string;
  subject: string;
  body: string;
};

/** どう送ったか */
export type Delivery = {
  /**
   * "LOG"  … サーバーの記録に書いただけ（外へは出していない）
   * "SENT" … 配信会社が受け取った
   *
   * ★Mock が "SENT" を返さないこと。
   */
  via: "LOG" | "SENT";
  /** どの送り口を使ったか（記録に残す用） */
  provider: string;
  /** 配信会社側の受付番号。Mock のときは null */
  ref: string | null;
};

/**
 * 送れる状態かどうかの下見。
 *
 * ★1通目を送る前に見ること。
 *   送ってから気づいても、その1通は戻せません。
 */
export type Preflight =
  | { ok: true; provider: string; note: string }
  | {
      ok: false;
      provider: string;
      code: string;
      /** 非エンジニアが読んで、何をすればよいか分かる文 */
      message: string;
      /** 足りない設定の名前 */
      missing: string[];
    };

export interface MailProvider {
  /** 記録に残す名前（例 "MOCK" / "HTTP:resend"） */
  readonly name: string;
  /** Mock か、本物か。ここを文字列比較で判定させないため型で持つ */
  readonly kind: "MOCK" | "REAL";
  /** 設定がそろっているか（外へは何も送らない） */
  preflight(): Preflight;
  /**
   * 送る。
   *
   * ★送れなかったら、必ず例外にすること。
   *   戻り値で「失敗」を表さないこと。
   *   呼び出し側が戻り値を見落とすと、そのまま成功として進みます。
   */
  send(mail: Mail): Promise<Delivery>;
}

/** 設定が足りないまま本番で送ろうとしたときの例外 */
export class MailNotConfiguredError extends Error {
  readonly code: string;
  readonly missing: string[];
  constructor(code: string, message: string, missing: string[]) {
    super(message);
    this.name = "MailNotConfiguredError";
    this.code = code;
    this.missing = missing;
  }
}

/** 配信会社が受け取ってくれなかったときの例外 */
export class MailSendError extends Error {
  readonly status: number | null;
  constructor(message: string, status: number | null) {
    super(message);
    this.name = "MailSendError";
    this.status = status;
  }
}
