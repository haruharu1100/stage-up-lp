/**
 * お客様がガチャを引く画面（CUSTOMER PLAY DEMO）の、抽選の中身のテスト。
 *
 * ★なぜ機械で確かめるのか
 *   このデモは「見た目のアニメーション」ではなく「実際に抽選している」ものです。
 *   だから、演出を直すたびに確率や残数がずれていないかを、
 *   目で見て確かめるわけにはいきません。ここで機械に見張らせます。
 *
 * ★特に守りたい3つ
 *   ① 10連で10件返り、残り口数がちょうど10減ること
 *      （画面には減ったように見えるのに、裏では減っていない、が最悪）
 *   ② 残っていない賞は絶対に出ないこと
 *      （在庫1本のS賞が10連で2回出たら、実物の景品が用意できません）
 *   ③ 実還元率の式が、還元率モニタ（RtpMonitor）と同じであること
 *      （同じ商品なのにセクションごとに違う数字が出たら、それだけで信用を失います）
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  CATALOG,
  applyDraw,
  bestOf,
  drawMany,
  drawOnce,
  makeRng,
  operatorView,
  realRtp,
  type Gacha,
} from "../lib/customerDemo";

const g0 = () => CATALOG[0];

/* ══════════════════════════════════════════════
   乱数：同じ種なら必ず同じ結果
   ══════════════════════════════════════════════ */

test("同じ種からは、いつも同じ並びが出る（テストが安定する前提）", () => {
  const a = makeRng(12345);
  const b = makeRng(12345);
  for (let i = 0; i < 50; i++) assert.equal(a(), b());
});

test("乱数は 0 以上 1 未満に収まる", () => {
  const r = makeRng(7);
  for (let i = 0; i < 2000; i++) {
    const x = r();
    assert.ok(x >= 0 && x < 1, `範囲外の乱数: ${x}`);
  }
});

/* ══════════════════════════════════════════════
   10連
   ══════════════════════════════════════════════ */

test("10連は10件返り、残り口数がちょうど10減る", () => {
  const g = g0();
  const { results, next } = drawMany(g, 10, makeRng(1));
  assert.equal(results.length, 10);
  assert.equal(next.left, g.left - 10);
});

