/**
 * 公開前バックテスト。
 *
 * 何をするものか：
 *   ガチャを公開する「前」に、そのガチャを最後まで売り切ったらどうなるかを
 *   6通りの想定（シナリオ）× 当選順 200通り で先に回してみて、
 *   どのくらい危ないかを数字で出します。
 *
 * ★この版で強くした点
 *   1. 中央値だけで判断しない。
 *      「200回のうち何回が赤字だったか」「悪い方から5%の結果はいくらか」も出す。
 *      中央値が黒字でも、赤字確率が28%なら安全とは言えないため。
 *   2. 判定を2軸にした。
 *      EXPECTED RESULT（期待値＝中央値の結果）と TAIL RISK（悪い方の分布）を
 *      別々に出し、その両方から総合判定を決める。
 *   3. 終盤を切り捨てず、分けて見る。
 *      NORMAL PHASE（消化0〜70%）＝通常運営リスク
 *      ENDGAME PHASE（消化70〜100%）＝終盤運営リスク
 *      終盤はどんな構成でも数字が跳ねるため、別の基準で判定する。
 *   4. seed とエンジンのバージョンを結果に含める。
 *      同じ設定＋同じ seed なら必ず同じ結果になる。
 *      「前回はDANGERだったのに今日はSAFE」を防ぐ。
 *
 * 設計方針：
 *   ・乱数は種（seed）から作る。同じ入力なら必ず同じ結果になる
 *   ・数字をごまかさない。判定は下の THRESHOLD だけで決める
 *   ・この計算はすべてブラウザ内で完結する。外部へデータを送らない
 *   ・「必ず赤字を防ぐ」ものではない。複数条件での事前シミュレーションであり、
 *     結果を保証するものではない（画面表示でも必ずその旨を添える）
 */

/**
 * 判定アルゴリズムのバージョン。
 * 判定ルールを変えたら必ず上げる。
 * 過去の判定が「どのルールで出たものか」を追えるようにするため。
 */
export const BACKTEST_ENGINE_VERSION = "1.0.0";

/** 既定の乱数の種。結果を再現するために保存する */
export const DEFAULT_SEED = 20260820;

/** 1シナリオあたり、何通りの当選順で回すか */
export const RUNS = 200;

export type Prize = {
  /** 等級（S賞・A賞 など） */
  grade: string;
  name: string;
  /** 本数 */
  count: number;
  /** 1本あたりの市場価格（円） */
  value: number;
};

export type GachaSpec = {
  name: string;
  /** 1回の料金（円） */
  price: number;
  /** 総口数 */
  total: number;
  prizes: Prize[];
};

export type ScenarioKey =
  | "normal"
  | "surge"
  | "slump"
  | "earlyJackpot"
  | "lateJackpot"
  | "slowSales";

export type Verdict = "SAFE" | "CAUTION" | "DANGER";

/** 悪い方の分布（テールリスク）の大きさ */
export type RiskLevel = "LOW" | "MEDIUM" | "HIGH";

/* ────────────────────────────────
   判定のしきい値
   ここだけを見て SAFE / CAUTION / DANGER を決める
   ──────────────────────────────── */
export const THRESHOLD = {
  /** 実還元率：これ未満なら安全 */
  caution: 105,
  /** 実還元率：これ以上なら危険 */
  danger: 110,

  /**
   * 通常運営として判定する範囲（消化率）。
   * ここまでが NORMAL PHASE、これ以降が ENDGAME PHASE。
   *
   * 終盤は、上位賞が1本残っているだけで実還元率が必ず跳ね上がります。
   * 例：1回2,000円のガチャで残り40口なら、その枠の売上は80,000円しかないので、
   * 51,800円の賞が1本残っているだけで、それだけで還元率は65%分に相当します。
   * つまり終盤の数値は「構成が危ないから高い」のではなく、
   * どんな構成でも必ず高くなります。同じ基準で混ぜると全部 DANGER になるため、
   * 通常運営リスクと終盤運営リスクを分けて判定します。
   */
  judgeUntilSoldRatio: 0.7,

  /** 売れ残りが売上のこの割合を超えたら注意（資金が寝る） */
  leftoverRatio: 0.5,

  /* 赤字確率（200回のうち何回が赤字だったか） */
  /** これ以上なら TAIL RISK = HIGH */
  lossRateHigh: 0.2,
  /** これ以上なら TAIL RISK = MEDIUM */
  lossRateMedium: 0.05,
  /** これ以上なら、期待値に関係なく総合 DANGER */
  lossRateForceDanger: 0.3,

  /* 終盤（ENDGAME）は別基準で見る。必ず高くなるため */
  endgameCaution: 130,
  endgameDanger: 200,

  /** 「残りわずか」の口数（総口数のこの割合／最低10口） */
  tailSlotsRatio: 0.05,
  tailSlotsMin: 10,
} as const;

