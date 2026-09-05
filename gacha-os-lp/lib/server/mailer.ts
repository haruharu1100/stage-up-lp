/**
 * メールの送り口（入口だけ）。
 *
 * ═══════════════════════════════════════════════════════
 * ★中身は lib/server/mail/ へ移しました
 * ═══════════════════════════════════════════════════════
 *
 *   前は、このファイルの中に
 *   「確認用なら記録に書く／本番なら送る（未実装）」が
 *   直接書いてありました。
 *
 *   本番のメール会社をつなぐには、そこを書き換えることになります。
 *   書き換えるということは、確認用の動きも一緒に壊せる、ということです。
 *   壊れても、確認用では誰も困らないので、気づきません。
 *
 *   ですので、次の形に分けました。
 *
 *     lib/server/mail/types.ts … 共通の決めごと（送り口の形）
 *     lib/server/mail/mock.ts  … 確認用（外へは1通も出さない）
 *     lib/server/mail/http.ts  … 本物（設定が無ければはっきり止まる）
 *     lib/server/mail/index.ts … どちらを使うかを決める1か所
 *
 *   このファイルは、これまでの呼び出し方をそのまま使えるようにするためだけに
 *   残してあります。新しく書くときは lib/server/mail から読んでください。
 *
 * ★ここに送信の中身を書き戻さないこと。
 *   1か所で決める、という約束が消えます。
 */

export {
  deliver,
  isCriticalMail,
  isProductionEnv,
  mailReadiness,
  assertMailReadyAtBoot,
  makeMailProvider,
  MockMailProvider,
  HttpMailProvider,
  MailNotConfiguredError,
  MailSendError,
  CRITICAL_KINDS,
  MAIL_KIND_LABEL,
} from "./mail";

export type {
  Mail,
  MailKind,
  MailProvider,
  MailReadiness,
  Delivery,
  Preflight,
} from "./mail";
