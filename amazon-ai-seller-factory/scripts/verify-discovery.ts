/**
 * 自動探索まわりの「配線が本当に正しいか」を、サーバーを立てずに確かめる検証スクリプト。
 *
 * ★確かめること（お金は1円も動かない／外部APIは1回も叩かない）
 *   1. 仕入先Provider と 市場調査Provider が正しく分かれているか
 *   2. Yahoo!が「仕入先」として絶対に選ばれないか
 *   3. 鍵が無い状態で liveReady が false のままか（＝鍵なしをLIVE扱いしない）
 *   4. Amazon→仕入先の「種」選びの条件が意図どおりか
 *   5. 利益商品1件あたりの費用が、実績0件のときに勝手な数字を出さないか
 *
 * 実行： npx tsc -p tsconfig.verify.json && node .verify/scripts/verify-discovery.js
 */
import {
  discoveryProviderStatus,
  getDiscoveryProviders,
  getMarketDiscoveryProviders,
  discoveryLiveReady,
  discoveryLiveReadyReason,
  marketDiscoveryReady,
  DISCOVERY_PURPOSE_LABEL,
} from '../lib/providers/supplierDiscovery';
import { providerVerifiedApis } from '../lib/providers/apiContractRegistry';
import { reverseSeedGate } from '../lib/research/discoveryRun';
import { discoveryCostReport, estimateDiscoveryCostJpy, DIRECTION_LABEL } from '../lib/research/discoveryCost';

const fails: string[] = [];
const ok = (cond: boolean, label: string) => {
  console.log(`${cond ? '  OK  ' : '  NG  '} ${label}`);
  if (!cond) fails.push(label);
};

async function main() {
  console.log('=== 1. Providerの役割分け ===');
  for (const p of discoveryProviderStatus()) {
    console.log(
      `  ${p.name.padEnd(22)} ${p.readiness.padEnd(22)} ${DISCOVERY_PURPOSE_LABEL[p.purpose]}` +
        `  ${p.enabled ? '★使用中' : '未使用'}`,
    );
  }

  const supplierNames = getDiscoveryProviders().map((p) => p.name);
  const marketNames = getMarketDiscoveryProviders().map((p) => p.name);
  const all = discoveryProviderStatus();

  console.log('\n=== 2. 安全の確認 ===');
  ok(!supplierNames.includes('yahoo'), 'Yahoo!は仕入先として選ばれない（国内小売価格を仕入値にしない）');
  ok(
    all.find((p) => p.name === 'yahoo')?.purpose === 'MARKET_DISCOVERY',
    'Yahoo!の役割が「市場調査・価格比較」になっている',
  );
  ok(
    !!all.find((p) => p.name === 'aliexpress_affiliate'),
    'AliExpressアフィリエイト枠が登録されている（★2026-08-20訂正：アクセストークンは必要）',
  );
  ok(
    all.every((p) => !!p.purpose),
    'すべてのProviderが「仕入先／市場調査」のどちらかを持っている',
  );
  ok(
    all.filter((p) => p.isReal).length === supplierNames.length + marketNames.length,
    '本物として動くProviderの数が、仕入先＋市場調査の合計と一致する',
  );

  console.log('\n=== 3. 鍵が無い状態の表示 ===');
  const liveReady = await discoveryLiveReady();
  console.log(`  仕入先の自動探索ができる（LIVE_DISCOVERY_READY）：${liveReady}`);
  console.log(`  その理由：${await discoveryLiveReadyReason()}`);
  console.log(`  市場調査ができる：${marketDiscoveryReady()}`);
  const anyKey = !!(process.env.ALIEXPRESS_APP_KEY || process.env.ALIBABA_APP_KEY);
  ok(
    anyKey || liveReady === false,
    '鍵が1つも無いなら LIVE_DISCOVERY_READY は false のまま（鍵なしを完成扱いしない）',
  );
  // ★4段階ゲート：実データまで確認できたAPIが1つも無ければ、鍵があっても false
  const verified = await providerVerifiedApis('aliexpress').catch(() => [] as string[]);
  ok(
    verified.length > 0 || liveReady === false,
    '実データまで確認できたAPIが0件なら LIVE_DISCOVERY_READY は false（コードがあるだけを完成扱いしない）',
  );
  for (const p of all.filter((x) => !x.enabled)) {
    ok(!!p.needs && !!p.readinessReason, `${p.name}：使えない理由と、必要なものが日本語で出ている`);
  }

  console.log('\n=== 4. Amazon→仕入先の「種」の条件 ===');
  const gate = reverseSeedGate();
  console.log(`  推定月販 ${gate.minMonthlySales}個以上`);
  console.log(`  出品者 ${gate.maxSellers}人以下`);
  console.log(`  30日平均と90日平均の差 ${gate.maxPriceSwingPct}%以内`);
  console.log('  Amazon本体が売っている商品は種にしない');
  ok(gate.minMonthlySales >= 10, '月販の下限が10個以上（指示どおり）');

  console.log('\n=== 5. 利益商品1件あたりの費用 ===');
  console.log(`  Amazon照合20件ぶんの費用の見積り：${estimateDiscoveryCostJpy({ amazonChecked: 20 })}円`);
  const rep = await discoveryCostReport(30).catch((e) => {
    console.log(`  （集計できませんでした：${e?.message ?? e}）`);
    return null;
  });
  if (rep) {
    for (const d of rep.byDirection) {
      console.log(`  ${DIRECTION_LABEL[d.direction]}`);
      console.log(
        `    調べた${d.amazonChecked}件／一致${d.highMatch}件／利益商品${d.winners}件／` +
          `費用${d.estCostJpy}円／1件あたり${d.costPerWinnerJpy === null ? '（まだ出せません）' : `${d.costPerWinnerJpy}円`}`,
      );
      console.log(`    ${d.note}`);
    }
    console.log(`  結論：${rep.headline}`);
    ok(
      rep.byDirection.every((d) => (d.winners === 0 ? d.costPerWinnerJpy === null : true)),
      '利益商品が0件の向きは「1件あたり◯円」をでっち上げない',
    );
    ok(
      rep.cheaperDirection === null || rep.byDirection.filter((d) => d.reliable).length >= 2,
      '実績が足りないうちは、どちらが安いかの結論を出さない',
    );
  }

  console.log('\n==============================');
  if (fails.length) {
    console.log(`★${fails.length}件が想定どおりではありません：`);
    for (const f of fails) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('すべて想定どおりです（外部APIは1回も使っていません）');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