/* ────────────────────────────────
   結果の型
   ──────────────────────────────── */

/** 200回の結果のばらつき */
export type Distribution = {
  runs: number;
  /** 200回のうち SAFE だった割合（0〜1） */
  safeRate: number;
  cautionRate: number;
  dangerRate: number;
  /** 赤字になった割合（0〜1）。いちばん重要な指標 */
  lossRate: number;

  /** 実還元率（NORMAL PHASE）の中央値・P90・P95・最悪値（％） */
  rtpMedian: number;
  rtpP90: number;
  rtpP95: number;
  rtpWorst: number;

  /** 粗利の中央値・最悪値（円） */
  profitMedian: number;
  profitWorst: number;
  /** 悪い方から5%の位置の粗利（円）。「P95 Loss」として表示する */
  profitP95Loss: number;
  /**
   * 粗利が当選順によって変わるか。
   * 最後まで売り切る想定では、出ていく景品は結局すべて同じなので、
   * 当選順を変えても粗利は1円も変わらない（＝ばらつかない）。
   * その場合に「最悪の粗利」を並べても意味がないため、画面側で表示を変える。
   */
  profitVaries: boolean;
};

/** 終盤（消化70〜100%）の分析 */
export type EndgameAnalysis = {
  /** 終盤まで販売が届くか（途中で止まる想定なら false） */
  reached: boolean;
  verdict: Verdict;
  /** 終盤の実還元率の中央値・最悪値（％） */
  rtpMedian: number;
  rtpWorst: number;
  /** 最上位賞が終盤（消化70%）まで残る割合（0〜1） */
  topPrizeRemainRate: number;
  /** 最上位賞が「残りわずか」まで残る割合（0〜1）。上より小さくなる */
  topPrizeTailRate: number;
  /** 最上位賞の価格（円） */
  topPrizeValue: number;
  /** 「残りわずか」と見なす口数 */
  tailSlots: number;
  /**
   * 最上位賞が残ったまま「残りわずか」になった回だけを集めた、
   * その時点の実還元率の中央値（％）。
   * 「最上位賞が残っていた場合、そのとき何%になるか」を表す。
   */
  rtpAtTail: number;
  /** 終盤に入ってから完売までに必要な売上（円） */
  revenueToSellOut: number;
  reason: string;
  /** 運営判断の候補（自動では変更しない） */
  actions: string[];
};

export type ScenarioResult = {
  key: ScenarioKey;
  label: string;
  /** 何を想定した回し方か */
  premise: string;
  /** 設計時の還元率（％） */
  designedRtp: number;

  /* ── 2軸の判定 ── */
  /** 期待値（中央値の結果）から見た判定 */
  expected: Verdict;
  /** 悪い方の分布から見たリスク */
  tailRisk: RiskLevel;
  /** 総合判定（期待値とテールリスクの両方から決める） */
  verdict: Verdict;
  reason: string;

  /* ── 通常運営（消化0〜70%） ── */
  /** 判定に使う実還元率（％）＝ 中央値 */
  peakRtp: number;
  /** 中央値の回で、実還元率が最大になったときの消化率（％） */
  peakAtSoldPct: number;
  distribution: Distribution;

  /* ── 終盤（消化70〜100%） ── */
  endgame: EndgameAnalysis;

  /* ── 金額（中央値の回） ── */
  profit: number;
  revenue: number;
  payout: number;
  leftoverValue: number;
};

/** バックテスト1回分の結果全体。再現に必要な情報を必ず含める */
/**
 * 「そもそも判定できる構成になっていない」ことを表す。
 *
 * ★これは PHASE 9 の SAFE FAIL と同じ考え方です。
 * 景品を1本も登録していないガチャは、計算上は売上が丸ごと粗利になるので
 * 数字としては SAFE になります。でもそれは「安全な構成」ではなく
 * 「まだ入力が終わっていない」だけです。
 * ここで SAFE（＝このまま公開できます）と出すのがいちばん危ない。
 */
