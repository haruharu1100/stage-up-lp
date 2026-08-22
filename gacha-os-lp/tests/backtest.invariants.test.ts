/**
 * 不変条件テスト（どんな入力でも絶対に成り立つはずのこと）
 *
 * ゴールデンテストが「この構成のときはこの数字」を見張るのに対して、
 * こちらは「どんな構成であっても、これだけは絶対に破れない」を見張ります。
 *
 * 見張る中身（すべて、ガチャとして当たり前のこと）：
 *   ・残り口数がマイナスにならない（売った数が総口数を超えない）
 *   ・景品の本数がマイナスにならない／用意した以上に出ない
 *   ・同じ1本を2人に渡さない（売り切ったら、出た景品の合計＝用意した合計）
 *   ・割り算の分母が0にならない
 *   ・NaN（計算不能）や Infinity（無限大）がレポートのどこにも出ない ← 最重要
 *   ・確率が 0〜1 の外に出ない
 *   ・中央値 ≦ P90 ≦ P95 ≦ 最悪値 の順番が崩れない
 *
 * このファイルが落ちたら、それは「表示の問題」ではなく「計算が壊れている」ということです。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  RUNS,
  THRESHOLD,
  backtestReport,
  designedRtp,
  type BacktestReport,
  type GachaSpec,
} from "../lib/backtest";
import { demoBacktestSpec } from "../content/demoData";
import { SCENARIO_PREMISE, findBadNumbers, totalPrizeValueInSlots } from "./_helpers";

/**
 * 不変条件は「1つの構成でたまたま成り立った」では意味がないので、
 * 性格の違う構成をいくつも通して確かめる。
 */
const SPECS: { label: string; spec: GachaSpec }[] = [
  { label: "デモ（トップページのモデルケース）", spec: demoBacktestSpec },
  {
    label: "還元率が高すぎる構成",
    spec: {
      name: "高還元",
      price: 1_000,
      total: 300,
      prizes: [
        { grade: "S賞", name: "S", count: 2, value: 80_000 },
        { grade: "A賞", name: "A", count: 10, value: 9_000 },
        { grade: "B賞", name: "B", count: 288, value: 700 },
      ],
    },
  },
  {
    label: "上位賞が極端に重い構成",
    spec: {
      name: "一点豪華",
      price: 5_000,
      total: 200,
      prizes: [{ grade: "S賞", name: "S", count: 1, value: 400_000 }],
    },
  },
  {
    label: "景品が均一な構成",
    spec: {
      name: "均一",
      price: 3_000,
      total: 500,
      prizes: [{ grade: "A賞", name: "A", count: 500, value: 2_400 }],
    },
  },
  {
    label: "在庫が総口数を超えている（運営の入力ミス）",
    spec: {
      name: "在庫超過",
      price: 2_000,
      total: 100,
      prizes: [{ grade: "S賞", name: "S", count: 500, value: 1_500 }],
    },
  },
];

const REPORTS: { label: string; spec: GachaSpec; report: BacktestReport }[] = SPECS.map(
  ({ label, spec }) => ({ label, spec, report: backtestReport(spec) })
);

/* ────────────────────────────────
   最重要：数字が壊れていないこと
   ──────────────────────────────── */

test("【最重要】レポートのどこにも NaN と Infinity が無い", () => {
  for (const { label, report } of REPORTS) {
    const bad = findBadNumbers(report);
    assert.deepEqual(
      bad,
      [],
      `${label}: 壊れた数字が見つかりました → ${bad.join(" / ")}`
    );
  }
});

test("種を変えても NaN と Infinity は出ない", () => {
  // 当選順が変われば分母の作られ方も変わる。種違いでも壊れないことを確認する
  for (const seed of [0, 1, 7, 999_999, 20_260_101]) {
    const bad = findBadNumbers(backtestReport(demoBacktestSpec, seed));
    assert.deepEqual(bad, [], `seed=${seed} で壊れた数字が出ました → ${bad.join(" / ")}`);
  }
});

