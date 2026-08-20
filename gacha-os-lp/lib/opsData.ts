/**
 * 運用データの設計（型だけ／保存処理はまだ入れていません）
 *
 * ★この段階での位置づけ
 * 「将来ここにデータを貯める」という入れ物の形だけを決めたものです。
 * 実際の保存先（DB）や書き込み処理はまだ作っていません。
 * 先に形を決めておかないと、あとから項目を足すときに過去データが欠けるためです。
 *
 * ★なぜこの形なのか（いちばん大事な点）
 * 公開前バックテストの判定（SAFE / CAUTION / DANGER）を、
 * そのガチャの「実際の結果」と同じ場所に並べて残します。
 * こうしておくと、あとから
 *   「DANGER と出したガチャは、本当に赤字になったのか？」
 *   「SAFE と出したガチャは、本当に無事だったのか？」
 * を数字で確かめられます。
 * 判定のしきい値（105% / 110%）を勘で動かさず、実績で直せるようになります。
 * これがバックテストを“見せかけの機能”で終わらせないための土台です。
 */

import type { Verdict } from "./backtest";

/** 販売の終わり方 */
export type CloseReason =
  | "完売"
  | "期間満了"
  | "手動停止"
  | "自動停止"
  | "販売中";

/** 停止の引き金 */
export type StopTrigger =
  | "実還元率の超過"
  | "相場の高騰"
  | "在庫・仕入れの都合"
  | "不具合・問い合わせ"
  | "その他";

/* ────────────────────────────────
   1. ガチャ1本の記録（親）
   ──────────────────────────────── */
export type GachaRecord = {
  id: string;
  name: string;
  /** スニーカー／トレカ など */
  category: string;

  /** 1回の料金（円） */
  price: number;
  /** 総口数 */
  totalSlots: number;

  /** 設定時還元率（％）＝ 公開前に設計した数値 */
  designedRtp: number;

  publishedAt: string | null;
  closedAt: string | null;
  closeReason: CloseReason;

  /** 公開前バックテストの結果を、そのまま残す */
  backtest: BacktestSnapshot | null;

  /** 売り切った（または停止した）あとの最終結果 */
  outcome: GachaOutcome | null;

  /**
   * 予測精度を集計するための分類。
   * 「どの条件のとき判定が外れやすいか」を後から切り分けるために持ちます。
   */
  accuracyTags: AccuracyTags | null;
};

/* ────────────────────────────────
   2. 公開前バックテストの控え
   あとで「予測が当たっていたか」を検証するために残す
   ──────────────────────────────── */
export type BacktestSnapshot = {
  ranAt: string;

  /**
   * 判定アルゴリズムのバージョン（例 "1.0.0"）。
   * ★これが無いと、あとで判定ルールを直したときに
   * 「この判定は古いルールで出たものか、新しいルールで出たものか」が
   * 分からなくなり、過去データがすべて使えなくなります。
   */
  engineVersion: string;
  /** 計算に使った乱数の種（同じ種なら同じ結果を再現できる） */
  seed: number;
  /** 1シナリオあたり何通り回したか */
  runs: number;

  /** 総合判定 */
  verdict: Verdict;
  /** 通常運営（消化0〜70%）の判定 */
  normalVerdict: Verdict;
  /** 終盤（消化70〜100%）の判定 */
  endgameVerdict: Verdict;

  /* ── 公開前に「こうなるはず」と出した予測値 ──
     販売終了後、下の GachaOutcome と突き合わせます */
  /** 予測した赤字確率（0〜1）。全シナリオ中いちばん高いもの */
  predictedLossRate: number;
  /** 予測した利益（円）＝ 通常シナリオの中央値 */
  predictedProfit: number;
  /** 予測した実還元率（％）＝ 通常シナリオの中央値 */
  predictedRtp: number;
  /** 悪い方から5%の予測利益（円）。「最悪これくらい」の目安 */
  predictedProfitP95Loss: number;

  /** いちばん悪いシナリオの実還元率（％） */
  worstScenarioRtp: number;
  /** シナリオ別の判定（key → 判定） */
  byScenario: Record<
    string,
    { verdict: Verdict; peakRtp: number; lossRate: number; profitMedian: number }
  >;
  /** 判定に使ったしきい値（あとで変えても、当時の基準が分かるように） */
  thresholds: {
    caution: number;
    danger: number;
    judgeUntilSoldRatio: number;
    leftoverRatio: number;
    lossRateHigh: number;
    lossRateForceDanger: number;
  };
};

/* ────────────────────────────────
   3. 最終結果
   ──────────────────────────────── */
