/** 全市場 × 全市場のRouteを作りなおす。買わない・出品しない。計算とSHADOW記録だけ。 */
import { runRoutes } from '../lib/pipeline/routes';
import { ensureReady } from '../lib/queries';

function pct(v: number | null): string {
  return v === null ? '—' : `${(v * 100).toFixed(1)}%`;
}

async function main() {
  await ensureReady();
  const s = await runRoutes();
  console.log(`ルール版: ${s.ruleVersion}`);
  console.log(`対象商品 ${s.products}件 / 組み合わせ計算 ${s.combinationsTried}回`);
  console.log(`保存Route ${s.routesGenerated}件（使える ${s.routesOk} / 規約や仕様で使えない ${s.routesBlocked}）`);
  console.log(`ベストRouteが決まった商品 ${s.productsWithRoute}件 / SHADOW記録 ${s.shadowOpened}件`);
  console.log(`最高ROI ${pct(s.bestRoi)} / 平均ROI ${pct(s.avgRoi)}`);
  console.log(`使えないが儲かる組み合わせ ${s.blockedProfitable}件`);
  const pairs = Object.entries(s.byPair).sort((a, b) => b[1] - a[1]).slice(0, 10);
  console.log('多い組み合わせ:', Object.fromEntries(pairs));
  console.log('除外理由:', s.bySkipReason);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
