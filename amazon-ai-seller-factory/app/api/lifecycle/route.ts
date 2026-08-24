import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import {
  advanceLifecycle,
  approveCandidate,
  lifecycleCounts,
  lifecycleList,
  lifecycleWithEvents,
  markFailed,
  recordActuals,
} from '@/lib/learning/lifecycle';
import { evaluateLifecycle } from '@/lib/learning/forecastAccuracy';
import { financeOf, saveFinance } from '@/lib/finance/ledger';
import { refreshAllReorders, saveStock } from '@/lib/inventory/stockLedger';
import { seedLateralExploration } from '@/lib/learning/postmortem';
import { config } from '@/lib/env';
import type { FailureReason, LifecycleStatus } from '@/lib/types';

export const dynamic = 'force-dynamic';

/**
 * 商品の一生（発見→承認→発注→入荷→出品→販売→実績）を扱う入口。
 *
 * ★ここでは1円も動かない。「承認」も“予測を凍結して記録する”だけで、
 *   外部への発注は行わない（実際の注文は仕入先サイトでご自身で行う）。
 */

export async function GET(req: Request) {
  try {
    await migrate();
    const url = new URL(req.url);
    const id = url.searchParams.get('id');
    if (id) return NextResponse.json(await lifecycleWithEvents(id));

    const status = url.searchParams.get('status') || undefined;
    const [rows, counts] = await Promise.all([
      lifecycleList({ status, limit: Number(url.searchParams.get('limit')) || 200 }),
      lifecycleCounts(),
    ]);
    return NextResponse.json({ rows, counts });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const action = String(body?.action || '');

    // ★念のための二重ロック：自動発注が有効なら何も進めない
    if (config.autoPurchase) {
      return NextResponse.json(
        { error: 'AUTO_PURCHASE=true になっています。安全のため操作を中止しました（false に戻してください）' },
        { status: 400 },
      );
    }

    switch (action) {
      case 'approve': {
        const res = await approveCandidate({
          researchCandidateId: String(body.candidateId || ''),
          qty: body.qty != null ? Number(body.qty) : null,
          actor: body.actor || 'human',
          note: body.note || undefined,
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'advance': {
        const res = await advanceLifecycle({
          lifecycleId: String(body.lifecycleId || ''),
          to: String(body.to || '') as LifecycleStatus,
          actor: body.actor || 'human',
          note: body.note || undefined,
          data: body.data || undefined,
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'actuals': {
        const res = await recordActuals({
          lifecycleId: String(body.lifecycleId || ''),
          unitsSold: Number(body.unitsSold) || 0,
          avgPriceJpy: Number(body.avgPriceJpy) || 0,
          adCostJpy: Number(body.adCostJpy) || 0,
          profitJpy: Number(body.profitJpy) || 0,
          returns: Number(body.returns) || 0,
          sellDays: body.sellDays != null ? Number(body.sellDays) : null,
          actor: body.actor || 'human',
        });
        // 実績が入ったら、その場で予測精度を計算し直す
        const accuracy = res.ok ? await evaluateLifecycle(String(body.lifecycleId)) : null;
        return NextResponse.json({ ...res, accuracy }, { status: res.ok ? 200 : 400 });
      }

      // ★実費（12項目）と入出金の記録。ここでもお金は動かない。
      case 'finance': {
        const res = await saveFinance({
          lifecycleId: String(body.lifecycleId || ''),
          costs: body.costs || undefined,
          grossSalesJpy: body.grossSalesJpy,
          cashPaidJpy: body.cashPaidJpy,
          cashPaidAt: body.cashPaidAt,
          payoutExpectedJpy: body.payoutExpectedJpy,
          payoutExpectedAt: body.payoutExpectedAt,
          inventoryValueJpy: body.inventoryValueJpy,
          adUnrecoveredJpy: body.adUnrecoveredJpy,
          cashReceivedJpy: body.cashReceivedJpy,
          actor: body.actor || 'human',
        });
        const view = res.ok ? await financeOf(String(body.lifecycleId)) : null;
        return NextResponse.json({ ...res, view }, { status: res.ok ? 200 : 400 });
      }

      // ★在庫・販売数の記録と補充判断。AUTO_REORDER=false なので発注は起きない。
      case 'stock': {
        const res = await saveStock({
          lifecycleId: String(body.lifecycleId || ''),
          stockUnits: body.stockUnits,
          units7d: body.units7d,
          units30d: body.units30d,
          leadTimeDays: body.leadTimeDays,
          supplierStockUnits: body.supplierStockUnits,
          supplierPriceChangePct: body.supplierPriceChangePct,
          seasonality: body.seasonality,
          adState: body.adState,
          actor: body.actor || 'human',
        });
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'reorder_refresh': {
        const res = await refreshAllReorders();
        return NextResponse.json({
          ok: true,
          ...res,
          message:
            `${res.updated}件の補充判断を計算し直しました（いま発注${res.now}件・もうすぐ${res.soon}件）。` +
            `★このシステムは発注しません（AUTO_REORDER=${String(config.autoReorder)}）`,
        });
      }

      case 'fail': {
        const reasons: FailureReason[] = Array.isArray(body.reasons) ? body.reasons : [];
        const res = await markFailed(String(body.lifecycleId || ''), reasons, body.note, body.actor);
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'seed_lateral': {
        const res = await seedLateralExploration({
          lifecycleId: String(body.lifecycleId || ''),
          originAsin: body.asin ?? null,
          title: body.title ?? null,
          category: body.category ?? null,
          supplier: body.supplier ?? null,
        });
        return NextResponse.json({
          ok: true,
          ...res,
          message: `次に掘る方向を${res.created}件つくりました（重複${res.skipped}件は作りませんでした）`,
        });
      }

      default:
        return NextResponse.json({ error: '知らない操作です' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
