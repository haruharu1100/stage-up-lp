/**
 * 極端な入力のテスト（変な設定を入れても壊れないか）
 *
 * 運営が管理画面に打ち込む値は、いつも常識的とは限りません。
 * 口数を1にしてしまった、料金を1円にしてしまった、景品を1本も登録していない、
 * 在庫の本数を口数より多く入れてしまった――こういう入力でも、
 *   ① 落ちない（例外を投げない）
 *   ② 数字が壊れない（NaN や Infinity を出さない）
 *   ③ 危ない構成なのに「このまま公開できます（SAFE）」と嘘をつかない
 * の3つが守られている必要があります。
 *
 * ★ ③ が最も大事です。
 *   落ちれば誰かが気づきますが、間違って SAFE と出た場合は
 *   そのまま公開されて赤字になるまで誰も気づきません。
 *
 * ★ このファイルには、いま実際に守れていない項目が
 *   「TODO」印つきで入っています（下の「見つかった問題」を参照）。
 *   TODO のテストは失敗しても npm test 全体は通ります。
 *   本体を直すかどうかは人が決めることなので、勝手に直していません。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { backtestReport, designedRtp, type GachaSpec } from "../lib/backtest";
import { findBadNumbers } from "./_helpers";

/** 極端な構成を1つ作る小道具 */
function spec(partial: Partial<GachaSpec>): GachaSpec {
  return {
    name: "テスト構成",
    price: 2_000,
    total: 800,
    prizes: [{ grade: "S賞", name: "S", count: 1, value: 51_800 }],
    ...partial,
  };
}

/**
 * 極端な入力の一覧。
 * expectSafe は「この構成でエンジンが SAFE を出すのは妥当か」の判断。
 *   "must-not" … 明らかに危ないので SAFE を出してはいけない
 *   "ok"       … 実際に儲かる構成なので SAFE で問題ない
 */
const CASES: {
  label: string;
  spec: GachaSpec;
  expectSafe: "must-not" | "ok";
  note: string;
}[] = [
  {
    label: "総口数が1口だけ",
    spec: spec({ total: 1 }),
    expectSafe: "must-not",
    note: "2,000円で51,800円の景品を配るので、確実に大赤字",
  },
  {
    label: "総口数が10口",
    spec: spec({ total: 10 }),
    expectSafe: "must-not",
    note: "20,000円の売上で51,800円の景品。確実に赤字",
  },
  {
    label: "1回1円",
    spec: spec({ price: 1, total: 500 }),
    expectSafe: "must-not",
    note: "売上500円に対して景品51,800円。桁が違う赤字",
  },
  {
    label: "1回1,000万円（極端に高い料金）",
    spec: spec({ price: 10_000_000, total: 500 }),
    expectSafe: "ok",
    note: "料金が高すぎて現実味は無いが、計算としては大黒字なので SAFE で正しい",
  },
  {
    label: "S賞1本だけで他に何も無い",
    spec: spec({ total: 800, prizes: [{ grade: "S賞", name: "S", count: 1, value: 51_800 }] }),
    expectSafe: "ok",
    note: "還元率3.2%。客はまず怒るが、運営が赤字になる話ではない",
  },
  {
    label: "景品が全部同じ価値",
    spec: spec({
      total: 800,
      prizes: [{ grade: "A賞", name: "A", count: 800, value: 1_800 }],
    }),
    expectSafe: "must-not",
    note: "還元率90%。相場が25%上がると確実に赤字になるので、総合では SAFE にならないはず",
  },
  {
    label: "価値0円の景品",
    spec: spec({
      total: 800,
      prizes: [{ grade: "A賞", name: "A", count: 100, value: 0 }],
    }),
    expectSafe: "must-not",
    note: "1本も価値のある景品が無い。運営は儲かるが、公開してよい構成ではない",
  },
  {
    label: "景品を1本も登録していない",
    spec: spec({ total: 800, prizes: [] }),
    expectSafe: "must-not",
    note: "空のガチャ。入力ミスか、そのまま出せば景表法上まずい構成",
  },
  {
    label: "在庫が総口数を超えている（入力ミス）",
    spec: spec({
      total: 100,
      prizes: [{ grade: "S賞", name: "S", count: 500, value: 3_000 }],
    }),
    expectSafe: "must-not",
    note: "100口しかないのに景品500本。還元率150%",
  },
];

/* ────────────────────────────────
   ① 落ちない ② 数字が壊れない
   ──────────────────────────────── */

