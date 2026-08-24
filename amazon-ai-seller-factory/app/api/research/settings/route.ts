import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import { loadResearchSettings, saveResearchSettings } from '@/lib/research/settings';

export const dynamic = 'force-dynamic';

export async function GET() {
  await migrate();
  return NextResponse.json(await loadResearchSettings());
}

export async function POST(req: Request) {
  try {
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const patch: any = {};
    const nums = [
      'minMonthlySales',
      'minProfitJpy',
      'minProfitRate',
      'minRoi',
      'maxSellerCount',
      'matchAutoScore',
      'matchReviewScore',
      'maxVisionCalls',
      'expandDepth',
      'expandLimit',
      'oemMinMonthlySales',
      // ---- 第3段階：定期実行・見張り・お金・鮮度・学習 ----
      'watchIntervalAMin',
      'watchIntervalBMin',
      'watchIntervalCMin',
      'monthlyBudgetJpy',
      'budgetStopRatio',
      'maxDataAgeHours',
      'minConfidenceForA',
      'minSamplesForBias',
      'safetyStockDays',
      'maxFirstOrderQty',
    ];
    for (const k of nums) if (body?.[k] !== undefined && body[k] !== '') patch[k] = Number(body[k]);
    if (body?.fulfillment) patch.fulfillment = body.fulfillment === 'fba' ? 'fba' : 'fbm';

    // 毎日の実行時刻は "09:00" 形式だけ受け付ける（変な値で予定表を壊さない）
    if (typeof body?.dailyRunTime === 'string' && /^\d{2}:\d{2}$/.test(body.dailyRunTime)) {
      patch.dailyRunTime = body.dailyRunTime;
    }
    for (const k of ['autoRunEnabled', 'watchDEnabled', 'categoryBiasEnabled']) {
      if (typeof body?.[k] === 'boolean') patch[k] = body[k];
    }

    const saved = await saveResearchSettings(patch);
    return NextResponse.json(saved);
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