export type SpecIssue = {
  code: "NO_PRIZES" | "ZERO_VALUE" | "NO_SLOTS" | "NO_PRICE" | "OVER_SLOTS";
  /** 画面にそのまま出せる日本語 */
  message: string;
};

export type BacktestReport = {
  engineVersion: string;
  seed: number;
  runs: number;
  ranAt: string;
  designedRtp: number;
  /** 全シナリオのうち、いちばん悪い判定 */
  overall: Verdict;
  /** 全シナリオを通じた最大の赤字確率（0〜1） */
  maxLossRate: number;
  scenarios: ScenarioResult[];
  /** 入力が足りていない箇所。1件でもあれば判定を信じてはいけない */
  issues: SpecIssue[];
  /**
   * 判定結果を「安全／危険」として読んでよいか。
   * false のとき、画面は SAFE ではなく「判定できません」を出すこと。
   */
  usable: boolean;
};

/* ────────────────────────────────
   乱数と補助
   ──────────────────────────────── */

/** 種から作る乱数（同じ種なら毎回同じ並びになる） */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a += 0x6d2b79f5;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 景品リストを「1口 = 1要素」の価格の配列に展開する */
function expand(spec: GachaSpec): number[] {
  const slots: number[] = [];
  for (const p of spec.prizes) {
    for (let i = 0; i < p.count; i++) slots.push(p.value);
  }
  // 景品を割り当てていない残りの口は 0円（いわゆる参加賞なし）として扱う
  while (slots.length < spec.total) slots.push(0);
  return slots.slice(0, spec.total);
}

function shuffle(arr: number[], seed: number): number[] {
  const a = [...arr];
  const r = rng(seed);
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** 最も高い1口を、指定した範囲のどこかへ移動させる */
function placeTopPrize(order: number[], from: number, to: number, seed: number): number[] {
  const a = [...order];
  // 空の配列で splice すると undefined が混ざり、以降の計算が全部 NaN になる
  if (a.length === 0) return a;
  let top = 0;
  for (let i = 1; i < a.length; i++) if (a[i] > a[top]) top = i;
  const r = rng(seed);
  const lo = Math.max(0, Math.floor(from));
  const hi = Math.min(a.length - 1, Math.floor(to));
  const target = lo + Math.floor(r() * Math.max(1, hi - lo + 1));
  const [v] = a.splice(top, 1);
  a.splice(Math.min(target, a.length), 0, v);
  return a;
}

/** 昇順に並んだ配列から、p（0〜1）の位置の値を取る */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const i = Math.min(
    sortedAsc.length - 1,
    Math.max(0, Math.round((sortedAsc.length - 1) * p))
  );
  return sortedAsc[i];
}

const RANK: Record<Verdict, number> = { SAFE: 0, CAUTION: 1, DANGER: 2 };
const BY_RANK: Verdict[] = ["SAFE", "CAUTION", "DANGER"];
/** 1段階だけ重くする */
function bump(v: Verdict): Verdict {
  return BY_RANK[Math.min(2, RANK[v] + 1)];
}
function worseOf(a: Verdict, b: Verdict): Verdict {
  return RANK[a] >= RANK[b] ? a : b;
}

/* ────────────────────────────────
   シナリオ定義
   ──────────────────────────────── */
const SCENARIOS: {
  key: ScenarioKey;
  label: string;
  premise: string;
  /** 市場価格の倍率 */
  priceScale: number;
  /** 何％まで売れたところで止まるか */
  soldRatio: number;
  place?: "early" | "late";
}[] = [
  {
    key: "normal",
    label: "通常",
    premise: "相場は動かず、当選順もかたよらず、最後まで売り切れた場合。",
    priceScale: 1,
    soldRatio: 1,
  },
  {
    key: "surge",
    label: "相場の高騰",
    premise: "販売中に景品の相場が 25% 上がった場合。",
    priceScale: 1.25,
    soldRatio: 1,
  },
  {
    key: "slump",
    label: "相場の下落",
    premise: "販売中に景品の相場が 20% 下がった場合。",
    priceScale: 0.8,
    soldRatio: 1,
  },
  {
    key: "earlyJackpot",
    label: "序盤で高額賞が当たる",
    premise: "最上位賞が、売り出して最初の10%以内で引かれた場合。",
    priceScale: 1,
    soldRatio: 1,
    place: "early",
  },
  {
    key: "lateJackpot",
    label: "終盤まで高額賞が残る",
    premise: "最上位賞が、最後の20%まで残り続けた場合。",
    priceScale: 1,
    soldRatio: 1,
    place: "late",
  },
  {
    key: "slowSales",
    label: "販売速度の低下",
    premise: "売れ行きが止まり、45%までしか消化できなかった場合。",
    priceScale: 1,
    soldRatio: 0.45,
  },
];