/* ────────────────────────────────
   在庫・口数の保存則
   ──────────────────────────────── */

test("売った口数が総口数を超えない（残り口数がマイナスにならない）", () => {
  for (const { label, spec, report } of REPORTS) {
    for (const s of report.scenarios) {
      const soldSlots = s.revenue / spec.price;
      assert.ok(
        Number.isInteger(Math.round(soldSlots)) && Math.abs(soldSlots - Math.round(soldSlots)) < 1e-6,
        `${label}/${s.key}: 売れた口数が整数になっていません（${soldSlots}）`
      );
      assert.ok(soldSlots >= 0, `${label}/${s.key}: 売れた口数がマイナスです（${soldSlots}）`);
      assert.ok(
        Math.round(soldSlots) <= spec.total,
        `${label}/${s.key}: 総口数 ${spec.total} を超えて ${soldSlots} 口売れています`
      );

      // 想定どおりの消化率で止まっているか
      const expected = Math.max(1, Math.round(spec.total * SCENARIO_PREMISE[s.key].soldRatio));
      assert.equal(
        Math.round(soldSlots),
        expected,
        `${label}/${s.key}: 止まる口数が想定と違います`
      );
    }
  }
});

test("出た景品がマイナスにならず、用意した本数を超えない", () => {
  for (const { label, spec, report } of REPORTS) {
    // 口の中に実際に入る景品の総額（在庫超過ぶんは入りきらないので切り捨て）
    const stock = totalPrizeValueInSlots(spec);
    for (const s of report.scenarios) {
      const scale = SCENARIO_PREMISE[s.key].priceScale;
      const stockScaled = stock * scale;

      assert.ok(s.payout >= 0, `${label}/${s.key}: 支払った景品額がマイナスです（${s.payout}）`);
      assert.ok(
        s.leftoverValue >= 0,
        `${label}/${s.key}: 売れ残りの価値がマイナスです（${s.leftoverValue}）`
      );
      assert.ok(
        s.payout <= stockScaled + 2,
        `${label}/${s.key}: 用意した景品(${stockScaled})より多く(${s.payout})出ています`
      );
    }
  }
});

test("同じ1本を二重に出していない（出た景品＋残った景品＝用意した景品）", () => {
  for (const { label, spec, report } of REPORTS) {
    const stock = totalPrizeValueInSlots(spec);
    for (const s of report.scenarios) {
      const stockScaled = stock * SCENARIO_PREMISE[s.key].priceScale;
      // 表示用に円単位で四捨五入されているので、数円のズレは許す
      assert.ok(
        Math.abs(s.payout + s.leftoverValue - stockScaled) <= 2,
        `${label}/${s.key}: 景品の帳尻が合いません（出た ${s.payout} ＋ 残り ${s.leftoverValue} ≠ 用意 ${stockScaled}）`
      );
    }
  }
});

test("売り切る想定では、景品はきれいに出し切って売れ残りが0になる", () => {
  for (const { label, spec, report } of REPORTS) {
    const stock = totalPrizeValueInSlots(spec);
    for (const s of report.scenarios) {
      if (SCENARIO_PREMISE[s.key].soldRatio < 1) continue;
      assert.equal(s.leftoverValue, 0, `${label}/${s.key}: 売り切ったのに売れ残りがあります`);
      const stockScaled = stock * SCENARIO_PREMISE[s.key].priceScale;
      assert.ok(
        Math.abs(s.payout - stockScaled) <= 2,
        `${label}/${s.key}: 売り切ったのに出た景品の合計が用意した合計と違います`
      );
    }
  }
});

test("粗利＝売上−景品支払い（計算がすり替わっていない）", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(
        Math.abs(s.profit - (s.revenue - s.payout)) <= 1,
        `${label}/${s.key}: 粗利が売上−支払いになっていません`
      );
    }
  }
});

/* ────────────────────────────────
   割り算の分母
   ──────────────────────────────── */

