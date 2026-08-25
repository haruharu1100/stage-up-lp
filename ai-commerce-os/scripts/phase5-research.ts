/**
 * 自動リサーチを1回まわす（通信なし・枠0）。
 *
 *   npm run phase5:research            … 下見だけ（何も保存しない）
 *   npm run phase5:research -- --save  … 結果を保存する
 *
 * ------------------------------------------------------------------
 * 【外部へ1回も接続しない】
 *
 * ご本人の指示（原文・最初にやること）：
 *   「いきなり外部市場を勝手に検索しないでください。まず、
 *     AUTO RESEARCH ORCHESTRATOR の設計と、
 *     現在正式接続済みのデータだけでどこまで自動化できるかを確認してください。」
 *
 * このコマンドは **すでに保存してある Keepa データを読むだけ** である。
 * Keepa へ接続しないので枠は1つも減らず、他社サイトも1つも見に行かない。
 */

import { migrate } from '../lib/db/client';
import { autoResearchReachJa, buySideAutoConnectorCount, CANDIDATE_VENUES, REGISTERED_CONNECTORS, canAutoResearch, sellSideAutoConnectorCount } from '../lib/phase5/connector';
import { AUTO_LISTING_IMPLEMENTED, AUTO_PAYMENT_IMPLEMENTED, AUTO_PURCHASE_IMPLEMENTED, AUTO_SHIPPING_IMPLEMENTED, PIPELINE_STAGES, planRun } from '../lib/phase5/orchestrator';
import { connectorViews, countPendingByReason, runDemandFirstResearch } from '../lib/phase5/store';
import { PENDING_REASON_JA, type PendingReason } from '../lib/phase5/watch';

const W = 78;
const hr = (c = '=') => console.log(c.repeat(W));

function pad(text: string, width: number): string {
  let w = 0;
  for (const ch of text) w += ch.charCodeAt(0) < 128 ? 1 : 2;
  return text + ' '.repeat(Math.max(1, width - w));
}

async function main() {
  const save = process.argv.includes('--save');
  await migrate();

  hr();
  console.log('  自動リサーチ（Demand First）');
  console.log(save ? '  ★保存します' : '  ★下見だけです。何も保存しません（--save で保存）');
  hr();
  console.log('');

  /* ---- ① いま使える口 ---- */
  console.log('■ いま自動で使える市場');
  for (const d of REGISTERED_CONNECTORS) {
    const chk = canAutoResearch(d);
    console.log(`  ${chk.ok ? '○' : '×'} ${pad(d.labelJa, 40)} ${chk.ok ? '自動で使えます' : chk.reasonsJa.join(' / ')}`);
  }
  console.log(`  （候補として名前だけ持っている市場：${CANDIDATE_VENUES.length}件。1つも接続していません）`);
  console.log('');
  console.log(`  仕入側 ${buySideAutoConnectorCount()}件 ／ 販売側 ${sellSideAutoConnectorCount()}件`);
  console.log(`  ${autoResearchReachJa()}`);
  console.log('');

  /* ---- ② どこまで進めるか ---- */
  const plan = planRun('DEMAND_FIRST', connectorViews());
  console.log('■ この回の段取り');
  for (const s of plan.stages) {
    const label = PIPELINE_STAGES.find((x) => x.key === s.key)?.labelJa ?? s.key;
    console.log(`  ${s.runnable ? '○' : '×'} ${pad(label, 34)} ${s.runnable ? '' : s.blockedReasonsJa.join(' / ')}`);
  }
  console.log('');

  /* ---- ③ 実行 ---- */
  const rep = await runDemandFirstResearch({ dryRun: !save });

  console.log('■ 結果');
  for (const line of rep.linesJa) console.log(`  ${line}`);
  console.log('');

  if (rep.selected.length > 0) {
    console.log('■ 需要の条件を満たした商品（上位20件・需要の強い順）');
    console.log(`  ${pad('ASIN', 14)}${pad('30日の値下がり回数', 22)}理由`);
    for (const s of rep.selected.slice(0, 20)) {
      console.log(`  ${pad(s.asin, 14)}${pad(String(s.demandRank ?? '—'), 22)}${s.reasonsJa[0] ?? ''}`);
    }
    console.log('');
  }

  if (save) {
    const byReason = await countPendingByReason();
    if (byReason.length > 0) {
      console.log('■ 仕入先探し待ちの内訳');
      for (const r of byReason) {
        const ja = PENDING_REASON_JA[r.reason as PendingReason] ?? r.reason;
        console.log(`  ${pad(ja, 44)}${r.count}件`);
      }
      console.log('');
    }
  }

  if (rep.warningsJa.length > 0) {
    console.log('■ お知らせ');
    for (const w of rep.warningsJa) console.log(`  ・${w}`);
    console.log('');
  }

  hr('-');
  console.log('  このコマンドがしないこと');
  console.log(`    自動購入 ${AUTO_PURCHASE_IMPLEMENTED ? 'あり' : '実装していません'}`);
  console.log(`    自動出品 ${AUTO_LISTING_IMPLEMENTED ? 'あり' : '実装していません'}`);
  console.log(`    自動決済 ${AUTO_PAYMENT_IMPLEMENTED ? 'あり' : '実装していません'}`);
  console.log(`    自動発送 ${AUTO_SHIPPING_IMPLEMENTED ? 'あり' : '実装していません'}`);
  console.log('    外部サイトの巡回：していません（保存済みデータだけを読みました）');
  hr('-');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
