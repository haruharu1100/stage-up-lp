/**
 * どの送り口を使うかを、ここ1か所で決める。
 *
 * ═══════════════════════════════════════════════════════
 * ★本番で Mock を使わせないこと。これがこのファイルの全部
 * ═══════════════════════════════════════════════════════
 *
 *   いちばん起きやすい事故は、次の形です。
 *
 *     本番を開ける
 *       ↓
 *     設定を1つ入れ忘れる
 *       ↓
 *     仕組みが親切に Mock へ戻る
 *       ↓
 *     画面には「確認メールを送りました」と出る
 *       ↓
 *     誰にも届かない。誰も気づかない
 *       ↓
 *     お客様は自分では二度と登録できない
 *
 *   ★だから、本番では Mock へ戻しません。はっきり止めます。
 *     止まれば、その場で直せます。黙って進むと、直す機会が来ません。
 *
 * ═══════════════════════════════════════════════════════
 * ★「止める」の強さを、種類で変えていること
 * ═══════════════════════════════════════════════════════
 *
 *   本人しか開けないリンクが入るメール（登録確認・再設定・重要通知）は、
 *   届かなければ手続きそのものが成立しません。
 *   ですので、本番で送れないときは例外にして、
 *   呼び出し元の処理ごと止めます。
 *
 *   ★「メールだけ失敗しても、会員登録は通しておく」をしないこと。
 *     入り口だけ通ると、自分では有効化できない会員が生まれます。
 *     あとから見ても、なぜ有効化できないのか誰にも分かりません。
 *
 * ═══════════════════════════════════════════════════════
 * ★環境変数（まとめ）
 * ═══════════════════════════════════════════════════════
 *
 *   MAIL_PROVIDER  "mock"（既定） / "http"
 *   ほかは lib/server/mail/http.ts の頭に書いてあります。
 *
 *   ★既定を "http" にしないこと。
 *     設定を書き忘れた手元の環境から、実在の誰かへ飛びます。
 */

import { isProductionEnv } from "../env";
import { HttpMailProvider } from "./http";
import { MockMailProvider } from "./mock";
import {
  CRITICAL_KINDS,
  MailNotConfiguredError,
  type Delivery,
  type Mail,
  type MailProvider,
  type Preflight,
} from "./types";

export * from "./types";
export { MockMailProvider } from "./mock";
export { HttpMailProvider, readHttpMailConfig } from "./http";

/**
 * いま本番かどうか。
 *
 * ★中身は lib/server/env.ts にあります。ここには書き戻さないこと。
 *   決済側（lib/server/payments）もまったく同じ判定を使っています。
 *   2か所に書くと、いつか「メールは止まるのに決済は通る」が起きます。
 */
export { isProductionEnv } from "../env";

/** 設定で選ばれている送り口の名前（"mock" / "http"） */
export function wantedProvider(env: NodeJS.ProcessEnv = process.env): string {
  return String(env.MAIL_PROVIDER ?? "mock").trim().toLowerCase() || "mock";
}

/**
 * 送り口を作る（まだ送らない）。
 *
 * ★ここでは投げないこと。
 *   下見（mailPreflight）だけをしたい場面があります。
 *   投げるのは、実際に送るときと、本番の起動時チェックのときです。
 */
export function makeMailProvider(
  env: NodeJS.ProcessEnv = process.env,
): MailProvider {
  const want = wantedProvider(env);
  if (want === "http") return new HttpMailProvider(env);
  return new MockMailProvider();
}

export type MailReadiness = {
  /** 本番として扱っているか */
  production: boolean;
  /** 選ばれている送り口 */
  provider: string;
  /** Mock か本物か */
  kind: "MOCK" | "REAL";
  /** いま本当に送れる状態か */
  canSend: boolean;
  /** 本番なのに送れない状態か（＝公開してはいけない状態） */
  blocking: boolean;
  code: string | null;
  message: string;
  missing: string[];
};

