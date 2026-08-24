import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import { runResearch } from '@/lib/research/pipeline';
import { config } from '@/lib/env';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * リサーチを1回まわす。
 * ★ここは「探して並べる」だけ。仕入れ発注も出品公開も絶対に起きない。
 *   AUTO_PURCHASE / RESEARCH_AUTO_APPROVE は既定 false。
 */
export async function POST(req: Request) {
  try {
    if (config.autoPurchase) {
      return NextResponse.json(
        { error: 'AUTO_PURCHASE=true になっています。自動発注は許可されていないため実行を中止しました' },
        { status: 400 },
      );
    }
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const limit = Math.min(2000, Math.max(1, Number(body?.limit) || 60));
    const keyword = typeof body?.keyword === 'string' && body.keyword.trim() ? body.keyword.trim() : null;

    const result = await runResearch({
      limit,
      keyword,
      trigger: body?.trigger || 'manual',
      settings: body?.fulfillment ? { fulfillment: body.fulfillment === 'fba' ? 'fba' : 'fbm' } : undefined,
    });

    return NextResponse.json({ summary: result.summary, count: result.candidates.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