/* ────────────────────────────────
   1回分のシミュレーション
   ──────────────────────────────── */

type Run = {
  /** 通常運営（消化0〜70%）で到達した実還元率の最大値（％） */
  normalPeak: number;
  normalPeakAt: number;
  /**
   * 終盤（消化70〜100%）で到達した実還元率の最大値（％）。
   * ただし「残り数口」の極端な値は含めない。
   * 残り1口で51,800円の賞が残っていれば還元率は2,590%になりますが、
   * これは構成の危険度ではなく割り算の性質でしかないため、
   * 残り tailSlots 口を切ったあとは記録しません。
   */
  endgamePeak: number;
  /** 終盤に到達したか */
  endgameReached: boolean;
  /** 最上位賞が終盤（消化70%）まで残ったか */
  topRemained: boolean;
  /** 最上位賞が「残りわずか」まで残ったか（topRemained より厳しい条件） */
  topAtTail: boolean;
  /** 「残りわずか」に達した時点の実還元率（％）。到達しなければ -1 */
  rtpAtTail: number;

  payout: number;
  profit: number;
  leftoverValue: number;
  revenue: number;
};

function simulate(
  order: number[],
  price: number,
  soldRatio: number,
  tailSlots: number
): Run {
  const total = order.length;
  // 総口数が0のとき Math.max(1, …) にすると存在しない order[0] を足しにいき、
  // payout / profit / leftoverValue がすべて NaN になって画面に出る。
  const stopAt = total === 0 ? 0 : Math.max(1, Math.round(total * soldRatio));
  const judgeUntil = Math.floor(total * THRESHOLD.judgeUntilSoldRatio);

  // 最上位賞がどこにあるか
  let topIndex = 0;
  for (let i = 1; i < total; i++) if (order[i] > order[topIndex]) topIndex = i;
  // 終盤に入るまでに引かれていなければ「残った」
  const topRemained = topIndex >= judgeUntil;
  // さらに「残りわずか」まで引かれずに残ったか
  const topAtTail = topIndex >= total - tailSlots;

  const totalValue = order.reduce((a, v) => a + v, 0);
  let remainingValue = totalValue;
  let payout = 0;

  // 実還元率を1回でも測れたか。
  // 口数が極端に少ないガチャ（1〜2口）では「次に買う人」が存在しないため
  // 一度も測れないまま終わる。そのとき 0% のままにすると、
  // 画面には「実還元率 0.0%＝とても安全」と出てしまう。これは嘘になる。
  let rtpSamples = 0;

  let normalPeak = 0;
  let normalPeakAt = 0;
  let endgamePeak = 0;
  let endgameReached = false;
  let rtpAtTail = -1;

  for (let k = 0; k < stopAt; k++) {
    payout += order[k];
    remainingValue -= order[k];

    const sold = k + 1;
    const remainingSlots = total - sold;
    if (remainingSlots <= 0) break;

    // 料金が0円だと 0 で割ることになり、実還元率が Infinity になる。
    // Infinity をそのまま画面に出さないよう、測れなかった扱いにする。
    // （料金未設定は validateSpec が NO_PRICE として弾く）
    if (price <= 0) continue;

    // これから買う人にとっての実還元率
    const rtp = (remainingValue / (remainingSlots * price)) * 100;
    rtpSamples++;

    if (sold <= judgeUntil) {
      if (rtp > normalPeak) {
        normalPeak = rtp;
        normalPeakAt = (sold / total) * 100;
      }
    } else {
      endgameReached = true;
      // 残り数口の極端な値は入れない（割り算の性質で必ず跳ね上がるため）
      if (remainingSlots >= tailSlots && rtp > endgamePeak) endgamePeak = rtp;
    }

    // 「残りわずか」ちょうどの時点を記録
    if (remainingSlots === tailSlots) rtpAtTail = rtp;
  }

  const revenue = stopAt * price;

  // 一度も測れなかったときは 0% ではなく、ガチャ全体の還元率で埋める。
  // 「測れなかった」を「安全だった」に読み替えないための処理。
  const fallbackRtp =
    total > 0 && price > 0 ? (totalValue / (total * price)) * 100 : 0;
  if (rtpSamples === 0) {
    normalPeak = fallbackRtp;
    normalPeakAt = 100;
  }

  return {
    normalPeak,
    normalPeakAt,
    endgamePeak,
    endgameReached,
    topRemained,
    topAtTail,
    rtpAtTail,
    payout,
    profit: revenue - payout,
    leftoverValue: Math.max(0, remainingValue),
    revenue,
  };
}

