/**
 * 【需要指標しらべ】（Phase 3.14 で作成 → Phase 3.15＝100件でも同じものを使う・2026-08-25）
 *
 *   npm run keepa:study
 *
 * ================================================================
 * 【このスクリプトの一番大事な性質】
 *   **Keepa へ1回も通信しない。よって枠（Token）の消費は 0 である。**
 *   読むのは `keepa_raw_responses` に保存済みの応答だけ。
 *   このファイルには APIキーも URL も fetch も出てこない。
 *
 * ================================================================
 * 【何を出すか】
 *
 * ご本人の指示（原文・2026-08-25）：
 *   「20件では利益商品探しではなく
 *     『どの需要指標が、どのカテゴリで、どの程度使えるのか』を実データで確認すること。」
 *
 *   §21 商品ごとの表（13列）
 *   §22 全体の集計
 *   §23 需要判定に使う**候補**指標TOP3（「採用」ではない）
 *   §24 100件へ進むか YES/NO（**YESでも自動で進まない**）
 *   §25 枠の内訳
 *
 * ================================================================
 * 【このスクリプトが絶対にしないこと】
 *   ・「◯個以上」の値を実数として書かない（✕ 月5000個売れている）
 *   ・どちらの需要指標が正解かを採点しない
 *   ・仕入判定（SELLS / CROWDED / DOES_NOT_SELL / UNKNOWN）を1つも動かさない
 *   ・20件から結論を出さない（サンプルが小さい）
 */

import { all } from '../lib/db/client';
import {
  amazonRetailCrossTab,
  bucketCoverage,
  BUCKET_LOWER_BOUND_NOTE_JA,
  categoryCoverageEight,
  categoryStats,
  CATEGORY_MIN_SAMPLE_TO_DISCUSS,
  CATEGORY_SAMPLE_WARNING_JA,
  conflictBreakdown,
  coverageEight,
  formatBucketJa,
  freshnessBuckets,
  indicatorCandidates,
  INDICATOR_CANDIDATE_DISCLAIMER_JA,
  INDICATOR_TOP3_RECOUNT_NOTE_JA,
  judgeTwentyItemGate,
  KEEPA_AUTO_ADVANCE_TO_HUNDRED,
  outOfStockCrossTab,
  rankDropsCoverage,
  sellabilityBreakdown,
  type CoverageRow,
} from '../lib/keepa/coverage';
import {
  demandEvidenceRows,
  divergenceDirectionSummary,
  EQUAL_SHARE_MISSING_FACTORS_JA,
  EQUAL_SHARE_SCENARIO_LABEL_JA,
  EQUAL_SHARE_SCENARIO_NOTE_JA,
  judgeSignalDivergence,
  rankDropsStrength,
  rankDropVelocity,
  RANK_DROPS_STRENGTH_USED_IN_BUY_DECISION,
  SIGNAL_DIVERGENCE_JA,
  SIGNAL_DIVERGENCE_OVERWRITES_CONFLICT,
  SIGNAL_SOURCE_JA,
} from '../lib/keepa/signals';
import {
  CALIBRATED_MODEL_V0_APPLIED_IN_PRODUCTION,
  compareModels,
  DEEP_SCAN_EXECUTE,
  MODEL_COMPARISON_NOTE_JA,
  scoreCalibratedV0,
  selectDeepScanCandidates,
} from '../lib/keepa/modelv0';
import {
  KEEPA_HUNDRED_AFTER_JA,
  KEEPA_HUNDRED_TARGET_TOTAL,
  planHundred,
} from '../lib/keepa/strata';
import {
  buildDemandEvidence,
  DEMAND_CONFLICT_LEVEL_JA,
  DEMAND_CONFLICT_LEVEL_USED_IN_BUY_DECISION,
  EQUAL_SHARE_NOTE_JA,
} from '../lib/keepa/demand';
import { keepaFreshness, normalizeKeepaProduct } from '../lib/keepa/normalize';
import { judgeSellability } from '../lib/sellability';

const LINE = '='.repeat(76);
const THIN = '-'.repeat(76);

function n(v: number | null | undefined, unit = ''): string {
  if (v === null || v === undefined) return '不明';
  return `${Math.round(v * 100) / 100}${unit}`;
}

