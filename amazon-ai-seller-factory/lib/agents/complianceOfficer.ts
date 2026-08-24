import { all, insert, newId, nowIso } from '../db/client';
import { runCompliance } from '../compliance';
import { bestQuoteFor } from '../sourcing';
import type { RunLogger } from '../logger';
import type { ComplianceResult, ListingPlan, ProductCore } from '../types';

/**
 * AI社員07：コンプライアンス担当。
 * ワークフローの2箇所で走る。
 *   phase=pre  … 作り込む前（そもそも売れる商品か）
 *   phase=final… 出品直前（文章・画像まで含めて）
 * blocking が1つでもあれば AUTO PUBLISH は止まる。
 */
export async function runComplianceCheck(
  runId: string,
  logger: RunLogger,
  product: ProductCore,
  phase: 'pre' | 'final',
  plan?: ListingPlan | null,
): Promise<ComplianceResult> {
  const masters = await all(`SELECT rights_source FROM master_images WHERE product_id = ?`, [product.id]);
  const result = runCompliance({
    product,
    plan: plan ?? null,
    hasMasterImage: masters.length > 0,
    masterImageRights: masters.length ? String(masters[0].rights_source) : null,
    gtin: product.gtin,
    // 仕入先が海外なら輸入規制（食品衛生法・薬機法・PSE・技適）も一緒に点検する
    quote: bestQuoteFor(product),
  });

  await insert('compliance_checks', {
    id: newId('cc'),
    product_id: product.id,
    run_id: runId,
    phase,
    verdict: result.verdict,
    blocking_count: result.blockingCount,
    warning_count: result.warningCount,
    items: JSON.stringify(result.items),
    checked_at: nowIso(),
  });

  const failed = result.items.filter((i) => !i.passed);
  const summary =
    result.verdict === 'pass'
      ? 'コンプライアンス：問題は見つかりませんでした'
      : `コンプライアンス：停止${result.blockingCount}件／注意${result.warningCount}件 — ${failed
          .slice(0, 4)
          .map((f) => f.check)
          .join('、')}`;

  if (result.verdict === 'block') {
    await logger.needsReview('compliance', phase === 'pre' ? 'Compliance' : 'FinalCheck', summary);
  } else {
    await logger.log('compliance', result.verdict === 'warn' ? 'warn' : 'info', summary);
  }

  return result;
}
