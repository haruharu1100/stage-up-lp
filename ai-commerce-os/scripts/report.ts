import { buildDailyReport } from '../lib/dailyreport';
import { migrate } from '../lib/db/client';
import { REACHABILITY_JA, halfLifeTable } from '../lib/halflife';
import { ensureReady } from '../lib/queries';

/**
 * 毎日のSHADOWレポート（Phase 3.5・§24 §25）。
 *
 *   npm run report
 *
 * 一番上の1行だけ読めば、今日お金を動かしてよいかが分かるようにしてある。
 * 数字が良くても、卒業条件を1つでも満たしていなければ「まだ実購入に進めません」と出る。
 */

const pct = (v: number | null) => (v === null ? '測定不能' : `${(v * 100).toFixed(1)}%`);

async function main() {
  await migrate();
  // 手数料の状態は「今日から見て何日前に確認したか」で変わる。
  // レポートを出す前に必ず計算し直す（古い状態のまま結論を出さない）。
  await ensureReady();
  // 実行したときだけ判定結果を履歴に残す（画面を開いただけでは残さない）。
  const r = await buildDailyReport(new Date(), true);

  console.log('='.repeat(72));
  console.log(`【${r.date} の結論】`);
  console.log(`  ${r.headline}`);
  console.log('='.repeat(72));

  console.log('\n[今の状態]');
  for (const s of r.summary) console.log(`  ・${s}`);

  console.log('\n[Phase 4 卒業条件]');
  for (const c of r.gate.checks) {
    console.log(`  ${c.passed ? '○' : '×'} ${c.label}`);
    console.log(`      ${c.note}`);
  }
  console.log(`  → ${r.gate.passedCount} / ${r.gate.totalCount} 項目クリア`);
  console.log(`  → 人による解錠：${r.gate.humanUnlocked ? '済み' : 'まだ（AIは自分で解錠できません）'}`);

  console.log('\n[STRONG BUY に絞ったときの成績（実市場データのみ）]');
  const sb = r.precision.strongBuy;
  console.log(`  判断した件数：${sb.decidedBuy}件`);
  console.log(`  実際に利益が出た：${sb.truePositive}件／損だった：${sb.falsePositive}件`);
  console.log(`  的中率：${pct(sb.precision)}（95%下限：${pct(sb.precisionLower)}）`);
  console.log(`  見送ったが儲かっていた（取り逃し）：${sb.falseNegative}件`);
  console.log(`  ※ 損して買う間違いは、取り逃しの${r.precision.falsePositiveWeight}倍の重さで数えています`);
  if (r.precision.evaluated === 0) console.log(`  ${r.precision.note}`);

  console.log('\n[データの量]');
  console.log(`  SHADOW：全${r.realShadow.total}件／うち実市場データ ${r.realShadow.real}件（目標100件）`);
  console.log(`  相場の観測：全${r.snapshots.total}件／うち実市場データ ${r.snapshots.real}件`);
  console.log(`  価格の動きが追える組み合わせ：${r.snapshots.seriesWithHistory}件`);
  console.log(`  分散：市場の組${r.realShadow.venuePairs}通り／カテゴリ${r.realShadow.categories}種類／価格帯${r.realShadow.priceBands}区分`);
  console.log(`  手数料：実額確認済み ${r.fees.verified} / ${r.fees.total}件`);
  console.log(`  正規の自動取得ができる市場：${r.connectors.autoFetchAllowed} / ${r.connectors.total}`);

  console.log('\n[直近7日の答え合わせ]');
  console.log(
    `  判定${r.recent.evaluatedLast7d}件（売れた${r.recent.soldLast7d}／売れなかった${r.recent.notSoldLast7d}／確認できず${r.recent.unconfirmedLast7d}）`,
  );

  const hl = await halfLifeTable();
  const pairs = hl.filter((x) => String(x.segment_type) === 'pair').slice(0, 8);
  if (pairs.length > 0) {
    console.log('\n[利益機会が消えるまでの時間（人の承認が間に合うか）]');
    for (const x of pairs) {
      const half = x.half_life_hours === null ? '—' : `${Number(x.half_life_hours).toFixed(1)}時間`;
      console.log(
        `  ${String(x.segment_key).padEnd(22)} 半減期${half.padStart(9)}` +
        `（消滅実績${x.expired_count}件） ${REACHABILITY_JA[String(x.reachability) as keyof typeof REACHABILITY_JA] ?? x.reachability}`,
      );
    }
  }

  console.log('\n[次にやること（1つだけ）]');
  console.log(`  ${r.nextAction}`);

  console.log(`\n※ ${r.safety.message}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
