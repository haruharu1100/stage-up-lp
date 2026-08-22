/**
 * 獲得商品の受け取り（発送する／ポイントに交換する）のテスト。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで守っているのは、抽選と同じで「お金そのもの」です
 * ═══════════════════════════════════════════════════════
 *
 * 当たった商品は、お客様が2つのうち1つを選びます。
 *
 *     発送する          … 現物を1つ渡す
 *     ポイントに交換する … ポイントを1件発行する
 *
 * どちらも、運営から出ていくものは同じ1つ分です。
 * だから「1つの商品につき、一生に一度だけ」でなければいけません。
 * ここが壊れると、同じ景品で2回受け取れてしまいます。
 *
 *   ① 発送を選んだら、もうポイントには交換できない
 *   ② ポイントに交換したら、もう発送できない
 *   ③ 同じ鍵の依頼が2回届いても、2回は処理されない
 *   ④ ポイントが増えたら、必ず履歴（台帳）に1件残る
 *   ⑤ 残高と台帳の合計が、いつでも一致する
 *   ⑥ 発送を依頼した瞬間、管理サイトの未発送が1件増える
 *   ⑦ ポイント交換は、監査ログに交換前後の残高まで残る
 *
 * ★①②は「そう作ったつもり」では守れません。
 *   画面のボタンを消すだけでは、通信が2回届いたときに素通りします。
 *   だから受け取った側（reducer）で判定し、ここで機械に見張らせます。
 */

import test from "node:test";
import assert from "node:assert/strict";

import {
  DEMO_ADDRESS,
  DEMO_ADMINS,
  PREVIEW_USER_ID,
  initialState,
  ledgerBalance,
  pointsReconcile,
  reducer,
  type ConsoleState,
  type Prize,
} from "../lib/console/state";
import { verifyAudit } from "../lib/console/audit";

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

const wallet = (s: ConsoleState) =>
  s.users.find((u) => u.id === PREVIEW_USER_ID)!.points;

/* ══════════════════════════════════════════════
   ① 発送を選んだら、もうポイントには交換できない
   ══════════════════════════════════════════════ */

test("発送を依頼した商品は、ポイントに交換できない", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "ship-1",
    address: DEMO_ADDRESS,
  });
  assert.equal(
    s1.prizes.find((x) => x.id === p.id)!.status,
    "SHIP_REQUESTED",
    "発送依頼が通っていない",
  );

  const before = wallet(s1);
  const s2 = reducer(s1, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "ex-1" });

  assert.equal(
    s2.prizes.find((x) => x.id === p.id)!.status,
    "SHIP_REQUESTED",
    "発送依頼済みの商品が、ポイント交換で状態を上書きされている",
  );
  assert.equal(wallet(s2), before, "発送依頼済みなのにポイントが増えている");
  assert.equal(s2.flash?.kind, "error", "断った理由が画面に出ていない");
});

/* ══════════════════════════════════════════════
   ② ポイントに交換したら、もう発送できない
   ══════════════════════════════════════════════ */

test("ポイントに交換した商品は、発送できない", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);

  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "ex-2" });
  assert.equal(
    s1.prizes.find((x) => x.id === p.id)!.status,
    "EXCHANGED",
    "ポイント交換が通っていない",
  );

  const orders1 = s1.orders.length;
  const s2 = reducer(s1, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "ship-2",
    address: DEMO_ADDRESS,
  });

  assert.equal(
    s2.prizes.find((x) => x.id === p.id)!.status,
    "EXCHANGED",
    "交換済みの商品が、発送依頼で状態を上書きされている",
  );
  assert.equal(s2.orders.length, orders1, "交換済みなのに発送依頼が作られている");
  assert.equal(s2.flash?.kind, "error", "断った理由が画面に出ていない");
});

/* ══════════════════════════════════════════════
   ③ 同じ鍵の依頼が2回届いても、2回は処理されない
   ══════════════════════════════════════════════ */

