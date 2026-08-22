/**
 * ゴールデンテスト（数字の作り置き）
 *
 * ★これは「意図しない変更」を止めるためのテストです。
 *   数字が変わってテストが落ちたら、それは
 *     ・バグ（直すべき）なのか
 *     ・意図した改良（数字が変わって正しい）なのか
 *   を人が確認するまで、テストを通さないでください。
 *   落ちたテストを消したり、期待値を新しい数字に書き換えて「通した」ことに
 *   するのは禁止です。それをやると、このテストは何も守らなくなります。
 *
 * なぜここまでやるか：
 *   このサイトの売りは「公開前に赤字確率が分かる」ことです。
 *   画面は正しく見えているのに計算だけ間違っている、という不具合が
 *   これまで4件見つかりました（終盤の還元率が2010%に跳ねる、
 *   別々の出来事の確率を1つの文章に混ぜてしまう、など）。
 *   見た目では気づけないので、数字そのものを固定して見張ります。
 *
 * ここに書いてある期待値は、実際にエンジンを回して出た値です（推測ではありません）。
 * 意図してアルゴリズムを変えるときは、
 *   ① lib/backtest.ts の BACKTEST_ENGINE_VERSION を上げる
 *   ② このファイルの期待値を新しい値に更新する
 * を「同じコミットの中で両方」やってください。片方だけは不可です。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  BACKTEST_ENGINE_VERSION,
  DEFAULT_SEED,
  RUNS,
  backtestReport,
  designedRtp,
  type ScenarioKey,
  type ScenarioResult,
} from "../lib/backtest";
import { demoBacktestSpec } from "../content/demoData";

/** 実還元率など「％」の許容誤差。0.05ポイントまでのズレしか認めない */
const PCT_TOLERANCE = 0.05;

const report = backtestReport(demoBacktestSpec);

function scenario(key: ScenarioKey): ScenarioResult {
  const s = report.scenarios.find((x) => x.key === key);
  assert.ok(s, `シナリオ ${key} が見つかりません`);
  return s;
}

/** ％の比較（小数のわずかな差は許す） */
function pct(actual: number, expected: number, label: string) {
  assert.ok(
    Math.abs(actual - expected) <= PCT_TOLERANCE,
    `${label}: 期待 ${expected}% に対して実際は ${actual}%（許容 ±${PCT_TOLERANCE}）`
  );
}

/* ────────────────────────────────
   1. エンジンの素性
   ──────────────────────────────── */

test("エンジンのバージョン・種・試行回数が固定されている", () => {
  // ここを変えるということは、判定ルールそのものを変えるということ。
  // 変えた場合は、このファイルの期待値も同じコミットで更新すること。
  assert.equal(BACKTEST_ENGINE_VERSION, "2.0.0");
  // 種（seed）を変えると当選順が全部変わる＝下の数字は全部変わる
  assert.equal(DEFAULT_SEED, 20260820);
  // 試行回数を変えると分布（赤字確率・P95）が変わる
  assert.equal(RUNS, 200);

  assert.equal(report.engineVersion, BACKTEST_ENGINE_VERSION);
  assert.equal(report.seed, DEFAULT_SEED);
  assert.equal(report.runs, RUNS);
  assert.equal(report.scenarios.length, 6);
});

/* ────────────────────────────────
   2. 画面に出ているモデルケースの数字
   （トップページに載っている「スニーカーBOX 第13弾」）
   ──────────────────────────────── */

test("設計時の還元率は 93.2%", () => {
  // 景品の総額 1,491,200円 ÷（800口 × 2,000円）= 93.2%
  pct(report.designedRtp, 93.2, "designedRtp");
  pct(designedRtp(demoBacktestSpec), 93.2, "designedRtp(spec)");
});

