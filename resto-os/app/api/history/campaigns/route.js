import { NextResponse } from 'next/server';
import { nowIso } from '../../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../../lib/auth.js';
import { logAudit } from '../../../../lib/audit.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/**
 * 打った手（クーポン・広告・チラシ・セールなど）の記録。
 *
 * 出来事（day_events）が「起きたこと」なのに対して、こちらは「こちらから仕掛けたこと」。
 * いつ何をいくらかけてやったかが残っていないと、
 * あとから「あの月が良かったのは何をしたからか」を確かめようがない。
 * ここも人が書いた事実だけで、AIの推測は入らない。
 */

const KINDS = ['coupon', 'sns', 'flyer', 'gourmet', 'sale', 'event', 'ad', 'other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const from = String(sp.get('from') || '').slice(0, 10);
    const to = String(sp.get('to') || '').slice(0, 10);

    // 期間にすこしでも重なっていれば拾う（始まりが期間より前でも、まだ続いていれば対象）
    const where = DATE_RE.test(from) && DATE_RE.test(to)
      ? { sql: ` AND starts_on <= ? AND (ends_on = '' OR ends_on >= ?)`, args: [to, from] }
      : { sql: '', args: [] };

    const rows = await ctx.query(
      `SELECT id, name, kind, detail, starts_on, ends_on, cost, staff_name, created_at
         FROM campaigns WHERE SCOPE()${where.sql} ORDER BY starts_on DESC, id DESC LIMIT 300`,
      where.args
    );
    const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    return NextResponse.json({
      ok: true,
      campaigns: rows.map((r) => ({
        id: Number(r.id), name: r.name, kind: r.kind, detail: r.detail,
        startsOn: r.starts_on, endsOn: r.ends_on, cost: Number(r.cost || 0),
        by: r.staff_name, at: r.created_at,
        // 今まさに動いているものが一目で分かるようにする
        running: r.starts_on <= today && (!r.ends_on || r.ends_on >= today),
      })),
    });
  } catch (e) {
    return apiFail(e);
  }
}

export async function POST(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const b = await req.json();

    const name = String(b.name || '').trim().slice(0, 120);
    if (!name) throw new ApiError('BAD_REQUEST', '企画の名前を入れてください');

    const startsOn = String(b.startsOn || '').slice(0, 10);
    if (!DATE_RE.test(startsOn)) throw new ApiError('BAD_REQUEST', '始める日の指定が正しくありません');

    const endsOn = b.endsOn && DATE_RE.test(String(b.endsOn)) ? String(b.endsOn) : '';
    if (endsOn && endsOn < startsOn) throw new ApiError('BAD_REQUEST', '終わりの日が、始まりの日より前になっています');

    const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'other';
    const detail = String(b.detail || '').slice(0, 1000);
    const cost = Math.max(0, Math.round(Number(b.cost) || 0));

    const id = await ctx.insert('campaigns', {
      name, kind, detail,
      starts_on: startsOn,
      ends_on: endsOn,
      cost,
      staff_name: ctx.staffName || '',
      created_at: nowIso(),
    });

    await logAudit(ctx, {
      action: 'campaign.create', targetType: 'campaign', targetId: id,
      after: { 名前: name, 種類: kind, 開始: startsOn, 終了: endsOn || '（続行中）', かけた費用: cost },
    });
    return NextResponse.json({ ok: true, id });
  } catch (e) {
    return apiFail(e);
  }
}

/** 打ち間違いを直せるようにする。消した記録そのものは操作ログに残る */
export async function DELETE(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const id = Number(new URL(req.url).searchParams.get('id'));
    if (!id) throw new ApiError('BAD_REQUEST', '消す対象が指定されていません');

    const before = await ctx.first(`SELECT * FROM campaigns WHERE SCOPE() AND id = ?`, [id]);
    if (!before) throw new ApiError('NOT_FOUND', 'その記録は見つかりませんでした', 404);

    await ctx.run(`DELETE FROM campaigns WHERE SCOPE() AND id = ?`, [id]);
    await logAudit(ctx, {
      action: 'campaign.delete', targetType: 'campaign', targetId: id,
      before: { 名前: before.name, 種類: before.kind, 開始: before.starts_on, 終了: before.ends_on || '（続行中）' },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}