/* ────────────────────────────────
   判定
   ──────────────────────────────── */

/** 1回分の結果を SAFE / CAUTION / DANGER に分類する（分布を取るために使う） */
function judgeRun(r: Run): Verdict {
  if (r.profit < 0) return "DANGER";
  if (r.normalPeak >= THRESHOLD.danger) return "DANGER";
  if (r.normalPeak >= THRESHOLD.caution) return "CAUTION";
  if (r.leftoverValue > r.revenue * THRESHOLD.leftoverRatio) return "CAUTION";
  return "SAFE";
}

/** 悪い方の分布（テールリスク）の大きさを決める */
function judgeTailRisk(d: Distribution): RiskLevel {
  if (d.lossRate >= THRESHOLD.lossRateHigh) return "HIGH";
  if (d.rtpP95 >= THRESHOLD.danger) return "HIGH";
  if (d.lossRate >= THRESHOLD.lossRateMedium) return "MEDIUM";
  if (d.rtpP95 >= THRESHOLD.caution) return "MEDIUM";
  return "LOW";
}

export const riskLabel: Record<RiskLevel, string> = {
  LOW: "低い",
  MEDIUM: "中くらい",
  HIGH: "高い",
};

/** 期待値（中央値の結果）から見た判定 */
function judgeExpected(d: Distribution): Verdict {
  if (d.profitMedian < 0) return "DANGER";
  if (d.rtpMedian >= THRESHOLD.danger) return "DANGER";
  if (d.rtpMedian >= THRESHOLD.caution) return "CAUTION";
  return "SAFE";
}

/** 終盤の判定。通常運営とは別の基準で見る（終盤は必ず高くなるため） */
function judgeEndgame(rtpMedian: number, reached: boolean): Verdict {
  if (!reached) return "SAFE";
  if (rtpMedian >= THRESHOLD.endgameDanger) return "DANGER";
  if (rtpMedian >= THRESHOLD.endgameCaution) return "CAUTION";
  return "SAFE";
}

/** 総合判定と、その理由の文章 */
function combine(
  expected: Verdict,
  tail: RiskLevel,
  d: Distribution
): { verdict: Verdict; reason: string } {
  let verdict = expected;

  // 悪い方の分布が重ければ、期待値より1段階重くする
  if (tail === "HIGH") verdict = bump(expected);
  // 赤字確率がここまで高いと、中央値が黒字でも危険
  if (d.lossRate >= THRESHOLD.lossRateForceDanger) verdict = "DANGER";

  const lossPct = (d.lossRate * 100).toFixed(0);

  if (d.profitMedian < 0) {
    return {
      verdict,
      reason: `中央値の時点で赤字です（${jpyShort(d.profitMedian)}）。${RUNS}回中 ${lossPct}% が赤字になりました。上位賞の価値を下げるか、口数か料金を見直してください。`,
    };
  }

  if (d.lossRate >= THRESHOLD.lossRateMedium) {
    return {
      verdict,
      reason: `中央値では黒字（${jpyShort(d.profitMedian)}）ですが、${RUNS}回中 ${lossPct}% が赤字になりました。悪い方から5%の結果は ${jpyShort(d.profitP95Loss)} です。当選順しだいで損が出る構成です。`,
    };
  }

  if (verdict === "SAFE") {
    return {
      verdict,
      reason: `実還元率は中央値 ${d.rtpMedian.toFixed(1)}%、悪い方から5%でも ${d.rtpP95.toFixed(1)}% にとどまります。赤字になった回はありませんでした。`,
    };
  }

  return {
    verdict,
    reason: `実還元率が中央値で ${d.rtpMedian.toFixed(1)}%、悪い方から5%では ${d.rtpP95.toFixed(1)}% まで上がります。この付近で停止するか、景品を追加する判断が必要です。`,
  };
}

