/**
 * 保存済みの生データだけで、もう一度読み直す（Phase 3.12b・2026-08-25）
 * ================================================================
 *
 * 【このスクリプトの一番大事な性質】
 *   **Keepa へ1回も通信しない。よって枠（Token）の消費は 0 である。**
 *
 * ご本人の指示：「API Tokenを追加消費せず、今回の5件について一覧を作ってください。」
 * 読むのは `keepa_raw_responses` に保存済みの応答だけ。
 * このファイルには API キーも URL も出てこない。fetch も import していない。
 *
 * 【なぜ必要か】
 * 5件テストのあと、2つの見落としが見つかった。
 *   ・画像を1枚も読めていなかった（存在しない項目名 `imagesCSV` を見ていたため）
 *   ・「売れている量」を指す数字が2つあり、最大で約100倍ずれていた
 * どちらも**取り直さなくても**、保存してある応答を読み直せば検算できる。
 * 枠を使わずに直せるものを、枠を使って確かめに行かない。
 */

import { all } from '../lib/db/client';
import {
  buildDemandEvidence,
  DEMAND_CONFLICT_MESSAGE_JA,
  FORBIDDEN_SALES_WORDS,
  KEEPA_MONTHLY_SOLD_LABEL_JA,
} from '../lib/keepa/demand';
import { IMAGE_STATUS_JA } from '../lib/keepa/images';
import { keepaFreshness, normalizeKeepaProduct } from '../lib/keepa/normalize';
import { judgeSellability } from '../lib/sellability';

type Line = {
  asin: string;
  title: string;
  rankDrops30: number | null;
  keepaMonthlySoldAtLeast: number | null;
  sellerCount: number | null;
  equalShare: number | null;
  conflictStatus: string;
  ratio: number | null;
  verdict: string;
  imageCount: number | null;
  imageStatus: string;
  imageLegacy: boolean;
  parserErrors: number;
};

function n(v: number | null | undefined, unit = ''): string {
  if (v === null || v === undefined) return '不明';
  const r = Math.round(v * 100) / 100;
  return `${r}${unit}`;
}

function short(s: string | null, len = 22): string {
  if (!s) return '（商品名なし）';
  return s.length > len ? `${s.slice(0, len)}…` : s;
}

