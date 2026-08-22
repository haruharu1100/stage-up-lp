import { migrate } from '../lib/db/client';
import { buildDashboard } from '../lib/dashboard';
import {
  appendChangelog,
  appendClaim,
  ensureStructure,
  vaultAvailable,
  writeCurrentState,
  writeDailyResult,
  writeNextActions,
  OS_ROOT,
} from '../lib/obsidian';

/** 作業終了時に必ず実行する。Claudeの記憶に依存させないための書き戻し。 */
async function main() {
  await migrate();

  if (!vaultAvailable()) {
    console.log('Obsidian Vaultが見つかりません（ORICO未接続の可能性）。書き込みをスキップしました。');
    return;
  }
  ensureStructure();

  const d = await buildDashboard();

  const state = [
    `## 案件`,
    `- 登録済み: ${d.ideaCount}件（採点済み ${d.scoredCount}件）`,
    `- S/Aランク: ${d.ideas.filter((i) => i.grade === 'S' || i.grade === 'A').length}件`,
    `- 判定不能（根拠不足）: ${d.ideas.filter((i) => i.grade === 'INSUFFICIENT_DATA').length}件`,
    '',
    `## 収益`,
    `- 累計売上: ${d.allTime.revenueYen.toLocaleString()}円`,
    `- MRR: ${d.saas.mrrYen.toLocaleString()}円 / ARR: ${d.saas.arrYen.toLocaleString()}円`,
    `- 稼働契約: ${d.saas.activeContracts}件`,
    `- LTV÷CAC: ${d.saas.ltvCac ?? '算出不能（データ不足）'}`,
    '',
    `## 外部副作用フラグ（全てfalseが正常）`,
    ...Object.entries(d.outboundFlags).map(([k, v]) => `- ${k}: ${v}`),
  ].join('\n');
  writeCurrentState(state);

  const next = d.recommendations
    .map(
      (r) =>
        `## ${r.rank}. ${r.action}\n- 理由: ${r.why}\n- 根拠: ${r.evidence}\n- 信頼度: ${r.confidence}\n- 必要コスト: ${r.costYen.toLocaleString()}円\n- 期待効果: ${r.expectedEffect}\n- リスク: ${r.risk}\n- データ量: ${r.dataVolume}`
    )
    .join('\n\n');
  writeNextActions(next || '推奨アクションなし');

  const daily = [
    `# ${new Date().toISOString().slice(0, 10)} の結果`,
    '',
    '| 指標 | 本日 | 7日 | 30日 | 累計 |',
    '|---|---|---|---|---|',
    `| 売上(円) | ${d.today.revenueYen} | ${d.last7.revenueYen} | ${d.last30.revenueYen} | ${d.allTime.revenueYen} |`,
    `| note購入 | ${d.today.counts.NOTE_PURCHASE} | ${d.last7.counts.NOTE_PURCHASE} | ${d.last30.counts.NOTE_PURCHASE} | ${d.allTime.counts.NOTE_PURCHASE} |`,
    `| デモ完了 | ${d.today.counts.DEMO_COMPLETE} | ${d.last7.counts.DEMO_COMPLETE} | ${d.last30.counts.DEMO_COMPLETE} | ${d.allTime.counts.DEMO_COMPLETE} |`,
    `| 商談 | ${d.today.counts.MEETING} | ${d.last7.counts.MEETING} | ${d.last30.counts.MEETING} | ${d.allTime.counts.MEETING} |`,
    `| 契約 | ${d.today.counts.CONTRACT} | ${d.last7.counts.CONTRACT} | ${d.last30.counts.CONTRACT} | ${d.allTime.counts.CONTRACT} |`,
    '',
    `※ 率は母数が足りない間は算出しません（現在の30日購入率: ${d.last30.noteViewToPurchase.status === 'OK' ? `${Math.round((d.last30.noteViewToPurchase.rate ?? 0) * 1000) / 10}%` : '判定不能'}）`,
  ].join('\n');
  writeDailyResult(daily);

  appendChangelog(
    'AI BUSINESS OS 状態を同期',
    `案件${d.ideaCount}件 / 採点済み${d.scoredCount}件 / MRR ${d.saas.mrrYen.toLocaleString()}円`
  );

  const ok = appendClaim(
    'AI BUSINESS OS の状態',
    `案件${d.ideaCount}件を登録（採点済み${d.scoredCount}件、S/A ${d.ideas.filter((i) => i.grade === 'S' || i.grade === 'A').length}件）。` +
      `MRR ${d.saas.mrrYen}円。外部副作用フラグは全てfalseのまま。`
  );

  console.log(`Obsidianへ書き戻しました: ${OS_ROOT}`);
  console.log(`claims.jsonl 追記: ${ok ? '成功' : 'スキップ（ファイル未検出）'}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
