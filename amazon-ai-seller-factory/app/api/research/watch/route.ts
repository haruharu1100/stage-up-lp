import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import { reevaluateWatchList } from '@/lib/research/watch';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * B/Cランクの再評価。
 * ★価格と競合数を見直してAランクへ上げるだけ。仕入れは一切しない。
 */
export async function POST(req: Request) {
  try {
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const result = await reevaluateWatchList({ limit: Number(body?.limit) || 100 });
    return NextResponse.json(result);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
