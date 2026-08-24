import { NextResponse } from 'next/server';
import { startRun } from '@/lib/workflow';
import { getLatestRun } from '@/lib/db/queries';

export const dynamic = 'force-dynamic';

export async function POST() {
  try {
    const latest = await getLatestRun();
    if (latest && String(latest.status) === 'running') {
      return NextResponse.json({ error: 'すでに作業中です。終わるまでお待ちください。' }, { status: 409 });
    }
    const runId = await startRun('manual', 1);
    return NextResponse.json({ runId });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
