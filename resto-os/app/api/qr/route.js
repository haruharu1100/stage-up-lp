import { NextResponse } from 'next/server';
import QRCode from 'qrcode';
import { requireAuth, requireRole, apiFail, ApiError } from '../../../lib/auth.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

export async function GET(req) {
  try {
    // QRは席への入場券なので、自店舗のテーブルの分しか作らせない
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const sp = new URL(req.url).searchParams;
    const table = await ctx.first('SELECT * FROM tables WHERE SCOPE() AND id = ?', [Number(sp.get('tableId')) || 0]);
    if (!table) throw new ApiError('NOT_FOUND', 'テーブルが見つかりません', 404);

    const origin = process.env.PUBLIC_ORIGIN || new URL(req.url).origin;
    // QRには「会計のたびに入れ替わる入場トークン」ではなく、卓のずっと変わらない番号を焼く。
    // こうしないと、一度お会計するたびに貼ったQRが使えなくなる。
    const png = await QRCode.toBuffer(`${origin}/q/${table.public_id}`, { width: 600, margin: 2 });
    return new NextResponse(png, {
      headers: { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' },
    });
  } catch (e) {
    return apiFail(e);
  }
}