/** 金額を短く（理由の文章に埋め込む用） */
function jpyShort(n: number): string {
  const s = Math.abs(Math.round(n)).toLocaleString("ja-JP");
  return n < 0 ? `−¥${s}` : `+¥${s}`;
}

/** 設計時の還元率（％） */
export function designedRtp(spec: GachaSpec): number {
  const totalValue = spec.prizes.reduce((a, p) => a + p.count * p.value, 0);
  const denom = spec.total * spec.price;
  // 分母が0のときに Infinity / NaN を画面へ出さない
  if (!(denom > 0)) return 0;
  return (totalValue / denom) * 100;
}

/**
 * バックテストにかける前に、構成そのものが判定できる状態かを見る。
 *
 * ここで止めないと、入力途中のガチャに対して
 * 「このまま公開できます」という、いちばん危ない誤りが出ます。
 */
export function validateSpec(spec: GachaSpec): SpecIssue[] {
  const issues: SpecIssue[] = [];
  const prizeSlots = spec.prizes.reduce((a, p) => a + Math.max(0, p.count), 0);
  const totalValue = spec.prizes.reduce(
    (a, p) => a + Math.max(0, p.count) * Math.max(0, p.value),
    0
  );

  if (!(spec.total > 0)) {
    issues.push({
      code: "NO_SLOTS",
      message: "総口数が設定されていません。判定できません。",
    });
  }
  if (!(spec.price > 0)) {
    issues.push({
      code: "NO_PRICE",
      message: "1回の料金が設定されていません。判定できません。",
    });
  }
  if (prizeSlots === 0) {
    issues.push({
      code: "NO_PRIZES",
      message:
        "景品が1本も登録されていません。売上がそのまま粗利になるため計算上は安全に見えますが、これは構成が安全なのではなく入力が終わっていないだけです。",
    });
  } else if (totalValue === 0) {
    issues.push({
      code: "ZERO_VALUE",
      message:
        "登録された景品の価格がすべて0円です。市場価格が取り込めていないか、入力が終わっていません。この状態の判定は使えません。",
    });
  }
  if (spec.total > 0 && prizeSlots > spec.total) {
    issues.push({
      code: "OVER_SLOTS",
      message: `景品の本数（${prizeSlots}本）が総口数（${spec.total}口）を超えています。入りきらない景品は抽選に出ません。`,
    });
  }
  return issues;
}

/* ────────────────────────────────
   1シナリオを RUNS 通り回す
   ──────────────────────────────── */
