import { config } from '../env';

/**
 * REAL_NET_PROFIT（第4段階・仕様3〜5番）
 *
 * ユーザー指定：
 *   「Amazon売上だけ見て黒字判定しない」
 *   「利益が高くても、現金化まで120日かかる商品は評価を下げられるようにする」
 *   「ROIだけでなく GMROI／在庫回転率／30日利益／資金拘束日数」
 *
 * ★ここは全部ただの計算。AIは1円も使わない。
 * ★入っていない費目は 0 として足すが、「入力されていない」ことは別に数えて画面に出す。
 *   （勝手に推測値で埋めない）
 */

/** 実費12項目。すべて「その商品ロット全体の合計額（円）」 */
export interface RealCostInput {
  /** ① 仕入代（商品そのもの） */
  purchaseJpy?: number | null;
  /** ② 仕入送料（仕入先→自分／国内） */
  supplierShippingJpy?: number | null;
  /** ③ 国際送料 */
  intlShippingJpy?: number | null;
  /** ④ 関税・消費税・通関手数料 */
  dutyJpy?: number | null;
  /** ⑤ Amazon販売手数料（カテゴリー手数料） */
  amazonFeeJpy?: number | null;
  /** ⑥ FBA手数料または自己発送の配送料 */
  fulfillmentJpy?: number | null;
  /** ⑦ 広告費 */
  adJpy?: number | null;
  /** ⑧ 返品にかかった費用 */
  returnJpy?: number | null;
  /** ⑨ 値引き・クーポン・セール差額 */
  discountJpy?: number | null;
  /** ⑩ 廃棄（不良・期限切れ） */
  disposalJpy?: number | null;
  /** ⑪ 保管費（FBA長期保管料など） */
  storageJpy?: number | null;
  /** ⑫ その他（検品・梱包資材・振込手数料など） */
  otherJpy?: number | null;
}

export const REAL_COST_LABEL: Record<keyof RealCostInput, string> = {
  purchaseJpy: '仕入代',
  supplierShippingJpy: '仕入送料',
  intlShippingJpy: '国際送料',
  dutyJpy: '関税・通関',
  amazonFeeJpy: 'Amazon販売手数料',
  fulfillmentJpy: 'FBA／自己発送送料',
  adJpy: '広告費',
  returnJpy: '返品費用',
  discountJpy: '値引き・クーポン',
  disposalJpy: '廃棄',
  storageJpy: '保管費',
  otherJpy: 'その他費用',
};

export const REAL_COST_KEYS = Object.keys(REAL_COST_LABEL) as (keyof RealCostInput)[];

export interface RealProfitResult {
  /** Amazonでの総売上（値引き前） */
  grossSalesJpy: number;
  /** 12費目の合計 */
  totalCostJpy: number;
  /** 売上 − 全費用 ＝ 本当の手残り */
  realNetProfitJpy: number;
  /** 手残り ÷ 売上 */
  realProfitRate: number | null;
  /** 手残り ÷ 投下した現金 */
  realRoi: number | null;
  /** 1個あたりの手残り */
  perUnitJpy: number | null;
  /** 費目ごとの内訳（画面表示用） */
  breakdown: { key: keyof RealCostInput; label: string; jpy: number; entered: boolean }[];
  /** まだ入力されていない費目の名前（★推測で埋めていないことを明示する） */
  missing: string[];
  /** 人が読む1行 */
  summary: string;
}

function n(v: number | null | undefined): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

export function calcRealNetProfit(input: {
  costs: RealCostInput;
  /** Amazonでの総売上（実額） */
  grossSalesJpy: number;
  /** 販売数（1個あたりを出すため） */
  unitsSold?: number | null;
  /** 実際に出ていった現金（ROIの分母。未指定なら仕入系の合計を使う） */
  cashInvestedJpy?: number | null;
}): RealProfitResult {
  const c = input.costs;
  const breakdown = REAL_COST_KEYS.map((k) => ({
    key: k,
    label: REAL_COST_LABEL[k],
    jpy: n(c[k]),
    entered: c[k] != null,
  }));
  const totalCostJpy = breakdown.reduce((a, b) => a + b.jpy, 0);
  const grossSalesJpy = Math.max(0, Math.round(input.grossSalesJpy));
  const realNetProfitJpy = Math.round(grossSalesJpy - totalCostJpy);

  const invested =
    input.cashInvestedJpy != null && input.cashInvestedJpy > 0
      ? input.cashInvestedJpy
      : n(c.purchaseJpy) + n(c.supplierShippingJpy) + n(c.intlShippingJpy) + n(c.dutyJpy);

  const units = Math.max(0, Math.round(n(input.unitsSold)));
  const missing = breakdown.filter((b) => !b.entered).map((b) => b.label);

  const summary =
    realNetProfitJpy >= 0
      ? `すべての費用を引いた手残りは ${realNetProfitJpy.toLocaleString()}円です`
      : `すべての費用を引くと ${Math.abs(realNetProfitJpy).toLocaleString()}円の赤字です`;

  return {
    grossSalesJpy,
    totalCostJpy: Math.round(totalCostJpy),
    realNetProfitJpy,
    realProfitRate: grossSalesJpy > 0 ? realNetProfitJpy / grossSalesJpy : null,
    realRoi: invested > 0 ? realNetProfitJpy / invested : null,
    perUnitJpy: units > 0 ? Math.round(realNetProfitJpy / units) : null,
    breakdown,
    missing,
    summary:
      summary +
      (missing.length ? `（未入力の費目が${missing.length}件あります：${missing.slice(0, 4).join('・')}）` : ''),
  };
}

