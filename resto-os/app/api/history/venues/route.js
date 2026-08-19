import { NextResponse } from 'next/server';
import { nowIso, one, businessDate } from '../../../../lib/db.js';
import { requireAuth, requireRole, requireFeature, apiFail, ApiError } from '../../../../lib/auth.js';
import { logAudit } from '../../../../lib/audit.js';
import { geocodeJp } from '../../../../lib/weather/provider.js';
import { addDays } from '../../../../lib/learn.js';

export const dynamic = 'force-dynamic';

/**
 * 近くの会場と、そこでの開催予定。
 *
 * 「京セラドームでライブがある日は、終演後にお客様が増える」ような動きは、
 * 売上の数字だけを見ていても分からない。かといって、日本中の催し物を
 * 正確に自動で拾える無料の窓口が見当たらないので、
 * ★ここは店長が知っていることを登録する形にしている。
 *   分からないものを推測で埋めるより、確かな事実を1件入れてもらうほうが役に立つため。
 *
 * 徒歩5分の会場と、電車で30分の会場を同じに扱っては困るので、
 * 会場は店ごとに登録し、お店からの距離も一緒に持つ。
 */

const MANAGE_ROLES = ['owner', 'admin', 'manager'];
const KINDS = ['live', 'sports', 'festival', 'fireworks', 'expo', 'school', 'other'];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{1,2}:\d{2}$/;

/** 2点間のおおよその距離（km）。地球を丸いものとして計算する */
function distanceKm(aLat, aLng, bLat, bLng) {
  const R = 6371;
  const r = (d) => (d * Math.PI) / 180;
  const dLat = r(bLat - aLat);
  const dLng = r(bLng - aLng);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(r(aLat)) * Math.cos(r(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(s)) * 10) / 10;
}

async function storeOf(ctx) {
  return one('SELECT lat, lng FROM stores WHERE id = ? AND tenant_id = ?', [ctx.storeId, ctx.tenantId]);
}

