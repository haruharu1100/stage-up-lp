/**
 * 会員登録の入口（POST /api/auth/signup）。
 *
 * ═══════════════════════════════════════════════════════
 * ★この入口は、ログインしていない人が叩きます
 * ═══════════════════════════════════════════════════════
 *
 *   誰でも、何度でも叩けます。
 *   ですから、返事の内容で中身を教えないことが、
 *   ログインの入口以上に大事になります。
 *
 *   ★「そのメールアドレスは、すでに登録されています」を返さないこと。
 *     返した瞬間、この入口は「会員名簿を作る道具」になります。
 *     パスワードすら要りません。
 *
 *   ★リンクを、この入口の返事に入れないこと。
 *     入れると、メールアドレスを書いただけの人にリンクが渡り、
 *     誰でも誰にでも成りすませます。
 *     確認用（Preview）であっても、そこは同じにしません。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで、ログインさせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   登録した瞬間に入場券（クッキー）を渡すと、
 *   他人のメールアドレスで登録した人が、そのまま中に入れます。
 *   メールを受け取れることを確かめてから、ログインしていただきます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { tenantByCode } from "@/lib/server/auth";
import { signupCustomer, SignupError, VERIFY_LINK_HOURS } from "@/lib/server/signup";
import { id } from "@/lib/server/ids";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * うまくいっても、すでにいらっしゃっても、必ずこの返事にする。
 *
 * ★呼び出し側で文言を変えないこと。
 *   1か所だけ違う文言になっていると、そこから中身が分かります。
 */
const ACCEPTED =
  "お申し込みを受け付けました。ご入力のメールアドレス宛に、" +
  `確認のご案内をお送りします（${VERIFY_LINK_HOURS}時間有効）。` +
  "メールに記載のリンクを開くと、ご利用いただけるようになります。";

/** 断る理由ごとの返し方。★どれも「送られてきた内容」の話だけ */
const STATUS: Record<string, number> = {
  BAD_REQUEST: 400,
  BAD_EMAIL: 400,
  AGREEMENT_REQUIRED: 400,
  WEAK_PASSWORD: 400,
  BAD_NAME: 400,
  TOO_MANY: 429,
  INTERNAL: 503,
};

export async function POST(req: NextRequest) {
  const requestId = id("req");

  let body: {
    tenantCode?: unknown;
    email?: unknown;
    password?: unknown;
    name?: unknown;
    agreeTerms?: unknown;
    agreePrivacy?: unknown;
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

  const tenantCode =
    str(body.tenantCode).trim() !== ""
      ? str(body.tenantCode).trim()
      : process.env.DEFAULT_TENANT_CODE;

  /* ★会社が決まらなければ、その場で断ること。
       「決まらなかったので、とりあえず1社目」をやらないこと。
       やると、他社の会員名簿に人が増えていきます。 */
  const tenant = await tenantByCode(tenantCode);
  if (!tenant || tenant.status !== "ACTIVE") {
    return NextResponse.json(
      { ok: false, code: "NO_TENANT", message: "登録先が見つかりません。", requestId },
      { status: 400 },
    );
  }

  try {
    await signupCustomer({
      tenantId: tenant.id,
      tenantName: tenant.name,
      email: str(body.email),
      password: str(body.password),
      name: str(body.name),
      agreeTerms: body.agreeTerms === true,
      agreePrivacy: body.agreePrivacy === true,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
      userAgent: req.headers.get("user-agent") ?? undefined,
    });
  } catch (e) {
    if (e instanceof SignupError) {
      return NextResponse.json(
        { ok: false, code: e.code, message: e.message, requestId },
        { status: STATUS[e.code] ?? 400 },
      );
    }
    /* ★中身を外へ返さないこと。記録には残します。 */
    console.error("[signup] unexpected", requestId, e);
    return NextResponse.json(
      {
        ok: false,
        code: "INTERNAL",
        message:
          "ただいま登録を受け付けられません。少し時間をおいてから、もう一度お試しください。",
        requestId,
      },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ok: true, requestId, message: ACCEPTED },
    { status: 200 },
  );
}