test("実還元率の分母が0にならない（0で割った痕跡が無い）", () => {
  // 0で割ると Infinity か NaN になる。「有限の数字である」ことが、
  // 分母が0になっていないことの証拠になる。
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      for (const [name, v] of [
        ["designedRtp", s.designedRtp],
        ["peakRtp", s.peakRtp],
        ["rtpMedian", s.distribution.rtpMedian],
        ["rtpP90", s.distribution.rtpP90],
        ["rtpP95", s.distribution.rtpP95],
        ["rtpWorst", s.distribution.rtpWorst],
        ["endgame.rtpMedian", s.endgame.rtpMedian],
        ["endgame.rtpWorst", s.endgame.rtpWorst],
        ["endgame.rtpAtTail", s.endgame.rtpAtTail],
      ] as const) {
        assert.ok(
          Number.isFinite(v) && v >= 0,
          `${label}/${s.key}: ${name} が ${v} になっています（分母0の疑い）`
        );
      }
    }
  }
});

test("設計時の還元率は全シナリオで同じ（構成そのものの数字なので相場では動かない）", () => {
  for (const { label, spec, report } of REPORTS) {
    const expected = designedRtp(spec);
    assert.ok(Number.isFinite(report.designedRtp), `${label}: designedRtp が壊れています`);
    for (const s of report.scenarios) {
      assert.equal(s.designedRtp, expected, `${label}/${s.key}: designedRtp がずれています`);
    }
    assert.equal(report.designedRtp, expected);
  }
});

/* ────────────────────────────────
   確率
   ──────────────────────────────── */

test("確率はすべて 0〜1 の中にある", () => {
  for (const { label, report } of REPORTS) {
    assert.ok(
      report.maxLossRate >= 0 && report.maxLossRate <= 1,
      `${label}: maxLossRate が範囲外（${report.maxLossRate}）`
    );
    for (const s of report.scenarios) {
      for (const [name, v] of [
        ["safeRate", s.distribution.safeRate],
        ["cautionRate", s.distribution.cautionRate],
        ["dangerRate", s.distribution.dangerRate],
        ["lossRate", s.distribution.lossRate],
        ["topPrizeRemainRate", s.endgame.topPrizeRemainRate],
        ["topPrizeTailRate", s.endgame.topPrizeTailRate],
      ] as const) {
        assert.ok(v >= 0 && v <= 1, `${label}/${s.key}: ${name} が範囲外（${v}）`);
      }
    }
  }
});

test("SAFE・CAUTION・DANGER の割合を足すとちょうど1になる", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      const d = s.distribution;
      assert.ok(
        Math.abs(d.safeRate + d.cautionRate + d.dangerRate - 1) < 1e-9,
        `${label}/${s.key}: 割合の合計が1になりません`
      );
      // 200回のうち何回、なので必ず 1/200 の倍数になる
      for (const v of [d.safeRate, d.cautionRate, d.dangerRate, d.lossRate]) {
        assert.ok(
          Math.abs(v * RUNS - Math.round(v * RUNS)) < 1e-9,
          `${label}/${s.key}: 割合が試行回数の刻みと合いません（${v}）`
        );
      }
      assert.equal(d.runs, RUNS);
    }
  }
});

test("赤字だった回は必ず DANGER に数えられている（赤字確率 ≦ DANGER割合）", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(
        s.distribution.lossRate <= s.distribution.dangerRate + 1e-9,
        `${label}/${s.key}: 赤字なのに DANGER に数えられていない回があります`
      );
    }
  }
});

test("「残り数口まで残る確率」は「終盤まで残る確率」以下（条件が厳しいので必ず小さい）", () => {
  // 過去に、この2つを1つの数字として混ぜてしまう不具合があった箇所。
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(
        s.endgame.topPrizeTailRate <= s.endgame.topPrizeRemainRate + 1e-9,
        `${label}/${s.key}: 残り数口まで残る確率(${s.endgame.topPrizeTailRate})が、終盤まで残る確率(${s.endgame.topPrizeRemainRate})を超えています`
      );
    }
  }
});

