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
 *      だからお客様の操作に、運営のログインは要りません。
 *
 *      ★ただし「誰のログインも要らない」ではありません。
 *        ここは以前、誰もログインしていなくても発送依頼が通る作りでした。
 *        それは、ポイント・当選商品・住所という、
 *        その方だけのものが、誰にでも触れる場所にあったということです。
 *        いまは「運営のログインは要らない／ご本人のログインは要る」です。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEMO_ADDRESS,
  DEMO_ADMINS,
  ORDER_TODO,
  PREVIEW_USER_ID,
  STEP_UP_EXCHANGE_PT,
  initialState,
  reducer,
  summary,
  todayTodos,
  type ConsoleState,
  type OrderStatus,
  type Prize,
} from "../lib/console/state";

/** 管理者としてログインし、2段階認証まで通し、お客様としてもログインする */
function loggedIn(): ConsoleState {
  let s = initialState();
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });
  s = reducer(s, { type: "CUSTOMER_LOGIN", userId: PREVIEW_USER_ID });
  return s;
}

/** お客様だけがログインした状態（運営は誰も入っていない） */
function customerOnly(): ConsoleState {
  return reducer(initialState(), {
    type: "CUSTOMER_LOGIN",
    userId: PREVIEW_USER_ID,
  });
}

/**
 * まだ受け取り方法を選んでいない、ログイン中のご本人の商品を1つ取る。
 *
 * ★持ち主で絞ること。他の会員の商品を混ぜると、
 *   確かめたいことと、実際に確かめていることがずれます。
 * ★追加の本人確認に回る高額品は避けること。止まるのが正しい動きだからです。
 */
function unchosen(s: ConsoleState): Prize {
  const p = s.prizes.find(
    (x) =>
      x.status === "UNCHOSEN" &&
      x.userId === PREVIEW_USER_ID &&
      x.exchangePt < STEP_UP_EXCHANGE_PT,
  );
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
   ④ 運営のログインは要らない。ご本人のログインは要る
   ══════════════════════════════════════════════ */

test("運営が誰もログインしていなくても、お客様ご本人の操作は通る", () => {
  const s0 = customerOnly();
  assert.equal(s0.me, null, "運営は誰もログインしていないこと");
  assert.ok(s0.customer, "お客様のログインが通っていない");

  const p = unchosen(s0);
  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "no-admin-ship",
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

/**
 * ★ここが、今回いちばん大事な1本です。
 *
 *   以前は、誰もログインしていない状態でも
 *   発送依頼とポイント交換が通っていました。
 *   デモとしては動いて見えます。
 *   しかし本番であれば、住所を知らない他人が、
 *   他人の当選商品を、他人の住所へ送らせられる、ということです。
 */
test("お客様がログインしていなければ、発送もポイント交換も通らない", () => {
  const s0 = initialState();
  assert.equal(s0.customer, null, "はじめは誰もログインしていないこと");

  const p = s0.prizes.find((x) => x.status === "UNCHOSEN")!;
  const orders0 = s0.orders.length;
  const points0 = s0.users.find((u) => u.id === p.userId)!.points;

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "anon-ship",
  });
  assert.equal(
    s1.prizes.find((x) => x.id === p.id)!.status,
    "UNCHOSEN",
    "ログインしていないのに、発送依頼が通っている",
  );
  assert.equal(s1.orders.length, orders0, "ログインなしで伝票が作られている");

  const s2 = reducer(s1, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "anon-ex" });
  assert.equal(
    s2.users.find((u) => u.id === p.userId)!.points,
    points0,
    "ログインしていないのに、ポイントが増えている",
  );

  /* ★止めたことを、必ず残すこと。
     成功だけを記録すると、何回叩かれたのかが誰にも分かりません */
  assert.ok(
    s2.securityEvents.length >= 2,
    "止めた操作が、セキュリティの記録に残っていない",
  );
});

test("お客様の操作は、監査ログに「お客様」として残る", () => {
  const s0 = customerOnly();
  const p = unchosen(s0);
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "cust-ex" });

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

/* ══════════════════════════════════════════════
   ⑤ 他人の商品は、ログインしていても操作できない
   ══════════════════════════════════════════════ */

