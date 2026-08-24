import { all } from '../db/client';
import type { AmazonCandidate, ResearchCost, SalesEstimate, SupplierListing } from '../types';

/**
 * DATA_ANOMALY（第4段階・仕様2番）
 *
 * ユーザー指定：
 *   「Keepaから明らかに異常なデータが返った場合、仕入判断に使わないでください」
 *   「DATA_ANOMALY として隔離してください」
 *   「人間確認が終わるまでAランク禁止」
 *
 * ★ここは計算とルールだけ。AIは1円も使わない。
 * ★推測で埋めない。分からない項目は「異常」ではなく「不明」として扱う
 *   （ただしランキング不明だけは、仕様どおり異常扱いにする）。
 */

export type AnomalyLevel = 'none' | 'warn' | 'block';

export interface AnomalyItem {
  /** 機械が読む種別 */
  code:
    | 'price_zero'
    | 'price_vs_90d'
    | 'rank_unknown'
    | 'price_vs_cost'
    | 'sales_spike'
    | 'seller_count_absurd'
    | 'review_vs_rank';
  /** 人が読む説明 */
  message: string;
  level: AnomalyLevel;
  /** 判定の根拠になった実際の数字 */
  observed?: string;
}

export interface AnomalyResult {
  /** block が1つでもあれば true。true の間は絶対にAランクにしない */
  isAnomaly: boolean;
  level: AnomalyLevel;
  items: AnomalyItem[];
  /** 画面に出す1行 */
  summary: string;
}

/** 前日の推定月販（同じASINの直近レコード）。無ければ null */
export async function previousMonthlySales(asin: string): Promise<number | null> {
  if (!asin) return null;
  try {
    const rows = await all(
      `SELECT monthly_sales_est FROM research_candidates
        WHERE asin = ? AND monthly_sales_est IS NOT NULL AND monthly_sales_basis <> 'unknown'
        ORDER BY created_at DESC LIMIT 1`,
      [asin],
    );
    const v = rows[0]?.monthly_sales_est;
    return typeof v === 'number' && v > 0 ? v : null;
  } catch {
    return null;
  }
}

/**
 * 「人が確認済みにしたASIN」の一覧。
 * ★毎回のリサーチで新しい行が作られるため、確認済みはASIN単位で引き継ぐ。
 *   ただし無期限にはしない（30日で切れ、また確認を求める）。
 */
export async function clearedAnomalyAsins(): Promise<Set<string>> {
  const since = new Date(Date.now() - 30 * 24 * 3600 * 1000).toISOString();
  try {
    const rows = await all(
      `SELECT DISTINCT asin FROM research_candidates
        WHERE anomaly = 1 AND anomaly_cleared_at IS NOT NULL AND anomaly_cleared_at >= ?`,
      [since],
    );
    return new Set(rows.map((r: any) => String(r.asin)).filter(Boolean));
  } catch {
    return new Set();
  }
}

