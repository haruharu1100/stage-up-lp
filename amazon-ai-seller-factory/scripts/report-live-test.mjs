#!/usr/bin/env node
/**
 * 本番20商品テストの結果を、そのままChatGPTへ渡せる形にまとめる。
 *
 * ★このスクリプトは「読むだけ」です。判定基準を書き換えることも、
 *   発注・出品することも、データを消すこともありません。
 *
 *   使い方:
 *     node scripts/report-live-test.mjs            … 最新のリサーチ結果でレポート作成
 *     node scripts/report-live-test.mjs <run_id>   … 特定の実行を指定
 *
 *   出力先:
 *     事業Vault/Amazon AI Seller OS/検証結果/本番20商品検証_<日付>.md
 *     同フォルダに .csv（32項目の一覧・表計算ソフト用）
 */
import { createClient } from '@libsql/client';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const VAULT = '/Volumes/ORICO/保存用/hp用/hp-auto-system/事業Vault/Amazon AI Seller OS/検証結果';
const db = createClient({ url: 'file:' + path.join(ROOT, 'data', 'factory.db') });

const argRun = process.argv[2] && !process.argv[2].startsWith('--') ? process.argv[2] : null;

// ---- 小道具 ---------------------------------------------------------
const J = (v, fb = null) => { try { return v ? JSON.parse(v) : fb; } catch { return fb; } };
const yen = (v) => (v == null ? '不明' : Number(v).toLocaleString() + '円');
const pct = (v, d = 1) => (v == null ? '不明' : (Number(v) * 100).toFixed(d) + '%');
const num = (v) => (v == null ? '不明' : Number(v).toLocaleString());
const yn = (v) => (v == null ? '不明' : v ? 'あり' : 'なし');

function jstStamp(d = new Date()) {
  const t = new Date(d.getTime() + 9 * 3600 * 1000);
  return t.toISOString().slice(0, 10);
}

/** 手数料の「金額＋実データか推定か」を1マスに出す。推定を確定値のように見せないため。 */
const FEE_LABEL = { ACTUAL: '実データ', ESTIMATED: '推定値', UNKNOWN: '不明' };
function feeCell(r, amountKey, confKey) {
  const c = J(r.cost_detail, {}) || {};
  const conf = c.feeConfidence?.[confKey];
  const label = FEE_LABEL[conf] || '不明';
  if (c[amountKey] == null) return `不明（${label}）`;
  return `${yen(c[amountKey])}（${label}）`;
}

/** 旧「一律の仮置き手数料」と実データ手数料で、利益がいくら変わったか。 */
function legacyCell(r) {
  const lc = (J(r.cost_detail, {}) || {}).legacyComparison;
  if (!lc) return '(実データが取れなかったため比較なし)';
  const d = Number(lc.deltaJpy || 0);
  const sign = d > 0 ? '+' : '';
  return `仮${yen(lc.legacyNetProfitJpy)} → 実${yen(r.net_profit_jpy)}（差 ${sign}${d.toLocaleString()}円）`;
}