test("公開可否は SAFE、運営判定は DANGER（相場が上がれば赤字に変わるため）", () => {
  /* ★2.0.0 から、判定は2つに分かれています。
       overall（公開可否）…【設計】シナリオだけで決める
       stress（運営判定）…【運営】シナリオだけで決める
     この構成は、そのまま公開してよい（設計 SAFE）。
     ただし相場が 7.3% 上がった時点で赤字に変わるので、
     運営中はそこを見張る、という読み方になります。 */
  assert.equal(report.overall, "SAFE");
  assert.equal(report.stress, "DANGER");
  // 設計還元率93.2% → 100 ÷ 93.2 − 1 = 7.3%
  assert.equal(report.stopLineUpPct, 7.3);
  // 全シナリオを通じた最大の赤字確率＝相場高騰の 100%
  assert.equal(report.maxLossRate, 1);
});

test("シナリオの役割分担が固定されている（設計2件・運営4件）", () => {
  const kinds = Object.fromEntries(report.scenarios.map((s) => [s.key, s.kind]));
  assert.deepEqual(kinds, {
    normal: "design",
    earlyJackpot: "design",
    surge: "stress",
    slump: "stress",
    lateJackpot: "stress",
    slowSales: "stress",
  });
});

test("通常シナリオ: SAFE / 中央値 93.3% / 赤字0回 / 粗利 +108,800円", () => {
  const s = scenario("normal");
  assert.equal(s.kind, "design");
  assert.equal(s.verdict, "SAFE");
  assert.equal(s.expected, "SAFE");
  assert.equal(s.tailRisk, "MEDIUM");

  // peakRtp は「途中でいちばん高かった一瞬」。表示用で、判定には使わない
  pct(s.peakRtp, 93.333333, "peakRtp");
  pct(s.distribution.rtpPeakMedian, 98.642384, "rtpPeakMedian");

  // 判定に使うのは、消化70%時点の実還元率
  pct(s.distribution.rtpMedian, 93.333333, "rtpMedian");
  pct(s.distribution.rtpP90, 104.666667, "rtpP90");
  pct(s.distribution.rtpP95, 106.875, "rtpP95");
  pct(s.distribution.rtpWorst, 115.166667, "rtpWorst");

  // 赤字になった回は1回もない
  assert.equal(s.distribution.lossRate, 0);
  assert.equal(s.distribution.safeRate, 0.9);
  assert.equal(s.distribution.cautionRate, 0.08);
  assert.equal(s.distribution.dangerRate, 0.02);

  // 金額は円単位でぴったり一致すること
  assert.equal(s.distribution.profitMedian, 108_800);
  assert.equal(s.distribution.profitWorst, 108_800);
  assert.equal(s.distribution.profitP95Loss, 108_800);
  // 売り切る想定では、当選順を変えても粗利は1円も動かない
  assert.equal(s.distribution.profitVaries, false);

  assert.equal(s.revenue, 1_600_000);
  assert.equal(s.payout, 1_491_200);
  assert.equal(s.leftoverValue, 0);
  assert.equal(s.profit, 108_800);
});

test("通常シナリオの終盤: 最上位賞が70%時点まで残る確率 29.5%、残り40口まで残る確率 5.5%", () => {
  const eg = scenario("normal").endgame;
  assert.equal(eg.reached, true);
  assert.equal(eg.verdict, "SAFE");
  pct(eg.rtpMedian, 106.25, "endgame.rtpMedian");
  pct(eg.rtpWorst, 193.5, "endgame.rtpWorst");

  // ここは「70%時点で残る確率」と「残り40口まで残る確率」という
  // まったく別の出来事。過去に1つの文章に混ぜてしまった箇所なので、
  // 別々の数字として固定しておく。
  assert.equal(eg.topPrizeRemainRate, 0.295);
  assert.equal(eg.topPrizeTailRate, 0.055);
  assert.ok(eg.topPrizeTailRate < eg.topPrizeRemainRate);

  assert.equal(eg.topPrizeValue, 51_800);
  assert.equal(eg.tailSlots, 40);
  pct(eg.rtpAtTail, 146.25, "endgame.rtpAtTail");
  assert.equal(eg.revenueToSellOut, 480_000);
});