function runScenario(
  spec: GachaSpec,
  s: (typeof SCENARIOS)[number],
  seed: number
): ScenarioResult {
  const base = expand(spec).map((v) => v * s.priceScale);
  const scenarioSeed = seed + s.key.length * 977;

  const tailSlots = Math.max(
    THRESHOLD.tailSlotsMin,
    Math.round(spec.total * THRESHOLD.tailSlotsRatio)
  );

  const runs: Run[] = [];
  for (let i = 0; i < RUNS; i++) {
    let order = shuffle(base, scenarioSeed + i * 7919);
    if (s.place === "early") {
      order = placeTopPrize(order, 0, order.length * 0.1, scenarioSeed + i * 31 + 5);
    } else if (s.place === "late") {
      order = placeTopPrize(
        order,
        order.length * 0.8,
        order.length - 1,
        scenarioSeed + i * 71 + 9
      );
    }
    runs.push(simulate(order, spec.price, s.soldRatio, tailSlots));
  }

  /* ── 分布を作る ── */
  const verdicts = runs.map(judgeRun);
  const rtpAsc = runs.map((r) => r.normalPeak).sort((a, b) => a - b);
  const profitAsc = runs.map((r) => r.profit).sort((a, b) => a - b);

  const count = (v: Verdict) => verdicts.filter((x) => x === v).length / RUNS;

  const distribution: Distribution = {
    runs: RUNS,
    safeRate: count("SAFE"),
    cautionRate: count("CAUTION"),
    dangerRate: count("DANGER"),
    lossRate: runs.filter((r) => r.profit < 0).length / RUNS,

    rtpMedian: percentile(rtpAsc, 0.5),
    rtpP90: percentile(rtpAsc, 0.9),
    rtpP95: percentile(rtpAsc, 0.95),
    rtpWorst: rtpAsc[rtpAsc.length - 1],

    profitMedian: Math.round(percentile(profitAsc, 0.5)),
    profitWorst: Math.round(profitAsc[0]),
    profitP95Loss: Math.round(percentile(profitAsc, 0.05)),
    // 最小と最大が同じなら、当選順を変えても粗利は動かない
    profitVaries:
      Math.round(profitAsc[0]) !== Math.round(profitAsc[profitAsc.length - 1]),
  };

  /* ── 代表として中央値の回を選ぶ（画面に出す金額の一貫性のため） ── */
  const byRtp = [...runs].sort((a, b) => a.normalPeak - b.normalPeak);
  const mid = byRtp[Math.floor(RUNS / 2)];

  /* ── 2軸の判定 ── */
  const expected = judgeExpected(distribution);
  const tailRisk = judgeTailRisk(distribution);
  let { verdict, reason } = combine(expected, tailRisk, distribution);

  // 売れ残りが大きい場合は、実還元率が良くても注意（資金が寝る）
  if (mid.leftoverValue > mid.revenue * THRESHOLD.leftoverRatio) {
    verdict = worseOf(verdict, "CAUTION");
    reason = `実還元率は中央値 ${distribution.rtpMedian.toFixed(1)}% で問題ありませんが、売れ残った景品の価値が売上の半分を超えます。仕入れた資金がそのまま寝ることになります。`;
  }

  /* ── 終盤の分析 ── */
  const endgameRuns = runs.filter((r) => r.endgameReached);
  const endgameReached = endgameRuns.length > 0;
  const egAsc = endgameRuns.map((r) => r.endgamePeak).sort((a, b) => a - b);
  const egMedian = endgameReached ? percentile(egAsc, 0.5) : 0;
  const egWorst = endgameReached ? egAsc[egAsc.length - 1] : 0;

  const topRemainRate = runs.filter((r) => r.topRemained).length / RUNS;
  const topTailRate = runs.filter((r) => r.topAtTail).length / RUNS;
  // 「最上位賞が残りわずかまで残った」回だけを見る。
  // ここを絞らないと、残っていない回の低い数値が混ざって実態より軽く見える。
  const tailRuns = runs
    .filter((r) => r.topAtTail && r.rtpAtTail >= 0)
    .map((r) => r.rtpAtTail)
    .sort((a, b) => a - b);
  const rtpAtTail = tailRuns.length > 0 ? percentile(tailRuns, 0.5) : 0;

  // ★ Math.max(...base) と書いてはいけない。
  // 引数展開は10万個あたりで「Maximum call stack size exceeded」になり、
  // 100万口のガチャでバックテストごと落ちる。1周して最大値を取る。
  let topPrizeValue = 0;
  for (const v of base) if (v > topPrizeValue) topPrizeValue = v;
  const judgeUntilSlots = Math.floor(spec.total * THRESHOLD.judgeUntilSoldRatio);
  const revenueToSellOut = (spec.total - judgeUntilSlots) * spec.price;

  const endgameVerdict = judgeEndgame(egMedian, endgameReached);

  const endgame: EndgameAnalysis = {
    reached: endgameReached,
    verdict: endgameVerdict,
    rtpMedian: egMedian,
    rtpWorst: egWorst,
    topPrizeRemainRate: topRemainRate,
    topPrizeTailRate: topTailRate,
    topPrizeValue: Math.round(topPrizeValue),
    tailSlots,
    rtpAtTail,
    revenueToSellOut,
    reason: endgameReason({
      reached: endgameReached,
      soldRatio: s.soldRatio,
      topPrizeValue: Math.round(topPrizeValue),
      topRemainRate,
      topTailRate,
      tailSlots,
      rtpAtTail,
      egMedian,
      revenueToSellOut,
    }),
    actions: endgameActions(endgameVerdict, endgameReached, topRemainRate),
  };

  return {
    key: s.key,
    label: s.label,
    premise: s.premise,
    designedRtp: designedRtp(spec),

    expected,
    tailRisk,
    verdict,
    reason,

    peakRtp: distribution.rtpMedian,
    peakAtSoldPct: mid.normalPeakAt,
    distribution,

    endgame,

    profit: Math.round(mid.profit),
    revenue: Math.round(mid.revenue),
    payout: Math.round(mid.payout),
    leftoverValue: Math.round(mid.leftoverValue),
  };
}

