import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import { categoryBiasList, rebuildCategoryBias } from '@/lib/learning/categoryBias';
import { accuracyList, overallAccuracy } from '@/lib/learning/forecastAccuracy';
import { failureStats, lateralSeedList, seedFromWinners } from '@/lib/learning/postmortem';
import { decideProposal, currentWeights, proposalList, proposeWeights } from '@/lib/learning/scoreWeights';
import { loadResearchSettings } from '@/lib/research/settings';

export const dynamic = 'force-dynamic';

/**
 * 実績からの学習（予測精度・カテゴリー補正・重み提案・失敗分類・横展開）。
 *
 * ★重みの変更は「提案」までしかしない。承認するまで採点は1点も変わらない。
 * ★実績5件未満では、そもそも学習を動かさない（推測で数字をいじらないため）。
 */

export async function GET() {
  try {
    await migrate();
    const settings = await loadResearchSettings();
    const [accuracy, rows, bias, proposals, weights, failures, seeds] = await Promise.all([
      overallAccuracy(),
      accuracyList(100),
      categoryBiasList(),
      proposalList(20),
      currentWeights(),
      failureStats(),
      lateralSeedList(50),
    ]);
    return NextResponse.json({
      accuracy,
      rows,
      bias,
      proposals,
      weights,
      failures,
      seeds,
      settings: {
        minSamplesForBias: settings.minSamplesForBias,
        categoryBiasEnabled: settings.categoryBiasEnabled,
      },
      note: '★重みの変更は、あなたが承認するまで反映されません',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  try {
    await migrate();
    const body = await req.json().catch(() => ({}) as any);
    const action = String(body?.action || '');
    const settings = await loadResearchSettings();

    switch (action) {
      case 'rebuild_bias': {
        const rows = await rebuildCategoryBias(settings.minSamplesForBias);
        const applied = rows.filter((r) => r.applied).length;
        return NextResponse.json({
          ok: true,
          rows,
          message: `${rows.length}カテゴリーを見直し、${applied}件に補正をかけました（実績${settings.minSamplesForBias}件未満のカテゴリーは補正しません）`,
        });
      }

      case 'propose_weights': {
        const res = await proposeWeights(settings.minSamplesForBias);
        return NextResponse.json(res, { status: res.ok ? 200 : 200 });
      }

      case 'decide_proposal': {
        const decision = body.decision === 'approved' ? 'approved' : 'rejected';
        const res = await decideProposal(String(body.id || ''), decision, body.actor || 'human');
        return NextResponse.json(res, { status: res.ok ? 200 : 400 });
      }

      case 'seed_winners': {
        const res = await seedFromWinners();
        return NextResponse.json({
          ok: true,
          ...res,
          message: `売れた商品${res.scanned}件から、次に掘る方向を${res.created}件つくりました`,
        });
      }

      default:
        return NextResponse.json({ error: '知らない操作です' }, { status: 400 });
    }
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
