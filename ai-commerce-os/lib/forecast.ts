import { all } from './db/client';

/**
 * 3本立ての予測（Phase 3.5・§11〜§16）。
 *
 * 【なぜ数字を3つ出すのか】
 * これまで「予想販売価格 105,000円」と1つだけ出していた。
 * だが、その数字には性質の違う3つが混ざっている。
 *
 *   RAW（理論）        … 相場データをそのまま計算しただけの値。まだ何も学んでいない。
 *   CALIBRATED（補正後）… 過去の実績で「いつも◯%外している」と分かった分を直した値。
 *   CONSERVATIVE（保守）… 外れる時のことを考えて、わざと低めに置いた値。
 *
 * 将来お金を出すかどうかは CONSERVATIVE で判断する（§13）。
 * 理論値で判断すると、当たった時のことしか考えていない判断になる。
 *
 * 【いちばん大事な決まりごと（§11）】
 * 補正は「実市場データの答え合わせ」からしか学ばない。
 * いま手元にあるテストデータの「予想ROI 57.4% → 実績 47.3%（−10.1ポイント）」は、
 * 自分で作ったサンプルの中での誤差なので、本番の補正には一切使わない。
 * 実市場データが0件のあいだは CALIBRATED = RAW のままにして、
 * 「まだ何も学べていない」と正直に表示する。
 */

/** 80%の予測レンジを出すときの係数（正規分布の両側80%）。 */
export const Z80 = 1.2816;

export type CalibrationSource =
  /** 実市場データが1件も無い。補正しない。 */
  | 'NO_REAL_DATA'
  /** 実市場データはあるが件数が足りない。補正しない。 */
  | 'INSUFFICIENT_SAMPLES'
  /** 実市場データから学んだ補正を当てている。 */
  | 'REAL_MARKET';

export const CALIBRATION_SOURCE_JA: Record<CalibrationSource, string> = {
  NO_REAL_DATA: '実市場データがまだ0件のため、補正していない',
  INSUFFICIENT_SAMPLES: '実市場データの件数が足りないため、補正していない',
  REAL_MARKET: '実市場データの答え合わせから補正済み',
};

export type Calibration = {
  source: CalibrationSource;
  sampleCount: number;
  /** 実績 ÷ 予想 の平均。1.0なら予想どおり、0.9なら1割低かった。 */
  meanRatio: number | null;
  /** 下振れ側（下から20%の位置）。保守見積りに使う。 */
  p20Ratio: number | null;
  note: string;
};

export const NO_CALIBRATION: Calibration = {
  source: 'NO_REAL_DATA',
  sampleCount: 0,
  meanRatio: null,
  p20Ratio: null,
  note: CALIBRATION_SOURCE_JA.NO_REAL_DATA,
};

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** 下から◯%の位置の値。件数が少ないときは一番低い値を返す（甘く見積もらない）。 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];
  const idx = clamp(Math.floor((sorted.length - 1) * p), 0, sorted.length - 1);
  return sorted[idx];
}

export type SellPriceForecast = {
  raw: number;
  calibrated: number;
  conservative: number;
  low80: number;
  high80: number;
  /** レンジの根拠。実測のばらつきか、既定の仮置きか。 */
  intervalBasis: 'MARKET_STDDEV' | 'DEFAULT_ASSUMPTION';
  calibrationSource: CalibrationSource;
  calibrationNote: string;
};

export const INTERVAL_BASIS_JA: Record<SellPriceForecast['intervalBasis'], string> = {
  MARKET_STDDEV: 'その市場の実際の価格のばらつきから計算',
  DEFAULT_ASSUMPTION: 'ばらつきが分からないため既定の幅を仮置き',
};

/**
 * 販売価格の3本立てと80%予測レンジ（§14 §15）。
 *
 * 【保守値の作り方】
 * 実市場の実績があれば、その下振れ（下から20%）をそのまま使う。
 * 実績が無いあいだは、既定の控えめ幅を引く。
 * どちらを使ったかは calibrationSource と intervalBasis で必ず見えるようにする。
 * 「保守的に見た」という言葉だけを残して根拠を隠さない。
 */