function endgameReason(a: {
  reached: boolean;
  soldRatio: number;
  topPrizeValue: number;
  topRemainRate: number;
  topTailRate: number;
  tailSlots: number;
  rtpAtTail: number;
  egMedian: number;
  revenueToSellOut: number;
}): string {
  if (!a.reached) {
    return `この想定では消化 ${(a.soldRatio * 100).toFixed(0)}% で止まるため、終盤に到達しません。終盤リスクよりも、売れ残った在庫の扱いが問題になります。`;
  }
  const yen = `¥${a.topPrizeValue.toLocaleString("ja-JP")}`;
  // 「消化70%まで残る確率」と「残りわずかまで残る確率」は別の事象なので、必ず分けて書く
  const head = `最上位賞（${yen}）が消化70%の時点で残っている確率は ${(a.topRemainRate * 100).toFixed(0)}%、残り${a.tailSlots}口まで残る確率は ${(a.topTailRate * 100).toFixed(0)}%。`;
  const mid =
    a.topTailRate > 0 && a.rtpAtTail > 0
      ? `残ったまま残り${a.tailSlots}口になった場合、その時点の実還元率は ${a.rtpAtTail.toFixed(0)}% になります。`
      : `残り${a.tailSlots}口まで残るケースはこの想定では出ませんでした。`;
  const tail = `終盤に入ってから完売までに必要な売上は ¥${a.revenueToSellOut.toLocaleString("ja-JP")} です。`;
  return `${head}${mid}${tail}`;
}

function endgameActions(
  v: Verdict,
  reached: boolean,
  topRemainRate: number
): string[] {
  if (!reached) {
    return [
      "在庫の引き取り先を先に決める",
      "販売期間の延長を検討する",
      "次回は口数を減らす",
    ];
  }
  const base = ["完売優先（残りを売り切る）", "追加施策の検討（告知・期間延長）"];
  if (v !== "SAFE") base.unshift("停止判断（この付近で販売を止める）");
  if (topRemainRate >= 0.2)
    base.push("ラストワン特典として上位賞の残りを訴求する");
  return base;
}

/* ────────────────────────────────
   入口
   ──────────────────────────────── */

/** 全シナリオを回す。同じ spec ＋ 同じ seed なら必ず同じ結果になる。 */
export function backtest(spec: GachaSpec, seed: number = DEFAULT_SEED): ScenarioResult[] {
  return SCENARIOS.map((s) => runScenario(spec, s, seed));
}

/** 再現に必要な情報を含めた、レポート全体を作る */
export function backtestReport(
  spec: GachaSpec,
  seed: number = DEFAULT_SEED,
  ranAt = ""
): BacktestReport {
  const issues = validateSpec(spec);
  const scenarios = backtest(spec, seed);
  return {
    engineVersion: BACKTEST_ENGINE_VERSION,
    seed,
    runs: RUNS,
    ranAt,
    designedRtp: designedRtp(spec),
    overall: overallVerdict(scenarios),
    maxLossRate: Math.max(...scenarios.map((s) => s.distribution.lossRate)),
    scenarios,
    issues,
    usable: issues.length === 0,
  };
}

/** 全体としての判定（いちばん悪いシナリオに合わせる） */
export function overallVerdict(results: ScenarioResult[]): Verdict {
  if (results.some((r) => r.verdict === "DANGER")) return "DANGER";
  if (results.some((r) => r.verdict === "CAUTION")) return "CAUTION";
  return "SAFE";
}

/** 終盤だけを見た全体判定 */
export function overallEndgameVerdict(results: ScenarioResult[]): Verdict {
  if (results.some((r) => r.endgame.verdict === "DANGER")) return "DANGER";
  if (results.some((r) => r.endgame.verdict === "CAUTION")) return "CAUTION";
  return "SAFE";
}

export const verdictLabel: Record<Verdict, string> = {
  SAFE: "このまま公開できます",
  CAUTION: "条件つきで公開できます",
  DANGER: "この構成では公開しないでください",
};