test("全体の最大赤字確率は、各シナリオの最大と一致する", () => {
  for (const { label, report } of REPORTS) {
    const expected = Math.max(...report.scenarios.map((s) => s.distribution.lossRate));
    assert.equal(report.maxLossRate, expected, `${label}: maxLossRate が合いません`);
  }
});

/* ────────────────────────────────
   分位点の並び順
   ──────────────────────────────── */

test("実還元率は 中央値 ≦ P90 ≦ P95 ≦ 最悪値 の順に並ぶ（高いほど悪い）", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      const d = s.distribution;
      assert.ok(d.rtpMedian <= d.rtpP90, `${label}/${s.key}: 中央値 > P90`);
      assert.ok(d.rtpP90 <= d.rtpP95, `${label}/${s.key}: P90 > P95`);
      assert.ok(d.rtpP95 <= d.rtpWorst, `${label}/${s.key}: P95 > 最悪値`);
      // 画面に出す peakRtp は中央値そのもの
      assert.equal(d.rtpMedian, s.peakRtp, `${label}/${s.key}: peakRtp が中央値と違います`);
    }
  }
});

test("粗利は 最悪値 ≦ 悪い方5% ≦ 中央値 の順に並ぶ（低いほど悪い）", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      const d = s.distribution;
      assert.ok(
        d.profitWorst <= d.profitP95Loss,
        `${label}/${s.key}: 最悪の粗利 > 悪い方5%の粗利`
      );
      assert.ok(
        d.profitP95Loss <= d.profitMedian,
        `${label}/${s.key}: 悪い方5%の粗利 > 中央値の粗利`
      );
    }
  }
});

test("粗利がばらつかない回では、最悪値も中央値も同じ額になる", () => {
  // 売り切る想定では、出ていく景品は結局すべて同じなので粗利は1円も動かない。
  // 「動かないのに最悪値だけ違う」なら、どこかで別の数字を混ぜている。
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      const d = s.distribution;
      if (d.profitVaries) continue;
      assert.equal(d.profitWorst, d.profitMedian, `${label}/${s.key}: ばらつかないのに差があります`);
      assert.equal(d.profitP95Loss, d.profitMedian, `${label}/${s.key}: ばらつかないのに差があります`);
    }
  }
});

test("終盤の還元率も 中央値 ≦ 最悪値 の順になる", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(
        s.endgame.rtpMedian <= s.endgame.rtpWorst,
        `${label}/${s.key}: 終盤の中央値が最悪値を超えています`
      );
    }
  }
});

/* ────────────────────────────────
   判定ロジックの筋が通っていること
   ──────────────────────────────── */

test("公開可否は【設計】シナリオの、いちばん悪いものと一致する", () => {
  /* ★2.0.0 で、シナリオは2つの役割に分かれました。
       【設計】…構成そのものの良し悪し（公開してよいか）
       【運営】…相場や売れ行きが動いたとき（運営中に気をつけること）
     公開可否は【設計】だけで決めます。
     「相場が25%上がったら」で公開を止めていた1.0.0では、
     還元率80%を超えるガチャが全部 DANGER になり、
     公開ボタンが永久に押せませんでした。 */
  const rank = { SAFE: 0, CAUTION: 1, DANGER: 2 } as const;
  for (const { label, report } of REPORTS) {
    const design = report.scenarios.filter((s) => s.kind === "design");
    assert.ok(design.length > 0, `${label}: 【設計】シナリオが1つもありません`);
    const worst = Math.max(...design.map((s) => rank[s.verdict]));
    assert.equal(rank[report.overall], worst, `${label}: 公開可否が【設計】の最悪値と一致しません`);
  }
});

test("運営判定は【運営】シナリオの、いちばん悪いものと一致する", () => {
  const rank = { SAFE: 0, CAUTION: 1, DANGER: 2 } as const;
  for (const { label, report } of REPORTS) {
    const stress = report.scenarios.filter((s) => s.kind === "stress");
    assert.ok(stress.length > 0, `${label}: 【運営】シナリオが1つもありません`);
    const worst = Math.max(...stress.map((s) => rank[s.verdict]));
    assert.equal(rank[report.stress], worst, `${label}: 運営判定が【運営】の最悪値と一致しません`);
  }
});

