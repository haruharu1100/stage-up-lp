/**
 * テスト用の共通道具。
 *
 * ここにはテストからしか使わない小さな部品だけを置きます。
 * 本体（lib/backtest.ts）には一切手を入れません。
 * 「テストを通すために計算を変える」のは、この仕組みの意味を消してしまうためです。
 *
 * ※ ファイル名が *.test.ts ではないので、npm test の対象にはなりません。
 */

import type { GachaSpec, ScenarioKey } from "../lib/backtest";

/**
 * レポート全体をたどって、数字がおかしくなっていないかを調べる。
 *
 * なぜ必要か：
 *   NaN（計算不能）や Infinity（無限大）は、画面上では「-」や「NaN%」として
 *   出るだけで、見た目には気づきにくい。0で割ってしまった、空の配列の
 *   平均を取ってしまった、といった事故がここで必ず引っかかるようにする。
 *
 * @returns 問題のあった場所の一覧（空なら健全）
 */
export function findBadNumbers(value: unknown, path = "report"): string[] {
  const bad: string[] = [];
  const walk = (v: unknown, p: string) => {
    if (typeof v === "number") {
      if (Number.isNaN(v)) bad.push(`${p} = NaN`);
      else if (!Number.isFinite(v)) bad.push(`${p} = ${v > 0 ? "Infinity" : "-Infinity"}`);
      return;
    }
    if (Array.isArray(v)) {
      v.forEach((x, i) => walk(x, `${p}[${i}]`));
      return;
    }
    if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) walk(x, `${p}.${k}`);
    }
  };
  walk(value, path);
  return bad;
}

/**
 * シナリオごとの前提（相場の倍率・どこまで売れたか）。
 *
 * これは lib/backtest.ts の SCENARIOS を写したもの。
 * 本体側は export していないので、テストからは同じ値を「別に」持っておき、
 * 本体の出した金額と突き合わせる。
 * 本体を書き換えたのにこちらを直し忘れれば、テストが落ちて気づける。
 */
export const SCENARIO_PREMISE: Record<
  ScenarioKey,
  { priceScale: number; soldRatio: number }
> = {
  normal: { priceScale: 1, soldRatio: 1 },
  surge: { priceScale: 1.25, soldRatio: 1 },
  slump: { priceScale: 0.8, soldRatio: 1 },
  earlyJackpot: { priceScale: 1, soldRatio: 1 },
  lateJackpot: { priceScale: 1, soldRatio: 1 },
  slowSales: { priceScale: 1, soldRatio: 0.45 },
};

/**
 * 「実際に口の中へ入る景品の合計金額」をテスト側で独自に計算する。
 *
 * 本体の expand() と同じ考え方をわざと別に書いている（答え合わせ用）。
 * 景品の本数の合計が総口数を超えていた場合、後ろの景品は入りきらずに
 * 切り捨てられる。運営の入力ミス（在庫超過）を再現するために、
 * その切り捨てまで含めて数える。
 */
export function totalPrizeValueInSlots(spec: GachaSpec): number {
  let placed = 0;
  let sum = 0;
  for (const p of spec.prizes) {
    for (let i = 0; i < p.count; i++) {
      if (placed >= spec.total) return sum;
      sum += p.value;
      placed++;
    }
  }
  return sum;
}
