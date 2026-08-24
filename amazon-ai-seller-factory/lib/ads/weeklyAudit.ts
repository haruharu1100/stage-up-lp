/**
 * 広告の週次点検（AD_WEEKLY_AUDIT）。
 *
 * ★ユーザー指定の絶対ルール：
 *   「7日ごとに、広告費・広告売上・自然売上・ACOS・ROAS・TACOS・CTR・CPC・CVR・
 *     広告後純利益・販売数・在庫 を確認してください。」
 *   「『売れるが赤字』も『黒字だがほぼ売れない』も失敗です。」
 *   「BALANCED GROWTH MODE を維持してください。」
 *   「AD_AUTO_OPTIMIZE=false のままにしてください。」
 *
 * → このファイルは判定と提案を出すだけ。入札を1円も変えない。
 * → LLMは1回も呼ばない。全部わり算。
 */

export type AdState = 'SCALE' | 'OPTIMAL' | 'OVERSPEND' | 'UNDEREXPOSED' | 'POOR';

export const AD_STATE_LABEL: Record<AdState, string> = {
  SCALE: '伸ばせる（広告を増やす）',
  OPTIMAL: 'ちょうど良い（そのまま）',
  OVERSPEND: '使いすぎ（赤字寄り）',
  UNDEREXPOSED: '露出不足（見られていない）',
  POOR: '見込みが薄い（止めるか作り直す）',
};

export const AD_STATE_COLOR: Record<AdState, string | undefined> = {
  SCALE: undefined,
  OPTIMAL: undefined,
  OVERSPEND: '#b00',
  UNDEREXPOSED: '#b36b00',
  POOR: '#b00',
};

export interface AdWeeklyInput {
  /** 期間（7日間） */
  weekStart: string;
  weekEnd: string;
  adCostJpy: number | null;
  adSalesJpy: number | null;
  /** 広告経由でない売上 */
  organicSalesJpy: number | null;
  impressions: number | null;
  clicks: number | null;
  /** 広告経由の注文数 */
  orders: number | null;
  unitsSold: number | null;
  stockUnits: number | null;
  /** 1個あたりの粗利（広告費を引く前）。これが無いと黒字か赤字か分からない */
  unitMarginJpy: number | null;
  /** 販売価格（損益分岐ACOSの計算に使う） */
  sellPriceJpy: number | null;
}

export interface AdWeeklyResult {
  metrics: {
    adCostJpy: number | null;
    adSalesJpy: number | null;
    organicSalesJpy: number | null;
    totalSalesJpy: number | null;
    acos: number | null;
    roas: number | null;
    tacos: number | null;
    impressions: number | null;
    clicks: number | null;
    ctr: number | null;
    cpc: number | null;
    cvr: number | null;
    profitAfterAdJpy: number | null;
    unitsSold: number | null;
    stockUnits: number | null;
  };
  /** 損益分岐ACOS（これを超えると広告のせいで赤字） */
  breakEvenAcos: number | null;
  state: AdState;
  reasons: string[];
  /** 人が実行する提案（★システムは実行しない） */
  actions: string[];
  missing: string[];
}

function div(a: number | null, b: number | null): number | null {
  if (a == null || b == null || b === 0) return null;
  const v = a / b;
  return Number.isFinite(v) ? v : null;
}

function r2(v: number | null): number | null {
  return v == null ? null : Math.round(v * 1000) / 1000;
}

