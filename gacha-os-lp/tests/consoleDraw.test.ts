/**
 * 抽選（ガチャを1回引く）のテスト。
 *
 * ═══════════════════════════════════════════════
 * ★ここで守っているのは、お金そのものです
 * ═══════════════════════════════════════════════
 *
 * オンラインガチャの抽選は、1回まわるたびに
 * ポイント（＝お金）と景品（＝在庫）が同時に動きます。
 * だから、次のどれか1つでも壊れていると、その日のうちに事故になります。
 *
 *   ① 同じ依頼が2回届いても、2回引かれない
 *      連打・通信のやり直し・戻るボタンで、実際に毎日起きます。
 *      画面のボタンを押せなくするだけでは防げません。
 *
 *   ② 在庫より多く当たらない
 *      S賞が1本しかないのに2人に当たると、必ずどちらかに謝りに行きます。
 *
 *   ③ 残高が足りないのに引けない
 *      ここが抜けると、残高がマイナスの会員ができます。
 *
 *   ④ 販売していないガチャは引けない
 *      止めたはずのガチャが裏口から引かれると、止めた意味がありません。
 *
 *   ⑤ 引いた分だけ、必ず全部動く
 *      ポイントだけ減って当たりが記録されない、が最悪の壊れ方です。
 *
 * どれも「そう作ったつもり」では守れません。ここで機械に見張らせます。
 */

import test from "node:test";
import assert from "node:assert/strict";

import { drawOnce, poolOf, seedOf } from "../lib/console/draw";
import {
  DEMO_ADMINS,
  PREVIEW_USER_ID,
  initialState,
  reducer,
  type ConsoleState,
} from "../lib/console/state";

/**
 * 管理者としてログインし、2段階認証まで通した状態を作る。
 *
 * ★お客様側のログインも、ここで一緒に通しておくこと。
 *   ガチャを引くのはお客様の操作です。
 *   お客様がログインしていない状態では、そもそも1回も引けません
 *   （引けてしまうなら、そちらが不具合です）。
 */
function loggedIn(): ConsoleState {
  let s = initialState();
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });
  s = reducer(s, { type: "CUSTOMER_LOGIN", userId: PREVIEW_USER_ID });
  return s;
}

/** 販売中で、残りがあるガチャ */
function livingGachaId(s: ConsoleState): string {
  const g = s.gachas.find((x) => x.status === "PUBLISHED" && x.left > 0);
  assert.ok(g, "販売中のガチャがデモデータに1つも無い");
  return g!.id;
}

/* ══════════════════════════════════════════════
   ① 二重送信
   ══════════════════════════════════════════════ */

test("同じ鍵の抽選依頼が2回届いても、2回は引かれない", () => {
  const s0 = loggedIn();
  const id = livingGachaId(s0);
  const before = s0.gachas.find((g) => g.id === id)!;
  const wallet0 = s0.users.find((u) => u.id === PREVIEW_USER_ID)!.points;

  const s1 = reducer(s0, { type: "DRAW", gachaId: id, key: "same-key" });
  const s2 = reducer(s1, { type: "DRAW", gachaId: id, key: "same-key" });

  const after = s2.gachas.find((g) => g.id === id)!;
  const wallet2 = s2.users.find((u) => u.id === PREVIEW_USER_ID)!.points;

  assert.equal(s2.draws.length, 1, "同じ鍵で2件の抽選が記録されている");
  assert.equal(after.left, before.left - 1, "残り口数が2つ減っている");
  assert.equal(
    wallet2,
    s1.users.find((u) => u.id === PREVIEW_USER_ID)!.points,
    "2回目でポイントが減っている",
  );
  assert.notEqual(wallet2, wallet0, "1回目でポイントが減っていない");
});

test("鍵が違えば、2回とも引ける", () => {
  const s0 = loggedIn();
  const id = livingGachaId(s0);
  const s1 = reducer(s0, { type: "DRAW", gachaId: id, key: "k1" });
  const s2 = reducer(s1, { type: "DRAW", gachaId: id, key: "k2" });
  assert.equal(s2.draws.length, 2);
});

