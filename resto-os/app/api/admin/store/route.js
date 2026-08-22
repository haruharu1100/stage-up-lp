import { NextResponse } from 'next/server';
import { one, run, nowIso } from '../../../../lib/db.js';
import { requireAuth, requireRole, apiFail, ApiError } from '../../../../lib/auth.js';
import { logAudit } from '../../../../lib/audit.js';
import { geocodeJp } from '../../../../lib/weather/provider.js';

export const dynamic = 'force-dynamic';

const MANAGE_ROLES = ['owner', 'admin', 'manager'];

/**
 * stores は SCOPE() の対象表ではない（店そのものを表す表なので）。
 * かわりに、必ず「ログイン中の店のID＋会社ID」の両方で絞る。片方だけだと他店の設定に触れてしまう。
 */
async function myStore(ctx) {
  const s = await one('SELECT * FROM stores WHERE id = ? AND tenant_id = ?', [ctx.storeId, ctx.tenantId]);
  if (!s) throw new ApiError('NOT_FOUND', '店舗が見つかりません', 404);
  return s;
}

export async function GET() {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const s = await myStore(ctx);
    return NextResponse.json({
      ok: true,
      store: {
        id: Number(s.id),
        name: s.name,
        businessDayStart: s.business_day_start || '05:00',
        taxRate: Number(s.tax_rate) || 10,
        otoshiName: s.otoshi_name || 'お通し',
        otoshiPrice: Number(s.otoshi_price) || 0,
        seatCharge: Number(s.seat_charge) || 0,
        serviceRate: Number(s.service_rate) || 0,
        invoiceNo: s.invoice_no || '',
        receiptNote: s.receipt_note || '',
        tel: s.tel || '',
        address: s.address || '',
        // 天気の取得に使う場所。緯度・経度が入っていないと天気は取りに行かない。
        postalCode: s.postal_code || '',
        prefecture: s.prefecture || '',
        city: s.city || '',
        building: s.building || '',
        lat: s.lat === null || s.lat === undefined ? null : Number(s.lat),
        lng: s.lng === null || s.lng === undefined ? null : Number(s.lng),
        timezone: s.timezone || 'Asia/Tokyo',
        geoSource: s.geo_source || '',
        geoUpdatedAt: s.geo_updated_at || '',
        // 必要な人手を出すときの目安（店の作りで変わるので店ごとに持つ）
        guestsPerStaff: Number(s.guests_per_staff) || 12,
        minStaff: Number(s.min_staff) || 2,
      },
    });
  } catch (e) {
    return apiFail(e);
  }
}