/**
 * いまの状態を、送らずに調べる。
 *
 * ★画面（/launch）・ビルド前チェック・起動時チェックが、
 *   全部これを見ること。判定を3か所に書くと、必ずずれます。
 */
export function mailReadiness(
  env: NodeJS.ProcessEnv = process.env,
): MailReadiness {
  const production = isProductionEnv(env);
  const provider = makeMailProvider(env);
  const pre: Preflight = provider.preflight();

  /* ── 本番なのに Mock ── */
  if (production && provider.kind === "MOCK") {
    return {
      production,
      provider: provider.name,
      kind: provider.kind,
      canSend: false,
      blocking: true,
      code: "MAIL_PROVIDER_IS_MOCK_IN_PRODUCTION",
      message:
        "本番なのに、メールの送り口が確認用（Mock）のままです。" +
        "このままだと、会員登録の確認メールもパスワード再設定のメールも1通も届きません。" +
        "MAIL_PROVIDER=http と、配信会社の設定（MAIL_API_URL / MAIL_API_KEY / MAIL_FROM / MAIL_API_FORMAT）を入れてください。",
      missing: ["MAIL_PROVIDER"],
    };
  }

  /* ── 本物を選んでいるが、設定が足りない ── */
  if (!pre.ok) {
    return {
      production,
      provider: provider.name,
      kind: provider.kind,
      canSend: false,
      /* 本番でなければ、止めるほどではない（手元では Mock で足ります） */
      blocking: production,
      code: pre.code,
      message: pre.message,
      missing: pre.missing,
    };
  }

  return {
    production,
    provider: provider.name,
    kind: provider.kind,
    canSend: true,
    blocking: false,
    code: null,
    message: pre.note,
    missing: [],
  };
}

/**
 * 起動時に1回だけ確かめる。
 *
 * ★本番で送れない状態なら、ここで投げること。
 *   「1通目を送ろうとした瞬間に初めて気づく」だと、
 *   その1通目は、実在するお客様の登録です。
 */
export function assertMailReadyAtBoot(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const r = mailReadiness(env);
  if (r.blocking) {
    throw new MailNotConfiguredError(
      r.code ?? "MAIL_NOT_READY",
      r.message,
      r.missing,
    );
  }
}

/**
 * メールを届ける。
 *
 * ★戻り値で本文を返さないこと。
 *   呼び出し側が、うっかり画面へ出せてしまいます。
 *
 * ★失敗を戻り値で表さないこと。例外にします。
 *   戻り値だと、見落としたときに「送れた」として先へ進みます。
 */
export async function deliver(mail: Mail): Promise<Delivery> {
  const env = process.env;
  const production = isProductionEnv(env);
  const provider = makeMailProvider(env);

  if (production && provider.kind === "MOCK") {
    const r = mailReadiness(env);
    /* ★ここで console に書いて成功を返さないこと。
         それが「送信しました」と表示して実際には送られていない状態そのものです。 */
    throw new MailNotConfiguredError(
      r.code ?? "MAIL_PROVIDER_IS_MOCK_IN_PRODUCTION",
      r.message,
      r.missing,
    );
  }

  /* ★本番でないときは、本物の設定が無くても Mock で進めてよい。
       ただし「本物を選んでいるのに設定が無い」ときは、
       手元でも止めます。設定漏れに気づく唯一の機会だからです。 */
  if (!production && provider.kind === "REAL") {
    const pre = provider.preflight();
    if (!pre.ok) {
      throw new MailNotConfiguredError(pre.code, pre.message, pre.missing);
    }
  }

  return provider.send(mail);
}

/**
 * 本人しか開けないリンクが入る種類かどうか。
 *
 * ★呼び出し側が「失敗しても握りつぶす」判断をするときに、
 *   これを見て、握りつぶしてよいかを決めること。
 */
export function isCriticalMail(mail: Mail): boolean {
  return CRITICAL_KINDS.includes(mail.kind);
}
