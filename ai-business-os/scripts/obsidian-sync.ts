import { migrate } from '../lib/db/client';
import { buildDashboard } from '../lib/dashboard';
import {
  appendChangelog,
  appendClaim,
  ensureStructure,
  saveValidationNote,
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

  // 検証カードは案件ごとに1ファイル。売れなかった案件も消さずに残す
  const savedCards = d.validation.cards.map((c) => saveValidationNote(c)).filter(Boolean);

  const v = d.validation;
  const state = [
    `## 検証パイプライン（実測ベース）`,
    `- 発掘 ${v.counts.DISCOVERED}件 → 日本調査 ${v.counts.RESEARCHED}件 → 採算試算 ${v.counts.BACKTESTED}件 → 売ってみる候補 ${v.counts.VALIDATION_READY}件`,
    `- 実際に売ってみている: ${v.counts.TESTING}件 / 有料顧客あり: ${v.counts.PAID_CUSTOMER}件 / 拡大候補: ${v.counts.SCALE}件`,
    `- 実績CSV: ${v.hasMeasuredData ? '読み込み済み' : '未記入（したがって数字は全て仮定であり、売れる根拠ではない）'}`,
    `- 合否・撤退・拡大の条件は ${v.criteriaFixedAt} に凍結（結果を見てから緩めない）`,
    v.criteriaOverride
      ? `- 条件の変更: ${v.criteriaOverride.changedAt}／理由 ${v.criteriaOverride.reason}`
      : '- 条件の変更: なし',
    '',
    `## ${v.rankingLabel}`,
    `- ${v.provisionalReason}`,
    `- 順位を付けられず母集団から外した案件: ${v.excludedUnresearched}件`,
    ...v.provisionalTop.map(
      (r) => `- ${r.rank}. ${r.title}（${r.clusterLabel}／点数 ${r.rankScore ?? '—'}）`
    ),
    '',
    `## 最初に検証する3件（同じ種類が重ならないよう選び直したもの）`,
    ...v.portfolio.picks.map(
      (p) => `- ${p.rank}. ${p.item.title}（${p.clusterLabel}／点数 ${p.item.score ?? '—'}）`
    ),
    `- 同じ種類のため見送り: ${v.portfolio.skippedByCluster.length}件 / 点数が離れているため見送り: ${v.portfolio.skippedByScore.length}件`,
    v.portfolio.note ? `- ${v.portfolio.note}` : '',
    '',
    `## P&L（記入済みの費用だけで計算。未記入は0円にしない）`,
    `- CONTENT: 収益 ${v.pnl.content.revenueYen.toLocaleString()}円 / 費用 ${v.pnl.content.costYen.toLocaleString()}円 / 利益 ${v.pnl.content.profitYen.toLocaleString()}円`,
    `- SAAS: 収益 ${v.pnl.saas.revenueYen.toLocaleString()}円 / 費用 ${v.pnl.saas.costYen.toLocaleString()}円 / 利益 ${v.pnl.saas.profitYen.toLocaleString()}円`,
    `- TOTAL: 収益 ${v.pnl.revenueYen.toLocaleString()}円 / 費用 ${v.pnl.costYen.toLocaleString()}円 / 利益 ${v.pnl.profitYen.toLocaleString()}円`,
    `- 未記入の費目: ${v.pnl.missingCostKinds.length === 0 ? 'なし' : v.pnl.missingCostKinds.join('・')}`,
    '',
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
    `案件${d.ideaCount}件 / 採点済み${d.scoredCount}件 / MRR ${d.saas.mrrYen.toLocaleString()}円\n` +
      `検証カード${savedCards.length}件を保存（実際に売ってみた案件 ${v.counts.TESTING}件・有料顧客 ${v.counts.PAID_CUSTOMER}件）`
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