export type GachaOutcome = {
  /** 売れた口数 */
  soldSlots: number;
  /** 売上（円） */
  revenue: number;
  /** 出ていった景品の価値（円） */
  payout: number;
  /** 利益（円）＝ 売上 − 景品 */
  profit: number;

  /** 実還元率の最大値（％） */
  realRtpMax: number;
  /** 終了時点の実還元率（％） */
  realRtpFinal: number;

  /** 完売までにかかった日数（完売しなかったら null） */
  soldOutDays: number | null;
  /** 販売速度（口／日）＝ 売れた口数 ÷ 販売日数 */
  slotsPerDay: number;

  /** 売れ残った景品の価値（円） */
  leftoverValue: number;

  /** このガチャに関する問い合わせ件数 */
  inquiries: number;
  /** このガチャの発送件数 */
  shipments: number;
};

/* ────────────────────────────────
   4. 1日ごとの記録（子）
   販売速度・実還元率の推移を見るための時系列
   ──────────────────────────────── */
export type GachaDailyRecord = {
  gachaId: string;
  /** YYYY-MM-DD */
  date: string;

  /** その日に売れた口数 */
  soldSlots: number;
  /** 累計で売れた口数 */
  cumulativeSoldSlots: number;

  /** その日の売上（円） */
  revenue: number;
  /** その日に出た景品の価値（円） */
  payout: number;

  /** その日の終わりに残っている景品の価値（円） */
  remainingValue: number;
  /** その日の終わりの実還元率（％） */
  realRtp: number;

  /** その日の問い合わせ件数 */
  inquiries: number;
  /** その日の発送件数 */
  shipments: number;
};

/* ────────────────────────────────
   5. 価格変動の記録
   「いつ・どの景品が・いくらからいくらへ動いたか」
   ──────────────────────────────── */
export type PriceChangeRecord = {
  gachaId: string;
  at: string;
  prizeGrade: string;
  prizeName: string;
  /** 変動前の市場価格（円） */
  before: number;
  /** 変動後の市場価格（円） */
  after: number;
  /** 変動率（％）。+12.4 なら 12.4% 上昇 */
  changePct: number;
  /**
   * 価格の取得元。
   * ★取得は、各サービスの利用規約と正式な取得方法を確認したうえで実装する前提です。
   */
  source: string;
};

/* ────────────────────────────────
   6. 停止判断の記録
   AIが出した警告に対して、人がどう判断したかを残す
   ──────────────────────────────── */
export type StopDecisionRecord = {
  gachaId: string;
  at: string;
  /** 自動停止か、人の判断か */
  kind: "自動" | "手動";
  trigger: StopTrigger;
  /** 判断した時点の実還元率（％） */
  rtpAtDecision: number;
  /** 判断した時点の消化率（％） */
  soldPctAtDecision: number;
  /** 誰が決めたか（自動なら "system"） */
  decidedBy: string;
  note: string;
};

/* ────────────────────────────────
   7. 予測と実績の突き合わせ
   バックテストを「当たる道具」に育てるための計算
   ──────────────────────────────── */
export type BacktestAccuracy = {
  gachaId: string;
  /** どのバージョンの判定ルールで出した予測か */
  engineVersion: string;

  /* ── 判定の答え合わせ ── */
  /** 公開前の判定 */
  predicted: Verdict;
  /** 実績から見た、あるべき判定 */
  actual: Verdict;
  /** 判定が一致したか */
  matched: boolean;
  /**
   * 外し方の向き。
   * "厳しすぎ" … 危ないと言ったのに無事だった（機会損失につながる）
   * "甘すぎ"   … 安全と言ったのに損が出た（いちばん避けたい外し方）
   */
  missDirection: "一致" | "厳しすぎ" | "甘すぎ";

  /* ── 数字の答え合わせ ── */
  /** 予測した実還元率（％） */
  predictedRtp: number;
  /** 実際の実還元率の最大値（％） */
  actualRtp: number;
  /** 予測と実績の差（％ポイント）。プラスなら実績のほうが悪かった */
  rtpGap: number;

  /** 予測した利益（円） */
  predictedProfit: number;
  /** 実際の利益（円） */
  actualProfit: number;
  /** 予測と実績の差（円）。マイナスなら実績のほうが悪かった */
  profitGap: number;

  /** 予測した赤字確率（0〜1） */
  predictedLossRate: number;
  /** 実際に赤字だったか */
  actualLoss: boolean;
};

/* ────────────────────────────────
   8. 予測精度を「どこで外したか」に分けて見るための軸
   ★現段階では、自動学習も自動変更もしません。
     データの形だけを決めています。
     十分な件数が貯まったあと、人が中身を見て判断します。
   ──────────────────────────────── */

