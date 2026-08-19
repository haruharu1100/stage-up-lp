import { all, batch, nowIso, run } from './db/client';
import { calcNetReceipt, loadFeeProfiles, pickFee, type FeeProfile } from './route';
import { getThresholds } from './settings';

/**
 * 答え合わせ（Phase 3・§3 §4 §5）。
 *
 * 【何を確かめるのか】
 * 「AIが買うと判断した商品が、本当にその後利益になったのか」。
 * 7日 / 30日 / 90日の3地点で、予想と実際のズレを測る。
 *
 * 【勝敗を無理に決めない（最重要）】
 * 出品価格しか取れていない市場で「売れた」と数えると、精度の数字そのものが嘘になる。
 * 成約の証拠が無いものは ACTUAL_SALE_UNCONFIRMED（判定保留）にし、
 * 的中率の分母にも入れない。分からないものは分からないままにする。
 *
 * 【当時の手数料で計算する】
 * 手数料が変わったあとの料金で過去の利益を計算し直すと、判断の答え合わせにならない。
 * 判断時の fee_version と一致する手数料だけを使い、一致しなければ計算しない。
 */

// ---------------------------------------------------------------- 結果の型

export type Outcome = 'SOLD' | 'NOT_SOLD' | 'ACTUAL_SALE_UNCONFIRMED' | 'PENDING';

export const OUTCOME_JA: Record<Outcome, string> = {
  SOLD: '売れた（成約の証拠あり）',
  NOT_SOLD: '売れなかった',
  ACTUAL_SALE_UNCONFIRMED: '判定保留（成約の証拠が無い）',
  PENDING: '答え合わせ待ち',
};

/**
 * 「売れたことにしてよい」証拠の強さ。上から順に優先する（§4）。
 * 下の2つは Phase 3 時点では発生しない（自社の販売履歴も外部APIも無い）。
 * それでも枠を先に決めておく。あとから弱い証拠が紛れ込むのを防ぐため。
 */
export type EvidenceBasis =
  | 'ACTUAL_SOLD_RECORD'   // 1. 実際の成約データ（成約価格・成約件数）
  | 'OWN_SALES_HISTORY'    // 2. 自社の販売履歴
  | 'API_TRANSACTION'      // 3. APIから取得した成約データ
  | 'MARKET_STATS'         // 4. 信頼できる市場統計
  | 'NONE';                // 証拠なし → 判定保留

export const EVIDENCE_JA: Record<EvidenceBasis, string> = {
  ACTUAL_SOLD_RECORD: '実際の成約データ',
  OWN_SALES_HISTORY: '自社の販売履歴',
  API_TRANSACTION: 'APIから取得した成約データ',
  MARKET_STATS: '信頼できる市場統計',
  NONE: '成約の証拠なし',
};

export type VerifyStats = {
  due: number;
  evaluated: number;
  sold: number;
  notSold: number;
  unconfirmed: number;
  skippedNoFeeVersion: number;
};

// ---------------------------------------------------------------- 判定

type Shadow = {
  id: number;
  supplier_product_id: number;
  identity_key: string | null;
  category_key: string | null;
  decided_at: string;
  buy_venue_code: string;
  sell_venue_code: string;
  acquisition_total_cost: number;
  expected_sell_price: number;
  expected_net_receipt: number;
  expected_net_profit: number;
  expected_roi: number | null;
  expected_days_to_sell: number | null;
  route_score: number | null;
  sell_fee_version: string | null;
};

type Evidence = {
  outcome: Outcome;
  basis: EvidenceBasis;
  note: string;
  actualSellPrice: number | null;
  actualDaysToSell: number | null;
};

/**
 * 判断してから期限までの間に観測された相場から、売れたかどうかを決める。
 *
 * 決めてよいのは、次のすべてが揃ったときだけ。
 *   1. 判断より後に取得された観測がある
 *   2. その観測が成約ベース（SOLD_MEDIAN）で、成約件数が1件以上ある
 *   3. 平均売却日数が分かる（分からなければ「N日以内か」を言えない）
 * 1つでも欠けたら判定保留。
 */