test("相場高騰シナリオ: DANGER / 中央値 116.7% / 全200回が赤字 / 粗利 −264,000円", () => {
  const s = scenario("surge");
  // ★このシナリオは【運営】側。公開を止める理由にはしない
  assert.equal(s.kind, "stress");
  assert.equal(s.verdict, "DANGER");
  assert.equal(s.expected, "DANGER");
  assert.equal(s.tailRisk, "HIGH");

  pct(s.distribution.rtpMedian, 116.666667, "rtpMedian");
  pct(s.distribution.rtpP90, 129.791667, "rtpP90");
  pct(s.distribution.rtpP95, 134.114583, "rtpP95");
  pct(s.distribution.rtpWorst, 142.395833, "rtpWorst");

  assert.equal(s.distribution.lossRate, 1);
  assert.equal(s.distribution.dangerRate, 1);

  assert.equal(s.distribution.profitMedian, -264_000);
  assert.equal(s.distribution.profitWorst, -264_000);
  assert.equal(s.distribution.profitP95Loss, -264_000);
  assert.equal(s.distribution.profitVaries, false);

  assert.equal(s.revenue, 1_600_000);
  // 相場が25%上がるので、景品の支払いも25%増える
  assert.equal(s.payout, 1_864_000);
  assert.equal(s.profit, -264_000);

  assert.equal(s.endgame.verdict, "CAUTION");
  assert.equal(s.endgame.topPrizeValue, 64_750);
  pct(s.endgame.rtpMedian, 132.25, "endgame.rtpMedian");
});

test("相場下落シナリオ: SAFE / 中央値 74.7% / 粗利 +407,040円", () => {
  const s = scenario("slump");
  assert.equal(s.verdict, "SAFE");
  pct(s.distribution.rtpMedian, 74.666667, "rtpMedian");
  pct(s.distribution.rtpP95, 85.833333, "rtpP95");
  assert.equal(s.distribution.lossRate, 0);
  assert.equal(s.distribution.safeRate, 1);
  assert.equal(s.distribution.profitMedian, 407_040);
  assert.equal(s.payout, 1_192_960);
});

test("序盤で高額賞シナリオ: SAFE / 中央値 90.2% / 最上位賞は終盤まで残らない", () => {
  const s = scenario("earlyJackpot");
  assert.equal(s.kind, "design");
  assert.equal(s.verdict, "SAFE");
  pct(s.distribution.rtpMedian, 90.166667, "rtpMedian");
  pct(s.distribution.rtpP95, 102.458333, "rtpP95");
  assert.equal(s.distribution.lossRate, 0);
  assert.equal(s.distribution.profitMedian, 108_800);

  // 最初の10%以内で必ず引かれる想定なので、残る確率は0
  assert.equal(s.endgame.topPrizeRemainRate, 0);
  assert.equal(s.endgame.topPrizeTailRate, 0);
  // 残るケースが0件なので、その時点の還元率は「該当なし」の0
  assert.equal(s.endgame.rtpAtTail, 0);
});

test("終盤まで高額賞が残るシナリオ: CAUTION（期待値はSAFEだがテールリスクが高い）", () => {
  const s = scenario("lateJackpot");
  // 中央値だけ見れば安全だが、悪い方の分布が重いので1段階重くする
  assert.equal(s.expected, "SAFE");
  assert.equal(s.tailRisk, "HIGH");
  assert.equal(s.verdict, "CAUTION");
  // ★このシナリオは【運営】側。起きたときの動き方を出すもので、公開は止めない
  assert.equal(s.kind, "stress");

  pct(s.distribution.rtpMedian, 100.666667, "rtpMedian");
  pct(s.distribution.rtpP95, 111.708333, "rtpP95");
  assert.equal(s.distribution.lossRate, 0);
  assert.equal(s.distribution.profitMedian, 108_800);

  // 定義上、最上位賞は必ず終盤まで残る
  assert.equal(s.endgame.topPrizeRemainRate, 1);
  assert.equal(s.endgame.topPrizeTailRate, 0.29);
  pct(s.endgame.rtpMedian, 128.787879, "endgame.rtpMedian");
});