export function buildSellPriceForecast(
  rawSellPrice: number,
  cal: Calibration,
  opts: {
    /** その市場の価格のばらつき（標準偏差÷平均）。分からなければ null。 */
    stddevRatio: number | null;
    /** ばらつきが分からないときのレンジ幅（既定0.15＝±15%相当）。 */
    defaultBand: number;
    /** 実績が無いときに保守値へ掛ける控えめ率（既定0.15＝15%引く）。 */
    defaultHaircut: number;
  },
): SellPriceForecast {
  const raw = Math.max(0, Math.round(rawSellPrice));

  // 補正後。実市場から学べていなければ理論値のまま動かさない。
  const useCal = cal.source === 'REAL_MARKET' && cal.meanRatio !== null;
  const calibrated = useCal ? Math.round(raw * clamp(cal.meanRatio as number, 0, 2)) : raw;

  // 保守値。実績の下振れがあればそれを、無ければ既定の控えめ率を使う。
  const haircutRatio = cal.source === 'REAL_MARKET' && cal.p20Ratio !== null
    ? clamp(cal.p20Ratio, 0, 1.5)
    : 1 - clamp(opts.defaultHaircut, 0, 0.9);
  // 保守値が補正後より高くなることはあり得ない。念のため下側で押さえる。
  const conservative = Math.min(calibrated, Math.round(raw * haircutRatio));

  // 80%レンジ。実測のばらつきがあればそれを使う。
  const sd = opts.stddevRatio;
  const hasSd = sd !== null && Number.isFinite(sd) && sd > 0;
  const band = hasSd ? clamp((sd as number) * Z80, 0, 0.9) : clamp(opts.defaultBand, 0, 0.9);
  const center = calibrated;

  return {
    raw,
    calibrated,
    conservative: Math.max(0, conservative),
    low80: Math.max(0, Math.round(center * (1 - band))),
    high80: Math.round(center * (1 + band)),
    intervalBasis: hasSd ? 'MARKET_STDDEV' : 'DEFAULT_ASSUMPTION',
    calibrationSource: cal.source,
    calibrationNote: cal.note,
  };
}

// ---------------------------------------------------------------- 実績からの学習

/**
 * 実市場データの答え合わせから補正を読み込む（§11）。
 *
 * 【テストデータは絶対に混ぜない】
 * real_market_data = 1 の SHADOW から作られた答え合わせだけを見る。
 * 混ぜてしまうと、自分で作ったサンプルの癖を本番の判断に持ち込むことになる。
 *
 * 戻り値は Route（買う市場→売る市場）ごと。該当が無ければ全体（'*'）を使う。
 */
export async function loadCalibrations(
  horizonDays: number,
  minSamples: number,
): Promise<Map<string, Calibration>> {
  const rows = await all(
    `SELECT s.buy_venue_code || '→' || s.sell_venue_code AS seg,
            e.actual_sell_price, s.expected_sell_price
       FROM shadow_evaluations e
       JOIN route_shadow_trades s ON s.id = e.shadow_id
      WHERE e.horizon_days = ?
        AND s.real_market_data = 1
        AND e.outcome IN ('SOLD','NOT_SOLD')
        AND e.actual_sell_price IS NOT NULL
        AND s.expected_sell_price > 0`,
    [horizonDays],
  );

  const bySeg = new Map<string, number[]>();
  const allRatios: number[] = [];
  for (const r of rows) {
    const ratio = Number(r.actual_sell_price) / Number(r.expected_sell_price);
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const seg = String(r.seg);
    if (!bySeg.has(seg)) bySeg.set(seg, []);
    (bySeg.get(seg) as number[]).push(ratio);
    allRatios.push(ratio);
  }

  const out = new Map<string, Calibration>();
  const build = (list: number[]): Calibration => {
    if (list.length === 0) return NO_CALIBRATION;
    if (list.length < minSamples) {
      return {
        source: 'INSUFFICIENT_SAMPLES',
        sampleCount: list.length,
        meanRatio: null,
        p20Ratio: null,
        note: `実市場の答え合わせが${list.length}件しかない（補正開始は${minSamples}件から）`,
      };
    }
    const sorted = [...list].sort((a, b) => a - b);
    const mean = list.reduce((a, b) => a + b, 0) / list.length;
    return {
      source: 'REAL_MARKET',
      sampleCount: list.length,
      meanRatio: mean,
      p20Ratio: percentile(sorted, 0.2),
      note: `実市場${list.length}件の実績から補正（実績÷予想の平均 ${(mean * 100).toFixed(1)}%）`,
    };
  };

  for (const [seg, list] of bySeg) out.set(seg, build(list));
  out.set('*', build(allRatios));
  return out;
}

/** Route別の補正が無ければ全体を使う。全体も無ければ「補正なし」。 */
export function calibrationFor(map: Map<string, Calibration>, routeKey: string): Calibration {
  return map.get(routeKey) ?? map.get('*') ?? NO_CALIBRATION;
}
