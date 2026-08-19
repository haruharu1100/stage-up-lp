/**
 * Phase 1 の受け入れテスト。
 *
 * 「動くはず」ではなく「実際に全ケースが出ているか」を数える。
 * 利益計算は本体のコードを呼ばず、この中で独立に計算し直して突き合わせる。
 * （本体のバグをテストが写してしまわないため）
 */
import { all, one } from '../lib/db/client';
import { getThresholds } from '../lib/settings';
import { config, MONEY_ACTIONS_IMPLEMENTED } from '../lib/env';

let passed = 0;
const failures: string[] = [];

function check(name: string, ok: boolean, detail = ''): void {
  if (ok) {
    passed++;
    console.log(`  OK   ${name}${detail ? ` — ${detail}` : ''}`);
  } else {
    failures.push(`${name}${detail ? ` — ${detail}` : ''}`);
    console.log(`  NG   ${name}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title: string): void {
  console.log(`\n[${title}]`);
}

async function count(sql: string, args: unknown[] = []): Promise<number> {
  const r = await one(`SELECT COUNT(*) AS n FROM supplier_products WHERE ${sql}`, args);
  return Number(r?.n ?? 0);
}

async function main() {
  const t = await getThresholds();
  const total = await count('1=1');
  if (total === 0) {
    console.error('データがありません。先に `npm run seed -- --reset` を実行してください。');
    process.exit(1);
  }

  // ---------------------------------------------------------------
  section('1. テストデータ量');
  check('商品が100件以上ある', total >= 100, `${total}件`);
  const suppliers = await all('SELECT DISTINCT supplier_code FROM supplier_products');
  check('仕入先が3社以上ある', suppliers.length >= 3, suppliers.map((s) => s.supplier_code).join(', '));

  // ---------------------------------------------------------------
  section('2. 判定の全区分が出ているか');
  for (const d of ['STRONG_BUY', 'BUY', 'WATCH', 'LOW_PRIORITY', 'SKIP']) {
    const n = await count('decision = ?', [d]);
    check(`${d} が1件以上`, n > 0, `${n}件`);
  }

  // ---------------------------------------------------------------
  section('3. 除外理由の必須ケース');
  const required: [string, string][] = [
    ['NEGATIVE_PROFIT', '赤字'],
    ['NO_MARKET_PRICE', '相場データ不足'],
    ['DUPLICATE', '重複'],
    ['PRICE_ANOMALY_LOW', '価格が安すぎる'],
    ['PRICE_ANOMALY_HIGH', '価格が高すぎる'],
    ['INVALID_DATA', 'データ不備'],
    ['NO_STOCK', '在庫なし'],
    ['LOW_PROFIT', '利益不足'],
    ['LOW_ROI', 'ROI不足'],
    ['MARKET_PRICE_TOO_LOW', '相場では成立しない'],
  ];
  for (const [reason, ja] of required) {
    const n = await count('skip_reason = ?', [reason]);
    check(`${ja}（${reason}）が1件以上`, n > 0, `${n}件`);
  }

  // ---------------------------------------------------------------
  section('4. 重複排除の3層');
  const l1 = await one(`
    SELECT COUNT(*) AS n FROM (
      SELECT supplier_id, external_id FROM supplier_products
       GROUP BY supplier_id, external_id HAVING COUNT(*) > 1)`);
  check('L1: 同じ仕入先の同じ商品IDが二重登録されていない', Number(l1?.n ?? 0) === 0);

  const l2 = await count("skip_reason = 'DUPLICATE' AND duplicate_of IS NOT NULL");
  check('L2: 内容一致の重複が元商品へ紐づいている', l2 > 0, `${l2}件`);

  const l3 = await one(`
    SELECT COUNT(DISTINCT product_id) AS n FROM supplier_products
     WHERE product_id IS NOT NULL`);
  check('L3: 商品マスタへ集約されている', Number(l3?.n ?? 0) > 0, `${Number(l3?.n ?? 0)}件の商品マスタ`);

  // ---------------------------------------------------------------
  section('5. 利益計算の検算（本体とは別の計算で突き合わせ）');
  const samples = await all(`
    SELECT sp.id, sp.name, sp.purchase_price, sp.market_price,
           sp.expected_net_profit, sp.expected_roi, sp.required_sell_price,
           sp.market_premium_ratio, sp.buyable_purchase_price, sp.discount_needed,
           sp.required_market_price, sp.uplift_needed,
           a.break_even_price, a.total_cost, a.fixed_cost, a.variable_fee,
           f.marketplace_fee_rate, f.payment_fee_rate, f.shipping_cost, f.authentication_fee,
           f.packing_cost, f.expected_return_cost, f.other_cost
      FROM supplier_products sp
      JOIN analyses a ON a.supplier_product_id = sp.id
      JOIN fee_rules f ON f.id = a.fee_rule_id
     WHERE sp.expected_net_profit IS NOT NULL
     ORDER BY sp.buy_score DESC LIMIT 30`);

  let mismatch = 0;
  const notes: string[] = [];
  for (const s of samples) {
    const pp = Number(s.purchase_price);
    const mp = Number(s.market_price);
    const r = Number(s.marketplace_fee_rate) + Number(s.payment_fee_rate);
    const F =
      pp + Number(s.shipping_cost) + Number(s.authentication_fee) + Number(s.packing_cost) +
      Number(s.expected_return_cost) + Number(s.other_cost);
    const varFee = Math.ceil(mp * Number(s.marketplace_fee_rate)) + Math.ceil(mp * Number(s.payment_fee_rate));
    const profit = mp - (F + varFee);
    const roi = profit / F;
    const req = Math.ceil((F * (1 + t.targetNetMargin)) / (1 - r));
    const be = Math.ceil(F / (1 - r));

    const bad: string[] = [];
    if (Number(s.expected_net_profit) !== profit) bad.push(`利益 ${s.expected_net_profit} ≠ ${profit}`);
    if (Math.abs(Number(s.expected_roi) - roi) > 1e-9) bad.push(`ROI ${s.expected_roi} ≠ ${roi}`);
    if (Number(s.required_sell_price) !== req) bad.push(`必要販売価格 ${s.required_sell_price} ≠ ${req}`);
    if (Number(s.break_even_price) !== be) bad.push(`損益分岐 ${s.break_even_price} ≠ ${be}`);
    if (Math.abs(Number(s.market_premium_ratio) - req / mp) > 1e-9) bad.push('相場倍率が一致しない');
    if (bad.length > 0) {
      mismatch++;
      notes.push(`#${s.id} ${s.name}: ${bad.join(' / ')}`);
    }
  }
  check(`利益・ROI・必要販売価格・損益分岐が全件一致（${samples.length}件を検算）`, mismatch === 0, notes.slice(0, 3).join(' | '));

  // 「目標利益率15%」の意味が仕入価格×1.15でないこと
  const one15 = samples[0];
  if (one15) {
    const naive = Math.ceil(Number(one15.purchase_price) * 1.15);
    check(
      '必要販売価格が「仕入価格×1.15」ではなく全費用差引後の計算になっている',
      Number(one15.required_sell_price) > naive,
      `必要販売価格 ${Number(one15.required_sell_price).toLocaleString()}円 > 仕入×1.15 ${naive.toLocaleString()}円`,
    );
  }

  // ---------------------------------------------------------------
  section('6. あといくら安く／高くなれば買えるか');
  const disc = await one(`
    SELECT id, name, purchase_price, buyable_purchase_price, discount_needed
      FROM supplier_products
     WHERE discount_needed > 0 AND buyable_purchase_price IS NOT NULL LIMIT 1`);
  check('「あといくら安くなればBUYか」が出ている', disc !== null,
    disc ? `${disc.name}: ${Number(disc.purchase_price).toLocaleString()}円 → ${Number(disc.buyable_purchase_price).toLocaleString()}円（あと${Number(disc.discount_needed).toLocaleString()}円）` : '');
  if (disc) {
    check('差額の計算が合っている',
      Number(disc.purchase_price) - Number(disc.buyable_purchase_price) === Number(disc.discount_needed));
  }

  const up = await one(`
    SELECT id, name, market_price, required_market_price, uplift_needed
      FROM supplier_products
     WHERE uplift_needed > 0 AND required_market_price IS NOT NULL LIMIT 1`);
  check('「あといくら高く売れればBUYか」が出ている', up !== null,
    up ? `${up.name}: ${Number(up.market_price).toLocaleString()}円 → ${Number(up.required_market_price).toLocaleString()}円（あと${Number(up.uplift_needed).toLocaleString()}円）` : '');
  if (up) {
    check('差額の計算が合っている',
      Number(up.required_market_price) - Number(up.market_price) === Number(up.uplift_needed));
  }

  const zeroDisc = await count('discount_needed = 0');
  check('現在価格のままBUY条件を満たす商品がある', zeroDisc > 0, `${zeroDisc}件`);

  // ---------------------------------------------------------------
  section('7. スコアと判定の整合');
  const bad1 = await count('decision = ? AND buy_score < ?', ['STRONG_BUY', t.scoreStrongBuy]);
  check('STRONG BUY はすべて基準点以上', bad1 === 0);
  const bad2 = await count('decision = ? AND (buy_score < ? OR buy_score >= ?)', ['BUY', t.scoreBuy, t.scoreStrongBuy]);
  check('BUY はすべて基準点の範囲内', bad2 === 0);
  const bad3 = await count("decision IN ('STRONG_BUY','BUY') AND skip_reason IS NOT NULL");
  check('除外理由が付いた商品がBUY扱いになっていない', bad3 === 0);
  const bad4 = await count("decision IN ('STRONG_BUY','BUY') AND expected_net_profit < ?", [t.minNetProfit]);
  check('BUY判定はすべて最低純利益を満たす', bad4 === 0);
  const bad5 = await count("decision IN ('STRONG_BUY','BUY') AND expected_roi < ?", [t.minRoi]);
  check('BUY判定はすべて最低ROIを満たす', bad5 === 0);
  const bad6 = await count("decision IN ('STRONG_BUY','BUY') AND market_premium_ratio > ?", [t.maxMarketPremiumRatio]);
  check('BUY判定はすべて相場内で成立する', bad6 === 0);

  const noReason = await all(`
    SELECT COUNT(*) AS n FROM supplier_products sp
     LEFT JOIN analyses a ON a.supplier_product_id = sp.id
     WHERE sp.decision IS NOT NULL AND sp.buy_score IS NOT NULL
       AND (a.reasons_json IS NULL OR a.reasons_json = '')`);
  check('判定した商品には必ず理由が保存されている', Number(noReason[0]?.n ?? 0) === 0);

  // ---------------------------------------------------------------
  section('8. AI費用の関門（AI処理対象を1〜5%に絞る）');
  const aiN = await count('is_ai_candidate = 1');
  const rate = (aiN / total) * 100;
  check('AI候補が全商品の5%以下に絞れている', rate <= 5, `${aiN}/${total}件 = ${rate.toFixed(1)}%`);
  check('AI候補はすべてBUY判定以上（買わない商品にAI費用を払わない）',
    (await count("is_ai_candidate = 1 AND decision NOT IN ('STRONG_BUY','BUY')")) === 0);
  const aiBad = await count('is_ai_candidate = 1 AND expected_net_profit < ?', [t.aiUnitCostJpy * t.aiProfitMultiple]);
  check(`AI候補はすべて想定利益がAI費用の${t.aiProfitMultiple}倍以上`, aiBad === 0);
  const aiBad2 = await count('is_ai_candidate = 1 AND buy_score < ?', [t.aiReviewMinScore]);
  check('AI候補はすべて最低スコア以上', aiBad2 === 0);

  // ---------------------------------------------------------------
  section('9. SHADOW（仮想取引）の記録');
  const shadowN = Number((await one('SELECT COUNT(*) AS n FROM shadow_trades'))?.n ?? 0);
  const buyN = await count("decision IN ('STRONG_BUY','BUY')");
  check('BUY判定した商品はすべて仮想取引として残っている', shadowN === buyN, `仮想取引${shadowN}件 / BUY判定${buyN}件`);
  const shadowOpen = Number((await one("SELECT COUNT(*) AS n FROM shadow_trades WHERE status = 'OPEN'"))?.n ?? 0);
  check('仮想取引は未検証（OPEN）状態で保存されている', shadowOpen === shadowN);
  const shadowRule = Number((await one('SELECT COUNT(DISTINCT rule_version) AS n FROM shadow_trades'))?.n ?? 0);
  check('仮想取引に判定ルール版が記録されている（後から検証できる）', shadowRule > 0);

  // ---------------------------------------------------------------
  section('10. 価格方式の振り分け（新品・型番 / 中古一点物）');
  const stepUp = await count("pricing_mode = 'STEP_UP'");
  const premium = await count("pricing_mode = 'PREMIUM_RATIO'");
  check('新品・型番商品が STEP_UP になっている', stepUp > 0, `${stepUp}件`);
  check('中古一点物が PREMIUM_RATIO になっている', premium > 0, `${premium}件`);
  const wrongMode = await count("pricing_mode = 'PREMIUM_RATIO' AND condition_rank = 'N'");
  check('新品が中古一点物方式になっていない', wrongMode === 0);

  const plan = await one(`
    SELECT pricing_mode, next_price_hint, planned_listing_price, auto_apply
      FROM price_plans WHERE pricing_mode = 'STEP_UP' AND next_price_hint IS NOT NULL LIMIT 1`);
  check('STEP_UP に「売れたら次はこの価格」の候補が入っている', plan !== null,
    plan ? `${Number(plan.planned_listing_price).toLocaleString()}円 → ${Number(plan.next_price_hint).toLocaleString()}円` : '');
  if (plan) {
    const expected = Math.ceil(Number(plan.planned_listing_price) * (1 + t.priceStepUpRate));
    check('値上げ幅が設定どおり（+5%）', Number(plan.next_price_hint) === expected);
  }
  const autoApply = Number((await one('SELECT COUNT(*) AS n FROM price_plans WHERE auto_apply = 1'))?.n ?? 0);
  check('自動値上げが有効になっている計画は1件も無い', autoApply === 0);

  const belowReq = await all(`
    SELECT COUNT(*) AS n FROM price_plans pp
      JOIN supplier_products sp ON sp.id = pp.supplier_product_id
     WHERE pp.planned_listing_price < sp.required_sell_price`);
  check('提案出品価格が必要販売価格を下回っていない', Number(belowReq[0]?.n ?? 0) === 0);

  // ---------------------------------------------------------------
  section('11. 相場倍率の学習（打ち切りを売れ残りと混同しない）');
  const stats = await all('SELECT * FROM premium_ratio_stats ORDER BY sample_count DESC');
  check('販売実績から相場倍率の統計が作られている', stats.length > 0, `${stats.length}セグメント`);
  const censored = Number((await one("SELECT COUNT(*) AS n FROM sales_records WHERE result = 'CENSORED'"))?.n ?? 0);
  check('打ち切り（売れる前に取り下げた）実績が入っている', censored > 0, `${censored}件`);
  const soldOnly = await all(`
    SELECT segment_type, segment_key, COUNT(*) AS n FROM sales_records
     WHERE result = 'SOLD' AND market_premium_ratio IS NOT NULL
     GROUP BY segment_type, segment_key`);
  let statsOk = true;
  for (const s of stats) {
    const m = soldOnly.find((x) => x.segment_type === s.segment_type && x.segment_key === s.segment_key);
    if (!m || Number(m.n) !== Number(s.sample_count)) statsOk = false;
  }
  check('統計の件数が「売れた実績」だけで数えられている（打ち切りを含まない）', statsOk);

  // ---------------------------------------------------------------
  section('12. 人間の確認が必要なものが止まっているか');
  const mr = await count("pipeline_state = 'MANUAL_REVIEW'");
  check('人間の確認まちが1件以上ある（自動で判断していない）', mr > 0, `${mr}件`);
  const unknownCond = await count("needs_review_reason LIKE 'UNKNOWN_CONDITION:%'");
  check('意味の分からない状態表記が推測されず確認まちになっている', unknownCond > 0, `${unknownCond}件`);
  const mrBuy = await count("pipeline_state = 'MANUAL_REVIEW' AND decision IN ('STRONG_BUY','BUY')");
  check('確認まちの商品がBUY扱いになっていない', mrBuy === 0);

  // ---------------------------------------------------------------
  section('13. 安全確認（Phase 1 は金銭を動かさない）');
  check('自動購入がOFF', config.autoBuy === false);
  check('自動出品がOFF', config.autoListing === false);
  check('自動値付け変更がOFF', config.autoReprice === false);
  check('自動注文処理がOFF', config.autoOrderProcessing === false);
  check('自動再仕入がOFF', config.autoReorder === false);
  check('動作モードがSAFE', config.autoMode === 'SAFE');
  check('金銭を動かす処理が実装されていない', MONEY_ACTIONS_IMPLEMENTED === false);
  check('AI（LLM）呼び出しがOFF', config.aiEnabled === false);

  const autoSuppliers = await all("SELECT code FROM suppliers WHERE cap_purchase = 'api'");
  check('自動購入できる仕入先が1社も登録されていない', autoSuppliers.length === 0);
  const autoChannels = await all("SELECT code FROM channels WHERE cap_list = 'api'");
  check('自動出品できる販路が1社も登録されていない', autoChannels.length === 0);

  // ---------------------------------------------------------------
  section('14. 判定ルール版（後から検証できるか）');
  const rv = await all('SELECT DISTINCT rule_version FROM analyses');
  check('全分析に同じ判定ルール版が記録されている', rv.length === 1, rv.map((r) => r.rule_version).join(', '));

  const estimated = await count('fees_estimated = 1');
  check('手数料が概算のものに「概算」の印が付いている', estimated > 0, `${estimated}件`);

  // ---------------------------------------------------------------
  console.log('\n' + '='.repeat(60));
  const topRows = await all(`
    SELECT name, supplier_code, purchase_price, market_price, expected_net_profit,
           expected_roi, buy_score, decision
      FROM supplier_products WHERE decision IN ('STRONG_BUY','BUY')
     ORDER BY buy_score DESC, expected_net_profit DESC LIMIT 5`);
  console.log('仕入候補の上位5件：');
  for (const r of topRows) {
    console.log(
      `  ${String(r.decision).padEnd(10)} ${String(r.buy_score).padStart(3)}点  ` +
      `利益 ${Number(r.expected_net_profit).toLocaleString().padStart(9)}円  ` +
      `ROI ${(Number(r.expected_roi) * 100).toFixed(1).padStart(5)}%  ${r.name}`,
    );
  }

  console.log('='.repeat(60));
  console.log(`合格 ${passed}件 / 不合格 ${failures.length}件`);
  if (failures.length > 0) {
    console.log('\n不合格の項目：');
    for (const f of failures) console.log(`  - ${f}`);
    process.exit(1);
  }
  console.log('Phase 1 の受け入れ条件をすべて満たしています。');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