export function judgeOutcome(
  s: Pick<Shadow, 'decided_at' | 'expected_sell_price'>,
  horizonDays: number,
  obs: {
    price: number;
    price_basis: string;
    sold_count_30d: number | null;
    avg_days_to_sell: number | null;
    observed_at: string | null;
  } | null,
): Evidence {
  const none = (note: string): Evidence => ({
    outcome: 'ACTUAL_SALE_UNCONFIRMED', basis: 'NONE', note,
    actualSellPrice: null, actualDaysToSell: null,
  });

  if (!obs) return none('この市場・この商品の相場データが無い');
  if (!obs.observed_at) return none('相場の取得日が分からないため、判断より後のデータか確かめられない');
  if (Date.parse(obs.observed_at) <= Date.parse(s.decided_at)) {
    return none('判断より後に取得された相場データが無い（同じデータで答え合わせはできない）');
  }
  if (obs.price_basis !== 'SOLD_MEDIAN') {
    return none('出品価格しか取れていない。出品されていることは売れた証拠にならない');
  }
  if (!obs.sold_count_30d || obs.sold_count_30d < 1) {
    return none('成約件数が0件。売れたとも売れなかったとも言えない');
  }
  if (obs.avg_days_to_sell === null) {
    return none('平均売却日数が分からないため、期間内に売れたかを判定できない');
  }

  // ここまで来てはじめて勝敗をつける。
  const inTime = obs.avg_days_to_sell <= horizonDays;
  const priceReached = obs.price >= s.expected_sell_price;

  if (inTime && priceReached) {
    return {
      outcome: 'SOLD', basis: 'ACTUAL_SOLD_RECORD',
      note: `${obs.sold_count_30d}件の成約実績。成約中央値 ${obs.price.toLocaleString()}円は予想 ${s.expected_sell_price.toLocaleString()}円に届いている`,
      actualSellPrice: obs.price, actualDaysToSell: obs.avg_days_to_sell,
    };
  }
  return {
    outcome: 'NOT_SOLD', basis: 'ACTUAL_SOLD_RECORD',
    note: !priceReached
      ? `成約中央値 ${obs.price.toLocaleString()}円が予想 ${s.expected_sell_price.toLocaleString()}円に届かなかった（高く見積もりすぎ）`
      : `平均売却日数 ${obs.avg_days_to_sell}日が${horizonDays}日を超えた（売れるが時間がかかる）`,
    actualSellPrice: obs.price, actualDaysToSell: obs.avg_days_to_sell,
  };
}

/** 点数が妥当だったか（§3）。高得点なのに売れないのが一番まずい。 */
export function scoreVerdict(
  routeScore: number | null, outcome: Outcome, actualRoi: number | null, expectedRoi: number | null,
  buyThreshold: number,
): string | null {
  if (routeScore === null || outcome === 'ACTUAL_SALE_UNCONFIRMED' || outcome === 'PENDING') return null;
  const high = routeScore >= buyThreshold;
  if (high && (outcome === 'NOT_SOLD' || (actualRoi !== null && actualRoi < 0))) return 'OVERRATED';
  if (!high && outcome === 'SOLD' && actualRoi !== null && expectedRoi !== null && actualRoi >= expectedRoi) {
    return 'UNDERRATED';
  }
  return 'APPROPRIATE';
}

export const VERDICT_JA: Record<string, string> = {
  OVERRATED: '点数を高く付けすぎた',
  UNDERRATED: '点数を低く付けすぎた',
  APPROPRIATE: '点数は妥当だった',
};

// ---------------------------------------------------------------- 実行

/**
 * 期限が来た答え合わせをまとめて処理する。
 * `now` を渡せるのは、テストで「30日後」を作るため。実運用では省略する。
 */