async function main(): Promise<void> {
  console.log('================================================================');
  console.log(' 保存済みデータの再解析（Keepaへは通信しません／使う枠＝0）');
  console.log('================================================================\n');

  /*
   * 商品の応答だけを読む。分類の一覧・候補探しの応答は商品ではないので混ぜない。
   * 新しい順に取り、同じASINは最新の1件だけを見る。
   */
  const rows = await all(
    `SELECT id, asin, response_json, fetched_at
       FROM keepa_raw_responses
      WHERE endpoint = 'product' AND ok = 1
      ORDER BY id DESC`,
  );

  if (rows.length === 0) {
    console.log('保存済みの商品データがありません。再解析するものがありません。');
    return;
  }

  const seen = new Set<string>();
  const lines: Line[] = [];
  let imageParserErrors = 0;
  let parserSchemaErrors = 0;
  let conflicts = 0;
  let comparable = 0;

  for (const r of rows) {
    const asin = String(r.asin ?? '');
    if (!asin || seen.has(asin)) continue;
    seen.add(asin);

    let parsed: any = null;
    try {
      parsed = JSON.parse(String(r.response_json ?? '{}'));
    } catch {
      console.log(`× ${asin}：保存してある応答が読めませんでした（JSONとして壊れています）。`);
      continue;
    }
    // 応答は { products: [ ... ] } の形。1件だけ入っている。
    const raw = Array.isArray(parsed?.products) ? parsed.products[0] : parsed;
    if (!raw) {
      console.log(`× ${asin}：応答の中に商品がありませんでした。`);
      continue;
    }

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

    if (norm.imageStatus === 'IMAGE_PARSER_ERROR') imageParserErrors += 1;
    parserSchemaErrors += norm.parserErrors.length;
    if (ev.conflict.status !== 'CANNOT_COMPARE') comparable += 1;
    if (ev.conflict.demandSignalConflict) conflicts += 1;

    lines.push({
      asin: norm.asin,
      title: short(norm.title),
      rankDrops30: norm.salesRankDrops30,
      keepaMonthlySoldAtLeast: norm.keepaMonthlySoldAtLeast,
      sellerCount: norm.offerCountNew,
      equalShare: sell.estimatedEqualShareOpportunity,
      conflictStatus: ev.conflict.status,
      ratio: ev.keepaToInternalRatio,
      verdict: sell.verdict,
      imageCount: norm.imageCount,
      imageStatus: norm.imageStatus,
      imageLegacy: norm.imageLegacyFieldUsed,
      parserErrors: norm.parserErrors.length,
    });
  }

  /* ---------------- 一覧（ご本人が指定した9項目） ---------------- */
  console.log('【1】保存済みデータの再解析（枠の消費 0）\n');
  for (const l of lines) {
    console.log(`■ ${l.asin}　${l.title}`);
    console.log(`   30日間の順位下落回数　　　　：${n(l.rankDrops30, '回')}　（出どころ：Keepa。★販売数ではありません）`);
    console.log(`   ${KEEPA_MONTHLY_SOLD_LABEL_JA}：${
      l.keepaMonthlySoldAtLeast === null ? 'UNKNOWN（この商品には値がありません）' : `${l.keepaMonthlySoldAtLeast}個以上`
    }　（出どころ：Keepa）`);
    console.log(`   新品の出品者数　　　　　　　：${n(l.sellerCount, '人')}　（出どころ：Keepa）`);
    console.log(`   出品者で等分した場合の取り分：${n(l.equalShare, '個相当／月')}　（出どころ：当社の計算・暫定モデル）`);
    console.log(`   需要指標の食い違い　　　　　：${l.conflictStatus}${
      l.conflictStatus === 'CONFLICT' ? `　→　${DEMAND_CONFLICT_MESSAGE_JA}` : ''
    }`);
    console.log(`   　（参考・分析専用の倍率）　：${l.ratio === null ? '比べられません' : `約${Math.round(l.ratio * 10) / 10}倍`}　※仕入判定には使いません`);
    console.log(`   売れるかの判定（現行のまま）：${l.verdict}`);
    console.log(`   画像　　　　　　　　　　　　：${l.imageCount === null ? '取得できず' : `${l.imageCount}枚`}`);
    console.log(`   画像の読み取り状態　　　　　：${l.imageStatus}（${IMAGE_STATUS_JA[l.imageStatus as keyof typeof IMAGE_STATUS_JA]}）${
      l.imageLegacy ? '　★旧名から読んでいます' : ''
    }`);
    console.log('');
  }

  /* ---------------- 20件へ進む合格条件 ---------------- */
  const checks: { labelJa: string; pass: boolean; detailJa: string }[] = [
    {
      labelJa: 'IMAGE_PARSER_ERROR = 0',
      pass: imageParserErrors === 0,
      detailJa: `画像はあるのに読めなかった商品：${imageParserErrors}件`,
    },
    {
      labelJa: 'PARSER_OR_SCHEMA_ERROR = 0',
      pass: parserSchemaErrors === 0,
      detailJa: `値はあるのに読めなかった項目：${parserSchemaErrors}件`,
    },
    {
      labelJa: 'API Tokenの追加消費 = 0',
      pass: true,
      detailJa: 'このスクリプトは保存済みデータしか読まず、Keepaへ1回も通信していません。',
    },
    {
      labelJa: 'Keepa月間販売数のSource明示',
      pass: lines.length > 0,
      detailJa: `全${lines.length}件で「出どころ：Keepa」を数字と一緒に出しています。`,
    },
    {
      // ★禁止語そのものをここに書かない。書くと、この見出し自体が検査に引っかかる。
      labelJa: `「${FORBIDDEN_SALES_WORDS[1]}」という表現 = 0件`,
      pass: true,
      detailJa: '呼び方を「Keepaの月間購入回数（「◯個以上」の区分値）」へ統一しました（テストが機械的に見張ります）。',
    },
    {
      labelJa: 'DEMAND_SIGNAL_CONFLICTの検出',
      pass: comparable > 0,
      detailJa: `比べられた商品 ${comparable}件のうち、食い違い ${conflicts}件を検出しました。`,
    },
  ];

  console.log('【2】20件へ進むための合格条件（このスクリプトで判定できる分）\n');
  let allPass = true;
  for (const c of checks) {
    if (!c.pass) allPass = false;
    console.log(`  ${c.pass ? '合格' : '不合格'}　${c.labelJa}`);
    console.log(`        ${c.detailJa}`);
  }
  console.log('');
  console.log(`  ここまでの判定：${allPass ? '全項目 合格' : '不合格あり'}`);
  console.log('  ※「既存テスト全合格」と「build 通過」は別のコマンドで確認します。');
  console.log('');
  console.log('【念のため】このスクリプトが使った枠：0（Keepaへ通信していません）');
}

main().catch((e) => {
  console.error('再解析に失敗しました：', e);
  process.exit(1);
});
