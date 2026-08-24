import { NextResponse } from 'next/server';
import { one } from '@/lib/db/client';
import { recalcWeights, recordSalesResult } from '@/lib/learning';

export const dynamic = 'force-dynamic';

function numOrUndef(v: unknown): number | undefined {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

/** 実売結果の登録。入れるほど、次の採点が実績に寄っていく */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  try {
    const product = await one(`SELECT id FROM products WHERE id = ?`, [params.id]);
    if (!product) return NextResponse.json({ error: '商品が見つかりません' }, { status: 404 });

    const body = await req.json();
    await recordSalesResult({
      productId: params.id,
      periodStart: body.periodStart || undefined,
      periodEnd: body.periodEnd || undefined,
      revenueJpy: numOrUndef(body.revenueJpy),
      unitsSold: numOrUndef(body.unitsSold),
      profitJpy: numOrUndef(body.profitJpy),
      adSpendJpy: numOrUndef(body.adSpendJpy),
      cvr: numOrUndef(body.cvr),
      sessions: numOrUndef(body.sessions),
      returnRate: numOrUndef(body.returnRate),
      inventoryTurnoverDays: numOrUndef(body.inventoryTurnoverDays),
      stockoutDays: numOrUndef(body.stockoutDays),
      bsrChange: numOrUndef(body.bsrChange),
      enteredBy: 'admin',
    });

    const learned = await recalcWeights();
    return NextResponse.json({ ok: true, learned });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