test("10連の結果には 1〜10 の通し番号が入っている", () => {
  const { results } = drawMany(g0(), 10, makeRng(2));
  assert.deepEqual(
    results.map((r) => r.n),
    [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  );
});

test("引いた分だけ、その賞の在庫が減る（合計で一致する）", () => {
  const g = g0();
  const { results, next } = drawMany(g, 10, makeRng(3));
  for (const p of next.prizes) {
    const hit = results.filter((r) => r.prizeId === p.id).length;
    const before = g.prizes.find((x) => x.id === p.id)!.left;
    assert.equal(p.left, before - hit, `${p.name} の在庫が合いません`);
  }
});

test("元のデータは書き換えない（画面を戻したときに壊れない）", () => {
  const g = g0();
  const beforeLeft = g.left;
  const beforePrizes = g.prizes.map((p) => p.left);
  drawMany(g, 10, makeRng(4));
  assert.equal(g.left, beforeLeft);
  assert.deepEqual(
    g.prizes.map((p) => p.left),
    beforePrizes,
  );
});

/* ══════════════════════════════════════════════
   在庫を超えて出さない
   ══════════════════════════════════════════════ */

test("どの賞も、在庫が0を下回らない（最後まで引ききっても）", () => {
  let cur: Gacha = g0();
  const rng = makeRng(99);
  let guard = 0;
  while (cur.left > 0 && guard++ < 5000) {
    const r = drawOnce(cur, rng, 1);
    const p = cur.prizes.find((x) => x.id === r.prizeId)!;
    assert.ok(p.left > 0, `在庫のない賞が出ました: ${p.name}`);
    cur = applyDraw(cur, r);
  }
  assert.equal(cur.left, 0);
  for (const p of cur.prizes) {
    assert.ok(p.left >= 0, `${p.name} の在庫が負になりました`);
  }
});

test("残り口数より多く引こうとしても、残っている分しか出ない", () => {
  const g: Gacha = { ...g0(), left: 3 };
  const { results, next } = drawMany(g, 10, makeRng(5));
  assert.equal(results.length, 3);
  assert.equal(next.left, 0);
});

test("残り0のガチャは引けない（黙って0円で引かせない）", () => {
  const g: Gacha = { ...g0(), left: 0 };
  assert.throws(() => drawOnce(g, makeRng(6), 1));
});

/* ══════════════════════════════════════════════
   ラストワン賞
   ══════════════════════════════════════════════ */

test("ラストワン賞は、最後の1口で必ず出る（抽選しない）", () => {
  const g: Gacha = { ...g0(), left: 1 };
  for (let seed = 0; seed < 30; seed++) {
    const r = drawOnce(g, makeRng(seed), 1);
    assert.equal(r.rank, "L");
    assert.equal(r.lastOne, true);
  }
});

test("最後の1口より前には、ラストワン賞は絶対に出ない", () => {
  let cur: Gacha = g0();
  const rng = makeRng(2026);
  let guard = 0;
  while (cur.left > 1 && guard++ < 5000) {
    const r = drawOnce(cur, rng, 1);
    assert.notEqual(r.rank, "L", "途中でラストワン賞が出ました");
    cur = applyDraw(cur, r);
  }
  assert.equal(cur.left, 1);
});

/* ══════════════════════════════════════════════
   いちばん良かった賞
   ══════════════════════════════════════════════ */

test("10連の「いちばん良かった賞」は、順位どおりに選ばれる", () => {
  const mk = (n: number, rank: "L" | "S" | "A" | "B" | "C") => ({
    n,
    prizeId: `${rank}${n}`,
    rank,
    name: rank,
    pt: 1,
    lastOne: false,
  });
  assert.equal(bestOf([mk(1, "C"), mk(2, "A"), mk(3, "B")])!.rank, "A");
  assert.equal(bestOf([mk(1, "C"), mk(2, "S"), mk(3, "A")])!.rank, "S");
  assert.equal(bestOf([mk(1, "S"), mk(2, "L")])!.rank, "L");
  assert.equal(bestOf([]), null);
});

test("同じ格なら、先に引いた方を選ぶ", () => {
  const mk = (n: number) => ({
    n,
    prizeId: `A${n}`,
    rank: "A" as const,
    name: `A${n}`,
    pt: 1,
    lastOne: false,
  });
  assert.equal(bestOf([mk(3), mk(7)])!.n, 3);
});

/* ══════════════════════════════════════════════
   運営側に見える数字（お客様の操作と必ず一致させる）
   ══════════════════════════════════════════════ */

test("実還元率の式は「残っている景品の合計価値 ÷（残り口数 × 料金）」", () => {
  const g = g0();
  const value = g.prizes.reduce((a, p) => a + p.pt * p.left, 0);
  const expect = (value / (g.left * g.price)) * 100;
  assert.equal(realRtp(g), expect);
});

test("残り0のときの実還元率は0（割り算で壊れない）", () => {
  const g: Gacha = { ...g0(), left: 0 };
  assert.equal(realRtp(g), 0);
  assert.ok(Number.isFinite(realRtp(g)));
});

test("売上は「売れた口数 × 1回の料金」。10連なら料金の10倍", () => {
  const base = g0();
  const { next } = drawMany(base, 10, makeRng(8));
  const v = operatorView(next, base, 26);
  assert.equal(v.sold, 10);
  assert.equal(v.revenue, base.price * 10);
  assert.equal(v.left, base.left - 10);
  assert.equal(v.unshipped, 26);
});

test("引く前は、売上0・残り口数はそのまま", () => {
  const base = g0();
  const v = operatorView(base, base, 26);
  assert.equal(v.sold, 0);
  assert.equal(v.revenue, 0);
  assert.equal(v.left, base.left);
});

/* ══════════════════════════════════════════════
   デモ用データそのものの確認
   ══════════════════════════════════════════════ */

test("デモの商品名には必ず「（デモ）」が付く（販売中と誤解させない）", () => {
  for (const g of CATALOG) {
    for (const p of g.prizes) {
      assert.ok(
        p.name.includes("（デモ）"),
        `デモ表記のない商品名: ${g.title} / ${p.name}`,
      );
    }
  }
});

test("残っている景品の本数の合計 ＝ 残り口数（1口引けば景品が1つ出るので）", () => {
  for (const g of CATALOG) {
    const stock = g.prizes.reduce((a, p) => a + p.left, 0);
    assert.equal(
      stock,
      g.left,
      `${g.title}：残り口数 ${g.left} に対して景品が ${stock}。これがずれると実還元率が嘘になります`,
    );
    assert.ok(g.left <= g.total, `${g.title}：残り口数が総口数を超えています`);
    for (const p of g.prizes) {
      assert.ok(
        p.left <= p.total,
        `${g.title} / ${p.name}：残りが最初の本数を超えています`,
      );
    }
  }
});

test("デモに出す実還元率は 90〜105% に収まる（相場から外れた数字を出さない）", () => {
  for (const g of CATALOG) {
    const v = realRtp(g);
    assert.ok(
      v >= 90 && v <= 105,
      `${g.title}：実還元率 ${v.toFixed(1)}% は、お客様に見せる数字として不自然です`,
    );
  }
});

test("設計上の還元率（全口数ベース）も 90〜105% に収まる", () => {
  for (const g of CATALOG) {
    const value = g.prizes.reduce((a, p) => a + p.pt * p.total, 0);
    const v = (value / (g.total * g.price)) * 100;
    assert.ok(
      v >= 90 && v <= 105,
      `${g.title}：設計還元率 ${v.toFixed(1)}% は不自然です`,
    );
  }
});

test("どのガチャにもラストワン賞が1本だけある", () => {
  for (const g of CATALOG) {
    const l = g.prizes.filter((p) => p.rank === "L");
    assert.equal(l.length, 1, `${g.title}：ラストワン賞の数が1本ではありません`);
    assert.equal(l[0].left, 1);
  }
});