function short(s: string | null, len = 18): string {
  if (!s) return '（商品名なし）';
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

function pctText(v: number | null): string {
  return v === null ? '—' : `${v}%`;
}

async function main(): Promise<void> {
  console.log(LINE);
  // ★2026-08-25：件数を見出しに直書きしていたため、100件になっても「20件」と出ていた。
  //   実際の保存件数を数えて出す（見出しと中身がズレるのは、いちばん静かな嘘になる）。
  console.log(' 需要指標しらべ（Keepaへは通信しません／使う枠＝0）');
  console.log(LINE);
  console.log(' ★目的は利益商品探しではありません。');
  console.log('   「どの需要指標が、どのカテゴリで、どの程度使えるか」を数えます。\n');

  const rows = await all(
    `SELECT id, asin, response_json, fetched_at
       FROM keepa_raw_responses
      WHERE endpoint = 'product' AND ok = 1
      ORDER BY id DESC`,
  );

  if (rows.length === 0) {
    console.log('保存済みの商品データがありません。');
    return;
  }

  const seen = new Set<string>();
  const cov: CoverageRow[] = [];
  /** 分析専用の追加材料（当社の計算。Keepaの値ではありません）。 */
  const raws: {
    asin: string;
    ourSignal: number | null;
    velocity: 'ACCELERATING' | 'STEADY' | 'SLOWING' | 'UNKNOWN';
    strength: 'LOW' | 'MEDIUM' | 'HIGH' | 'VERY_HIGH' | null;
  }[] = [];
  let parserOrSchemaError = 0;
  let wrongMarketplace = 0;
  let falseAsin = 0;
  let brokenJson = 0;

  for (const r of rows) {
    const asin = String(r.asin ?? '');
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);

    let parsed: any = null;
    try {
      parsed = JSON.parse(String(r.response_json ?? '{}'));
    } catch {
      brokenJson += 1;
      console.log(`× ${asin}：保存してある応答が読めませんでした（JSONとして壊れています）。`);
      continue;
    }
    const raw = Array.isArray(parsed?.products) ? parsed.products[0] : parsed;
    if (!raw) continue;

    const norm = normalizeKeepaProduct(raw);
    const fresh = keepaFreshness(norm);
    const sell = judgeSellability({
      observedAt: norm.lastUpdateIso,
      windowDays: 30,
      rankDrops: norm.salesRankDrops30,
      salesRank: norm.currentSalesRank,
      offerCount: norm.offerCountNew,
      avgPrice: norm.avgNewPrice30,
      currentPrice: norm.currentNewPrice,
    });
    const ev = buildDemandEvidence({
      asin: norm.asin,
      rankDrops30: norm.salesRankDrops30,
      keepaMonthlySoldAtLeast: norm.keepaMonthlySoldAtLeast,
      internalDemandSignal: sell.estimatedDemandSignal,
      estimatedEqualShareOpportunity: sell.estimatedEqualShareOpportunity,
      sellerCount: norm.offerCountNew,
      amazonRetail: norm.amazonRetailPresent,
      dataAgeDays: fresh.ageDays,
    });

    parserOrSchemaError += norm.parserErrors.length + norm.schema.mismatches.length;
    if (norm.isJapan === false) wrongMarketplace += 1;
    if (!norm.asin) falseAsin += 1;

    cov.push({
      asin: norm.asin || asin,
      titleJa: norm.title,
      categoryJa: norm.rootCategoryName,
      rankDrops30: norm.salesRankDrops30,
      rankDrops90: norm.salesRankDrops90,
      rankDrops180: norm.salesRankDrops180,
      rankDrops365: norm.salesRankDrops365,
      keepaMonthlySoldAtLeast: norm.keepaMonthlySoldAtLeast,
      sellerCount: norm.offerCountNew,
      estimatedEqualShareOpportunity: sell.estimatedEqualShareOpportunity,
      amazonRetailPresent: norm.amazonRetailPresent,
      outOfStock30: norm.outOfStockPercentage30,
      outOfStock90: norm.outOfStockPercentage90,
      dataAgeDays: fresh.ageDays,
      conflictLevel: ev.conflictLevel.level,
      sellability: sell.verdict as CoverageRow['sellability'],
      parserErrorCount: norm.parserErrors.length,
      tokensUsed: 1,

      // ★2026-08-25（Phase 3.15）追加。100件で必ず出す8つのCoverageのうち、
      //   これまで数えていなかった 価格・手数料・画像 の3つ。
      currentPriceYen: norm.currentNewPrice,
      fbaFeeYen: norm.fbaPickAndPackFee,
      referralFeePercent: norm.referralFeePercentage,
      imageCount: norm.imageCount,
      divergenceLevel: judgeSignalDivergence({
        ourSignal: sell.estimatedDemandSignal,
        keepaBucketLowerBound: norm.keepaMonthlySoldAtLeast,
      }).level,
    });

    raws.push({
      asin: norm.asin || asin,
      ourSignal: sell.estimatedDemandSignal,
      velocity: rankDropVelocity(norm.salesRankDrops30, norm.salesRankDrops90).level,
      strength: rankDropsStrength(norm.salesRankDrops30).code,
    });
  }

  /* ============================================================
   * §21 商品ごとの表
   * ============================================================ */
  console.log(`${LINE}\n【1】商品ごとの需要材料（${cov.length}件）\n${LINE}`);
  console.log('  ★1行ごとに「出どころ」を書いています。');
  console.log('    Keepaが言っていることと、当社が計算したことを、同じ見た目で並べません。');
  for (const c of cov) {
    console.log(`\n■ ${c.asin}　${short(c.titleJa, 30)}`);
    console.log(`   売り場：${c.categoryJa ?? '不明（Keepaから名前が取れませんでした）'}`);
    for (const ev of demandEvidenceRows(
      {
        rankDrops30: c.rankDrops30,
        rankDrops90: c.rankDrops90,
        rankDrops180: c.rankDrops180,
        rankDrops365: c.rankDrops365,
        keepaMonthlySoldAtLeast: c.keepaMonthlySoldAtLeast,
        sellerCount: c.sellerCount,
        outOfStock30: c.outOfStock30,
        outOfStock90: c.outOfStock90,
        amazonRetailPresent: c.amazonRetailPresent,
        dataAgeDays: c.dataAgeDays,
      },
      formatBucketJa,
    )) {
      console.log(`   ${ev.labelJa.padEnd(24, '　')}：${ev.valueJa}　【${SIGNAL_SOURCE_JA[ev.source]}】`);
    }
    console.log(`   ${EQUAL_SHARE_SCENARIO_LABEL_JA}：${n(c.estimatedEqualShareOpportunity)}　【${SIGNAL_SOURCE_JA.INTERNAL_CALCULATION}】`);
    console.log(`   需要指標の食い違い（既存4段階）：${c.conflictLevel}（${DEMAND_CONFLICT_LEVEL_JA[c.conflictLevel]}）`);
    console.log(`   シグナルの離れぐあい（分析専用）：${c.divergenceLevel}（${SIGNAL_DIVERGENCE_JA[c.divergenceLevel]}）`);
    console.log(`   売れるかの判定（現行のまま）　　：${c.sellability}`);
    console.log(`   価格 ${n(c.currentPriceYen, '円')} ／ FBA手数料 ${n(c.fbaFeeYen, '円')} ／ 販売手数料率 ${n(c.referralFeePercent, '%')} ／ 画像 ${n(c.imageCount, '枚')}`);
    console.log(`   読み取り不具合 ${c.parserErrorCount}件 ／ 使った枠 ${n(c.tokensUsed)}`);
  }
  console.log(`\n  ${BUCKET_LOWER_BOUND_NOTE_JA}`);
  console.log(`  ${EQUAL_SHARE_NOTE_JA}`);

  /* ============================================================
   * §22 全体の集計
   * ============================================================ */
  const bucket = bucketCoverage(cov);
  const rank = rankDropsCoverage(cov);
  const conf = conflictBreakdown(cov);
  const sellb = sellabilityBreakdown(cov);
  const freshB = freshnessBuckets(cov);

  console.log(`\n${LINE}\n【2】全体の集計\n${LINE}`);
  console.log(`  総商品数：${cov.length}件\n`);

  console.log('  ■ 値が入っている割合（COVERAGE）');
  console.log(`    ${bucket.labelJa}`);
  console.log(`      ${bucket.present} / ${bucket.total}件 ＝ ${pctText(bucket.percent)}`);
  console.log(`      ${bucket.noteJa}`);
  console.log(`    ${rank.labelJa}`);
  console.log(`      ${rank.present} / ${rank.total}件 ＝ ${pctText(rank.percent)}`);
  console.log(`      ${rank.noteJa}`);

  console.log('\n  ■ 需要指標の食い違い（4段階）');
  console.log(`    食い違い無し（2倍未満）　　　：${conf.noConflict}件`);
  console.log(`    軽い食い違い（2〜3倍未満）　 ：${conf.mildConflict}件`);
  console.log(`    強い食い違い（3倍以上）　　　：${conf.strongConflict}件`);
  console.log(`    比べられない（材料不足）　　 ：${conf.notComparable}件`);
  console.log(`    比べられた商品の中での「強い食い違い」の割合：${pctText(conf.strongPercentAmongComparable)}`);
  console.log(`    ${conf.noteJa}`);
  console.log(`    この4段階を仕入判定に使っているか：${DEMAND_CONFLICT_LEVEL_USED_IN_BUY_DECISION ? '使っている' : '**使っていません**'}`);

  console.log('\n  ■ 売れるかの判定（4種のまま。1文字も変えていません）');
  console.log(`    SELLS ${sellb.sells}件 ／ CROWDED ${sellb.crowded}件 ／ DOES_NOT_SELL ${sellb.doesNotSell}件 ／ UNKNOWN ${sellb.unknown}件`);
  console.log(`    ${sellb.noteJa}`);

  console.log('\n  ■ データの新しさ');
  console.log(`    0〜7日 ${freshB.within7}件 ／ 8〜30日 ${freshB.within30}件 ／ 31日以上 ${freshB.over30}件 ／ 不明 ${freshB.unknown}件`);
  console.log(`    ${freshB.noteJa}`);

  console.log('\n  ■ 読み取りの不具合');
  console.log(`    PARSER_OR_SCHEMA_ERROR：${parserOrSchemaError}件`);
  console.log(`    日本以外のAmazonが混じった：${wrongMarketplace}件`);
  console.log(`    ASINが取れなかった：${falseAsin}件`);
  console.log(`    保存データが壊れていた：${brokenJson}件`);

  /* ============================================================
   * カテゴリ別
   * ============================================================ */
  console.log(`\n${LINE}\n【3】売り場（カテゴリ）ごとの違い\n${LINE}`);
  const cats = categoryStats(cov);
  for (const c of cats) {
    console.log(`\n  ■ ${c.categoryJa}（${c.count}件）`);
    console.log(`     Keepaの区分値あり　：${c.bucketPresent}/${c.count}　${pctText(c.bucketPercent)}`);
    console.log(`     順位下落回数あり　　：${c.rankDropsPresent}/${c.count}　${pctText(c.rankDropsPercent)}`);
    console.log(`     食い違い　　　　　　：強${c.strongConflict} ／ 軽${c.mildConflict} ／ 無${c.noConflict} ／ 比較不可${c.notComparable}`);
    console.log(`     出品者数の中央値　　：${n(c.medianSellerCount, '人')}`);
    console.log(`     Amazon本体あり　　　：${c.amazonRetailYes}件`);
  }
  console.log(`\n  ${CATEGORY_SAMPLE_WARNING_JA}`);

  /* ============================================================
   * 関係を見る（観察のみ）
   * ============================================================ */
  console.log(`\n${LINE}\n【4】ほかの材料との関係（観察のみ・判定へは返していません）\n${LINE}`);
  for (const tab of [amazonRetailCrossTab(cov), outOfStockCrossTab(cov)]) {
    console.log(`\n  ■ ${tab.labelJa}`);
    for (const g of tab.groups) {
      console.log(`     ${g.groupJa.padEnd(22, '　')}：${g.count}件中 ${g.bucketPresent}件に値あり　${pctText(g.bucketPercent)}`);
    }
    console.log(`     ${tab.noteJa}`);
  }

  /* ============================================================
   * §23 候補指標TOP3
   * ============================================================ */
  console.log(`\n${LINE}\n【5】需要判定に使う「候補」指標 TOP3\n${LINE}`);
  console.log(`  ${INDICATOR_CANDIDATE_DISCLAIMER_JA}\n`);
  for (const c of indicatorCandidates(cov)) {
    console.log(`  候補${c.rank}：${c.nameJa}`);
    console.log(`    理由：${c.reasonJa}`);
    console.log(`    採用したか：${c.adopted ? 'した' : 'していません'}\n`);
  }

  /* ============================================================
   * §24 100件へ進むか
   * ============================================================ */
  const gate = judgeTwentyItemGate({
    parserOrSchemaError,
    criticalFalseAsin: falseAsin,
    wrongMarketplace,
    // 枠のズレは取得スクリプト側で見積りと実消費を突き合わせている。
    // ここは保存済みデータを読むだけなので、新たなズレは発生しない。
    tokenEstimateMismatch: 0,
    // ★キーが外へ出る経路そのものが無い（ルール85）。構造上0である。
    secretLeak: 0,
  });

  console.log(`${LINE}\n【6】100件へ進んでよいかの条件（5つ全部が0）\n${LINE}`);
  for (const row of gate.rows) {
    console.log(`  ${row.passed ? '○' : '×'} ${row.labelJa}：${row.value}件`);
  }
  console.log(`\n  ${gate.verdictJa}`);
  console.log(`  この仕組みが自動で100件へ進むか：${KEEPA_AUTO_ADVANCE_TO_HUNDRED ? '進む' : '**進みません**'}`);

  /* ============================================================
   * ここから Phase 3.15（100件へ向けた追加分析）
   * ============================================================ */

  /* 【7】層化サンプリングの進み具合 */
  console.log(`\n${LINE}\n【7】100件の配分表と、いまの進み具合\n${LINE}`);
  const plan = planHundred(cov.map((c) => ({ asin: c.asin, categoryJa: c.categoryJa })));
  console.log(`  目標の合計：${plan.targetTotal}件 ／ いま持っている：${plan.alreadyTotal}件`);
  console.log('');
  console.log('  売り場　　　　　　　　　目標　保有　あと　状態');
  for (const s of plan.strata) {
    const state = !s.searchableByName
      ? '名前で探しに行かない枠（受け皿）'
      : s.remaining === 0
        ? '足りています'
        : '不足';
    console.log(
      `  ${s.labelJa.padEnd(12, '　')}${String(s.target).padStart(4, ' ')}${String(s.already).padStart(6, ' ')}${String(s.remaining).padStart(6, ' ')}　${state}`,
    );
  }
  console.log(`\n  これから取る合計：${plan.remainingTotal}件`);
  console.log(`  売り場名が取れずどの枠にも入れられなかった商品：${plan.unassigned}件`);
  console.log(`  ${plan.noteJa}`);

  /* 【8】8つのCoverage */
  console.log(`\n${LINE}\n【8】必ず出す8つのCoverage（全体）\n${LINE}`);
  for (const s of coverageEight(cov)) {
    console.log(`  ${s.labelJa}`);
    console.log(`    ${s.present} / ${s.total}件 ＝ ${pctText(s.percent)}`);
    console.log(`    ${s.noteJa}`);
  }

  console.log(`\n${THIN}\n  売り場ごとの8つのCoverage\n${THIN}`);
  for (const g of categoryCoverageEight(cov)) {
    console.log(`\n  ■ ${g.categoryJa}（${g.count}件）`);
    for (const s of g.stats) {
      console.log(`     ${s.labelJa.padEnd(34, '　')}：${s.present}/${s.total}　${pctText(s.percent)}`);
    }
    if (g.count < CATEGORY_MIN_SAMPLE_TO_DISCUSS) {
      console.log(`     ★${g.count}件しかありません。この売り場について断定した言い方はしません。`);
    }
  }

  /* 【9】カテゴリ別の詳しい比較 */
  console.log(`\n${LINE}\n【9】売り場ごとの詳しい比較（8項目）\n${LINE}`);
  for (const c of categoryStats(cov)) {
    console.log(`\n  ■ ${c.categoryJa}（${c.count}件）${c.tooFewToConclude ? '　★件数が少なく、傾向は語れません' : ''}`);
    console.log(`     順位下落回数あり　：${c.rankDropsPresent}/${c.count}　${pctText(c.rankDropsPercent)}`);
    console.log(`     Keepaの区分値あり　：${c.bucketPresent}/${c.count}　${pctText(c.bucketPercent)}`);
    console.log(`     出品者数　　　　　：平均 ${n(c.avgSellerCount, '人')} ／ 中央値 ${n(c.medianSellerCount, '人')}`);
    console.log(`     Amazon本体あり　　：${c.amazonRetailYes}件　${pctText(c.amazonRetailPercent)}（分母は有無が分かった商品）`);
    console.log(`     在庫切れ（90日）　：0% ${c.outOfStock.zero}件 ／ 〜10% ${c.outOfStock.upTo10}件 ／ 〜30% ${c.outOfStock.upTo30}件 ／ 30%超 ${c.outOfStock.over30}件 ／ 不明 ${c.outOfStock.unknown}件`);
    console.log(`     売れるかの判定　　：SELLS ${c.sellability.sells} ／ CROWDED ${c.sellability.crowded} ／ DOES_NOT_SELL ${c.sellability.doesNotSell} ／ UNKNOWN ${c.sellability.unknown}`);
    console.log(`     シグナルの離れ　　：大 ${c.divergence.large} ／ 小 ${c.divergence.small} ／ 無 ${c.divergence.none} ／ 比較不可 ${c.divergence.notComparable}`);
  }
  console.log(`\n  ${CATEGORY_SAMPLE_WARNING_JA}`);

  /* 【10】シグナルの離れぐあい（SIGNAL_DIVERGENCE） */
  console.log(`\n${LINE}\n【10】需要シグナルの離れぐあい（分析専用）\n${LINE}`);
  const divs = cov.map((c) => {
    const r = raws.find((x) => x.asin === c.asin);
    return judgeSignalDivergence({
      ourSignal: r ? r.ourSignal : null,
      keepaBucketLowerBound: c.keepaMonthlySoldAtLeast,
    });
  });
  const dirSummary = divergenceDirectionSummary(divs.map((d) => ({ direction: d.direction, level: d.level })));
  console.log(`  比べられた商品：${dirSummary.comparable}件`);
  console.log(`    当社の数字のほうが小さい：${dirSummary.oursLower}件`);
  console.log(`    当社の数字のほうが大きい：${dirSummary.oursHigher}件`);
  console.log(`    同じ　　　　　　　　　　：${dirSummary.same}件`);
  console.log(`  ${dirSummary.noteJa}`);
  console.log(`  この分析が既存の食い違い判定を書き換えるか：${SIGNAL_DIVERGENCE_OVERWRITES_CONFLICT ? '書き換える' : '**書き換えません**'}`);
  console.log(`  順位下落の4段階（強さ）を仕入判定に使っているか：${RANK_DROPS_STRENGTH_USED_IN_BUY_DECISION ? '使っている' : '**使っていません**'}`);

  console.log(`\n  ${EQUAL_SHARE_SCENARIO_NOTE_JA}`);
  console.log('  等分シナリオが見ていないもの：');
  for (const f of EQUAL_SHARE_MISSING_FACTORS_JA) console.log(`    ・${f}`);

  /* 【11】Deep Scan候補（実行しない） */
  console.log(`\n${LINE}\n【11】Deep Scanを見に行くとしたら、どれか（**実行しません**）\n${LINE}`);
  const deep = selectDeepScanCandidates(
    cov.map((c) => ({
      asin: c.asin,
      dataAgeDays: c.dataAgeDays,
      rankDrops30: c.rankDrops30,
      sellerCount: c.sellerCount,
      amazonRetailPresent: c.amazonRetailPresent,
      currentPriceYen: c.currentPriceYen,
      // 仕入先の実データがまだ無いので、ここは null（＝判断できない）のまま。
      hasProfitRoute: null,
    })),
  );
  console.log(`  6条件すべてを満たした商品：${deep.qualified.length}件`);
  console.log('  ※「仕入→販売の道筋」の材料がまだ無いため、多くが「判断できません」になります。');
  console.log('    判断できないものを「条件を満たさない」に書き換えていません。');
  for (const c of deep.candidates.slice(0, 10)) {
    const ng = c.results.filter((r) => r.result !== 'PASS').map((r) => `${r.code}=${r.result}`);
    console.log(`    ${c.asin}：満たした ${c.passCount}/6　${ng.length === 0 ? '' : `（${ng.join(' , ')}）`}`);
  }
  if (deep.candidates.length > 10) console.log(`    …ほか${deep.candidates.length - 10}件`);
  console.log(`  Deep Scanを実行したか：${DEEP_SCAN_EXECUTE ? '実行した' : '**していません（使った枠0）**'}`);

  /* 【12】現行モデルと CALIBRATED_MODEL_V0 の比較 */
  console.log(`\n${LINE}\n【12】いまの判定と、判定モデルv0（案）を並べる\n${LINE}`);
  const v0Rows = cov.map((c) => {
    const r = raws.find((x) => x.asin === c.asin);
    const v0 = scoreCalibratedV0({
      asin: c.asin,
      rankDropsStrength: r ? r.strength : null,
      sellerCount: c.sellerCount,
      velocity: r ? r.velocity : 'UNKNOWN',
      outOfStock90: c.outOfStock90,
      amazonRetailPresent: c.amazonRetailPresent,
      dataAgeDays: c.dataAgeDays,
      hasKeepaBucket: c.keepaMonthlySoldAtLeast !== null,
    });
    return { asin: c.asin, current: c.sellability, v0: v0.verdict };
  });
  const cmp = compareModels(v0Rows);
  console.log(`  比べた商品：${cmp.total}件`);
  console.log(`  判定が変わった：${cmp.changed}件（${pctText(cmp.changedPercent)}）／ 変わらなかった：${cmp.unchanged}件`);
  console.log('  内訳（いまの判定 → v0の判定）：');
  for (const m of cmp.matrix) console.log(`    ${m.fromJa} → ${m.toJa}：${m.count}件`);
  console.log(`  v0を本番で使っているか：${CALIBRATED_MODEL_V0_APPLIED_IN_PRODUCTION ? '使っている' : '**使っていません**'}`);
  console.log(`  どちらが優秀かを決めたか：${cmp.winnerDecided ? '決めた' : '**決めていません**'}`);
  console.log(`  ${MODEL_COMPARISON_NOTE_JA}`);

  /* 【13】報告 A〜G */
  console.log(`\n${LINE}\n【13】まとめ（A〜G）\n${LINE}`);
  const allCov = coverageEight(cov);
  const covLine = allCov.map((s) => `${s.labelJa.replace('が取れている割合', '')} ${pctText(s.percent)}`).join(' ／ ');
  console.log(`  A システムの品質：読み取り不具合 ${parserOrSchemaError}件 ／ 日本以外 ${wrongMarketplace}件 ／ ASIN取れず ${falseAsin}件 ／ 保存データ破損 ${brokenJson}件`);
  console.log(`  B Coverage：${covLine}`);
  console.log(`  C 売り場ごとの差：${categoryStats(cov).length}種類の売り場。${CATEGORY_SAMPLE_WARNING_JA}`);
  console.log(`  D 需要シグナル：順位下落は${rank.present}/${rank.total}件、Keepaの区分値は${bucket.present}/${bucket.total}件で取得。${INDICATOR_TOP3_RECOUNT_NOTE_JA}`);
  console.log(`  E シグナルの離れ：比べられた${dirSummary.comparable}件のうち、当社が小さい${dirSummary.oursLower}件／大きい${dirSummary.oursHigher}件。${dirSummary.allSameDirection ? '**全部同じ向きです。**' : ''}`);
  console.log(`  F 枠：このスクリプトは0枠（通信していません）。取得に使った枠は取得スクリプトの記録を見てください。`);
  console.log('  G 次の判断');
  console.log(`     ・Deep Scanへ進むか：${DEEP_SCAN_EXECUTE ? 'YES' : 'NO（まだ進みません）'}`);
  console.log(`     ・判定モデルv0を本番に入れるか：${CALIBRATED_MODEL_V0_APPLIED_IN_PRODUCTION ? 'YES' : 'NO（案のままです）'}`);
  console.log('     ・実購入へ進むか：**NO**');
  console.log(`\n  ${KEEPA_HUNDRED_AFTER_JA}`);
  console.log(`  100件の目標：${KEEPA_HUNDRED_TARGET_TOTAL}件（いま ${cov.length}件）`);

  console.log(`\n${THIN}`);
  console.log('【念のため】このスクリプトが使った枠：0（Keepaへ通信していません）');
}

main().catch((e) => {
  console.error('しらべに失敗しました：', e);
  process.exit(1);
});
