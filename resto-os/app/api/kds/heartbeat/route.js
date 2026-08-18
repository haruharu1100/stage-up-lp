import { NextResponse } from 'next/server';
import { run, nowIso } from '../../../../lib/db.js';
import { requireAuth, apiFail } from '../../../../lib/auth.js';

export const dynamic = 'force-dynamic';

const STALE_SEC = 60;

/**
 * 厨房モニターの生存確認。
 * 「厨房に注文が届かない」事故は、たいてい端末が落ちている／回線が切れているのに
 * 誰も気づいていない、という形で起きる。だから厨房側から定期的に合図を送らせ、
 * 途絶えたらホール側（POS）に警告を出す。
 */
export async function POST(req) {
  try {
    const ctx = await requireAuth();
    const station = String((await req.json().catch(() => ({}))).station || 'all').slice(0, 20);
    // INSERT には WHERE が無いので、ここだけ tenant/store を明示して書く（値はctx由来の数値）
    await run(
      'INSERT OR REPLACE INTO settings (tenant_id, store_id, key, value) VALUES (?, ?, ?, ?)',
      [ctx.tenantId, ctx.storeId, `kds_alive:${station}`, nowIso()]
    );
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}

export async function GET() {
  try {
    const ctx = await requireAuth();
    const rows = await ctx.query(`SELECT key, value FROM settings WHERE SCOPE() AND key LIKE 'kds_alive:%'`);
    const now = Date.now();
    const stations = rows.map((r) => ({
      station: String(r.key).slice('kds_alive:'.length),
      lastSeen: r.value,
      secondsAgo: Math.round((now - new Date(r.value).getTime()) / 1000),
    }));
    const alive = stations.filter((s) => s.secondsAgo <= STALE_SEC);

    // まだ誰も手をつけていない注文（届いていない疑いがあるもの）
    const pending = await ctx.first(
      `SELECT COUNT(*) AS c, MIN(created_at) AS oldest
         FROM order_items WHERE SCOPE() AND status = 'received' AND check_id IS NULL`
    );
    const oldestSec = pending.oldest ? Math.round((now - new Date(pending.oldest).getTime()) / 1000) : 0;

    return NextResponse.json({
      ok: true,
      stations,
      kitchenOffline: stations.length > 0 && alive.length === 0,
      neverConnected: stations.length === 0,
      pending: Number(pending.c),
      oldestPendingSec: oldestSec,
      now: nowIso(),
    });
  } catch (e) {
    return apiFail(e);
  }
}
