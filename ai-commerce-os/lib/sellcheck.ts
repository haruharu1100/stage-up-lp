/**
 * 売れるかテストの記録と集計（Phase 3.9d・2026-08-22）。
 *
 * 判定そのものは `lib/sellability.ts` にある（外部依存ゼロ。画面からも読める）。
 * こちらはデータベースに触る側。画面の 'use client' 部品からは読み込まないこと（ルール37）。
 *
 * 【このファイルに通信は無い】
 * Keepa へも Amazon へも一切アクセスしない。
 * 受け取るのは「人が画面を見て書き写した数字」だけ。
 */
import { all, nowIso, one, run } from './db/client';
import { cleanText, normalizeJan, parseIntOrNull, parseMoney } from './normalize';
import { checkProductUrl } from './producturl';
import {
  judgeSellability,
  SELLABILITY_SOURCE_TOOLS,
  SELLABILITY_VERDICT_JA,
  THIRD_PARTY_TOOL_CAUTION,
  type SellabilityResult,
  type SellabilitySourceTool,
  type SellabilityVerdict,
} from './sellability';

export * from './sellability';

export function isSourceTool(v: string): v is SellabilitySourceTool {
  return (SELLABILITY_SOURCE_TOOLS as readonly string[]).includes(v);
}

export type SellCheckInput = {
  /** JAN・ASIN・型番など、その商品を指せる文字列。人が入れる。 */
  productKey: string;
  productName?: string | null;
  venueCode: string;
  sourceTool: string;
  /** 人が貼ったURLだけ。システムは組み立てない（ルール55）。 */
  productUrl?: string | null;
  observedAt: string;
  windowDays: string | number;
  rankDrops?: string | number | null;
  salesRank?: string | number | null;
  offerCount?: string | number | null;
  avgPrice?: string | number | null;
  currentPrice?: string | number | null;
  note?: string | null;
  now?: number;
};

export type SellCheckResult = {
  ok: boolean;
  message: string;
  /** すでに同じ内容が入っていて、新しく積まなかったとき true（冪等性） */
  duplicate: boolean;
  judged: SellabilityResult | null;
  /** 第三者ツール由来のときに必ず出す注意書き */
  caution: string | null;
};

/**
 * 1件記録する。
 *
 * 【同じものを2回入れても2件にならない】
 * 「商品・市場・道具・観測日・期間」が同じなら、データベース側の UNIQUE が弾く。
 * ボタンを2回押しても、同じ商品が2件に増えることはない。
 *
 * 【上書きはしない】
 * 日を変えて入れれば新しい行が積まれる。前の行は消さない。
 * 「先月より動きが鈍った」という変化が、いちばん知りたいことだから。
 */