test("どのシナリオも【設計】か【運営】のどちらかに必ず属している", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(
        s.kind === "design" || s.kind === "stress",
        `${label}/${s.key}: 役割が ${s.kind} になっています`
      );
      /* テスト側に写しておいた表と一致すること。
         本体の役割分担をこっそり変えたら、ここで落ちる */
      assert.equal(
        s.kind,
        SCENARIO_PREMISE[s.key].kind,
        `${label}/${s.key}: シナリオの役割（設計／運営）が勝手に変わっています`
      );
    }
  }
});

test("総合判定は期待値の判定より軽くならない（テールリスクで重くはなるが軽くはしない）", () => {
  const rank = { SAFE: 0, CAUTION: 1, DANGER: 2 } as const;
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(
        rank[s.verdict] >= rank[s.expected],
        `${label}/${s.key}: 総合判定(${s.verdict})が期待値判定(${s.expected})より軽くなっています`
      );
    }
  }
});

test("中央値が赤字なら必ず DANGER になる", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      if (s.distribution.profitMedian < 0) {
        assert.equal(s.verdict, "DANGER", `${label}/${s.key}: 中央値が赤字なのに ${s.verdict}`);
      }
    }
  }
});

test("赤字確率が30%以上なら必ず DANGER になる", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      if (s.distribution.lossRate >= THRESHOLD.lossRateForceDanger) {
        assert.equal(
          s.verdict,
          "DANGER",
          `${label}/${s.key}: 赤字確率 ${s.distribution.lossRate} なのに ${s.verdict}`
        );
      }
    }
  }
});

test("終盤に到達しない想定では、終盤の数字が0のままで判定も SAFE になる", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      if (s.endgame.reached) continue;
      assert.equal(s.endgame.rtpMedian, 0, `${label}/${s.key}`);
      assert.equal(s.endgame.rtpWorst, 0, `${label}/${s.key}`);
      assert.equal(s.endgame.verdict, "SAFE", `${label}/${s.key}`);
    }
  }
});

test("「残りわずか」の口数は 総口数の5%（最低10口）で決まる", () => {
  for (const { label, spec, report } of REPORTS) {
    const expected = Math.max(
      THRESHOLD.tailSlotsMin,
      Math.round(spec.total * THRESHOLD.tailSlotsRatio)
    );
    for (const s of report.scenarios) {
      assert.equal(s.endgame.tailSlots, expected, `${label}/${s.key}: tailSlots がずれています`);
      assert.ok(s.endgame.tailSlots > 0, `${label}/${s.key}: tailSlots が0以下です`);
    }
  }
});

test("実還元率が最大になった消化率は 0〜100% の中にある", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(
        s.peakAtSoldPct >= 0 && s.peakAtSoldPct <= 100,
        `${label}/${s.key}: peakAtSoldPct が範囲外（${s.peakAtSoldPct}）`
      );
    }
  }
});

test("判定理由・打ち手の文章が空にならない（画面が空欄にならないこと）", () => {
  for (const { label, report } of REPORTS) {
    for (const s of report.scenarios) {
      assert.ok(s.reason.trim().length > 0, `${label}/${s.key}: 判定理由が空です`);
      assert.ok(s.endgame.reason.trim().length > 0, `${label}/${s.key}: 終盤の理由が空です`);
      assert.ok(s.endgame.actions.length > 0, `${label}/${s.key}: 打ち手が空です`);
      // 数字が壊れていると "NaN" や "Infinity" が文章に混ざる
      for (const text of [s.reason, s.endgame.reason, ...s.endgame.actions]) {
        assert.ok(!/NaN|Infinity/.test(text), `${label}/${s.key}: 文章に壊れた数字が混ざっています → ${text}`);
      }
    }
  }
});