for (const c of CASES) {
  test(`極端な入力で落ちない・数字が壊れない: ${c.label}`, () => {
    const report = backtestReport(c.spec);

    const bad = findBadNumbers(report);
    assert.deepEqual(bad, [], `${c.label}: 壊れた数字 → ${bad.join(" / ")}`);

    // 設計時の還元率も壊れていないこと
    assert.ok(
      Number.isFinite(designedRtp(c.spec)),
      `${c.label}: 設計時の還元率が計算できていません`
    );

    // 最低限のかたちが崩れていないこと
    assert.equal(report.scenarios.length, 6, `${c.label}: シナリオ数が6件ではありません`);
    for (const s of report.scenarios) {
      assert.ok(["SAFE", "CAUTION", "DANGER"].includes(s.verdict), `${c.label}/${s.key}`);
      assert.ok(s.reason.trim().length > 0, `${c.label}/${s.key}: 判定理由が空`);
      assert.ok(!/NaN|Infinity/.test(s.reason), `${c.label}/${s.key}: 文章に壊れた数字`);
      assert.ok(!/NaN|Infinity/.test(s.endgame.reason), `${c.label}/${s.key}: 文章に壊れた数字`);
      assert.ok(s.revenue >= 0 && s.payout >= 0 && s.leftoverValue >= 0, `${c.label}/${s.key}`);
    }
  });
}

/* ────────────────────────────────
   ③ 危ない構成で SAFE と言わないこと
   ──────────────────────────────── */

test("明らかに赤字になる構成では SAFE と言わない", () => {
  for (const c of CASES) {
    if (c.expectSafe !== "must-not") continue;
    // 下の「見つかった問題」で TODO 扱いにしている2件はここから外す
    if (c.label === "価値0円の景品" || c.label === "景品を1本も登録していない") continue;

    const report = backtestReport(c.spec);
    assert.notEqual(
      report.overall,
      "SAFE",
      `${c.label}（${c.note}）なのに「このまま公開できます」と出ています`
    );
  }
});

test("儲かる構成では素直に SAFE と言う（過剰に危険側へ倒していない）", () => {
  for (const c of CASES) {
    if (c.expectSafe !== "ok") continue;
    const report = backtestReport(c.spec);
    assert.equal(
      report.overall,
      "SAFE",
      `${c.label}（${c.note}）なのに ${report.overall} と出ています`
    );
  }
});

/* ────────────────────────────────
   修正済みの問題 ①
   景品が実質ゼロのガチャを「このまま公開できます」と言ってしまう
   → validateSpec で「判定できません」を返すようにした
   ──────────────────────────────── */

test("景品が1本も無いガチャは「判定できない」と分かる（SAFEと言わない）", () => {
  // 景品ゼロ＝ 800口 × 2,000円がそのまま粗利になるので、
  // 赤字リスクの計算「だけ」を見れば確かに SAFE になる。
  // だがこれは「安全な構成」ではなく「景品を登録し忘れている」だけ。
  // いちばん起きやすい入力ミスに対して SAFE と出すのが最も危険なので、
  // レポート側で usable=false を立てて画面に判定を出させない。
  const empty = backtestReport(spec({ total: 800, prizes: [] }));
  assert.equal(empty.usable, false, "景品ゼロなのに判定可能として扱われています");
  assert.ok(
    empty.issues.some((i) => i.code === "NO_PRIZES"),
    "NO_PRIZES の指摘が出ていません"
  );
  assert.ok(empty.issues[0].message.length > 10, "画面に出せる説明文がありません");
});

test("価値0円の景品しか無いガチャも「判定できない」と分かる", () => {
  const zero = backtestReport(
    spec({ total: 800, prizes: [{ grade: "A賞", name: "A", count: 100, value: 0 }] })
  );
  assert.equal(zero.usable, false);
  assert.ok(zero.issues.some((i) => i.code === "ZERO_VALUE"));
});

test("総口数や料金が未設定でも、NaN や Infinity を出さずに「判定できない」と返す", () => {
  const noSlots = backtestReport(spec({ total: 0 }));
  assert.equal(noSlots.usable, false);
  assert.ok(noSlots.issues.some((i) => i.code === "NO_SLOTS"));
  assert.deepEqual(findBadNumbers(noSlots), [], "NaN / Infinity が混ざっています");

  const noPrice = backtestReport(spec({ price: 0 }));
  assert.equal(noPrice.usable, false);
  assert.ok(noPrice.issues.some((i) => i.code === "NO_PRICE"));
  assert.deepEqual(findBadNumbers(noPrice), []);
});

