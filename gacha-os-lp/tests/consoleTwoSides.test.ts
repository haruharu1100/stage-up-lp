/**
 * 「管理サイト」と「ユーザー側」が、1つのデータを見ていることのテスト。
 *
 * ═══════════════════════════════════════════════════════
 * ★このテストが見張っていること
 * ═══════════════════════════════════════════════════════
 *
 *   1) お客様の操作が、そのまま運営の数字に出ること
 *      お客様が発送を依頼したら、その瞬間に運営の「未発送」が増えます。
 *      ここが別々のデータになっていると、
 *      「お客様の画面では依頼済みなのに、運営には届いていない」が起きます。
 *      デモでは気づけても、本番では必ず事故になります。
 *
 *   2) 未発送に、もう届いた分を数えないこと
 *      「発送済みでないもの」で数えると、
 *      配送中も配達済みも未発送に入ります。
 *      毎朝の「今日やること」が、永久に減らない数字になります。
 *      （実際にそう書かれていたのを直しました。ここで再発を止めます）
 *
 *   3) 運営に向けて書かれた文を、お客様に見せないこと
 *      運営向けの知らせには、担当者の名前と役割が入ります。
 *      「運営 太郎（管理者（全権））としてログインしました。」
 *      これがお客様の画面に出たら、本番なら情報の漏れです。
 *      （切り替えた先のお客様画面に出ているのを撮影して見つけました）
 *
 *   4) お客様側に、管理者のログインを要らなくすること
 *      お客様は、ただガチャを引きに来ただけです。
 *      2段階認証は運営を守るための鍵で、お客様のためのものではありません。
 *      だからお客様の操作は、誰もログインしていなくても通ります。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_ADDRESS,
  DEMO_ADMINS,
  ORDER_TODO,
  PREVIEW_USER_ID,
  initialState,
  reducer,
  summary,
  todayTodos,
  type ConsoleState,
  type OrderStatus,
  type Prize,
} from "../lib/console/state";

/** 管理者としてログインし、2段階認証まで通した状態を作る */
function loggedIn(): ConsoleState {
  let s = initialState();
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });
  return s;
}

/** まだ受け取り方法を選んでいない商品を1つ取る */
function unchosen(s: ConsoleState): Prize {
  const p = s.prizes.find((x) => x.status === "UNCHOSEN");
  assert.ok(p, "受け取り方法を選べる商品が、デモデータに1つも無い");
  return p!;
}

/* ══════════════════════════════════════════════
   ① お客様の操作が、そのまま運営の数字に出る
   ══════════════════════════════════════════════ */

test("お客様が発送を依頼すると、運営の未発送がその場で1件増える", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const before = summary(s0);

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "two-sides-ship",
    address: DEMO_ADDRESS,
  });
  const after = summary(s1);

  assert.equal(after.unshipped, before.unshipped + 1, "運営の未発送が増えていない");
  assert.equal(
    after.unchosenPrizes,
    before.unchosenPrizes - 1,
    "受け取り方法を選ぶ待ちが減っていない",
  );
  assert.ok(
    s1.orders.some((o) => o.prizeId === p.id),
    "発送依頼の一覧に、いま依頼した商品が入っていない",
  );
});

test("お客様がポイントに交換すると、運営の未発送は増えない", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const before = summary(s0);

  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "two-sides-ex" });
  const after = summary(s1);

  assert.equal(after.unshipped, before.unshipped, "交換なのに未発送が増えている");
  assert.equal(
    after.unchosenPrizes,
    before.unchosenPrizes - 1,
    "受け取り方法を選ぶ待ちが減っていない",
  );
});

/* ══════════════════════════════════════════════
   ② 未発送に、もう届いた分を数えない
   ══════════════════════════════════════════════ */

test("未発送は「発送済みでないもの」ではなく、まだ運営の手が要るものだけ", () => {
  /* ★この2つが ORDER_TODO に入っていたら、
     配送中や配達済みが毎朝の用件に残り続けます */
  const done: OrderStatus[] = ["IN_TRANSIT", "DELIVERED", "SHIPPED"];
  for (const st of done) {
    assert.ok(
      !ORDER_TODO.includes(st),
      `${st} が「運営の手が要るもの」に入っている。未発送の数が永久に減らなくなる`,
    );
  }
  assert.ok(ORDER_TODO.includes("UNSHIPPED"), "未発送が用件から漏れている");
});