// ---- キャッシュフロー（お金がいつ出て、いつ戻るか）--------------------

export interface CashFlowInput {
  /** 仕入で実際に払った額 */
  paidJpy?: number | null;
  /** 仕入代を払った日（ISO） */
  paidAt?: string | null;
  /** Amazonでの総売上 */
  grossSalesJpy?: number | null;
  /** Amazonからの入金予定額（手数料を引いたあと） */
  payoutExpectedJpy?: number | null;
  /** 入金予定日（ISO）。未指定ならAmazonの入金サイクルから推定する */
  payoutExpectedAt?: string | null;
  /** まだ売れていない在庫の金額（原価ベース） */
  inventoryValueJpy?: number | null;
  /** 広告費のうち、まだ売上で回収できていない額 */
  adUnrecoveredJpy?: number | null;
  /** すでに現金として回収できた額 */
  receivedJpy?: number | null;
  /** 最後に売れた日（ISO）。入金予定日の推定に使う */
  lastSoldAt?: string | null;
}

export interface CashFlowResult {
  paidJpy: number;
  paidAt: string | null;
  grossSalesJpy: number;
  payoutExpectedJpy: number;
  payoutExpectedAt: string | null;
  /** 入金予定日を推定で埋めたか（★推定は必ず明示する） */
  payoutDateEstimated: boolean;
  inventoryValueJpy: number;
  adUnrecoveredJpy: number;
  receivedJpy: number;
  /** まだ戻ってきていない現金 */
  outstandingJpy: number;
  /** ★CASH_CONVERSION_DAYS＝払った日から現金が戻るまでの日数 */
  cashConversionDays: number | null;
  /** 日数が分からない理由（分かる時は null） */
  unknownReason: string | null;
  summary: string;
}