/** 予測のズレを集計する切り口 */
export type AccuracyDimension =
  | "ガチャ種類"
  | "価格帯"
  | "景品構成"
  | "口数"
  | "販売速度"
  | "商品カテゴリ"
  | "市場価格変動";

/**
 * 1本のガチャを、上の各軸のどこに分類したか。
 * 例：{ 価格帯: "1,000〜2,999円", 口数: "500〜999口", ... }
 * 分類の区切り方は運用しながら変わるので、文字列で持ちます。
 */
export type AccuracyTags = Record<AccuracyDimension, string>;

/** ある軸のある区分について、予測がどれだけ当たっていたか */
export type AccuracyBucket = {
  dimension: AccuracyDimension;
  /** 区分の名前（例 "1,000〜2,999円"） */
  bucket: string;
  /** この区分に入ったガチャの本数 */
  samples: number;

  /** 判定が一致した割合（0〜1） */
  matchRate: number;
  /** 厳しすぎた割合（0〜1） */
  tooStrictRate: number;
  /** 甘すぎた割合（0〜1）。ここが高い区分がいちばん危ない */
  tooLooseRate: number;

  /** 実還元率のズレの平均（％ポイント）。プラスなら実績のほうが悪い */
  avgRtpGap: number;
  /** 利益のズレの平均（円）。マイナスなら実績のほうが悪い */
  avgProfitGap: number;
};

/**
 * 予測精度のまとめ。
 * これを見て「どの条件のとき、判定が甘くなりやすいか」を人が読み取ります。
 */
export type PredictionAccuracyReport = {
  /** どのバージョンの判定ルールの成績か */
  engineVersion: string;
  /** 集計した期間 */
  from: string;
  to: string;
  /** 集計に使ったガチャの本数 */
  samples: number;

  /** 全体の一致率（0〜1） */
  overallMatchRate: number;
  /** 全体で「甘すぎた」割合（0〜1） */
  overallTooLooseRate: number;

  /** 軸ごとの内訳 */
  buckets: AccuracyBucket[];
};

/**
 * 予測がどちら向きに外れたかを出す。
 * 「厳しすぎ」より「甘すぎ」のほうが実害が大きいので、必ず区別して記録します。
 */
export function missDirectionOf(
  predicted: Verdict,
  actual: Verdict
): BacktestAccuracy["missDirection"] {
  const rank: Record<Verdict, number> = { SAFE: 0, CAUTION: 1, DANGER: 2 };
  if (rank[predicted] === rank[actual]) return "一致";
  return rank[predicted] > rank[actual] ? "厳しすぎ" : "甘すぎ";
}

/**
 * 実績から「あるべき判定」を出す。
 * 公開前バックテストと同じしきい値で、実際の結果を判定し直すためのもの。
 * これを predicted と並べると、判定基準が甘いか厳しいかが分かる。
 */
export function verdictFromOutcome(
  outcome: GachaOutcome,
  thresholds: { caution: number; danger: number; leftoverRatio: number }
): Verdict {
  if (outcome.profit < 0) return "DANGER";
  if (outcome.realRtpMax >= thresholds.danger) return "DANGER";
  if (outcome.realRtpMax >= thresholds.caution) return "CAUTION";
  if (outcome.leftoverValue > outcome.revenue * thresholds.leftoverRatio)
    return "CAUTION";
  return "SAFE";
}

/**
 * 公開前の予測と、販売終了後の実績を突き合わせて1件分の成績を作る。
 *
 * ★ここで何も自動では変えません。
 * しきい値を動かすかどうかは、件数が貯まったあとに人が決めます。
 * 少ない件数で自動調整すると、たまたまの結果に引っ張られて基準が壊れるためです。
 */
export function compareBacktestToOutcome(
  gachaId: string,
  snapshot: BacktestSnapshot,
  outcome: GachaOutcome
): BacktestAccuracy {
  const actual = verdictFromOutcome(outcome, {
    caution: snapshot.thresholds.caution,
    danger: snapshot.thresholds.danger,
    leftoverRatio: snapshot.thresholds.leftoverRatio,
  });

  return {
    gachaId,
    engineVersion: snapshot.engineVersion,

    predicted: snapshot.verdict,
    actual,
    matched: snapshot.verdict === actual,
    missDirection: missDirectionOf(snapshot.verdict, actual),

    predictedRtp: snapshot.predictedRtp,
    actualRtp: outcome.realRtpMax,
    rtpGap: outcome.realRtpMax - snapshot.predictedRtp,

    predictedProfit: snapshot.predictedProfit,
    actualProfit: outcome.profit,
    profitGap: outcome.profit - snapshot.predictedProfit,

    predictedLossRate: snapshot.predictedLossRate,
    actualLoss: outcome.profit < 0,
  };
}
