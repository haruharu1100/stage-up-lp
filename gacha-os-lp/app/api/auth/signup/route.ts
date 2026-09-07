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
import { tenantById } from "@/lib/server/auth";
import { hostFromHeaders, resolveTenantByHost } from "@/lib/server/tenantHost";
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
    /**
     * ★tenantCode をここに戻さないこと（2026-09-07）。
     *
     *   以前は、お客様に「会社コード」を打たせていました。
     *   ふつうのオンラインガチャのお店で聞かれないものです。
     *   聞かれた時点で、多くの方はそこで帰ります。
     *
     *   さらに、本文で受け取る形は
     *   「本文の会社コードだけ書き換えて、よそのお店に登録する」
     *   ということができる形でもありました。
     *
     *   どのお店かは、開いている住所（ドメイン）から
     *   サーバー側だけで決めます。lib/server/tenantHost.ts を見てください。
     */
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

  /* ★どのお店かは、開いている住所からだけ決めること。
       本文（body）から受け取る形に戻さないこと。
       戻すと、本文を書き換えるだけで他社の会員名簿に人が増えます。 */
  const here = await resolveTenantByHost(hostFromHeaders(req.headers));
  if (!here) {
    return NextResponse.json(
      {
        ok: false,
        code: "NO_TENANT",
        message:
          "このアドレスは、どのお店にも結びついていません。お店のご案内にあるアドレスからお入りください。",
        requestId,
      },
      { status: 400 },
    );
  }

  const tenant = await tenantById(here.tenantId);
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