export async function runVerification(opts: { now?: string } = {}): Promise<VerifyStats> {
  const now = opts.now ?? nowIso();
  const t = await getThresholds();
  const fees = await loadFeeProfiles();

  const rows = await all(
    `SELECT e.id AS eval_id, e.horizon_days, e.predicted_probability,
            s.id, s.supplier_product_id, s.identity_key, s.category_key, s.decided_at,
            s.buy_venue_code, s.sell_venue_code, s.acquisition_total_cost,
            s.expected_sell_price, s.expected_net_receipt, s.expected_net_profit,
            s.expected_roi, s.expected_days_to_sell, s.route_score, s.sell_fee_version
       FROM shadow_evaluations e
       JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE e.outcome = 'PENDING' AND e.due_at <= ?
      ORDER BY e.due_at`,
    [now],
  );

  const stats: VerifyStats = {
    due: rows.length, evaluated: 0, sold: 0, notSold: 0, unconfirmed: 0, skippedNoFeeVersion: 0,
  };
  if (rows.length === 0) return stats;

  // 相場は1件ずつ引かずまとめて読む。
  const obsRows = await all(
    `SELECT identity_key, venue_code, price, price_basis, sold_count_30d, avg_days_to_sell, observed_at
       FROM venue_market_prices WHERE side = 'SELL'`,
  );
  const obsMap = new Map<string, any>();
  for (const o of obsRows) obsMap.set(`${o.identity_key}|${o.venue_code}`, o);

  const stmts: { sql: string; args: unknown[] }[] = [];

  for (const r of rows) {
    const s = r as unknown as Shadow;
    const horizon = Number(r.horizon_days);
    const obs = s.identity_key ? obsMap.get(`${s.identity_key}|${s.sell_venue_code}`) ?? null : null;

    const ev = judgeOutcome(s, horizon, obs
      ? {
          price: Number(obs.price), price_basis: String(obs.price_basis),
          sold_count_30d: obs.sold_count_30d === null ? null : Number(obs.sold_count_30d),
          avg_days_to_sell: obs.avg_days_to_sell === null ? null : Number(obs.avg_days_to_sell),
          observed_at: obs.observed_at === null ? null : String(obs.observed_at),
        }
      : null);

    let actualNetReceipt: number | null = null;
    let actualNetProfit: number | null = null;
    let actualRoi: number | null = null;

    if (ev.actualSellPrice !== null) {
      // §11 当時の手数料で計算する。版が変わっていたら計算しない（旧料金で塗り替えない）。
      const fee = pickFee(fees, s.sell_venue_code, 'SELL', s.category_key ?? '*');
      const versionMatches = fee !== null
        && (s.sell_fee_version === null || String(fee.fee_version ?? '') === s.sell_fee_version);
      if (fee && versionMatches) {
        actualNetReceipt = calcNetReceipt(ev.actualSellPrice, fee as FeeProfile).netReceipt;
        actualNetProfit = actualNetReceipt - s.acquisition_total_cost;
        actualRoi = s.acquisition_total_cost > 0 ? actualNetProfit / s.acquisition_total_cost : null;
      } else {
        stats.skippedNoFeeVersion++;
      }
    }

    const prob = r.predicted_probability === null ? null : Number(r.predicted_probability);
    // 確率の当たり外れは、判定保留のときは付けない。
    const probCorrect = ev.outcome === 'SOLD' || ev.outcome === 'NOT_SOLD'
      ? (prob === null ? null : ((prob >= 0.5) === (ev.outcome === 'SOLD') ? 1 : 0))
      : null;

    const verdict = scoreVerdict(s.route_score, ev.outcome, actualRoi, s.expected_roi, t.scoreBuy);

    const sellPriceError = ev.actualSellPrice === null ? null : ev.actualSellPrice - s.expected_sell_price;
    const sellPriceErrorRatio = sellPriceError === null || s.expected_sell_price <= 0
      ? null : sellPriceError / s.expected_sell_price;
    const daysError = ev.actualDaysToSell === null || s.expected_days_to_sell === null
      ? null : ev.actualDaysToSell - s.expected_days_to_sell;
    const profitError = actualNetProfit === null ? null : actualNetProfit - s.expected_net_profit;
    const roiError = actualRoi === null || s.expected_roi === null ? null : actualRoi - s.expected_roi;

    stmts.push({
      sql: `UPDATE shadow_evaluations SET
              evaluated_at = ?, outcome = ?, evidence_basis = ?, evidence_note = ?,
              actual_sell_price = ?, actual_days_to_sell = ?, actual_net_receipt = ?,
              actual_net_profit = ?, actual_roi = ?,
              sell_price_error = ?, sell_price_error_ratio = ?, days_to_sell_error = ?,
              net_profit_error = ?, roi_error = ?, probability_correct = ?, score_verdict = ?
            WHERE id = ?`,
      args: [
        now, ev.outcome, ev.basis, ev.note,
        ev.actualSellPrice, ev.actualDaysToSell, actualNetReceipt, actualNetProfit, actualRoi,
        sellPriceError, sellPriceErrorRatio, daysError, profitError, roiError,
        probCorrect, verdict, r.eval_id,
      ],
    });

    stats.evaluated++;
    if (ev.outcome === 'SOLD') stats.sold++;
    else if (ev.outcome === 'NOT_SOLD') stats.notSold++;
    else stats.unconfirmed++;
  }

  for (let i = 0; i < stmts.length; i += 300) await batch(stmts.slice(i, i + 300));

  // SHADOW 本体には「一番長い期間まで見た結果」を写す。画面で1件1行として見せるため。
  await run(`
    UPDATE route_shadow_trades SET
      final_outcome = (SELECT outcome FROM shadow_evaluations e
                        WHERE e.shadow_id = route_shadow_trades.id AND e.outcome <> 'PENDING'
                        ORDER BY e.horizon_days DESC LIMIT 1),
      final_horizon = (SELECT horizon_days FROM shadow_evaluations e
                        WHERE e.shadow_id = route_shadow_trades.id AND e.outcome <> 'PENDING'
                        ORDER BY e.horizon_days DESC LIMIT 1),
      actual_sell_price = (SELECT actual_sell_price FROM shadow_evaluations e
                        WHERE e.shadow_id = route_shadow_trades.id AND e.outcome <> 'PENDING'
                        ORDER BY e.horizon_days DESC LIMIT 1),
      actual_net_profit = (SELECT actual_net_profit FROM shadow_evaluations e
                        WHERE e.shadow_id = route_shadow_trades.id AND e.outcome <> 'PENDING'
                        ORDER BY e.horizon_days DESC LIMIT 1),
      forecast_error = (SELECT net_profit_error FROM shadow_evaluations e
                        WHERE e.shadow_id = route_shadow_trades.id AND e.outcome <> 'PENDING'
                        ORDER BY e.horizon_days DESC LIMIT 1),
      verified_at = ?
    WHERE EXISTS (SELECT 1 FROM shadow_evaluations e
                   WHERE e.shadow_id = route_shadow_trades.id AND e.outcome <> 'PENDING')`,
    [now]);

  // すべての期間が終わったものだけ CLOSED。途中は OPEN のまま。
  await run(`
    UPDATE route_shadow_trades SET status = 'CLOSED'
     WHERE status = 'OPEN'
       AND NOT EXISTS (SELECT 1 FROM shadow_evaluations e
                        WHERE e.shadow_id = route_shadow_trades.id AND e.outcome = 'PENDING')
       AND EXISTS (SELECT 1 FROM shadow_evaluations e WHERE e.shadow_id = route_shadow_trades.id)`);

  return stats;
}
