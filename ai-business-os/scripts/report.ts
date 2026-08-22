import { migrate } from '../lib/db/client';
import { buildDashboard } from '../lib/dashboard';
import { revenueByCampaign } from '../lib/funnel';

async function main() {
  await migrate();
  const d = await buildDashboard();

  console.log('===== 今日やること =====');
  if (d.recommendations.length === 0) console.log('推奨アクションなし');
  for (const r of d.recommendations) {
    console.log(`\n${r.rank}. ${r.action}`);
    console.log(`   理由: ${r.why}`);
    console.log(`   根拠: ${r.evidence}`);
    console.log(`   信頼度: ${r.confidence} / コスト: ${r.costYen.toLocaleString()}円 / データ量: ${r.dataVolume}`);
    console.log(`   期待効果: ${r.expectedEffect}`);
    console.log(`   リスク: ${r.risk}`);
  }

  console.log('\n===== 収益 =====');
  console.log(`本日 ${d.today.revenueYen.toLocaleString()}円 / 7日 ${d.last7.revenueYen.toLocaleString()}円 / 30日 ${d.last30.revenueYen.toLocaleString()}円 / 累計 ${d.allTime.revenueYen.toLocaleString()}円`);
  console.log(`MRR ${d.saas.mrrYen.toLocaleString()}円 / ARR ${d.saas.arrYen.toLocaleString()}円 / 契約 ${d.saas.activeContracts}件`);
  console.log(`LTV ${d.saas.ltvYen ?? '算出不能'} / CAC ${d.saas.cacYen ?? '算出不能'} / LTV÷CAC ${d.saas.ltvCac ?? '算出不能'} / 回収 ${d.saas.paybackMonths ?? '算出不能'}ヶ月`);

  console.log('\n===== ファネル（直近30日） =====');
  const f = d.last30;
  console.log(`Xクリック ${f.counts.X_CLICK} → note到達 ${f.counts.NOTE_VIEW} → 購入 ${f.counts.NOTE_PURCHASE}`);
  console.log(`デモ開始 ${f.counts.DEMO_START} → デモ完了 ${f.counts.DEMO_COMPLETE} → 商談 ${f.counts.MEETING} → 契約 ${f.counts.CONTRACT}`);
  const show = (label: string, r: typeof f.noteViewToPurchase) =>
    console.log(`${label}: ${r.status === 'OK' ? `${Math.round((r.rate ?? 0) * 1000) / 10}%` : `判定不能（母数${r.denominator}件）`}`);
  show('note購入率', f.noteViewToPurchase);
  show('デモ→商談', f.demoToMeeting);
  show('商談→契約', f.meetingToContract);

  console.log('\n===== 案件（上位10件） =====');
  for (const i of d.ideas.slice(0, 10)) {
    console.log(
      `${String(i.normalized100 ?? '--').padStart(5)}点 ${String(i.grade ?? '未採点').padEnd(18)} ` +
        `日本:${i.japan_stage ?? '未調査'} 海外:${i.market_trend ?? '未計測'} 販売:${i.sales_verdict ?? '未実施'}  ${i.title.slice(0, 45)}`
    );
  }

  const camp = await revenueByCampaign();
  if (camp.length > 0) {
    console.log('\n===== どの投稿から売れたか =====');
    for (const c of camp) {
      console.log(`${c.utm_campaign ?? '(なし)'} / ${c.utm_content ?? '(なし)'}: ${c.purchases}件 ${Number(c.revenue).toLocaleString()}円`);
    }
  }

  console.log('\n===== 安全フラグ =====');
  for (const [k, v] of Object.entries(d.outboundFlags)) console.log(`${k}=${v}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