test("販売速度低下シナリオ: CAUTION / 赤字確率 14.5% / 最悪 −81,000円", () => {
  const s = scenario("slowSales");
  assert.equal(s.kind, "stress");
  assert.equal(s.verdict, "CAUTION");
  pct(s.distribution.rtpMedian, 92.75, "rtpMedian");
  assert.equal(s.distribution.lossRate, 0.145);
  assert.equal(s.distribution.profitMedian, 45_000);
  assert.equal(s.distribution.profitWorst, -81_000);
  assert.equal(s.distribution.profitP95Loss, -20_600);
  // 途中で止まる想定なので、ここだけは当選順で粗利が変わる
  assert.equal(s.distribution.profitVaries, true);

  assert.equal(s.revenue, 720_000); // 800口 × 45% = 360口 × 2,000円
  // 代表として見せる1回は「中央値の回」。2.0.0 で並べ替えの基準が
  // 「途中の最大値」から「消化70%時点の実還元率」に変わったため、
  // どの回を代表に選ぶかが変わり、金額も入れ替わっている
  assert.equal(s.payout, 675_000);
  assert.equal(s.leftoverValue, 816_200);
  assert.equal(s.profit, 45_000);

  // 45%で止まるので終盤（消化70%以降）には到達しない
  assert.equal(s.endgame.reached, false);
  assert.equal(s.endgame.rtpMedian, 0);
  assert.equal(s.endgame.rtpWorst, 0);
});

/* ────────────────────────────────
   3. 再現性（同じ設定なら必ず同じ答え）
   ──────────────────────────────── */

test("同じ設定・同じ種なら、2回回しても完全に同じ結果になる", () => {
  // 「前回はDANGERだったのに今日はSAFE」が起きないことの確認。
  // ranAt（実行時刻）だけは呼び出し側が入れる値なので、既定の空文字で揃える。
  const a = backtestReport(demoBacktestSpec);
  const b = backtestReport(demoBacktestSpec);
  assert.deepEqual(a, b);
  // 明示的に既定の種を渡した場合も同じ
  assert.deepEqual(backtestReport(demoBacktestSpec, DEFAULT_SEED), a);
});

test("種を変えると結果も変わる（種が本当に使われている証拠）", () => {
  const base = backtestReport(demoBacktestSpec, DEFAULT_SEED);
  const other = backtestReport(demoBacktestSpec, 12_345);

  assert.equal(other.seed, 12_345);
  // 種が無視されていれば完全一致してしまう。一致しないことを確認する
  assert.notDeepEqual(other.scenarios, base.scenarios);

  // 分布そのものが動いていること（判定文字列だけの差ではないこと）
  const moved = (["normal", "surge", "slowSales"] as const).filter((key) => {
    const x = base.scenarios.find((s) => s.key === key)!;
    const y = other.scenarios.find((s) => s.key === key)!;
    return x.distribution.rtpMedian !== y.distribution.rtpMedian;
  });
  assert.equal(moved.length, 3, "種を変えても中央値が動かないシナリオがあります");

  // 一方で、売り切る想定の粗利は当選順に左右されないので変わらない。
  // これは「種が効いていない」のではなく、そういう性質であることの確認。
  const baseNormal = base.scenarios.find((s) => s.key === "normal")!;
  const otherNormal = other.scenarios.find((s) => s.key === "normal")!;
  assert.equal(baseNormal.distribution.profitMedian, otherNormal.distribution.profitMedian);
});