export function detectAnomalies(input: {
  listing: SupplierListing;
  cand: AmazonCandidate;
  sales: SalesEstimate;
  cost: ResearchCost;
  /** 同じASINの前回の推定月販（無ければ null） */
  prevMonthlySales?: number | null;
  /** 本番データかどうか。サンプルでは判定を出さない（Mockを異常と呼ばない） */
  live: boolean;
  /** この商品は過去30日以内に人が「確認済み」にしたか */
  humanCleared?: boolean;
}): AnomalyResult {
  const { listing, cand, sales, cost, live } = input;
  const items: AnomalyItem[] = [];

  if (!live) {
    return { isAnomaly: false, level: 'none', items: [], summary: 'サンプルデータのため異常検知は行いません' };
  }

  const price = cand.market.priceJpy;
  const avg90 = cand.market.avgPrice90dJpy ?? null;
  const bsr = cand.market.bsr ?? cand.market.bsrAvg30d ?? null;

  // ---- ① Amazon価格が0円（取得失敗を「無料」と読み違えない）----------
  if (!(typeof price === 'number' && price > 0)) {
    items.push({
      code: 'price_zero',
      message: 'Amazon価格が0円または取得できていません。価格が取れない商品は仕入判断に使えません',
      level: 'block',
      observed: `価格=${price ?? '不明'}`,
    });
  }

  // ---- ② 90日平均の10倍（桁違い＝取得ミスの疑い）---------------------
  if (typeof price === 'number' && price > 0 && typeof avg90 === 'number' && avg90 > 0) {
    if (price >= avg90 * 10) {
      items.push({
        code: 'price_vs_90d',
        message: '現在価格が90日平均の10倍以上です。取得ミスか一時的な異常出品の可能性があります',
        level: 'block',
        observed: `現在${price.toLocaleString()}円 / 90日平均${avg90.toLocaleString()}円`,
      });
    } else if (price <= avg90 / 10) {
      items.push({
        code: 'price_vs_90d',
        message: '現在価格が90日平均の10分の1以下です。価格の取り違えの可能性があります',
        level: 'block',
        observed: `現在${price.toLocaleString()}円 / 90日平均${avg90.toLocaleString()}円`,
      });
    }
  }

  // ---- ③ ランキングが UNKNOWN（売れ行きの根拠が無い）------------------
  if (bsr == null) {
    items.push({
      code: 'rank_unknown',
      message: 'Sales Rank（ランキング）が取得できていません。売れ行きの根拠が無いため仕入判断に使えません',
      level: 'block',
      observed: 'BSR=不明',
    });
  }

  // ---- ④ 仕入価格に対してAmazon価格が異常に高い ----------------------
  //   （＝別商品を掴んでいる／セット品と単品を取り違えている典型パターン）
  const landed = cost.landedCostJpy;
  if (typeof price === 'number' && price > 0 && landed > 0) {
    const ratio = price / landed;
    if (ratio >= 20) {
      items.push({
        code: 'price_vs_cost',
        message: 'Amazon価格が仕入原価の20倍以上です。別商品やセット品を同一と見なしている可能性が高いです',
        level: 'block',
        observed: `Amazon${price.toLocaleString()}円 / 原価${Math.round(landed).toLocaleString()}円（${ratio.toFixed(1)}倍）`,
      });
    } else if (ratio >= 10) {
      items.push({
        code: 'price_vs_cost',
        message: 'Amazon価格が仕入原価の10倍以上です。同一商品かを人の目で確認してください',
        level: 'warn',
        observed: `Amazon${price.toLocaleString()}円 / 原価${Math.round(landed).toLocaleString()}円（${ratio.toFixed(1)}倍）`,
      });
    }
  }

  // ---- ⑤ 月販推定が前日比10倍（統計の暴れ）---------------------------
  const prev = input.prevMonthlySales ?? null;
  if (prev != null && prev > 0 && sales.basis !== 'unknown' && sales.units > 0) {
    if (sales.units >= prev * 10) {
      items.push({
        code: 'sales_spike',
        message: '推定月販が前回の10倍以上に跳ねています。ランキングの取得ミスの可能性があります',
        level: 'block',
        observed: `前回${prev}個 → 今回${sales.units}個`,
      });
    } else if (sales.units * 10 <= prev) {
      items.push({
        code: 'sales_spike',
        message: '推定月販が前回の10分の1以下に落ちています。データの取得ミスの可能性があります',
        level: 'warn',
        observed: `前回${prev}個 → 今回${sales.units}個`,
      });
    }
  }

  // ---- ⑥ 出品者数がありえない数 ---------------------------------------
  const sellers = cand.market.sellerCount ?? null;
  if (sellers != null && (sellers < 0 || sellers > 500)) {
    items.push({
      code: 'seller_count_absurd',
      message: '出品者数の値がありえない数です。取得ミスとして扱います',
      level: 'block',
      observed: `出品者${sellers}人`,
    });
  }

  // ---- ⑦ レビュー0件なのに超上位ランク（新品ASINの取り違え）-----------
  const reviews = cand.market.reviewCount ?? null;
  if (reviews != null && reviews === 0 && bsr != null && bsr > 0 && bsr < 500) {
    items.push({
      code: 'review_vs_rank',
      message: 'レビュー0件なのにランキングが極端に上位です。別商品のランキングを見ている可能性があります',
      level: 'warn',
      observed: `レビュー0件 / BSR ${bsr}位`,
    });
  }

  // 仕入先タイトルが空＝そもそも突き合わせが成立しない
  if (!listing.title?.trim()) {
    items.push({
      code: 'price_vs_cost',
      message: '仕入先の商品名が空です。同一商品の確認ができません',
      level: 'block',
    });
  }

  let level: AnomalyLevel = items.some((i) => i.level === 'block')
    ? 'block'
    : items.some((i) => i.level === 'warn')
      ? 'warn'
      : 'none';

  // ★人が「このデータは正しい」と確認済みなら、隔離は解く（注意表示は残す）。
  //   30日で自動的に切れるので、確認しっぱなしで放置にはならない。
  if (level === 'block' && input.humanCleared) {
    level = 'warn';
    items.push({
      code: 'price_vs_cost',
      message: '★同じ商品を過去30日以内に人が「確認済み」にしているため、隔離は解いています',
      level: 'warn',
    });
  }

  const summary =
    level === 'block'
      ? `★異常データとして隔離しました（${items.filter((i) => i.level === 'block').length}件）。人の確認が終わるまでAランクにしません`
      : level === 'warn'
        ? `気になる点が${items.length}件あります（隔離まではしていません）`
        : '異常は見つかりませんでした';

  return { isAnomaly: level === 'block', level, items, summary };
}
