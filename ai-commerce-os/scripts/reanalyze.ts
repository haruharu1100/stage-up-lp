/** 全商品を現在のしきい値で判定しなおす。取込はしない。 */
import { runAnalyze } from '../lib/pipeline/analyze';
import { rebuildPremiumRatioStats } from '../lib/pricing';
import { ruleVersion } from '../lib/settings';
import { ensureReady } from '../lib/queries';

async function main() {
  await ensureReady();
  await rebuildPremiumRatioStats();
  const rv = await ruleVersion();
  const stats = await runAnalyze({ force: true });
  console.log(`判定ルール版: ${rv}`);
  console.log(`対象 ${stats.targetCount}件 / 分析 ${stats.analyzed}件 / 仕入候補 ${stats.profitable}件 / 除外 ${stats.skipped}件 / 人間確認まち ${stats.manualReview}件`);
  console.log('判定内訳:', stats.byDecision);
  console.log('除外理由:', stats.bySkipReason);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