/* ══════════════════════════════════════════════
   ② 在庫より多く当たらない
   ══════════════════════════════════════════════ */

test("等級ごとの在庫数を超えて当選が出ない（最後まで引ききっても）", () => {
  /* 小さめのガチャを最後まで引ききって、等級ごとの出た本数を数える。
     箱から札を抜く方式なので、設計本数を1本でも超えたら壊れている */
  const title = "テスト用ガチャ";
  const price = 500;
  const total = 300;
  const rtp = 95;
  const pool = poolOf(title, price, total, rtp);
  const limit: Record<string, number> = {};
  for (const p of pool) limit[p.grade] = p.count;

  const drawn: Record<string, number> = {};
  let left = total;
  for (let n = 1; n <= total; n++) {
    const out = drawOnce({ title, price, total, left, designedRtp: rtp }, drawn, seedOf("g_test"), n);
    if (out.grade !== "-") drawn[out.grade] = (drawn[out.grade] ?? 0) + 1;
    left -= 1;
  }

  for (const grade of Object.keys(limit)) {
    assert.ok(
      (drawn[grade] ?? 0) <= limit[grade],
      `${grade}賞が在庫 ${limit[grade]}本 に対して ${drawn[grade]}本 出ている`,
    );
  }
});

test("S賞は、箱に1本しか入っていない", () => {
  const pool = poolOf("テスト用ガチャ", 500, 300, 95);
  const s = pool.find((p) => p.grade === "S");
  assert.ok(s);
  assert.equal(s!.count, 1);
});

test("同じ種・同じ回数なら、必ず同じ結果になる", () => {
  const args = { title: "テスト用ガチャ", price: 500, total: 300, left: 300, designedRtp: 95 };
  const a = drawOnce(args, {}, seedOf("g_test"), 7);
  const b = drawOnce(args, {}, seedOf("g_test"), 7);
  assert.deepEqual(a, b);
});

/* ══════════════════════════════════════════════
   ③④ 引けない条件
   ══════════════════════════════════════════════ */

test("残高が足りないときは引けない（ポイントも残り口数も動かない）", () => {
  const s0 = loggedIn();
  const id = livingGachaId(s0);
  /* 残高を0にしておく */
  const poor: ConsoleState = {
    ...s0,
    users: s0.users.map((u) => (u.id === PREVIEW_USER_ID ? { ...u, points: 0 } : u)),
  };
  const after = reducer(poor, { type: "DRAW", gachaId: id, key: "k" });

  assert.equal(after.draws.length, 0, "残高不足なのに抽選が記録されている");
  assert.equal(
    after.gachas.find((g) => g.id === id)!.left,
    poor.gachas.find((g) => g.id === id)!.left,
    "残高不足なのに残り口数が減っている",
  );
  assert.equal(after.flash?.kind, "error");
});

test("販売中でないガチャは、お客様画面からも引けない", () => {
  const s0 = loggedIn();
  const paused = s0.gachas.find((g) => g.status !== "PUBLISHED");
  assert.ok(paused);
  const after = reducer(s0, { type: "DRAW", gachaId: paused!.id, key: "k" });
  assert.equal(after.draws.length, 0);
  assert.equal(after.flash?.kind, "error");
});

/* ══════════════════════════════════════════════
   ⑤ 1回引いたら、全部まとめて動く
   ══════════════════════════════════════════════ */

