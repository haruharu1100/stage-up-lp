import { NextResponse } from 'next/server';
import { runDiscovery } from '@/lib/agents/hunter';
import type { FulfillmentMode } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 商品発掘バッチ。
 * ★ここは「調べて並べる」だけ。仕入れ発注も出品公開も一切しない。
 */
export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({} as any));
    const limit = Math.min(1000, Math.max(1, Number(body?.limit) || 30));
    const fulfillment: FulfillmentMode = body?.fulfillment === 'fba' ? 'fba' : 'fbm';
    const asins: string[] | undefined = Array.isArray(body?.asins)
      ? body.asins.map((a: unknown) => String(a).trim()).filter(Boolean)
      : undefined;

    const result = await runDiscovery({ limit, fulfillment, asins });
    return NextResponse.json({
      runId: result.runId,
      source: result.source,
      summary: result.summary,
      notes: result.notes,
      count: result.rows.length,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
