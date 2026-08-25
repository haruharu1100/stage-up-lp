/**
 * パスワードの作り直し（POST /api/auth/password-reset）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口は、ログインしていない人が叩きます
 * ═══════════════════════════════════════════════════════
 *
 *   つまり、誰でも、何度でも叩けます。
 *   ですから、返事の内容で中身を教えないことが、
 *   ログインの入口以上に大事になります。
 *
 *   ★「そのメールアドレスは登録されていません」を返さないこと。
 *     返した瞬間、この入口は
 *     「実在するメールアドレスを調べる道具」になります。
 *     合言葉すら要らないので、ログインの入口より手軽です。
 *
 *   いてもいなくても、同じ返事にします。
 *   実際にメールを出すのは、いた場合だけです。
 *
 * ═══════════════════════════════════════════════════════
 * ★確認用（Preview）では、メールを実際に送りません
 * ═══════════════════════════════════════════════════════
 *
 *   架空のメールアドレスでも、1文字違いが実在すれば、
 *   身に覚えのない「パスワード再設定」のメールが他人へ届きます。
 *   こちらの確認作業のために、他人を不安にさせないこと。
 *
 *   送る代わりに、サーバーの記録に書きます（lib/server/mailer.ts）。
 *
 *   ★リンクを、この入口の返事に入れないこと。
 *     入れると、メールアドレスを書いただけの人にリンクが渡り、
 *     誰でも誰にでも成りすませます。
 *     確認用であっても、そこは同じにしません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { tenantByCode } from "@/lib/server/auth";
import {
  completePasswordReset,
  startPasswordReset,
  PasswordError,
  RESET_LINK_MINUTES,
} from "@/lib/server/passwordChange";
import { id } from "@/lib/server/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * 申し込みでも再設定でも、必ずこの返事にする。
 *
 * ★呼び出し側で文言を変えないこと。
 *   1か所だけ違う文言になっていると、そこから中身が分かります。
 */
const ACCEPTED =
  "お申し込みを受け付けました。登録されているメールアドレス宛に、" +
  `再設定のご案内をお送りします（${RESET_LINK_MINUTES}分間有効）。` +
  "届かない場合は、社内の管理者（全権）の方にご確認ください。";

export async function POST(req: NextRequest) {
  const requestId = id("req");

  let body: {
    step?: unknown;
    tenantCode?: unknown;
    email?: unknown;
    token?: unknown;
    newPassword?: unknown;
    confirmPassword?: unknown;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, code: "BAD_REQUEST", message: "内容を読み取れませんでした。", requestId },
      { status: 400 },
    );
  }

  const str = (v: unknown) => (typeof v === "string" ? v : "");

  /* ── ② リンクを使って、新しいパスワードを設定する ── */
  if (body.step === "COMPLETE") {
    try {
      await completePasswordReset({
        token: str(body.token),
        newPassword: str(body.newPassword),
        confirmPassword: str(body.confirmPassword),
      });
      return NextResponse.json(
        {
          ok: true,
          requestId,
          message:
            "パスワードを再設定しました。新しいパスワードでログインしてください。",
        },
        { status: 200 },
      );
    } catch (e) {
      if (e instanceof PasswordError) {
        return NextResponse.json(
          { ok: false, code: e.code, message: e.message, requestId },
          { status: e.code === "BAD_TOKEN" ? 400 : 400 },
        );
      }
      console.error("[password-reset] unexpected", requestId, e);
      return NextResponse.json(
        {
          ok: false,
          code: "INTERNAL",
          message: "処理中に問題が発生しました。しばらくしてからお試しください。",
          requestId,
        },
        { status: 500 },
      );
    }
  }

  /* ── ① 申し込む ── */
  const tenantCode =
    str(body.tenantCode).trim() !== ""
      ? str(body.tenantCode).trim()
      : process.env.DEFAULT_TENANT_CODE;

  const tenant = await tenantByCode(tenantCode);

  /* ★会社が見つからなくても、同じ返事にすること。
       違う返事にすると、会社コードを当てる道具になります。 */
  if (tenant && tenant.status === "ACTIVE") {
    try {
      await startPasswordReset({
        tenantId: tenant.id,
        email: str(body.email),
        ip: req.headers.get("x-forwarded-for") ?? undefined,
      });
    } catch (e) {
      /* ★失敗しても、外へは同じ返事にすること。
           「失敗した」と返すと、そこから実在が分かります。 */
      console.error("[password-reset] start failed", requestId, e);
    }
  }

  return NextResponse.json(
    { ok: true, requestId, message: ACCEPTED },
    { status: 200 },
  );
}