test("1回引くと、残り口数・売上・残高・抽選記録が同時に動く", () => {
  const s0 = loggedIn();
  const id = livingGachaId(s0);
  const g0 = s0.gachas.find((g) => g.id === id)!;
  const u0 = s0.users.find((u) => u.id === PREVIEW_USER_ID)!;

  const s1 = reducer(s0, { type: "DRAW", gachaId: id, key: "k" });
  const g1 = s1.gachas.find((g) => g.id === id)!;
  const u1 = s1.users.find((u) => u.id === PREVIEW_USER_ID)!;
  const rec = s1.draws[0];

  assert.equal(g1.left, g0.left - 1, "残り口数が減っていない");
  assert.equal(g1.revenue, g0.revenue + g0.price, "売上が増えていない");
  assert.equal(u1.spent, u0.spent + g0.price, "使った金額が増えていない");
  assert.ok(rec, "抽選が記録されていない");
  assert.equal(rec.leftBefore, g0.left);
  assert.equal(rec.leftAfter, g1.left);
  assert.equal(rec.balanceBefore, u0.points);
  assert.equal(rec.balanceAfter, u1.points, "記録上の残高と、実際の残高が食い違っている");
});

/**
 * ★当たった時点では、まだ発送しないこと。
 *
 *   当たると「獲得商品」に1件入るだけです。
 *   発送するか、ポイントに交換するかは、お客様が後から選びます。
 *   ここで勝手に発送依頼を作ってしまうと、
 *   ポイント交換を選んだお客様の分まで倉庫が動いてしまいます。
 */
test("現物のお届けが要る等級が出たら、獲得商品が1件増える（発送依頼はまだ増えない）", () => {
  let s = loggedIn();
  const id = livingGachaId(s);
  let found = false;

  for (let i = 0; i < 200 && !found; i++) {
    const beforePrizes = s.prizes.length;
    const beforeOrders = s.orders.length;
    const next = reducer(s, { type: "DRAW", gachaId: id, key: `k${i}` });
    if (next.draws.length === s.draws.length) break; /* 引けなくなった */
    const rec = next.draws[next.draws.length - 1];
    if (["S", "A", "B"].includes(rec.grade)) {
      assert.equal(
        next.prizes.length,
        beforePrizes + 1,
        `${rec.grade}賞が出たのに、獲得商品が増えていない`,
      );
      const added = next.prizes[0];
      assert.equal(added.status, "UNCHOSEN", "当たった直後は「未選択」でなければならない");
      assert.equal(
        next.orders.length,
        beforeOrders,
        "お客様がまだ選んでいないのに、発送依頼が作られている",
      );
      found = true;
    } else {
      assert.equal(next.prizes.length, beforePrizes, "現物不要の等級で獲得商品が増えている");
      assert.equal(next.orders.length, beforeOrders, "現物不要の等級で発送依頼が増えている");
    }
    s = next;
  }

  assert.ok(found, "200回引いても現物のお届けが要る等級が1度も出なかった");
});

test("残り口数が0になったら、状態が完売に変わる", () => {
  let s = loggedIn();
  const id = livingGachaId(s);
  /* 残り3口・残高たっぷりにしてから引ききる */
  s = {
    ...s,
    gachas: s.gachas.map((g) => (g.id === id ? { ...g, left: 3 } : g)),
    users: s.users.map((u) => (u.id === PREVIEW_USER_ID ? { ...u, points: 9_999_999 } : u)),
  };
  for (let i = 0; i < 3; i++) {
    s = reducer(s, { type: "DRAW", gachaId: id, key: `z${i}` });
  }
  const g = s.gachas.find((x) => x.id === id)!;
  assert.equal(g.left, 0);
  assert.equal(g.status, "SOLD_OUT");

  /* 完売した後は、もう引けない */
  const after = reducer(s, { type: "DRAW", gachaId: id, key: "z9" });
  assert.equal(after.draws.length, s.draws.length);
});

/* ══════════════════════════════════════════════
   デモを初期状態に戻したら、抽選記録も消えること
   ══════════════════════════════════════════════ */

test("デモを初期状態に戻すと、抽選の記録も消える", () => {
  let s = loggedIn();
  s = reducer(s, { type: "DRAW", gachaId: livingGachaId(s), key: "k" });
  assert.equal(s.draws.length, 1);
  const reset = reducer(s, { type: "RESET" });
  assert.equal(reset.draws.length, 0);
});