test("未発送の件数と、今日やることの件数が食い違わない", () => {
  const s = loggedIn();
  const sum = summary(s);
  const byHand = s.orders.filter((o) => ORDER_TODO.includes(o.status)).length;

  assert.equal(sum.unshipped, byHand, "数え方が2か所で違っている");

  const todo = todayTodos(s).find((t) => t.to === "shipping");
  if (todo) {
    assert.equal(
      todo.count,
      byHand,
      "ダッシュボードの「今日やること」と、未発送の数が合っていない",
    );
  }
});

/* ══════════════════════════════════════════════
   ③ 運営に向けた文を、お客様に見せない
   ══════════════════════════════════════════════ */

test("運営の操作で出た知らせは、お客様向けにならない", () => {
  let s = initialState();
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });

  assert.ok(s.flash, "ログインの知らせが出ていない");
  assert.equal(
    s.flash!.to,
    "admin",
    "運営向けの知らせがお客様側に出る。担当者名と役割がお客様に見える",
  );
  assert.ok(
    s.flash!.text.includes(DEMO_ADMINS[0].name),
    "この文には担当者名が入っている前提のテスト。文面が変わったら見直すこと",
  );
});

test("お客様の操作で出た知らせだけが、お客様向けになる", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "two-sides-flash",
    address: DEMO_ADDRESS,
  });
  assert.equal(s1.flash?.to, "customer", "お客様の操作の結果が、お客様に出ない");

  /* 運営がそのあと何かすると、また運営向けに戻る */
  const s2 = reducer(s1, { type: "SWITCH_ADMIN", adminId: DEMO_ADMINS[1].id });
  assert.equal(s2.flash?.to, "admin", "運営の操作なのにお客様向けのままになっている");
});

test("知らせが変わらない操作では、宛先が書き換わらない", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "two-sides-keep",
    address: DEMO_ADDRESS,
  });

  /* 知らせを出さない操作を挟んでも、さっきの宛先はそのまま。
     ★心当たりのない操作＝reducer の最後の「何もしない」道を通します。
       ここで宛先を上書きしてしまうと、
       お客様が見ている知らせが、無関係な操作で消えたり、
       運営向けに化けたりします */
  const s2 = reducer(s1, { type: "存在しない操作" } as unknown as Parameters<
    typeof reducer
  >[1]);
  assert.equal(
    s2.flash?.to,
    "customer",
    "何もしない操作で、知らせの宛先が書き換わっている",
  );
  assert.equal(s2.flash?.text, s1.flash?.text, "知らせの中身まで変わっている");
});

/* ══════════════════════════════════════════════
   ④ お客様側に、管理者のログインは要らない
   ══════════════════════════════════════════════ */

test("誰もログインしていなくても、お客様の操作は通る", () => {
  const s0 = initialState();
  assert.equal(s0.me, null, "はじめは誰もログインしていないこと");

  const p = unchosen(s0);
  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "no-login-ship",
    address: DEMO_ADDRESS,
  });

  assert.equal(
    s1.prizes.find((x) => x.id === p.id)!.status,
    "SHIP_REQUESTED",
    "お客様の発送依頼に、運営のログインが要る作りになっている",
  );
  assert.ok(
    s1.audit.length > s0.audit.length,
    "お客様の操作が監査ログに残っていない",
  );
});

test("お客様の操作は、監査ログに「お客様」として残る", () => {
  const s0 = initialState();
  const p = unchosen(s0);
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "no-login-ex" });

  const last = s1.audit[s1.audit.length - 1];
  assert.equal(
    last.actorRole,
    "お客様",
    "お客様の操作が、運営の誰かの操作として記録されている",
  );
  assert.equal(
    last.actorId,
    PREVIEW_USER_ID,
    "誰の操作なのかが記録から分からない",
  );
  /* ★「-」になっていないこと。
     運営が誰もログインしていないときの既定値がそのまま入ると、
     誰がやったのか永久に分からない記録になります */
  assert.notEqual(last.actorName, "-", "操作した人の名前が記録に残っていない");
});
