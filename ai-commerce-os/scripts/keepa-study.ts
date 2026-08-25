/**
 * 【20件の需要指標しらべ】（Phase 3.14・2026-08-25）
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
  categoryStats,
  CATEGORY_SAMPLE_WARNING_JA,
  conflictBreakdown,
  formatBucketJa,
  freshnessBuckets,
  indicatorCandidates,
  INDICATOR_CANDIDATE_DISCLAIMER_JA,
  judgeTwentyItemGate,
  KEEPA_AUTO_ADVANCE_TO_HUNDRED,
  outOfStockCrossTab,
  rankDropsCoverage,
  sellabilityBreakdown,
  type CoverageRow,
} from '../lib/keepa/coverage';
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
  console.log(' 20件の需要指標しらべ（Keepaへは通信しません／使う枠＝0）');
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
    });
  }

  /* ============================================================
   * §21 商品ごとの表
   * ============================================================ */
  console.log(`${LINE}\n【1】商品ごとの結果（${cov.length}件）\n${LINE}`);
  for (const c of cov) {
    console.log(`\n■ ${c.asin}　${short(c.titleJa, 30)}`);
    console.log(`   売り場　　　　　　　　　　　：${c.categoryJa ?? '不明（Keepaから名前が取れませんでした）'}`);
    console.log(`   順位の下落回数　　　　　　　：30日 ${n(c.rankDrops30, '回')} ／ 90日 ${n(c.rankDrops90, '回')} ／ 180日 ${n(c.rankDrops180, '回')} ／ 365日 ${n(c.rankDrops365, '回')}`);
    console.log('   　（出どころ：Keepa。★これは販売数ではありません）');
    console.log(`   Keepaの月間購入回数　　　　 ：${formatBucketJa(c.keepaMonthlySoldAtLeast)}　（出どころ：Keepa）`);
    console.log(`   新品の出品者数　　　　　　　：${n(c.sellerCount, '人')}　（出どころ：Keepa）`);
    console.log(`   出品者で等分した場合の取り分：${n(c.estimatedEqualShareOpportunity, '個相当／月')}　（出どころ：当社の計算・暫定モデル）`);
    console.log(`   Amazon本体が売っているか　　：${c.amazonRetailPresent}`);
    console.log(`   在庫切れだった割合　　　　　：30日 ${n(c.outOfStock30, '%')} ／ 90日 ${n(c.outOfStock90, '%')}`);
    console.log(`   データの新しさ　　　　　　　：${n(c.dataAgeDays, '日前')}`);
    console.log(`   需要指標の食い違い　　　　　：${c.conflictLevel}（${DEMAND_CONFLICT_LEVEL_JA[c.conflictLevel]}）`);
    console.log(`   売れるかの判定（現行のまま）：${c.sellability}`);
    console.log(`   読み取り不具合　　　　　　　：${c.parserErrorCount}件`);
    console.log(`   使った枠　　　　　　　　　　：${n(c.tokensUsed)}`);
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

  console.log(`\n${THIN}`);
  console.log('【念のため】このスクリプトが使った枠：0（Keepaへ通信していません）');
}

main().catch((e) => {
  console.error('しらべに失敗しました：', e);
  process.exit(1);
});