/**
 * ★これが IDOR（他人のIDを指定して操作すること）への備えです。
 *
 *   画面に他人の商品は出ません。しかし、
 *   画面に出ないことと、操作できないことは別のことです。
 *   商品のIDを1つ書き換えて送るだけなら、誰にでもできます。
 *   だから、受け取った側で持ち主を必ず確かめます。
 */
test("ログイン中でも、他人の商品は発送もポイント交換もできない", () => {
  const s0 = customerOnly();

  const other = s0.prizes.find(
    (p) => p.userId !== PREVIEW_USER_ID && p.status === "UNCHOSEN",
  );
  assert.ok(other, "他の会員の未選択商品が、デモデータに1つも無い");

  const points0 = s0.users.find((u) => u.id === PREVIEW_USER_ID)!.points;
  const orders0 = s0.orders.length;

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: other!.id,
    key: "idor-ship",
  });
  assert.equal(
    s1.prizes.find((x) => x.id === other!.id)!.status,
    "UNCHOSEN",
    "他人の商品の発送依頼が通っている",
  );
  assert.equal(s1.orders.length, orders0, "他人の商品で伝票が作られている");

  const s2 = reducer(s1, {
    type: "PRIZE_EXCHANGE",
    prizeId: other!.id,
    key: "idor-ex",
  });
  assert.equal(
    s2.prizes.find((x) => x.id === other!.id)!.status,
    "UNCHOSEN",
    "他人の商品がポイントに交換されている",
  );
  assert.equal(
    s2.users.find((u) => u.id === PREVIEW_USER_ID)!.points,
    points0,
    "他人の商品を交換して、自分のポイントが増えている",
  );

  /* ★止めたことを記録に残すこと */
  assert.ok(
    s2.audit.some((e) => e.action === "IDOR_BLOCKED"),
    "他人の商品への操作を止めたことが、監査ログに残っていない",
  );
});

/* ══════════════════════════════════════════════
   案内パネルが、押せないボタンを作らないこと
   ══════════════════════════════════════════════

   「1日、運営してみる」の案内は、画面のいちばん下に
   ずっと居座ります。その高さのぶんだけ、下の中身が隠れます。

   ★隠れたボタンは、押せません。
     押せないボタンがあると、案内どおりに操作しているのに
     手順が終わりません。見ている方には理由が分からないので、
     「このシステムは動かない」という結論になります。
     実際に、これで撮影が止まりました。

   ★高さは必ず実測すること。決め打ちで書くと、
     手順によって文章の長さが違うので、ある手順だけ隠れます。
     そして、作った本人の画面では、たまたま隠れません。

   ★取っ手の名前を ref にしないこと（ここがいちばんの落とし穴）。
     React では ref は特別扱いで、ただの関数コンポーネントには
     渡ってきません。渡らなくても、型検査は通ります。警告も
     ブラウザの記録に出るだけで、画面は普通に動いて見えます。
     つまり「測っているつもりで、ずっと 0 だった」に気づけません。
     実際にそうなっていたのを、ここで再発させないようにします。
*/
test("画面：下の案内パネルのぶん、中身に高さを空けている", () => {
  const src = readFileSync(
    new URL("../components/console/ClientConsole.tsx", import.meta.url),
    "utf8",
  );

  assert.ok(
    /ResizeObserver[\s\S]{0,200}setDayH/.test(src),
    "案内パネルの高さを実測していない（決め打ちの数値で逃げている）",
  );
  assert.ok(
    /style=\{\{\s*height:\s*dayH\s*\}\}/.test(src),
    "実測した高さを、隙間として使っていない",
  );
  assert.ok(
    !/\bh-52\b/.test(src),
    "決め打ちの高さ（h-52）が残っている。文章が1行増えるとボタンが隠れる",
  );
});

test("画面：高さを測る取っ手に、ref という名前を使っていない", () => {
  /* ★React では ref は特別扱いで、関数コンポーネントには渡りません。
     型検査も通り、画面も動いて見えるので、目視では絶対に気づけません */
  for (const f of ["ClientConsole.tsx", "DayInLife.tsx"]) {
    const src = readFileSync(
      new URL(`../components/console/${f}`, import.meta.url),
      "utf8",
    );
    assert.ok(
      !/^\s*ref:\s*React\.Ref/m.test(src),
      `${f}：ref という名前で取っ手を受け取っている（undefined になり、測れない）`,
    );
  }
});