/** ★32項目。ここが検証で見る全項目。 */
const COLUMNS = [
  ['商品名', (r) => r.amazon_title || r.supplier_title || '不明'],
  ['ASIN', (r) => r.asin || '不明'],
  ['仕入先', (r) => r.supplier || '不明'],
  ['仕入価格', (r) => yen(r.supplier_price_jpy)],
  ['Amazon現在価格', (r) => yen(r.amazon_price_jpy)],
  ['30日平均価格', (r) => yen(r.avg_price_30d_jpy)],
  ['90日平均価格', (r) => yen(r.avg_price_90d_jpy)],
  ['SalesRank', (r) => num(r.bsr)],
  ['推定月販', (r) => (r.monthly_sales_est == null ? '不明' : r.monthly_sales_est + '個')],
  ['出品者数', (r) => num(r.seller_count)],
  ['Amazon本体', (r) => yn(r.amazon_selling)],
  ['BuyBox', (r) => (r.buybox_price_jpy == null ? '不明' : yen(r.buybox_price_jpy) + (r.buybox_is_amazon ? '(Amazon)' : r.buybox_is_fba ? '(FBA)' : ''))],
  ['MATCH_SCORE', (r) => (r.match_score == null ? '不明' : r.match_score + '点/' + (r.match_verdict || '?'))],
  ['DATA_FRESHNESS', (r) => (r.freshness || '不明') + (r.freshness_hours != null ? `(${Math.round(r.freshness_hours)}時間前)` : '')],
  ['CONFIDENCE', (r) => (r.confidence == null ? '不明' : r.confidence + '点')],
  ['LANDED_COST', (r) => yen(r.landed_cost_jpy)],
  // ★手数料は「いくら」だけでなく「実データか推定か」まで出す
  ['Amazon紹介料', (r) => feeCell(r, 'referralFeeJpy', 'referral')],
  ['配送費(FBA/自己発送)', (r) => feeCell(r, 'fulfillmentFeeJpy', 'fulfillment')],
  ['FBA在庫保管料', (r) => feeCell(r, 'storageFeeJpy', 'storage')],
  ['手数料データの鮮度', (r) => (J(r.cost_detail, {}) || {}).feeFreshness?.label || '不明'],
  ['手数料UNKNOWN(Aランク禁止)', (r) => ((J(r.cost_detail, {}) || {}).feeCriticalUnknown || []).join('・') || '(なし)'],
  ['仮置き計算との差', (r) => legacyCell(r)],
  ['想定広告費', (r) => yen(J(r.cost_detail, {})?.adCostJpy)],
  ['想定純利益', (r) => yen(r.net_profit_jpy)],
  ['利益率', (r) => pct(r.profit_rate)],
  ['ROI', (r) => pct(r.roi)],
  ['推奨仕入数量', (r) => (r.recommended_qty == null ? '不明' : r.recommended_qty + '個')],
  ['ResearchScore', (r) => (r.research_score == null ? '不明' : r.research_score + '点')],
  ['ランク', (r) => r.grade || '不明'],
  ['判定理由', (r) => (J(r.grade_reasons, []) || []).join(' / ') || '(なし)'],
  ['異常検知', (r) => (r.anomaly ? `★あり(${r.anomaly_level || '?'}) ${r.anomaly_summary || ''}` : 'なし')],
  ['UNKNOWN項目', (r) => (J(r.unknown_fields, []) || []).join(',') || '(なし)'],
];

/** UNKNOWN率を数える対象（取れて当たり前の項目） */
const UNKNOWN_CHECKS = [
  ['ASIN', (r) => !r.asin],
  ['Amazon現在価格', (r) => r.amazon_price_jpy == null],
  ['30日平均価格', (r) => r.avg_price_30d_jpy == null],
  ['90日平均価格', (r) => r.avg_price_90d_jpy == null],
  ['SalesRank', (r) => r.bsr == null],
  ['推定月販', (r) => r.monthly_sales_est == null],
  ['出品者数', (r) => r.seller_count == null],
  ['BuyBox', (r) => r.buybox_price_jpy == null],
  ['レビュー数', (r) => r.review_count == null],
  ['評価', (r) => r.rating == null],
  ['カテゴリー', (r) => !r.category],
  ['仕入価格', (r) => r.supplier_price_jpy == null],
  ['CONFIDENCE', (r) => r.confidence == null],
  ['推奨仕入数量', (r) => r.recommended_qty == null],
];