function days(fromIso: string, toIso: string): number | null {
  const a = Date.parse(fromIso);
  const b = Date.parse(toIso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

export function calcCashFlow(input: CashFlowInput): CashFlowResult {
  const paidJpy = Math.round(n(input.paidJpy));
  const paidAt = input.paidAt ?? null;
  const grossSalesJpy = Math.round(n(input.grossSalesJpy));
  const payoutExpectedJpy = Math.round(n(input.payoutExpectedJpy));
  const inventoryValueJpy = Math.round(n(input.inventoryValueJpy));
  const adUnrecoveredJpy = Math.round(n(input.adUnrecoveredJpy));
  const receivedJpy = Math.round(n(input.receivedJpy));

  // 入金予定日：入力があればそれを使う。無ければ「最後に売れた日＋入金サイクル」で推定。
  let payoutExpectedAt = input.payoutExpectedAt ?? null;
  let payoutDateEstimated = false;
  if (!payoutExpectedAt && input.lastSoldAt) {
    const t = Date.parse(input.lastSoldAt);
    if (Number.isFinite(t)) {
      payoutExpectedAt = new Date(t + config.amazonPayoutLagDays * 86_400_000).toISOString();
      payoutDateEstimated = true;
    }
  }

  const outstandingJpy = Math.max(0, paidJpy + adUnrecoveredJpy - receivedJpy);

  let cashConversionDays: number | null = null;
  let unknownReason: string | null = null;
  if (!paidAt) {
    unknownReason = '仕入代を払った日が未入力のため、現金化までの日数は出せません';
  } else if (!payoutExpectedAt) {
    unknownReason = '入金予定日も最後に売れた日も分からないため、現金化までの日数は出せません';
  } else {
    cashConversionDays = days(paidAt, payoutExpectedAt);
    if (cashConversionDays == null) unknownReason = '日付の形式が読めませんでした';
  }

  const summary =
    cashConversionDays == null
      ? (unknownReason ?? '現金化までの日数は不明です')
      : `払ってから現金が戻るまで約${cashConversionDays}日です` +
        (payoutDateEstimated ? '（入金予定日はAmazonの入金サイクルからの推定です）' : '') +
        (cashConversionDays >= 120 ? '。★120日以上お金が寝るため、評価を下げています' : '');

  return {
    paidJpy,
    paidAt,
    grossSalesJpy,
    payoutExpectedJpy,
    payoutExpectedAt,
    payoutDateEstimated,
    inventoryValueJpy,
    adUnrecoveredJpy,
    receivedJpy,
    outstandingJpy,
    cashConversionDays,
    unknownReason,
    summary,
  };
}

// ---- 資金効率（利益率が高い＝良い商品、ではない）----------------------

export interface CapitalEfficiencyResult {
  /** GMROI ＝ 粗利 ÷ 平均在庫原価。1.0未満は在庫に金を寝かせているだけ */
  gmroi: number | null;
  /** 年間の在庫回転数（何回入れ替わるか） */
  turnoverPerYear: number | null;
  /** 30日あたりに換算した手残り（回転の速さを効かせた比較用） */
  profitPer30DaysJpy: number | null;
  /** 資金拘束日数＝この商品にお金が縛られる日数 */
  cashTiedDays: number | null;
  /** 投下1万円が30日で何円を生むか（★商品同士を横並びで比べる唯一の指標） */
  cashEfficiencyPer10kPer30Days: number | null;
  /** 選定に反映するための倍率（1.0が標準。速い商品は上、遅い商品は下） */
  efficiencyMultiplier: number;
  reasons: string[];
}

export function calcCapitalEfficiency(input: {
  /** 手残り（REAL_NET_PROFIT。無ければ見込み利益） */
  netProfitJpy: number;
  /** 投下した現金（仕入原価の合計） */
  investedJpy: number;
  /** 売り切るまでの日数（実績が無ければ予測） */
  sellDays: number | null;
  /** 仕入代を払ってから現金が戻るまでの日数（CASH_CONVERSION_DAYS） */
  cashConversionDays?: number | null;
}): CapitalEfficiencyResult {
  const reasons: string[] = [];
  const invested = Math.max(0, Math.round(input.investedJpy));
  const profit = Math.round(input.netProfitJpy);
  const sellDays = input.sellDays != null && input.sellDays > 0 ? input.sellDays : null;

  // ★お金が縛られる日数 = 売り切るまでの日数 と 現金化までの日数 の長い方。
  //   （売り切っても入金が先なら、まだお金は戻っていない）
  const cashTiedDays =
    input.cashConversionDays != null && sellDays != null
      ? Math.max(input.cashConversionDays, sellDays)
      : (input.cashConversionDays ?? sellDays);

  const gmroi = invested > 0 ? Math.round((profit / invested) * 100) / 100 : null;
  const turnoverPerYear = sellDays ? Math.round((365 / sellDays) * 10) / 10 : null;
  const profitPer30DaysJpy =
    cashTiedDays && cashTiedDays > 0 ? Math.round((profit / cashTiedDays) * 30) : null;
  const cashEfficiencyPer10kPer30Days =
    profitPer30DaysJpy != null && invested > 0
      ? Math.round((profitPer30DaysJpy / invested) * 10000)
      : null;

  if (gmroi != null) {
    reasons.push(
      gmroi >= 0.5
        ? `GMROI ${gmroi}：仕入れに使った金がよく働いています`
        : gmroi >= 0.2
          ? `GMROI ${gmroi}：普通です`
          : `GMROI ${gmroi}：在庫にお金が寝ているだけになりかけています`,
    );
  }
  if (turnoverPerYear != null) reasons.push(`年に約${turnoverPerYear}回、在庫が入れ替わる計算です`);
  if (cashTiedDays != null) reasons.push(`この商品にお金が縛られる日数は約${cashTiedDays}日です`);
  if (cashEfficiencyPer10kPer30Days != null) {
    reasons.push(
      `1万円を投じると30日で約${cashEfficiencyPer10kPer30Days.toLocaleString()}円を生む計算です` +
        '（利益率ではなく、これで商品同士を比べます）',
    );
  }

  // ---- 商品選定に反映する倍率 ----------------------------------------
  //   ユーザー指定：「利益率30%でも90日で1回転」より「18%でも月3回転」が良い場合がある。
  //   ★ここも数式だけ。AIには決めさせない。
  let m = 1.0;
  if (cashTiedDays != null) {
    if (cashTiedDays <= 30) m *= 1.25;
    else if (cashTiedDays <= 60) m *= 1.1;
    else if (cashTiedDays <= 90) m *= 1.0;
    else if (cashTiedDays <= 120) m *= 0.85;
    else {
      m *= 0.7;
      reasons.push('★現金化まで120日を超えるため、評価を下げています');
    }
  } else {
    reasons.push('売り切るまでの日数が分からないため、資金効率の補正はかけていません');
  }
  const efficiencyMultiplier = Math.round(m * 100) / 100;

  return {
    gmroi,
    turnoverPerYear,
    profitPer30DaysJpy,
    cashTiedDays,
    cashEfficiencyPer10kPer30Days,
    efficiencyMultiplier,
    reasons,
  };
}
