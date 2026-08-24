import { NextResponse } from 'next/server';
import { migrate } from '@/lib/db/client';
import { runResearch } from '@/lib/research/pipeline';
import { config } from '@/lib/env';
import {
  DISCOVERY_MODES,
  DISCOVERY_MODE_LABEL,
  discoveryProviderStatus,
  type DiscoveryMode,
} from '@/lib/providers/supplierDiscovery';
import { discoveryLimits } from '@/lib/research/discoveryFilter';
import { discoveryCostReport } from '@/lib/research/discoveryCost';

export const dynamic = 'force-dynamic';
export const maxDuration = 300;

/**
 * 仕入先の自動探索（Supplier Discovery）を1回まわす。
 *
 * ★ここは「システムが自分で安い商品を探して、Amazonと突き合わせて並べる」だけ。
 *   仕入れ発注も出品公開も絶対に起きない（AUTO_PURCHASE は既定 false）。
 */

/** GET = いま何が自動探索できるかを見るだけ（APIは1回も叩かない） */
export async function GET() {
  const status = discoveryProviderStatus();
  const supplier = status.filter((p) => p.purpose === 'SUPPLIER_DISCOVERY');
  const market = status.filter((p) => p.purpose === 'MARKET_DISCOVERY');
  // 1件の利益商品を見つけるのにいくらかかっているか（DBを読むだけ。APIは叩かない）
  const cost = await discoveryCostReport(30).catch(() => null);
  return NextResponse.json({
    providers: status,
    /** ★仕入先として本当に動くものが1つでもあるか。市場調査Providerは数えない */
    liveReady: supplier.some((p) => p.enabled),
    marketReady: market.some((p) => p.enabled),
    supplierProviders: supplier,
    marketProviders: market,
    modes: DISCOVERY_MODES.map((m) => ({ value: m, label: DISCOVERY_MODE_LABEL[m] })),
    limits: discoveryLimits(),
    costPerWinner: cost,
  });
}

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

    const mode: DiscoveryMode = DISCOVERY_MODES.includes(body?.mode) ? body.mode : 'STANDARD';
    const limits = discoveryLimits();
    const maxDiscover = Math.min(limits.maxDiscoveryItems, Math.max(1, Number(body?.maxDiscover) || limits.maxDiscoveryItems));
    const maxAmazonChecks = Math.min(limits.maxAmazonChecks, Math.max(1, Number(body?.maxAmazonChecks) || limits.maxAmazonChecks));
    const keywords = Array.isArray(body?.keywords)
      ? body.keywords.map((s: any) => String(s).trim()).filter(Boolean).slice(0, 20)
      : typeof body?.keyword === 'string' && body.keyword.trim()
        ? [body.keyword.trim()]
        : undefined;
    // ★既定は BOTH（Amazon→仕入先を先に回す）。指定があればそれに従う。
    const direction =
      body?.direction === 'AMAZON_TO_SUPPLIER' || body?.direction === 'SUPPLIER_TO_AMAZON' ? body.direction : 'BOTH';

    // ★仕入先Providerだけを数える。市場調査（Yahoo!）が動いていても「探せる」ことにしない。
    const providers = discoveryProviderStatus().filter((p) => p.enabled && p.purpose === 'SUPPLIER_DISCOVERY');
    if (!providers.length) {
      // ★「探せない」を成功扱いにしない。何を用意すればいいかをそのまま返す。
      return NextResponse.json(
        {
          error:
            '自動探索できる仕入先が1つもありません' +
            '（Yahoo!ショッピングは市場調査用であり、仕入先ではないためここには数えていません）',
          needs: discoveryProviderStatus().map((p) => ({
            name: p.name,
            purpose: p.purpose,
            purposeLabel: p.purposeLabel,
            readiness: p.readiness,
            reason: p.readinessReason,
            needs: p.needs,
          })),
        },
        { status: 409 },
      );
    }

    const result = await runResearch({
      limit: maxAmazonChecks,
      trigger: body?.trigger || 'discover',
      settings: body?.fulfillment ? { fulfillment: body.fulfillment === 'fba' ? 'fba' : 'fbm' } : undefined,
      discovery: {
        mode,
        keywords,
        category: typeof body?.category === 'string' && body.category.trim() ? body.category.trim() : null,
        minPriceJpy: Number.isFinite(Number(body?.minPriceJpy)) ? Number(body.minPriceJpy) : null,
        maxPriceJpy: Number.isFinite(Number(body?.maxPriceJpy)) ? Number(body.maxPriceJpy) : null,
        maxDiscover,
        maxAmazonChecks,
        direction,
      },
    });

    return NextResponse.json({ summary: result.summary, count: result.candidates.length });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || String(err) }, { status: 500 });
  }
}