export function auditAdWeek(input: AdWeeklyInput): AdWeeklyResult {
  const reasons: string[] = [];
  const actions: string[] = [];
  const missing: string[] = [];

  const ad = input.adCostJpy;
  const adSales = input.adSalesJpy;
  const organic = input.organicSalesJpy;
  const total = ad != null || adSales != null ? (adSales ?? 0) + (organic ?? 0) : null;

  if (ad == null) missing.push('広告費');
  if (adSales == null) missing.push('広告売上');
  if (organic == null) missing.push('自然売上');
  if (input.impressions == null) missing.push('表示回数');
  if (input.clicks == null) missing.push('クリック数');
  if (input.unitMarginJpy == null) missing.push('1個あたりの粗利');

  const acos = r2(div(ad, adSales));
  const roas = r2(div(adSales, ad));
  const tacos = r2(div(ad, total));
  const ctr = r2(div(input.clicks, input.impressions));
  const cpc = div(ad, input.clicks);
  const cvr = r2(div(input.orders, input.clicks));

  // 広告後の純利益 ＝ 売れた数 × 1個あたり粗利 − 広告費
  const profitAfterAd =
    input.unitsSold != null && input.unitMarginJpy != null
      ? Math.round(input.unitsSold * input.unitMarginJpy - (ad ?? 0))
      : null;

  // 損益分岐ACOS ＝ 1個あたり粗利 ÷ 販売価格
  const breakEvenAcos =
    input.unitMarginJpy != null && input.sellPriceJpy && input.sellPriceJpy > 0
      ? r2(input.unitMarginJpy / input.sellPriceJpy)
      : null;

  const metrics = {
    adCostJpy: ad,
    adSalesJpy: adSales,
    organicSalesJpy: organic,
    totalSalesJpy: total,
    acos,
    roas,
    tacos,
    impressions: input.impressions,
    clicks: input.clicks,
    ctr,
    cpc: cpc != null ? Math.round(cpc) : null,
    cvr,
    profitAfterAdJpy: profitAfterAd,
    unitsSold: input.unitsSold,
    stockUnits: input.stockUnits,
  };

  // ---- 材料が足りないなら判定しない（推測で埋めない）------------------
  if (ad == null || adSales == null) {
    return {
      metrics,
      breakEvenAcos,
      state: 'POOR',
      reasons: ['★広告費または広告売上が未入力のため、判定できません（推測では埋めません）'],
      actions: ['Amazon広告のレポートから、この7日間の広告費と広告売上を入れてください'],
      missing,
    };
  }

  // ---- 露出不足：そもそも見られていない --------------------------------
  const imp = input.impressions;
  if (imp != null && imp < 500) {
    reasons.push(`7日間の表示回数が${imp.toLocaleString()}回しかありません。まず見られていない状態です`);
    actions.push('入札額を上げる／キーワードを増やす／商品名と画像を見直す（人が判断してください）');
    return { metrics, breakEvenAcos, state: 'UNDEREXPOSED', reasons, actions, missing };
  }
  if (ctr != null && ctr < 0.002 && imp != null && imp >= 2000) {
    reasons.push(
      `表示は${imp.toLocaleString()}回ありますが、クリック率が${(ctr * 100).toFixed(2)}%と低すぎます（見られても選ばれていない）`,
    );
    actions.push('1枚目の画像・タイトル・価格・レビュー数のどれかが弱い可能性。ページ側を直してください');
    return { metrics, breakEvenAcos, state: 'UNDEREXPOSED', reasons, actions, missing };
  }

  // ---- 使いすぎ：売れているが赤字 --------------------------------------
  const be = breakEvenAcos;
  if (be != null && acos != null && acos > be) {
    reasons.push(
      `ACOSが${Math.round(acos * 100)}%で、赤字になる境目${Math.round(be * 100)}%を超えています。` +
        `売れていても広告費で利益が消えています`,
    );
    if (profitAfterAd != null) {
      reasons.push(`この7日間の広告後の手残りは${profitAfterAd.toLocaleString()}円です`);
    }
    actions.push('効いていないキーワードを止める／入札を下げる／販売価格を上げる（人が判断してください）');
    return { metrics, breakEvenAcos, state: 'OVERSPEND', reasons, actions, missing };
  }
  if (be == null && acos != null && acos > 0.4) {
    reasons.push(
      `ACOSが${Math.round(acos * 100)}%と高い状態です（1個あたりの粗利が未入力のため、赤字かどうかは断定できません）`,
    );
    actions.push('1個あたりの粗利を入れると、赤字かどうかを正確に判定できます');
    return { metrics, breakEvenAcos, state: 'OVERSPEND', reasons, actions, missing };
  }
  if (profitAfterAd != null && profitAfterAd < 0) {
    reasons.push(`広告費を引くと${profitAfterAd.toLocaleString()}円のマイナスです`);
    actions.push('広告費を減らすか、価格・原価を見直してください');
    return { metrics, breakEvenAcos, state: 'OVERSPEND', reasons, actions, missing };
  }

  // ---- 見込みが薄い：黒字だがほとんど売れない ---------------------------
  const units = input.unitsSold ?? 0;
  if (units <= 1 && (input.clicks ?? 0) >= 100) {
    reasons.push(
      `クリックは${input.clicks}回あるのに、7日間で${units}個しか売れていません。広告ではなく商品ページ側の問題です`,
    );
    actions.push('価格・レビュー・画像・商品説明を見直す。直らないなら、この商品は止める判断も必要です');
    return { metrics, breakEvenAcos, state: 'POOR', reasons, actions, missing };
  }

  // ---- 伸ばせる：黒字で、まだ余力がある --------------------------------
  const stock = input.stockUnits;
  const roomToScale =
    be != null && acos != null && acos <= be * 0.7 && (cvr == null || cvr >= 0.05) && units >= 3;
  if (roomToScale) {
    reasons.push(
      `ACOS${Math.round(acos! * 100)}%は境目${Math.round(be! * 100)}%に対してまだ余裕があり、7日で${units}個売れています`,
    );
    if (stock != null && units > 0) {
      const weeks = stock / units;
      if (weeks < 3) {
        reasons.push(`ただし在庫は約${weeks.toFixed(1)}週間分しかありません。増やす前に補充の手配を先にしてください`);
        actions.push('先に補充を発注（人が実行）→ 入荷の見通しが立ってから広告を増やす');
        return { metrics, breakEvenAcos, state: 'OPTIMAL', reasons, actions, missing };
      }
    }
    actions.push('広告費を1回につき20%まで増やす。増やしたら次の7日でACOSを必ず見直す（人が実行）');
    return { metrics, breakEvenAcos, state: 'SCALE', reasons, actions, missing };
  }

  // ---- それ以外はちょうど良い ------------------------------------------
  reasons.push(
    acos != null
      ? `ACOS${Math.round(acos * 100)}%・7日で${units}個。黒字で回っているので、いまは触らないのが正解です`
      : `7日で${units}個売れています。数字は安定しています`,
  );
  if (tacos != null) {
    reasons.push(`売上全体に対する広告費（TACOS）は${Math.round(tacos * 100)}%です`);
  }
  actions.push('次の7日も同じ設定のまま様子を見る（触らないことも判断のひとつです）');
  return { metrics, breakEvenAcos, state: 'OPTIMAL', reasons, actions, missing };
}