test("同じ鍵の発送依頼が2回届いても、伝票は1枚しか作られない", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const orders0 = s0.orders.length;

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "same-ship",
    address: DEMO_ADDRESS,
  });
  const s2 = reducer(s1, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "same-ship",
    address: DEMO_ADDRESS,
  });

  assert.equal(s2.orders.length, orders0 + 1, "同じ鍵で伝票が2枚できている");
  assert.equal(s2.flash?.kind, "warn", "二重受信を受け流したことが画面に出ていない");
});

test("同じ鍵のポイント交換が2回届いても、ポイントは1回しか増えない", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const before = wallet(s0);

  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "same-ex" });
  const s2 = reducer(s1, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "same-ex" });

  assert.equal(
    wallet(s2),
    before + p.exchangePt,
    "同じ鍵の再送で、ポイントが二重に増えている",
  );
  assert.equal(
    s2.ledger.filter((e) => e.ref === p.id && e.kind === "PRIZE_EXCHANGE").length,
    1,
    "同じ交換が履歴に2件残っている",
  );
});

test("違う商品なら、続けて交換できる（鍵が違えば止まらない）", () => {
  const s0 = loggedIn();
  const list = s0.prizes.filter((x) => x.status === "UNCHOSEN");
  assert.ok(list.length >= 2, "未選択の商品が2つ以上ないと、この確認ができない");

  const before = wallet(s0);
  let s = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: list[0].id, key: "ex-a" });
  s = reducer(s, { type: "PRIZE_EXCHANGE", prizeId: list[1].id, key: "ex-b" });

  assert.equal(
    wallet(s),
    before + list[0].exchangePt + list[1].exchangePt,
    "2件交換したのに、増えたポイントが合わない",
  );
});

/* ══════════════════════════════════════════════
   ④⑤ ポイントの動きは、必ず履歴に残り、残高と一致する
   ══════════════════════════════════════════════ */

test("最初から、残高と履歴の合計が一致している", () => {
  const s = loggedIn();
  for (const r of pointsReconcile(s)) {
    assert.ok(
      r.ok,
      `${r.name} の残高 ${r.wallet}pt と、履歴の合計 ${r.ledger}pt が合っていない`,
    );
  }
});

test("ポイント交換のあとも、残高と履歴の合計が一致する", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "ex-3" });

  assert.equal(
    ledgerBalance(s1, PREVIEW_USER_ID),
    wallet(s1),
    "交換したのに、履歴の合計と残高が食い違っている",
  );

  const e = s1.ledger[s1.ledger.length - 1];
  assert.equal(e.kind, "PRIZE_EXCHANGE");
  assert.equal(e.delta, p.exchangePt, "履歴に残った金額が、交換ポイントと違う");
  assert.equal(e.balanceAfter, wallet(s1), "履歴の「交換後の残高」が実際と違う");
  assert.equal(e.ref, p.id, "どの商品の交換なのかが履歴から追えない");
});

test("ガチャを1回引くと、使ったポイントが履歴に残り、残高と一致し続ける", () => {
  let s = loggedIn();
  const g = s.gachas.find((x) => x.status === "PUBLISHED" && x.left > 0)!;

  for (let i = 0; i < 20; i++) {
    const next = reducer(s, { type: "DRAW", gachaId: g.id, key: `draw-${i}` });
    if (next.draws.length === s.draws.length) break;
    s = next;
    assert.equal(
      ledgerBalance(s, PREVIEW_USER_ID),
      wallet(s),
      `${i + 1}回目のあとで、履歴の合計と残高が食い違っている`,
    );
  }
});

test("運営がポイントを動かしても、お客様の履歴に必ず出る", () => {
  const s0 = loggedIn();
  const before = wallet(s0);
  const s1 = reducer(s0, {
    type: "POINT_REQUEST",
    userId: PREVIEW_USER_ID,
    delta: 1_000,
    reason: "テスト用の調整",
  });

  assert.equal(wallet(s1), before + 1_000);
  assert.equal(
    ledgerBalance(s1, PREVIEW_USER_ID),
    wallet(s1),
    "運営が動かした分が、お客様の履歴に出ていない",
  );
});