async function main() {
  // ---- 対象の実行を選ぶ ---------------------------------------------
  const runRow = argRun
    ? (await db.execute({ sql: 'SELECT * FROM research_runs WHERE id=?', args: [argRun] })).rows[0]
    : (await db.execute('SELECT * FROM research_runs ORDER BY started_at DESC LIMIT 1')).rows[0];

  if (!runRow) {
    console.error('リサーチの実行記録がありません。先に画面「① リサーチツール」で実行してください。');
    process.exit(1);
  }

  const rows = (await db.execute({
    sql: 'SELECT * FROM research_candidates WHERE research_run_id=? ORDER BY research_score DESC',
    args: [runRow.id],
  })).rows;

  const isLive = Number(runRow.live_data) === 1;
  const N = rows.length;
  const out = [];
  const p = (s = '') => out.push(s);

  // ---- 見出し --------------------------------------------------------
  p(`# 本番${N}商品 検証結果（Amazon AI Seller OS）`);
  p('');
  p(`- 作成日: ${jstStamp()}`);
  p(`- 実行ID: ${runRow.id}`);
  p(`- 実行日時: ${runRow.started_at}`);
  p(`- データ種別: **${isLive ? 'LIVE DATA（本番のAmazonデータ）' : '★SAMPLE（練習用データ）'}**`);
  if (!isLive) {
    p('');
    p('> [!danger] これは練習用データの結果です');
    p('> 本番の検証結果ではありません。Keepaの鍵を入れてから実行し直してください。');
    p('> **この内容を「本番20商品テストの結果」としてChatGPTへ渡さないでください。**');
  }
  p('');
  p('---');
  p('');

  // ---- ① 一覧 --------------------------------------------------------
  p('## ① 商品一覧（32項目）');
  p('');
  p(`調べた商品: ${N}件（32項目すべてを商品ごとに記載。表計算用のCSVも同じフォルダにあります）`);
  p('');
  rows.forEach((r, i) => {
    p(`### ${i + 1}. ${r.amazon_title || r.supplier_title || '(商品名不明)'}`);
    p('');
    p('| 項目 | 値 |');
    p('|---|---|');
    for (const [label, fn] of COLUMNS) {
      let v;
      try { v = fn(r); } catch { v = '不明'; }
      p(`| ${label} | ${String(v).replace(/\|/g, '/')} |`);
    }
    p('');
  });

  // ---- ② A/B/C/D件数 -------------------------------------------------
  const g = (x) => rows.filter((r) => r.grade === x).length;
  p('## ② A/B/C/D 件数');
  p('');
  p('| ランク | 件数 | 意味 |');
  p('|---|---|---|');
  p(`| A | ${g('A')} | 今すぐ仕入れ候補 |`);
  p(`| B | ${g('B')} | 値下がりしたら候補 |`);
  p(`| C | ${g('C')} | 競合が減ったら候補 |`);
  p(`| D | ${g('D')} | 販売しない |`);
  p(`| 判定なし | ${rows.filter((r) => !r.grade).length} | ランクが付かなかった |`);
  p('');
  p('※Aランクが0件でも問題ありません。条件を満たさない商品をAにしない方が重要です。');
  p('');

  // ---- ③ Aランク詳細（利益を1円単位で分解）---------------------------
  p('## ③ Aランク商品の詳細（利益の内訳を1円単位で分解）');
  p('');
  const aRows = rows.filter((r) => r.grade === 'A');
  if (!aRows.length) {
    p('Aランクは**0件**でした。（無理にAを作っていません）');
    p('');
  } else {
    for (const r of aRows) {
      const c = J(r.cost_detail, {}) || {};
      p(`### ${r.amazon_title || r.supplier_title}（${r.asin || 'ASIN不明'}）`);
      p('');
      const fc = c.feeConfidence || {};
      const lab = (k) => FEE_LABEL[fc[k]] || '—';
      p('| 費目 | 金額 | データの種類 |');
      p('|---|---|---|');
      p(`| Amazon販売価格 | ${yen(c.sellPriceJpy)} | 実データ |`);
      p(`| − 仕入価格 | ${yen(c.supplierUnitPriceJpy)} | 仕入先データ |`);
      p(`| − 国内送料 | ${yen(c.domesticShippingJpy)} | 仕入先データ |`);
      p(`| − 国際送料 | ${yen(c.intlShippingJpy)} | 仕入先データ |`);
      p(`| − 関税・輸入消費税 | ${yen(c.dutyJpy)} | 設定値 |`);
      p(`| − 輸入関連費 | ${yen(c.importOtherJpy)} | 仕入先データ |`);
      p(`| − 検品費 | ${yen(c.inspectionJpy)} | 仕入先データ |`);
      p(`| （仕入原価合計 LANDED COST） | ${yen(c.landedCostJpy)} | — |`);
      p(`| − Amazon販売手数料 | ${yen(c.referralFeeJpy)} | **${lab('referral')}** |`);
      p(`| − ${c.fulfillmentLabel || '配送'} | ${yen(c.fulfillmentFeeJpy)} | **${lab('fulfillment')}** |`);
      p(`| − 保管料 | ${yen(c.storageFeeJpy)} | **${lab('storage')}** |`);
      p(`| − 想定広告費 | ${yen(c.adCostJpy)} | 推定値（設定率） |`);
      p(`| − 返品リスク | ${yen(c.returnRiskJpy)} | 推定値（設定率） |`);
      p(`| − その他変動費 | ${yen(c.otherVariableJpy)} | 推定値（設定率） |`);
      p(`| **＝ 純利益** | **${yen(c.netProfitJpy)}** | — |`);
      p(`| 利益率 | ${pct(c.profitRate)} | — |`);
      p(`| ROI | ${pct(c.roi)} | — |`);
      p('');
      p(`- サイズ区分: ${c.feeTiers?.size ?? '不明'} ／ 重量区分: ${c.feeTiers?.weight ?? '不明'}`);
      p(`- 手数料データの鮮度: ${c.feeFreshness?.label || '不明'}`);
      if (c.legacyComparison) p(`- 仮置き計算との差: ${c.legacyComparison.note}`);
      p('');
      p(`- 推定月販: ${r.monthly_sales_est == null ? '不明' : r.monthly_sales_est + '個'}`);
      p(`  - 計算根拠: ${r.monthly_sales_basis || '不明'}`);
      p(`  - 信頼度: ${r.monthly_sales_confidence || '不明'}（★これは推定値です。確定値ではありません）`);
      p(`- MATCH SCORE: ${r.match_score ?? '不明'}点（${r.match_verdict || '?'}）`);
      const mr = J(r.match_reasons, []) || [];
      if (mr.length) p(`  - 一致の根拠: ${mr.join(' / ')}`);
      p(`- CONFIDENCE: ${r.confidence ?? '不明'}点`);
      p(`- DATA FRESHNESS: ${r.freshness || '不明'}`);
      p(`- 推奨仕入数量: ${r.recommended_qty == null ? '不明' : r.recommended_qty + '個'}（★初回は安全係数で減らした数です）`);
      p('');
    }
  }

  // ---- ④ 強い推奨 ----------------------------------------------------
  p('## ④ 強い推奨商品');
  p('');
  const strong = rows.filter((r) => r.recommendation && r.recommendation !== 'none');
  if (!strong.length) p('該当なし。');
  else {
    p('| 商品 | ASIN | ランク | 純利益 | 推奨理由 |');
    p('|---|---|---|---|---|');
    for (const r of strong) {
      p(`| ${(r.amazon_title || '').slice(0, 30)} | ${r.asin || '不明'} | ${r.grade || '-'} | ${yen(r.net_profit_jpy)} | ${r.recommendation} |`);
    }
  }
  p('');

  // ---- ⑤ UNKNOWN率 ---------------------------------------------------
  p('## ⑤ UNKNOWN率（取得できなかった割合）');
  p('');
  p('| 項目 | 取得できなかった数 | 率 |');
  p('|---|---|---|');
  const unknownRates = [];
  for (const [label, isUnknown] of UNKNOWN_CHECKS) {
    const c = rows.filter(isUnknown).length;
    const rate = N ? c / N : 0;
    unknownRates.push([label, c, rate]);
    p(`| ${label} | ${c}/${N} | ${(rate * 100).toFixed(0)}% |`);
  }
  p('');
  const worst = unknownRates.filter(([, , r]) => r >= 0.2).sort((a, b) => b[2] - a[2]);
  if (worst.length) {
    p('**★UNKNOWN率が20%以上の項目（今後の改善候補）**');
    worst.forEach(([l, c, r]) => p(`- ${l}：${(r * 100).toFixed(0)}%（${c}件）`));
  } else {
    p('UNKNOWN率が20%を超える項目はありませんでした。');
  }
  p('');

  // ---- ⑥ 異常データ --------------------------------------------------
  p('## ⑥ 異常データ（DATA_ANOMALY）');
  p('');
  const anom = rows.filter((r) => r.anomaly);
  p(`異常として隔離: **${anom.length}件 / ${N}件**（${N ? Math.round((anom.length / N) * 100) : 0}%）`);
  p('');
  if (anom.length) {
    p('| 商品 | 深刻度 | 理由 |');
    p('|---|---|---|');
    for (const r of anom) {
      p(`| ${(r.amazon_title || r.supplier_title || '').slice(0, 30)} | ${r.anomaly_level || '?'} | ${r.anomaly_summary || (J(r.anomaly_items, []) || []).join(' / ')} |`);
    }
    p('');
    p('※これらは人が確認を終えるまでAランクになりません。');
  }
  p('');

  // ---- ⑦ API使用量・コスト -------------------------------------------
  p('## ⑦ API使用量・推定コスト');
  p('');
  p('| 項目 | 値 |');
  p('|---|---|');
  p(`| Keepa 呼び出し | ${num(runRow.keepa_calls)}回 |`);
  p(`| 有料AI 呼び出し | ${num(runRow.openai_calls ?? runRow.paid_ai_calls)}回 |`);
  p(`| 推定コスト | ${runRow.est_cost_jpy == null ? '不明' : Number(runRow.est_cost_jpy).toFixed(1) + '円'} |`);
  p(`| 本番テストモード | ${Number(runRow.live_test_mode) ? 'ON' : 'OFF'} |`);
  p(`| 1回の上限件数 | ${runRow.live_test_limit ?? '未設定'} |`);
  p(`| Mock混入ブロック | ${num(runRow.mixed_data_blocked)}件 |`);
  p('');

  // ---- ⑧ 誤一致 ------------------------------------------------------
  p('## ⑧ 誤一致（仕入先商品とAmazon商品が別物でないか）');
  p('');
  const lowMatchA = aRows.filter((r) => (r.match_score ?? 0) < 80);
  const review = rows.filter((r) => r.match_verdict === 'review');
  p(`- Aランクなのに MATCH SCORE 80点未満: **${lowMatchA.length}件**`);
  p(`- 「人が目で確認」判定: **${review.length}件**`);
  p('');
  if (lowMatchA.length) {
    p('> [!danger] Aランクで一致精度が低い商品があります。原因分析が必要です。');
    for (const r of lowMatchA) {
      p(`- ${r.amazon_title}（${r.asin}）: ${r.match_score}点 / 根拠: ${(J(r.match_reasons, []) || []).join(' / ')}`);
    }
    p('');
  }
  p('※画像が似ているだけで同一商品と断定はしていません（型番・名前・サイズ・仕様も加点対象）。');
  p('');

  // ---- ⑨ 仮置き項目 --------------------------------------------------
  p('## ⑨ 利益計算で仮置きしている項目');
  p('');
  const allAssump = new Map();
  for (const r of rows) {
    for (const a of J(r.cost_detail, {})?.assumptions || []) {
      allAssump.set(a, (allAssump.get(a) || 0) + 1);
    }
  }
  if (!allAssump.size) p('（記録なし）');
  else {
    p('| 仮置きしている内容 | 該当商品数 |');
    p('|---|---|');
    [...allAssump.entries()].sort((a, b) => b[1] - a[1]).forEach(([a, c]) => p(`| ${a} | ${c}件 |`));
    p('');
    p('**★これらは実際の請求額と必ずズレます。最初の数商品で実額と突き合わせが必要です。**');
  }
  p('');

  // ---- ⑨-2 手数料の実データ化 ---------------------------------------
  p('## ⑨-2 Amazon手数料：実データ／推定値／不明の内訳');
  p('');
  {
    const tally = { referral: {}, fulfillment: {}, storage: {} };
    const NAME = { referral: 'Amazon紹介料', fulfillment: '配送費(FBA/自己発送)', storage: 'FBA在庫保管料' };
    let stale = 0;
    let blockedA = 0;
    const deltas = [];
    for (const r of rows) {
      const c = J(r.cost_detail, {}) || {};
      for (const k of Object.keys(tally)) {
        const v = c.feeConfidence?.[k] || 'UNKNOWN';
        tally[k][v] = (tally[k][v] || 0) + 1;
      }
      if (c.feeFreshness?.stale) stale++;
      if ((c.feeCriticalUnknown || []).length) blockedA++;
      if (c.legacyComparison) deltas.push(Number(c.legacyComparison.deltaJpy || 0));
    }
    p('| 費目 | 実データ | 推定値 | 不明 |');
    p('|---|---|---|---|');
    for (const k of Object.keys(tally)) {
      p(`| ${NAME[k]} | ${tally[k].ACTUAL || 0}件 | ${tally[k].ESTIMATED || 0}件 | ${tally[k].UNKNOWN || 0}件 |`);
    }
    p('');
    p(`- 手数料データが古い／取得日時不明: **${stale}件**`);
    p(`- 手数料が不明でAランクを禁止した商品: **${blockedA}件**`);
    if (deltas.length) {
      const avg = deltas.reduce((a, b) => a + b, 0) / deltas.length;
      const worst = Math.min(...deltas);
      const best = Math.max(...deltas);
      p('');
      p('### 旧「仮置き手数料」との比較');
      p('');
      p(`- 比較できた商品: ${deltas.length}件`);
      p(`- 利益の変化: 平均 ${Math.round(avg).toLocaleString()}円 ／ 最も減った ${Math.round(worst).toLocaleString()}円 ／ 最も増えた +${Math.round(best).toLocaleString()}円`);
      p('- **マイナス＝仮置きは利益を多く見せていた（＝赤字を見落とす方向だった）**');
    } else {
      p('');
      p('- 実データが取れた商品が無かったため、仮置きとの比較はありません。');
    }
  }
  p('');

  // ---- ⑩⑪ Claudeが書く欄 --------------------------------------------
  p('## ⑩ システム側で怪しいと感じた部分');
  p('');
  p('（※この欄は結果を見たうえでClaudeが記入します）');
  p('');
  p('## ⑪ Claude自身が改善したい部分');
  p('');
  p('（※この欄は結果を見たうえでClaudeが記入します）');
  p('');

  // ---- ⑫ GO/HOLD（機械判定）------------------------------------------
  p('## ⑫ 50商品へ増やしてよいか（GO / HOLD）');
  p('');
  const blockers = [];
  if (!isLive) blockers.push('本番データではありません（練習用データの結果です）');
  if (Number(runRow.mixed_data_blocked) > 0) blockers.push(`Mockデータの混入を${runRow.mixed_data_blocked}件ブロックしています（原因調査が必要）`);
  if (lowMatchA.length > 0) blockers.push(`Aランクなのに一致精度が低い商品が${lowMatchA.length}件あります（誤一致の可能性）`);
  const highUnknown = unknownRates.filter(([, , r]) => r >= 0.5);
  if (highUnknown.length) blockers.push(`取得できない項目が半分を超えています：${highUnknown.map(([l]) => l).join('・')}`);
  if (N === 0) blockers.push('調査できた商品が0件です');

  p('**機械判定（客観的な条件だけで自動判定したもの）**');
  p('');
  if (blockers.length) {
    p('### → HOLD（まだ増やさない）');
    p('');
    p('理由：');
    blockers.forEach((b) => p(`- ${b}`));
  } else {
    p('### → GO（50商品へ進めてよい）');
    p('');
    p('客観的な停止条件（Mock混入・誤一致・取得失敗多発）には該当しませんでした。');
  }
  p('');
  p('※最終判断はこのレポートをChatGPTで確認してから行ってください。');
  p('※Research ScoreやA/B/C/Dの基準変更は、この確認が終わるまで行いません。');
  p('');

  // ---- 保存 ----------------------------------------------------------
  fs.mkdirSync(VAULT, { recursive: true });
  // ★練習用データの結果を「本番検証」という名前で残さない（混同防止）
  const base = isLive
    ? `本番${N}商品検証_${jstStamp()}`
    : `【練習データ】${N}商品_${jstStamp()}`;
  const mdPath = path.join(VAULT, `${base}.md`);
  const header = [
    '---',
    `title: 本番${N}商品 検証結果`,
    'category: トレカ・EC',
    `status: ${isLive ? '本番検証' : '練習データ'}`,
    'tags: [amazon, ai-os, 検証, keepa]',
    `updated: ${jstStamp()}`,
    '---',
    '',
  ].join('\n');
  fs.writeFileSync(mdPath, header + out.join('\n'), 'utf8');

  // CSV（表計算ソフト用）
  const esc = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = [COLUMNS.map(([l]) => esc(l)).join(',')];
  for (const r of rows) {
    csv.push(COLUMNS.map(([, fn]) => { let v; try { v = fn(r); } catch { v = '不明'; } return esc(v); }).join(','));
  }
  const csvPath = path.join(VAULT, `${base}.csv`);
  fs.writeFileSync(csvPath, '﻿' + csv.join('\n'), 'utf8');

  console.log('\n=== レポートを作成しました ===\n');
  console.log('  データ種別 :', isLive ? 'LIVE DATA（本番）' : '★SAMPLE（練習用・本番検証ではありません）');
  console.log('  商品数     :', N + '件');
  console.log(`  ランク     : A=${g('A')} B=${g('B')} C=${g('C')} D=${g('D')}`);
  console.log('  異常データ :', anom.length + '件');
  console.log('  機械判定   :', blockers.length ? 'HOLD（' + blockers.length + '件の停止条件）' : 'GO');
  console.log('');
  console.log('  レポート :', mdPath);
  console.log('  一覧CSV  :', csvPath);
  console.log('');
}

main().catch((e) => {
  console.error('レポート作成に失敗しました:', e.message);
  process.exit(1);
});