test("景品の本数が総口数を超えていたら指摘する", () => {
  const over = backtestReport(
    spec({ total: 100, prizes: [{ grade: "A賞", name: "A", count: 300, value: 1_000 }] })
  );
  assert.equal(over.usable, false);
  assert.ok(over.issues.some((i) => i.code === "OVER_SLOTS"));
});

test("まともな構成では usable=true で、指摘は1件も出ない", () => {
  const ok = backtestReport(spec({}));
  assert.equal(ok.usable, true);
  assert.deepEqual(ok.issues, []);
});

/* ────────────────────────────────
   修正済みの問題 ②
   口数が極端に少ないと、実還元率が 0.0% と表示される
   → 一度も測れなかったときはガチャ全体の還元率で埋めるようにした
   ──────────────────────────────── */

test("1口のガチャでも、実還元率が 0.0%（＝とても安全）とは表示されない", () => {
  // 1口だけのガチャ（料金2,000円・景品1,990円＝設計還元率99.5%）。
  // 「これから買う人にとっての還元率」は残り口数が0になると計算できないため、
  // 1口だと一度も記録されない。以前はそこで 0.0% のままになり、
  // 画面には「実還元率は中央値 0.0%」＝実態よりはるかに安全に見えていた。
  // 修正後は、測れなかった場合はガチャ全体の還元率で埋める。
  const oneSlot = spec({
    total: 1,
    price: 2_000,
    prizes: [{ grade: "S賞", name: "S", count: 1, value: 1_990 }],
  });
  const one = backtestReport(oneSlot);
  const normal = one.scenarios.find((s) => s.key === "normal")!;
  assert.ok(
    normal.distribution.rtpMedian > 0,
    `設計還元率は ${designedRtp(oneSlot).toFixed(1)}% なのに、実還元率が ${normal.distribution.rtpMedian}% と出ています`
  );
  // 設計還元率（99.5%）とほぼ同じ値になるはず
  assert.ok(
    Math.abs(normal.distribution.rtpMedian - 99.5) < 0.5,
    `実還元率 ${normal.distribution.rtpMedian}% が設計還元率 99.5% から離れすぎています`
  );
  // 設計上の還元率も正しく 99.5%
  assert.ok(Math.abs(one.designedRtp - 99.5) < 0.05);
  // 相場が25%上がる想定では赤字になるので DANGER
  assert.equal(one.overall, "DANGER");
  assert.deepEqual(findBadNumbers(one), []);
});

/* ────────────────────────────────
   見つかった問題 ③
   口数がおよそ10万を超えると、エンジンが例外で落ちる
   ──────────────────────────────── */

test("口数10万でも落ちず、数字も壊れない（動く上限の記録）", () => {
  const big = backtestReport({
    name: "10万口",
    price: 500,
    total: 100_000,
    prizes: [
      { grade: "S賞", name: "S", count: 1, value: 300_000 },
      { grade: "A賞", name: "A", count: 500, value: 5_000 },
      { grade: "B賞", name: "B", count: 90_000, value: 400 },
    ],
  });
  assert.deepEqual(findBadNumbers(big), []);
  assert.equal(big.scenarios.length, 6);
});

test("口数100万でも例外を出さずに完走する（修正済み）", { timeout: 600_000 }, () => {
  // 以前の原因：lib/backtest.ts の
  //   const topPrizeValue = Math.max(...base);
  // で、配列を1要素ずつ引数に展開していた。
  // JavaScript は引数の数に上限があり、およそ10万を超えると
  // 「Maximum call stack size exceeded」で落ちていた。
  // 200回×6シナリオを回しきったあとに落ちるため、
  // 「16秒待たされた末にエラー」という最悪の壊れ方をしていた。
  // 修正後は1周して最大値を取るだけなので落ちない。
  const huge: GachaSpec = {
    name: "100万口",
    price: 500,
    total: 1_000_000,
    prizes: [
      { grade: "S賞", name: "S", count: 10, value: 300_000 },
      { grade: "A賞", name: "A", count: 5_000, value: 5_000 },
      { grade: "B賞", name: "B", count: 900_000, value: 400 },
    ],
  };
  const report = backtestReport(huge);
  assert.equal(report.scenarios.length, 6);
  assert.equal(report.usable, true);
  assert.deepEqual(findBadNumbers(report), []);
});