/** 会計金額に直結する設定なので、変更は必ず記録に残す */
export async function PATCH(req) {
  try {
    const ctx = requireRole(await requireAuth(), MANAGE_ROLES);
    const b = await req.json();
    const before = await myStore(ctx);

    // ── 住所から地図上の位置を割り出す（天気はこの位置で取りに行く）
    if (b.action === 'geocode') {
      const q = [before.prefecture, before.city, b.address ?? before.address].filter(Boolean).join('');
      const hit = await geocodeJp(q || (b.address ?? before.address));
      if (!hit) {
        throw new ApiError(
          'NOT_FOUND',
          '住所から場所を特定できませんでした。番地までご入力いただくか、地図上の位置を直接ご指定ください。'
        );
      }
      return NextResponse.json({ ok: true, ...hit });
    }

    const otoshiName = String(b.otoshiName ?? before.otoshi_name ?? 'お通し').trim().slice(0, 60) || 'お通し';
    const otoshiPrice = Math.max(0, Math.min(100000, Math.floor(Number(b.otoshiPrice) || 0)));
    const seatCharge = Math.max(0, Math.min(100000, Math.floor(Number(b.seatCharge) || 0)));
    // サービス料は上限を設ける（打ち間違いで「100%」になると、その場でお客様に説明できない）
    const serviceRate = Math.max(0, Math.min(30, Math.floor(Number(b.serviceRate) || 0)));
    const invoiceNo = String(b.invoiceNo ?? before.invoice_no ?? '').trim().toUpperCase().slice(0, 20);
    if (invoiceNo && !/^T\d{13}$/.test(invoiceNo)) {
      throw new ApiError('BAD_REQUEST', '登録番号は T のあとに数字13桁で入力してください（例：T1234567890123）');
    }
    const receiptNote = String(b.receiptNote ?? before.receipt_note ?? '').slice(0, 200);
    // レシートの上に刷る店の連絡先（無くても会計はできる）
    const tel = String(b.tel ?? before.tel ?? '').trim().slice(0, 30);
    const address = String(b.address ?? before.address ?? '').trim().slice(0, 100);

    // ── 場所（天気の取得に使う）
    const postalCode = String(b.postalCode ?? before.postal_code ?? '').replace(/[^0-9-]/g, '').slice(0, 8);
    const prefecture = String(b.prefecture ?? before.prefecture ?? '').trim().slice(0, 20);
    const city = String(b.city ?? before.city ?? '').trim().slice(0, 40);
    const building = String(b.building ?? before.building ?? '').trim().slice(0, 60);
    const num = (v, lo, hi, prev) => {
      if (v === undefined || v === null || v === '') return prev ?? null;
      const n = Number(v);
      if (!Number.isFinite(n) || n < lo || n > hi) {
        throw new ApiError('BAD_REQUEST', '地図上の位置が正しくありません。もう一度ご指定ください。');
      }
      return Math.round(n * 1e6) / 1e6;
    };
    const lat = num(b.lat, -90, 90, before.lat);
    const lng = num(b.lng, -180, 180, before.lng);
    const geoMoved = String(lat) !== String(before.lat ?? '') || String(lng) !== String(before.lng ?? '');
    const geoSource = geoMoved ? String(b.geoSource || 'manual') : (before.geo_source || '');
    const geoUpdatedAt = geoMoved ? nowIso() : (before.geo_updated_at || '');

    // ── 人手の目安。0人や100人といった値が入ると、必要人数の目安が意味をなさなくなるので幅を決めておく。
    const clamp = (v, lo, hi, prev) => {
      if (v === undefined || v === null || v === '') return prev;
      return Math.max(lo, Math.min(hi, Math.floor(Number(v) || prev)));
    };
    const guestsPerStaff = clamp(b.guestsPerStaff, 4, 40, Number(before.guests_per_staff) || 12);
    const minStaff = clamp(b.minStaff, 1, 20, Number(before.min_staff) || 2);

    await run(
      `UPDATE stores SET otoshi_name = ?, otoshi_price = ?, seat_charge = ?, service_rate = ?, invoice_no = ?, receipt_note = ?, tel = ?, address = ?,
              postal_code = ?, prefecture = ?, city = ?, building = ?, lat = ?, lng = ?, geo_source = ?, geo_updated_at = ?,
              guests_per_staff = ?, min_staff = ?
        WHERE id = ? AND tenant_id = ?`,
      [otoshiName, otoshiPrice, seatCharge, serviceRate, invoiceNo, receiptNote, tel, address,
       postalCode, prefecture, city, building, lat, lng, geoSource, geoUpdatedAt,
       guestsPerStaff, minStaff,
       ctx.storeId, ctx.tenantId]
    );

    await logAudit(ctx, {
      action: 'store.update', targetType: 'store', targetId: ctx.storeId,
      before: {
        お通し: `${before.otoshi_name || 'お通し'} ${Number(before.otoshi_price) || 0}円`,
        席料: Number(before.seat_charge) || 0,
        サービス料: `${Number(before.service_rate) || 0}%`,
        登録番号: before.invoice_no || '',
        場所: before.lat && before.lng ? `${before.lat},${before.lng}` : '未設定',
      },
      after: {
        お通し: `${otoshiName} ${otoshiPrice}円`,
        席料: seatCharge,
        サービス料: `${serviceRate}%`,
        登録番号: invoiceNo,
        場所: lat && lng ? `${lat},${lng}` : '未設定',
      },
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return apiFail(e);
  }
}
