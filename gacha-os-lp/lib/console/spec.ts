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
 */

import type { GachaSpec, Prize } from "@/lib/backtest";

/** S賞をどのくらい強くするか */
export type Strength = 0 | 1 | 2;

export const STRENGTH_LABEL: Record<Strength, string> = {
  0: "控えめ",
  1: "ふつう",
  2: "強め",
};

/** 賞ごとの、景品予算の配分（S / A / B / C / D） */
const SHARE: Record<Strength, number[]> = {
  0: [0.15, 0.2, 0.25, 0.25, 0.15],
  1: [0.25, 0.2, 0.22, 0.2, 0.13],
  2: [0.38, 0.18, 0.18, 0.16, 0.1],
};

const GRADES = ["S", "A", "B", "C", "D"];

export function buildSpec(
  name: string,
  price: number,
  total: number,
  strength: Strength,
  targetRtp: number,
): GachaSpec {
  const budget = price * total * (targetRtp / 100);
  const counts = [
    1,
    Math.max(2, Math.round(total * 0.012)),
    Math.max(4, Math.round(total * 0.04)),
    Math.max(10, Math.round(total * 0.12)),
    Math.max(20, Math.round(total * 0.3)),
  ];
  const share = SHARE[strength];

  const prizes: Prize[] = GRADES.map((grade, i) => {
    const raw = (budget * share[i]) / counts[i];
    /* 100円単位に丸める。1円単位の景品価格は、現場で扱えません */
    const value = Math.max(100, Math.round(raw / 100) * 100);
    return { grade, name: `${grade}賞 相当（デモ景品）`, count: counts[i], value };
  });

  return { name, price, total, prizes };
}