export async function GET(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const today = businessDate();
    const from = DATE_RE.test(String(sp.get('from') || '')) ? sp.get('from') : addDays(today, -60);
    const to = DATE_RE.test(String(sp.get('to') || '')) ? sp.get('to') : addDays(today, 90);

    const venues = await ctx.query(
      `SELECT id, name, kind, lat, lng, distance_km, capacity, note, active FROM venues
        WHERE SCOPE() ORDER BY active DESC, distance_km, name`
    );
    const events = await ctx.query(
      `SELECT e.id, e.venue_id, v.name AS venue, e.business_date, e.end_date, e.title, e.kind,
              e.expected_people, e.start_time, e.end_time, e.staff_name
         FROM venue_events e JOIN venues v ON v.id = e.venue_id
        WHERE SCOPE(e) AND e.business_date >= ? AND e.business_date <= ?
        ORDER BY e.business_date DESC, e.start_time`,
      [from, to]
    );
    const st = await storeOf(ctx);

    return NextResponse.json({
      ok: true,
      today,
      hasStoreLocation: Boolean(st?.lat && st?.lng),
      venues: venues.map((v) => ({
        id: Number(v.id), name: v.name, kind: v.kind,
        lat: v.lat === null ? null : Number(v.lat),
        lng: v.lng === null ? null : Number(v.lng),
        distanceKm: v.distance_km === null ? null : Number(v.distance_km),
        capacity: Number(v.capacity || 0), note: v.note || '', active: Number(v.active) === 1,
      })),
      events: events.map((e) => ({
        id: Number(e.id), venueId: Number(e.venue_id), venue: e.venue,
        date: e.business_date, endDate: e.end_date || '', title: e.title, kind: e.kind,
        people: Number(e.expected_people || 0),
        startTime: e.start_time || '', endTime: e.end_time || '', by: e.staff_name || '',
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
    const action = String(b.action || 'venue');

    // ── 会場を登録する
    if (action === 'venue') {
      const name = String(b.name || '').trim().slice(0, 80);
      if (!name) throw new ApiError('BAD_REQUEST', '会場の名前を入れてください');
      const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'other';
      const capacity = Math.max(0, Math.min(200000, Math.floor(Number(b.capacity) || 0)));
      const note = String(b.note || '').slice(0, 200);

      // 住所（または会場名）から位置を割り出す。分からなければ位置なしで登録する
      // （位置が無くても、開催予定そのものは記録として役に立つため）
      let lat = Number.isFinite(Number(b.lat)) && b.lat !== '' ? Number(b.lat) : null;
      let lng = Number.isFinite(Number(b.lng)) && b.lng !== '' ? Number(b.lng) : null;
      if ((lat === null || lng === null) && (b.address || name)) {
        const hit = await geocodeJp(String(b.address || name));
        if (hit) { lat = hit.lat; lng = hit.lng; }
      }
      const st = await storeOf(ctx);
      const dist = lat !== null && lng !== null && st?.lat && st?.lng
        ? distanceKm(Number(st.lat), Number(st.lng), lat, lng)
        : null;

      const dup = await ctx.first(`SELECT id FROM venues WHERE SCOPE() AND name = ?`, [name]);
      if (dup) throw new ApiError('BAD_REQUEST', 'その名前の会場は、すでに登録されています');

      const id = await ctx.insert('venues', {
        name, kind, lat, lng, distance_km: dist, capacity, note, active: 1, created_at: nowIso(),
      });
      await logAudit(ctx, {
        action: 'venue.create', targetType: 'venue', targetId: id,
        after: { 会場: name, 種類: kind, 距離: dist === null ? '未算出' : `${dist}km` },
      });
      return NextResponse.json({ ok: true, id, distanceKm: dist, located: lat !== null });
    }

    // ── 開催予定を登録する
    if (action === 'event') {
      const venueId = Number(b.venueId);
      const venue = await ctx.first(`SELECT id, name FROM venues WHERE SCOPE() AND id = ?`, [venueId]);
      if (!venue) throw new ApiError('NOT_FOUND', '会場が見つかりません', 404);

      const date = String(b.date || '').slice(0, 10);
      if (!DATE_RE.test(date)) throw new ApiError('BAD_REQUEST', '日付の指定が正しくありません');
      const endDate = b.endDate && DATE_RE.test(String(b.endDate)) ? String(b.endDate) : '';
      if (endDate && endDate < date) throw new ApiError('BAD_REQUEST', '終わりの日が、始まりの日より前になっています');

      const title = String(b.title || '').trim().slice(0, 120);
      if (!title) throw new ApiError('BAD_REQUEST', '催しの名前を入れてください');
      const kind = KINDS.includes(String(b.kind)) ? String(b.kind) : 'other';
      const people = Math.max(0, Math.min(500000, Math.floor(Number(b.people) || 0)));
      const startTime = TIME_RE.test(String(b.startTime || '')) ? String(b.startTime) : '';
      const endTime = TIME_RE.test(String(b.endTime || '')) ? String(b.endTime) : '';

      const id = await ctx.insert('venue_events', {
        venue_id: venueId, business_date: date, end_date: endDate, title, kind,
        expected_people: people, start_time: startTime, end_time: endTime,
        source: 'manual', staff_name: ctx.staffName || '', created_at: nowIso(),
      });
      await logAudit(ctx, {
        action: 'venue_event.create', targetType: 'venue_event', targetId: id,
        after: { 会場: venue.name, 日付: date, 催し: title, 想定人数: people },
      });
      return NextResponse.json({ ok: true, id });
    }

    throw new ApiError('BAD_REQUEST', '操作が正しくありません');
  } catch (e) {
    return apiFail(e);
  }
}

/** 打ち間違いを消せるようにする。消したことは操作ログに残る */
export async function DELETE(req) {
  try {
    const ctx = requireFeature(requireRole(await requireAuth(), MANAGE_ROLES), 'history');
    const sp = new URL(req.url).searchParams;
    const kind = String(sp.get('kind') || 'event');
    const id = Number(sp.get('id'));
    if (!Number.isInteger(id) || id <= 0) throw new ApiError('BAD_REQUEST', '指定が正しくありません');

    if (kind === 'venue') {
      const v = await ctx.first(`SELECT id, name FROM venues WHERE SCOPE() AND id = ?`, [id]);
      if (!v) throw new ApiError('NOT_FOUND', '会場が見つかりません', 404);
      // 開催の記録ごと消えると過去の見込みの根拠が失われるので、会場は「使わない」印にする
      await ctx.run(`UPDATE venues SET active = 0 WHERE SCOPE() AND id = ?`, [id]);
      await logAudit(ctx, { action: 'venue.disable', targetType: 'venue', targetId: id, before: { 会場: v.name } });
      return NextResponse.json({ ok: true });
    }

    const e = await ctx.first(`SELECT id, title, business_date FROM venue_events WHERE SCOPE() AND id = ?`, [id]);
    if (!e) throw new ApiError('NOT_FOUND', '予定が見つかりません', 404);
    await ctx.run(`DELETE FROM venue_events WHERE SCOPE() AND id = ?`, [id]);
    await logAudit(ctx, {
      action: 'venue_event.delete', targetType: 'venue_event', targetId: id,
      before: { 日付: e.business_date, 催し: e.title },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}
