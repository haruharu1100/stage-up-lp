/**
 * ガチャの「賞の構成」を組み立てる。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ画面ではなく、ここに置くのか
 * ═══════════════════════════════════════════════
 *
 *   賞の本数と値段の決め方は、還元率に直結します。
 *   還元率は、赤字になるかどうかそのものです。
 *   画面の中に書くと、デザインを直すたびに
 *   「還元率の出し方が変わっていないか」を目で確かめる羽目になります。
 *
 * ★端数を丸めたあとに、必ず還元率を計算し直すこと。
 *   目標94%で組んでも、100円単位に丸めた時点で数字はずれます。
 *   ずれたまま「94%です」と表示すると、公開してから合わなくなります。
 *   だからこのファイルは目標値を返しません。組んだ結果だけを返します。
 *
 * ═══════════════════════════════════════════════
 * ★上位賞に予算を寄せすぎないこと（2026-08-22 修正）
 * ═══════════════════════════════════════════════
 *
 *   以前ここは、S賞1本に景品予算の 15〜38% を積んでいました。
 *   1,000口・500円のガチャなら、たった1本のカードに 18万円です。
 *
 *   この構成は、公開前バックテストを絶対に通りません。通らないのが正しいです。
 *   上位賞が箱に残ったまま販売が進むと、残り口数が減るぶん
 *   「次に買うお客様から見た実還元率」が跳ね上がり、
 *   途中で販売を止めるしかなくなるからです。
 *
 *   つまり以前は、AIが「検証に落ちる案しか出せない」状態でした。
 *   実在するオリパの構成（上位賞は売上の3〜5%程度）に合わせ直しています。
 *
 * ★はずれ（景品の入っていない口）を作らないこと
 *   以前は口数の半分以上が空でした。空の口には抽選側が
 *   「参加ポイント（料金の10%）」を配るのに、その分は還元率の計算に
 *   入っていませんでした。設計95%と表示しながら、実際は100%を超えます。
 *   いまは D賞 が残り全部の口を埋めるので、空の口は出ません。
 */

import type { GachaSpec, Prize } from "@/lib/backtest";

/** S賞をどのくらい強くするか */
export type Strength = 0 | 1 | 2;

export const STRENGTH_LABEL: Record<Strength, string> = {
  0: "控えめ",
  1: "ふつう",
  2: "強め",
};

/**
 * 賞ごとの、景品予算の配分（S / A / B / C / D）。
 *
 * S賞の取り分を上げるほど「夢はあるが、検証は通りにくい」構成になります。
 * 強め（13%）でも、口数の少ないガチャでは DANGER になります。
 * それは不具合ではなく、そういう構成だからです。
 */
const SHARE: Record<Strength, number[]> = {
  0: [0.05, 0.12, 0.2, 0.28, 0.35],
  1: [0.08, 0.13, 0.2, 0.27, 0.32],
  2: [0.13, 0.14, 0.19, 0.25, 0.29],
};

const GRADES = ["S", "A", "B", "C", "D"];

/**
 * 100円単位に丸める（S〜C賞は現物の景品なので、1円単位の値付けは現場で扱えません）
 *
 * ★D賞だけは、この丸めを使いません。
 *   D賞はポイントでお返しする等級なので、1pt単位で問題がなく、
 *   むしろ100円単位に丸めると還元率が数％ずれます。
 */
function round100(n: number): number {
  return Math.max(100, Math.round(n / 100) * 100);
}

export function buildSpec(
  name: string,
  price: number,
  total: number,
  strength: Strength,
  targetRtp: number,
): GachaSpec {
  const safeTotal = Math.max(1, Math.floor(total));
  const budget = price * safeTotal * (targetRtp / 100);
  const share = SHARE[strength];

  /* 上位4つの本数を先に決め、D賞が残りの口を全部埋める。
     こうすると「景品の入っていない口」が出ない */
  const s = 1;
  const a = Math.max(2, Math.round(safeTotal * 0.012));
  const b = Math.max(4, Math.round(safeTotal * 0.04));
  const c = Math.max(10, Math.round(safeTotal * 0.12));
  const upper = s + a + b + c;
  const d = Math.max(1, safeTotal - upper);
  const counts = [s, a, b, c, d];

  /* S〜C賞は現物の景品なので、100円単位に丸める */
  const values = share.map((sh, i) => round100((budget * sh) / counts[i]));

  /* ★丸めた分のズレを、D賞の1本あたりの価値で吸収する。
     100円単位に丸めると、安いガチャほど誤差が効きます。
     例：1回300円・2,000口なら D賞は1本110円のはずが、丸めて100円。
     そのまま出すと、目標95%のつもりが89%になります。
     D賞はポイントでお返しする等級なので、1pt単位で構いません。
     ここで端数を吸収することで、口を1つも空けずに目標へ寄せられます。 */
  const upperValue = counts
    .slice(0, 4)
    .reduce((acc, cnt, i) => acc + cnt * values[i], 0);
  values[4] = Math.max(1, Math.round((budget - upperValue) / counts[4]));

  const prizes: Prize[] = GRADES.map((grade, i) => ({
    grade,
    name: `${grade}賞 相当（デモ景品）`,
    count: counts[i],
    value: values[i],
  }));

  return { name, price, total: safeTotal, prizes };
}
