/**
 * お知らせ（GET / POST /api/customer/notices）。
 *
 * ═══════════════════════════════════════════════════════
 * ★いまは、本物のメールもSMSも出していません
 * ═══════════════════════════════════════════════════════
 *
 *   通知の送り先は Mock（練習用の受け皿）です。
 *   ですので、1件ずつに reallySent という印を付けて返します。
 *
 *       reallySent = false … 実際には誰にも届いていない
 *
 *   これを付けない作りにすると、記録に「送信済み」だけが並びます。
 *   あとで「送ったはずなのに届いていない」と言われたときに、
 *   本当に出したのか、練習だったのかを、誰も言えなくなります。
 *
 *   メール送信会社につないだ日から、この印が true に変わります。
 *   つなぐ前に true にしないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★POST は「読んだ印」を付けるだけです
 * ═══════════════════════════════════════════════════════
 *
 *   お知らせを消す入口は、作っていません。
 *   お客様が消せる作りにすると、
 *   「発送しました」の記録も一緒に消えます。
 */

import { NextResponse, type NextRequest } from "next/server";
import { guard, passed, internalError } from "@/lib/server/context";
import {
  listNotifications,
  unreadCount,
  markAllRead,
} from "@/lib/server/notify";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const [notices, unread] = await Promise.all([
      listNotifications(gate.session.tenantId, gate.session.subjectId),
      unreadCount(gate.session.tenantId, gate.session.subjectId),
    ]);
    return NextResponse.json({
      ok: true,
      requestId: gate.requestId,
      notices,
      unread,
    });
  } catch (e) {
    return internalError(gate.requestId, "customer-notices", e);
  }
}

export async function POST(req: NextRequest) {
  const gate = await guard(req, { kind: "CUSTOMER" });
  if (!passed(gate)) return gate;

  try {
    const n = await markAllRead(
      gate.session.tenantId,
      gate.session.subjectId,
    );
    return NextResponse.json({ ok: true, requestId: gate.requestId, read: n });
  } catch (e) {
    return internalError(gate.requestId, "customer-notices-read", e);
  }
}
