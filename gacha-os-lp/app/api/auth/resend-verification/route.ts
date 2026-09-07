/**
 * 確認メールの再送（POST /api/auth/resend-verification）。
 *
 * ═══════════════════════════════════════════════════════
 * ★ログイン済みの方だけが叩けます
 * ═══════════════════════════════════════════════════════
 *
 *   「メールアドレスを書けば再送される」形にすると、
 *   他人の受信箱へ、いくらでもメールを送りつけられます。
 *   （迷惑行為の踏み台になります）
 *
 *   ですから、ログインしていただいてから、
 *   ご自分の登録済みアドレスへだけ送ります。
 *   宛先は body から受け取りません。受け取れません。
 *
 * ═══════════════════════════════════════════════════════
 * ★firstRun: true が、ここでは正しい
 * ═══════════════════════════════════════════════════════
 *
 *   門番は、メール確認が済んでいないお客様の
 *   「状態が変わる依頼」を、すべて止めます。
 *   この入口も、そのままでは止まります。
 *
 *   ですが、この入口は、止めている原因そのものを
 *   解消するための入口です。ここを止めると、
 *   確認メールが届かなかった方は、二度と先へ進めません。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed } from "@/lib/server/context";
import { resendVerification } from "@/lib/server/signup";
import { db } from "@/lib/server/db";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER", firstRun: true });
  if (!passed(gate)) return gate;

  const t = await db().execute({
    sql: `SELECT name FROM tenants WHERE id = ? LIMIT 1`,
    args: [gate.session.tenantId],
  });
  const tenantName = String(
    (t.rows[0] as Record<string, unknown> | undefined)?.name ?? "",
  );

  /* ★既定は「送った」ではなく「送っていない」。
       途中で落ちたときに、送っていないのに送ったと
       お伝えしないためです。 */
  let sent = false;
  let waitSec: number | undefined;

  try {
    const r = await resendVerification({
      tenantId: gate.session.tenantId,
      tenantName,
      customerId: gate.session.subjectId,
      ip: req.headers.get("x-forwarded-for") ?? undefined,
    });
    sent = r.sent;
    if (!r.sent && r.skip === "TOO_SOON") waitSec = r.waitSec;
  } catch (e) {
    /* ★失敗しても、外へは同じ返事にすること。 */
    console.error("[resend-verification] failed", gate.requestId, e);
  }

  /* ★連打したときに「送りました」と言わないこと。
       言うと、お客様は届いていない4通目を待ち続けます。
       この方はログイン済みで、宛先はご自分のアドレスですから、
       ここは正直にお伝えしてかまいません。 */
  const message = sent
    ? "確認のご案内を、ご登録のメールアドレスへお送りしました。" +
      "前回のリンクは使えなくなります。"
    : waitSec != null
      ? `先ほどお送りしています。あと ${waitSec} 秒ほどお待ちいただくと、もう一度お送りできます。` +
        "届いていない場合は、迷惑メールに入っていないかご確認ください。"
      : "確認のご案内は、すでにお送りしています。" +
        "届いていない場合は、迷惑メールをご確認のうえ、しばらくしてからお試しください。";

  return NextResponse.json(
    { ok: true, requestId: gate.requestId, sent, message },
    { status: 200 },
  );
}