export async function recordSellCheck(i: SellCheckInput): Promise<SellCheckResult> {
  const fail = (message: string): SellCheckResult =>
    ({ ok: false, message, duplicate: false, judged: null, caution: null });

  const rawKey = cleanText(i.productKey);
  if (!rawKey) return fail('商品を指す文字列（JAN・ASIN・型番など）を入れてください。');
  // JANとして読めるならJANに正規化する。読めないならそのまま（大文字に揃えるだけ）。
  const jan = normalizeJan(rawKey);
  const productKey = jan || rawKey.toUpperCase();

  const venueCode = cleanText(i.venueCode).toUpperCase();
  if (!venueCode) return fail('どの市場の話かを選んでください。');

  const sourceTool = cleanText(i.sourceTool).toUpperCase();
  if (!isSourceTool(sourceTool)) return fail('どの画面を見て記入したかを選んでください。');

  const observedAt = cleanText(i.observedAt);
  if (!observedAt) return fail('いつ画面を見たかを入れてください。');

  // URLは任意。入っていれば、その市場のURLとして筋が通っているかだけ確かめる。
  // 通信はしない。おかしければ受け付けず、勝手に直さない。
  const url = cleanText(i.productUrl ?? '');
  if (url) {
    const check = checkProductUrl(venueCode, url);
    if (!check.ok) return fail(`商品ページURLを受け付けられません：${check.messageJa}`);
  }

  const windowDays = parseIntOrNull(String(i.windowDays ?? ''));
  const rankDrops = parseIntOrNull(String(i.rankDrops ?? ''));
  const salesRank = parseIntOrNull(String(i.salesRank ?? ''));
  const offerCount = parseIntOrNull(String(i.offerCount ?? ''));
  const avgPrice = parseMoney(String(i.avgPrice ?? ''));
  const currentPrice = parseMoney(String(i.currentPrice ?? ''));

  const judged = judgeSellability({
    observedAt,
    windowDays,
    rankDrops,
    salesRank,
    offerCount,
    avgPrice,
    currentPrice,
    now: i.now,
  });

  /*
   * 【判断できないものも記録する】
   * 「判断できない」を捨てると、材料が足りない商品が何件あったのかが分からなくなり、
   * 見た目の成績だけが良くなる。だから UNKNOWN も同じように積む。
   */

  // 期間が未入力だと表に入れられない（NOT NULL）。ここだけは先に止める。
  if (windowDays === null) return fail('期間（30 / 90 / 180 日のどれか）を選んでください。');

  const caution = sourceTool === 'VENUE_PAGE' ? null : THIRD_PARTY_TOOL_CAUTION;

  const res = await run(
    `INSERT OR IGNORE INTO sellability_checks (
      product_key, product_name, venue_code, source_tool, product_url,
      observed_at, window_days, rank_drops, sales_rank, offer_count,
      avg_price, current_price, verdict, reason,
      estimated_monthly_sales, per_seller_monthly, estimated_turnover_days,
      warnings_json, counts_as_real_market, note, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      productKey, cleanText(i.productName ?? '') || null, venueCode, sourceTool, url || null,
      observedAt, windowDays, rankDrops, salesRank, offerCount,
      avgPrice, currentPrice, judged.verdict, judged.reason,
      judged.estimatedMonthlySales, judged.perSellerMonthly, judged.estimatedTurnoverDays,
      JSON.stringify(judged.warnings),
      /*
       * 【0で固定してある】
       * 第三者ツールの数字を「実市場データ100件」に数えない。
       * 数え始めてよいのは、ご本人が Keepa の利用規約を読んで確認したあとだけ。
       * ここを引数で切り替えられるようにすると、いつのまにか数え始めてしまう。
       */
      0,
      cleanText(i.note ?? '') || null,
      nowIso(),
    ],
  );

  if (res.rowsAffected === 0) {
    return {
      ok: true,
      duplicate: true,
      judged,
      caution,
      message: `同じ内容（同じ商品・同じ観測日・同じ期間）がすでに入っていたので、増やしませんでした。判定は「${SELLABILITY_VERDICT_JA[judged.verdict]}」です。`,
    };
  }

  return {
    ok: true,
    duplicate: false,
    judged,
    caution,
    message: `記録しました。判定は「${SELLABILITY_VERDICT_JA[judged.verdict]}」です。${judged.reason}`,
  };
}

export type SellCheckRow = {
  id: number;
  product_key: string;
  product_name: string | null;
  venue_code: string;
  source_tool: string;
  product_url: string | null;
  observed_at: string;
  window_days: number;
  rank_drops: number | null;
  sales_rank: number | null;
  offer_count: number | null;
  avg_price: number | null;
  current_price: number | null;
  verdict: SellabilityVerdict;
  reason: string;
  estimated_monthly_sales: number | null;
  per_seller_monthly: number | null;
  estimated_turnover_days: number | null;
  warnings_json: string | null;
  counts_as_real_market: number;
  note: string | null;
  created_at: string;
};

export async function listSellChecks(limit = 100): Promise<SellCheckRow[]> {
  return (await all(
    `SELECT * FROM sellability_checks ORDER BY observed_at DESC, id DESC LIMIT ?`,
    [limit],
  )) as unknown as SellCheckRow[];
}

/** 同じ商品の履歴（古い順）。「先月より鈍ったか」を見るため。 */
export async function sellCheckHistory(productKey: string): Promise<SellCheckRow[]> {
  return (await all(
    `SELECT * FROM sellability_checks WHERE product_key = ? ORDER BY observed_at ASC, id ASC`,
    [productKey.toUpperCase()],
  )) as unknown as SellCheckRow[];
}

export type SellCheckSummary = {
  total: number;
  byVerdict: Record<SellabilityVerdict, number>;
  /** 別々の商品が何点あるか。同じ商品を10回見ても1点と数える。 */
  distinctProducts: number;
  /** 実市場データ100件に数えている件数。いまは必ず0。 */
  countedAsRealMarket: number;
  /** 画面に出す一行の結論。 */
  headlineJa: string;
};

/**
 * まとめ。
 *
 * 【件数を成果にしない】
 * 「登録件数」だけを大きく出すと、入れれば入れるほど進んでいるように見える。
 * 見たいのは「売れると判断できた**別々の商品**が何点あるか」なので、
 * 商品数と件数を分けて数える。
 */
export async function sellCheckSummary(): Promise<SellCheckSummary> {
  const rows = await all(
    `SELECT verdict, COUNT(*) AS n, COUNT(DISTINCT product_key) AS p FROM sellability_checks GROUP BY verdict`,
  );
  const byVerdict: Record<SellabilityVerdict, number> = {
    SELLS: 0, CROWDED: 0, DOES_NOT_SELL: 0, UNKNOWN: 0,
  };
  let total = 0;
  for (const r of rows) {
    const v = String(r.verdict) as SellabilityVerdict;
    const n = Number(r.n ?? 0);
    if (v in byVerdict) byVerdict[v] = n;
    total += n;
  }

  const d = await one(`SELECT COUNT(DISTINCT product_key) AS p FROM sellability_checks`);
  const distinctProducts = Number(d?.p ?? 0);

  const c = await one(`SELECT COUNT(*) AS n FROM sellability_checks WHERE counts_as_real_market = 1`);
  const countedAsRealMarket = Number(c?.n ?? 0);

  const sellsRow = await one(
    `SELECT COUNT(DISTINCT product_key) AS p FROM sellability_checks WHERE verdict = 'SELLS'`,
  );
  const sellsProducts = Number(sellsRow?.p ?? 0);

  const headlineJa = total === 0
    ? 'まだ1件も入っていません。Keepa の画面を見て、数字をここに書き写すところから始まります。'
    : `${distinctProducts}点を調べて、そのうち${sellsProducts}点が「売れている（自分にも回ってきそう）」でした。`
      + `判断できなかったものが${byVerdict.UNKNOWN}件あります。`;

  return { total, byVerdict, distinctProducts, countedAsRealMarket, headlineJa };
}