/* ══════════════════════════════════════════════
   ⑥ 発送依頼は、その場で管理サイトへ届く
   ══════════════════════════════════════════════ */

test("発送を依頼した瞬間、管理サイトの未発送が1件増える", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const todo0 = s0.orders.filter((o) => o.status === "UNSHIPPED").length;

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: p.id,
    key: "ship-3",
    address: DEMO_ADDRESS,
  });

  const todo1 = s1.orders.filter((o) => o.status === "UNSHIPPED").length;
  assert.equal(todo1, todo0 + 1, "お客様が依頼したのに、管理サイトの未発送が増えていない");

  const o = s1.orders.find((x) => x.prizeId === p.id);
  assert.ok(o, "伝票から、どの獲得商品なのかを追えない");
  assert.equal(o!.address?.zip, DEMO_ADDRESS.zip, "依頼時のお届け先が伝票に写っていない");
});

test("依頼したあとに会員情報の住所を変えても、出した伝票の宛先は変わらない", () => {
  const s0 = loggedIn();
  const list = s0.prizes.filter((x) => x.status === "UNCHOSEN");
  assert.ok(list.length >= 2, "未選択の商品が2つ以上ないと、この確認ができない");

  const s1 = reducer(s0, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: list[0].id,
    key: "ship-old",
    address: { ...DEMO_ADDRESS, addr: "むかしの住所" },
  });
  const s2 = reducer(s1, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: list[1].id,
    key: "ship-new",
    address: { ...DEMO_ADDRESS, addr: "あたらしい住所" },
  });

  assert.equal(
    s2.orders.find((o) => o.prizeId === list[0].id)!.address?.addr,
    "むかしの住所",
    "先に出した伝票の宛先が、後の変更で書き換わっている",
  );
});

/* ══════════════════════════════════════════════
   ⑦ 監査ログ
   ══════════════════════════════════════════════ */

test("ポイント交換は、交換前後の残高まで監査ログに残る", () => {
  const s0 = loggedIn();
  const p = unchosen(s0);
  const before = wallet(s0);
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "ex-audit" });
  const after = wallet(s1);

  const e = s1.audit[s1.audit.length - 1];
  assert.equal(e.action, "PRIZE_EXCHANGE");
  assert.equal(e.target, p.id, "どの商品の交換かが監査ログから追えない");
  assert.equal(e.actorId, PREVIEW_USER_ID, "誰が交換したのかが残っていない");
  assert.ok(e.before?.includes(before.toLocaleString()), "交換前の残高が残っていない");
  assert.ok(e.after?.includes(after.toLocaleString()), "交換後の残高が残っていない");
  assert.ok(e.reason?.includes("ex-audit"), "二重処理防止の鍵が残っていない");
});

test("お客様の操作を混ぜても、監査ログの鎖は切れない", () => {
  const s0 = loggedIn();
  const list = s0.prizes.filter((x) => x.status === "UNCHOSEN");

  let s = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: list[0].id, key: "chain-1" });
  s = reducer(s, {
    type: "PRIZE_SHIP_REQUEST",
    prizeId: list[1].id,
    key: "chain-2",
    address: DEMO_ADDRESS,
  });
  s = reducer(s, { type: "USER_ASK", text: "発送はいつ届きますか？", key: "chain-3" });

  const v = verifyAudit(s.audit);
  assert.equal(v.ok, true, "お客様の操作を混ぜたら、監査ログの検証が通らなくなった");
});

/* ══════════════════════════════════════════════
   ⑧ 存在しない商品には、何もしない
   ══════════════════════════════════════════════ */

test("存在しない商品を指定しても、ポイントは増えない", () => {
  const s0 = loggedIn();
  const before = wallet(s0);
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: "pz_nope", key: "ex-x" });

  assert.equal(wallet(s1), before);
  assert.equal(s1.flash?.kind, "error");
});
