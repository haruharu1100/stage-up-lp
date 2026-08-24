import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import { accountHealth, saveAccountHealth } from '@/lib/account/health';
import { adWeeklyList, saveAdWeek } from '@/lib/ads/adLedger';
import {
  deleteShipment,
  markShipped,
  notifyShipDeadlines,
  saveShipment,
  shipSummary,
  shipmentQueue,
} from '@/lib/ops/shipDeadline';
import { config } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * アカウント保護の入口（広告の週次点検・アカウント健全性・出荷期限）。
 *
 * ★ここでもお金は動かない。広告の入札も自動では変えない（AD_AUTO_OPTIMIZE=false）。
 */

export async function GET() {
  try {
    await migrate();
    const [health, ads, ships, summary] = await Promise.all([
      accountHealth(),
      adWeeklyList(60),
      shipmentQueue(200),
      shipSummary(),
    ]);
    return NextResponse.json({ health, ads, ships, summary });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const action = String(body?.action || '');

    switch (action) {
      // ---- 広告の週次点検（★入札は変えない）----------------------------
      case 'ad_week': {
        if (config.adAutoOptimize) {
          return NextResponse.json(
            { error: 'AD_AUTO_OPTIMIZE=true になっています。安全のため操作を中止しました（false に戻してください）' },
            { status: 400 },
          );
        }
        const res = await saveAdWeek({
          lifecycleId: body.lifecycleId ?? null,
          weekStart: String(body.weekStart || ''),
          adCostJpy: body.adCostJpy,
          adSalesJpy: body.adSalesJpy,
          organicSalesJpy: body.organicSalesJpy,
          impressions: body.impressions,
          clicks: body.clicks,
          orders: body.orders,
          unitsSold: body.unitsSold,
          stockUnits: body.stockUnits,
          unitMarginJpy: body.unitMarginJpy,
          sellPriceJpy: body.sellPriceJpy,
          actor: body.actor || 'human',
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      // ---- アカウント健全性（人がセラーセントラルから転記）--------------
      case 'account_health': {
        const res = await saveAccountHealth({
          measuredOn: body.measuredOn,
          orderDefectRate: body.orderDefectRate,
          lateShipmentRate: body.lateShipmentRate,
          preFulfillmentCancelRate: body.preFulfillmentCancelRate,
          validTrackingRate: body.validTrackingRate,
          returnRate: body.returnRate,
          refundRate: body.refundRate,
          accountWarnings: body.accountWarnings,
          policyViolations: body.policyViolations,
          ipComplaints: body.ipComplaints,
          note: body.note,
          enteredBy: body.actor || 'human',
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      // ---- 出荷期限 -----------------------------------------------------
      case 'shipment_save': {
        const res = await saveShipment({
          orderId: body.orderId ?? null,
          lifecycleId: body.lifecycleId ?? null,
          title: body.title ?? null,
          qty: body.qty ?? null,
          orderedAt: body.orderedAt ?? null,
          shipByDate: String(body.shipByDate || ''),
          deliverByDate: body.deliverByDate ?? null,
          fulfillment: body.fulfillment ?? 'FBM',
          note: body.note ?? null,
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'shipment_shipped': {
        const res = await markShipped({
          id: String(body.id || ''),
          carrier: body.carrier ?? null,
          trackingNumber: body.trackingNumber ?? null,
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'shipment_delete': {
        const res = await deleteShipment(String(body.id || ''));
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'ship_notify': {
        const res = await notifyShipDeadlines();
        return NextResponse.json({
          ok: true,
          ...res,
          message: res.sent
            ? `通知を送りました：${res.summary.headline}`
            : `いま急ぎの発送はありません（${res.summary.headline}）`,
        });
      }

      default:
        return NextResponse.json({ error: '知らない操作です' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
