/**
 * セキュリティの最終テスト（TEST A〜F）。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルだけは、目的が他と違います
 * ═══════════════════════════════════════════════════════
 *
 * 他のテストは「正しく使ったときに、正しく動くか」を見ています。
 * ここで見るのは、その逆です。
 *
 *     正しくない使い方をしたときに、ちゃんと断るか。
 *
 * オンラインガチャで実際に起きるのは、ボタンを順番どおり押す人ではなく、
 * ボタンを押さずに、通信の中身をまねて送ってくる人です。
 * 画面のボタンを消しても、その人には何の効果もありません。
 *
 * ★ここで断れなかった場合、何が起きるか
 *
 *     他人の商品IDを送る    … 他人の当たりを、自分のポイントに変えられる
 *     同じ依頼を10回送る    … 1つの商品で10回ぶんのポイントを受け取れる
 *     交換済みをもう一度送る … 同じ商品で二重に受け取れる
 *     ログインせずに送る     … 誰のものでも触れる
 *     権限の無い担当が送る   … サポートの担当者がポイントを発行できる
 *
 * どれも、起きたあとで気づいても、もう取り返せません。
 * だから、ここは機械に毎回確かめさせます。
 *
 * ★「そう作ったつもり」を、証拠にしないこと。
 *   このファイルが緑であることだけが、証拠です。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  DEMO_ADMINS,
  DEMO_STEP_UP_CODE,
  PREVIEW_USER_ID,
  STEP_UP_EXCHANGE_PT,
  can,
  initialState,
  ledgerBalance,
  pointsReconcile,
  reducer,
  type ConsoleAction,
  type ConsoleState,
  type Permission,
  type Prize,
} from "../lib/console/state";
import { verifyAudit } from "../lib/console/audit";

/* ══════════════════════════════════════════════
   下ごしらえ
   ══════════════════════════════════════════════ */

/** 運営もお客様も、正規の手順でログインした状態 */
function loggedIn(): ConsoleState {
  let s = initialState();
  s = reducer(s, { type: "LOGIN", adminId: DEMO_ADMINS[0].id });
  s = reducer(s, { type: "MFA_OK" });
  s = reducer(s, { type: "CUSTOMER_LOGIN", userId: PREVIEW_USER_ID });
  return s;
}

/** その時点の残高 */
const pt = (s: ConsoleState, id = PREVIEW_USER_ID) =>
  s.users.find((u) => u.id === id)!.points;

/** ある商品の、いまの状態 */
const statusOf = (s: ConsoleState, id: string) =>
  s.prizes.find((p) => p.id === id)!.status;

/**
 * ログイン中のご本人の、まだ受け取り方法を決めていない商品。
 *
 * ★高額品は避けます。高額は追加の本人確認で止まるのが正しく、
 *   ここで見たいのは「ふつうの操作が通るか」だからです。
 */
function mine(s: ConsoleState): Prize {
  const p = s.prizes.find(
    (x) =>
      x.status === "UNCHOSEN" &&
      x.userId === PREVIEW_USER_ID &&
      x.exchangePt < STEP_UP_EXCHANGE_PT,
  );
  assert.ok(p, "ご本人の、受け取り方法が未選択の商品がデモデータに無い");
  return p!;
}

/**
 * 他人の商品。
 *
 * ★これが1件も無いデータでテストを書かないこと。
 *   他人の商品が存在しないデータでは、
 *   「他人の商品を断れるか」を一度も確かめられません。
 *   それでも全部緑になるので、守れているように見えてしまいます。
 */
function someoneElses(s: ConsoleState): Prize {
  const p = s.prizes.find((x) => x.userId !== PREVIEW_USER_ID);
  assert.ok(p, "他の会員の商品がデモデータに無い（この検査が意味を失う）");
  return p!;
}

/** 止めた記録が1件増えたか */
const blockedCount = (s: ConsoleState, kind: string) =>
  s.securityEvents.filter((e) => e.kind === kind).length;

/**
 * 全会員について、残高と履歴の合計が一致しているか。
 *
 * ★1人でも合わなければ、そこで止めること。
 *   合わないということは、記録を残さずに残高だけ動かしたということです。
 *   それは、後から誰も説明できないお金になります。
 */
const reconciled = (s: ConsoleState) => pointsReconcile(s).every((r) => r.ok);

/* ══════════════════════════════════════════════
   TEST A：本人の商品なら、ちゃんと通る
   ══════════════════════════════════════════════

   最初にこれを置く理由があります。
   全部を断るだけなら、いちばん簡単に「安全」にできます。
   でもそれは、ただ壊れているだけです。
   通るべきものが通ることを、先に確かめます。
*/

test("TEST A：ご本人の商品なら、ポイント交換は成功する", () => {
  const s0 = loggedIn();
  const p = mine(s0);
  const before = pt(s0);

  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "A-1" });

  assert.equal(statusOf(s1, p.id), "EXCHANGED", "交換済みになっていない");
  assert.equal(pt(s1), before + p.exchangePt, "残高が増えていない");
  assert.equal(s1.flash?.kind, "ok");

  /* 増えたポイントは、必ず履歴に1件残っていること。
     残高だけ動いて履歴が無いと、あとで誰も説明できません */
  assert.equal(ledgerBalance(s1, PREVIEW_USER_ID), pt(s1));
  assert.equal(reconciled(s1), true, "残高と履歴が食い違っている");
  assert.equal(verifyAudit(s1.audit).ok, true);
});

/* ══════════════════════════════════════════════
   TEST B：他人の商品IDを送っても、通らない（IDOR）
   ══════════════════════════════════════════════

   いちばん危ないのがこれです。
   画面には自分の商品しか出ていなくても、
   送る番号を1文字変えるだけなら、誰でもできます。
*/

test("TEST B：他人の商品IDを送っても、ポイント交換は拒否される", () => {
  const s0 = loggedIn();
  const other = someoneElses(s0);
  const myBefore = pt(s0);
  const otherBefore = pt(s0, other.userId);

  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: other.id, key: "B-1" });

  assert.equal(statusOf(s1, other.id), other.status, "他人の商品の状態が変わった");
  assert.equal(pt(s1), myBefore, "他人の商品で自分の残高が増えた");
  assert.equal(pt(s1, other.userId), otherBefore, "他人の残高が動いた");
  assert.equal(s1.flash?.kind, "error");

  /* 断っただけで終わらせないこと。
     止めた事実が残っていなければ、攻撃されたことに誰も気づけません */
  assert.equal(
    blockedCount(s1, "IDOR_ATTEMPT"),
    blockedCount(s0, "IDOR_ATTEMPT") + 1,
    "止めたのに、止めた記録が増えていない",
  );
  assert.ok(
    s1.audit.some((e) => e.action === "IDOR_BLOCKED"),
    "監査ログに拒否の記録が無い",
  );
});

test("TEST B2：他人の商品IDを送っても、発送依頼は拒否される", () => {
  const s0 = loggedIn();
  const other = someoneElses(s0);
  const orders = s0.orders.length;

  const s1 = reducer(s0, { type: "PRIZE_SHIP_REQUEST", prizeId: other.id, key: "B2-1" });

  assert.equal(statusOf(s1, other.id), other.status);
  assert.equal(s1.orders.length, orders, "他人の商品で伝票が作られた");
  assert.equal(s1.flash?.kind, "error");
});

test("TEST B3：存在しない商品IDと、他人の商品IDの断り方が同じ", () => {
  /* ★断り方を分けないこと。
     「その商品はありません」と「他人の商品です」を区別して返すと、
     番号を1つずつ試すだけで、実在する番号を外から数えられます。
     数えられた時点で、次は中身を狙われます */
  const s0 = loggedIn();
  const other = someoneElses(s0);

  const ng1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: other.id, key: "B3-1" });
  const ng2 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: "pz_not_exist", key: "B3-2" });

  assert.equal(ng1.flash?.text, ng2.flash?.text, "断り文で、実在するIDが見分けられる");
});

/* ══════════════════════════════════════════════
   TEST C：交換済みを、もう一度は交換できない
   ══════════════════════════════════════════════ */

test("TEST C：交換済みの商品は、二度目の交換を拒否する", () => {
  const s0 = loggedIn();
  const p = mine(s0);
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "C-1" });
  const after1 = pt(s1);

  /* 鍵を変えて送り直す＝別の依頼として届いた場合 */
  const s2 = reducer(s1, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "C-2" });

  assert.equal(pt(s2), after1, "同じ商品で二重にポイントが増えた");
  assert.equal(s2.flash?.kind, "error");
  assert.equal(reconciled(s2), true);
});

/* ══════════════════════════════════════════════
   TEST D：発送を選んだ商品は、交換できない
   ══════════════════════════════════════════════

   ここが抜けると、1つの景品で
   「現物を受け取ったうえに、ポイントももらう」ができます。
*/

test("TEST D：発送依頼済みの商品は、ポイント交換を拒否する", () => {
  const s0 = loggedIn();
  const p = mine(s0);
  const s1 = reducer(s0, { type: "PRIZE_SHIP_REQUEST", prizeId: p.id, key: "D-1" });
  assert.equal(statusOf(s1, p.id), "SHIP_REQUESTED", "そもそも発送依頼が通っていない");
  const before = pt(s1);

  const s2 = reducer(s1, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "D-2" });

  assert.equal(pt(s2), before, "発送する商品で、ポイントまで増えた");
  assert.equal(statusOf(s2, p.id), "SHIP_REQUESTED");
  assert.equal(s2.flash?.kind, "error");
});

test("TEST D2：交換済みの商品は、発送依頼を拒否する", () => {
  const s0 = loggedIn();
  const p = mine(s0);
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "D2-1" });
  const orders = s1.orders.length;

  const s2 = reducer(s1, { type: "PRIZE_SHIP_REQUEST", prizeId: p.id, key: "D2-2" });

  assert.equal(s2.orders.length, orders, "交換済みなのに伝票ができた");
  assert.equal(statusOf(s2, p.id), "EXCHANGED");
  assert.equal(s2.flash?.kind, "error");
});

/* ══════════════════════════════════════════════
   TEST E：同時に10回届いても、成立するのは1回だけ
   ══════════════════════════════════════════════

   通信が混んだとき、スマートフォンは同じ依頼を勝手に投げ直します。
   利用者が連打しなくても、これは毎日起きます。
*/

test("TEST E：同じ鍵で10回届いても、ポイントは1回分しか増えない", () => {
  const s0 = loggedIn();
  const p = mine(s0);
  const before = pt(s0);

  let s = s0;
  for (let i = 0; i < 10; i++) {
    s = reducer(s, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "E-same" });
  }

  assert.equal(pt(s), before + p.exchangePt, "10回ぶん増えている");
  /* ★kind でも絞ること。
     同じ商品には「引いたときに払った分（DRAW_SPEND）」の履歴も付いています。
     ref だけで数えると、その1件まで数えてしまい、
     二重加算が起きていないのに起きたように見えます */
  assert.equal(
    s.ledger.filter((l) => l.kind === "PRIZE_EXCHANGE" && l.ref === p.id).length,
    1,
    "履歴が2件以上できている",
  );
  assert.equal(
    s.audit.filter((e) => e.action === "PRIZE_EXCHANGE" && e.target === p.id).length,
    1,
    "監査ログが2件以上できている",
  );
  assert.equal(reconciled(s), true);
});

test("TEST E2：同じ鍵で10回届いても、伝票は1枚しかできない", () => {
  const s0 = loggedIn();
  const p = mine(s0);
  const orders = s0.orders.length;

  let s = s0;
  for (let i = 0; i < 10; i++) {
    s = reducer(s, { type: "PRIZE_SHIP_REQUEST", prizeId: p.id, key: "E2-same" });
  }

  assert.equal(s.orders.length, orders + 1, "同じ商品で伝票が2枚以上できた");
});

/* ══════════════════════════════════════════════
   TEST F：時間切れのあとに送り直されても、二重にしない
   ══════════════════════════════════════════════

   いちばん多いのがこれです。
   処理は成功しているのに、返事だけが届かなかった場合、
   送った側は「失敗した」と思ってもう一度送ります。
*/

test("TEST F：時間切れで送り直されても、二重には加算しない", () => {
  const s0 = loggedIn();
  const p = mine(s0);
  const before = pt(s0);

  /* 1回目は成功している（返事だけが届かなかった、という想定） */
  const s1 = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "F-key" });
  /* 送った側は失敗したと思って、同じ鍵でもう一度送る */
  const s2 = reducer(s1, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "F-key" });

  assert.equal(pt(s2), before + p.exchangePt);
  /* ★ここでエラーを返さないこと。
     利用者から見れば、1回目は失敗したように見えています。
     そこへ「エラーです」と返すと、受け取れなかったと思われます。
     正しくは「すでに1回だけ処理済みです」と伝えることです */
  assert.notEqual(s2.flash?.kind, "error", "成功しているのに失敗と伝えている");
  assert.equal(reconciled(s2), true);
});

/* ══════════════════════════════════════════════
   ログインしていない人は、そもそも触れない
   ══════════════════════════════════════════════ */

test("未ログインでは、交換も発送も残高の閲覧も通らない", () => {
  const s0 = initialState(); // お客様としてログインしていない
  const p = s0.prizes.find((x) => x.status === "UNCHOSEN")!;

  const ex = reducer(s0, { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "N-1" });
  const sh = reducer(s0, { type: "PRIZE_SHIP_REQUEST", prizeId: p.id, key: "N-2" });

  assert.equal(statusOf(ex, p.id), "UNCHOSEN");
  assert.equal(statusOf(sh, p.id), "UNCHOSEN");
  assert.ok(
    blockedCount(ex, "UNAUTHENTICATED") >= 1,
    "ログインせずに呼ばれたことが記録されていない",
  );
});

/* ══════════════════════════════════════════════
   権限（RBAC）は、画面ではなく受け取り側で見る
   ══════════════════════════════════════════════

   サポートの担当者が、管理者用の通信をまねて送ってきた場合を試します。
   画面のボタンを消すだけでは、これは止まりません。
*/

function asSupport(): ConsoleState {
  const support = DEMO_ADMINS.find((a) => a.role === "SUPPORT");
  assert.ok(support, "サポート役の担当者がデモデータに無い");
  let s = reducer(initialState(), { type: "LOGIN", adminId: support!.id });
  s = reducer(s, { type: "MFA_OK" });
  return s;
}

test("サポートは、ポイント変更を直接呼んでも通らない", () => {
  const s0 = asSupport();
  const before = pt(s0);
  const s1 = reducer(s0, {
    type: "POINT_REQUEST", userId: PREVIEW_USER_ID, delta: 5_000, reason: "お詫び",
  });

  assert.equal(pt(s1), before, "権限が無いのにポイントが動いた");
  assert.equal(s1.pointRequests.length, 0, "申請だけが作られている");
  assert.equal(s1.flash?.kind, "error");
  assert.ok(
    s1.audit.some((e) => e.action === "RBAC_DENIED"),
    "断ったことが監査ログに残っていない",
  );
  assert.ok(blockedCount(s1, "RBAC_DENIED") >= 1);
});

test("サポートは、ガチャ公開を直接呼んでも通らない", () => {
  const s0 = asSupport();
  const g = s0.gachas.find((x) => x.status !== "PUBLISHED");
  assert.ok(g, "公開前のガチャがデモデータに無い");

  const s1 = reducer(s0, { type: "PUBLISH_GACHA", gachaId: g!.id });

  assert.equal(
    s1.gachas.find((x) => x.id === g!.id)!.status,
    g!.status,
    "権限が無いのにガチャが公開された",
  );
  assert.equal(s1.flash?.kind, "error");
});

test("サポートは、お客様の本人確認方式を勝手に変えられない", () => {
  const s0 = asSupport();
  const s1 = reducer(s0, { type: "SET_CUSTOMER_AUTH", method: "EMAIL" });
  assert.equal(s1.customerAuth, s0.customerAuth, "設定が書き換わった");
  assert.equal(s1.flash?.kind, "error");
});

/* ══════════════════════════════════════════════
   全部の担当 × 全部の操作を、総当たりで試す
   ══════════════════════════════════════════════

   ★1つずつテストを書く方式をやめること。
     操作が増えたとき、テストを書き足すのを忘れます。
     忘れたぶんだけ、権限の穴が見えないまま残ります。

   ここでは「権限を持たない担当が呼んだら、
   必ず断られ、必ず記録が残る」ことだけを見ます。
   誰がどの権限を持つかは ROLE_PERMISSIONS 側の話なので、
   このテストは中身を知らないまま can() に聞きます。
*/

/** 運営側の操作と、それに必要な権限の対応表 */
const GUARDED: { label: string; perm: Permission; act: (s: ConsoleState) => ConsoleAction }[] = [
  {
    label: "ガチャを作る",
    perm: "gacha.edit",
    act: () => ({
      type: "CREATE_GACHA",
      title: "権限テスト用ガチャ",
      spec: { name: "権限テスト用ガチャ", price: 1_000, total: 100, prizes: [] },
    }),
  },
  { label: "検証を実行する", perm: "gacha.edit", act: (s) => ({ type: "RUN_BACKTEST", gachaId: s.gachas[0].id }) },
  { label: "ガチャを公開する", perm: "gacha.publish", act: (s) => ({ type: "PUBLISH_GACHA", gachaId: s.gachas[0].id }) },
  { label: "ガチャを止める", perm: "gacha.publish", act: (s) => ({ type: "PAUSE_GACHA", gachaId: s.gachas[0].id, reason: "点検" }) },
  {
    label: "ポイント変更を申請する",
    perm: "point.request",
    act: () => ({ type: "POINT_REQUEST", userId: PREVIEW_USER_ID, delta: 500, reason: "お詫び" }),
  },
  { label: "ポイント変更を承認する", perm: "point.approve", act: () => ({ type: "POINT_APPROVE", requestId: "pr_1" }) },
  { label: "ポイント変更を却下する", perm: "point.approve", act: () => ({ type: "POINT_REJECT", requestId: "pr_1", reason: "不要" }) },
  { label: "不正判定を確定する", perm: "fraud.act", act: (s) => ({ type: "FRAUD_HANDLE", signupId: s.signups[0].id, decision: "REVIEW" }) },
  { label: "発送を処理する", perm: "shipping.act", act: (s) => ({ type: "SHIP", orderId: s.orders[0].id }) },
  { label: "問い合わせに返信する", perm: "support.reply", act: (s) => ({ type: "SUPPORT_REPLY", ticketId: s.tickets[0].id, text: "確認します" }) },
  { label: "設定を変える", perm: "settings.edit", act: () => ({ type: "SET_CUSTOMER_AUTH", method: "EMAIL" }) },
];

test("権限の無い担当が運営操作を直接呼ぶと、全部その場で断られる", () => {
  for (const admin of DEMO_ADMINS) {
    let s0 = reducer(initialState(), { type: "LOGIN", adminId: admin.id });
    s0 = reducer(s0, { type: "MFA_OK" });

    for (const g of GUARDED) {
      if (can(admin.role, g.perm)) continue; // 権限がある人は、ここでは見ない
      const s1 = reducer(s0, g.act(s0));
      const why = `${admin.role} が「${g.label}」を呼んだとき`;

      assert.equal(s1.flash?.kind, "error", `${why}：断っていない`);
      assert.equal(s1.flash?.to, "admin", `${why}：断り文がお客様側に出ている`);
      assert.ok(
        s1.audit.some((e) => e.action === "RBAC_DENIED"),
        `${why}：監査ログに残っていない`,
      );
      assert.ok(
        blockedCount(s1, "RBAC_DENIED") > blockedCount(s0, "RBAC_DENIED"),
        `${why}：セキュリティ記録に残っていない`,
      );
    }
  }
});

test("権限の無い担当が運営操作を呼んでも、残高と履歴はずれない", () => {
  for (const admin of DEMO_ADMINS) {
    let s = reducer(initialState(), { type: "LOGIN", adminId: admin.id });
    s = reducer(s, { type: "MFA_OK" });
    for (const g of GUARDED) {
      if (can(admin.role, g.perm)) continue;
      s = reducer(s, g.act(s));
    }
    assert.equal(reconciled(s), true, `${admin.role} のあとで帳尻が合っていない`);
  }
});

test("運営側の操作は、1つ残らず権限の関門を通っている", () => {
  /* ★対応表そのものを見張ること。
     操作を足したのに GUARDED へ書き忘れると、
     上の総当たりテストは静かに素通りします。
     「テストが緑だから安全」が嘘になるのが、いちばん困ります */
  const src = readFileSync(
    new URL("../lib/console/state.ts", import.meta.url),
    "utf8",
  );
  /* state.ts の中で requireRole を呼んでいる操作名を、すべて拾う */
  const gated = (src.match(/requireRole\(s,\s*"[^"]+",\s*"[A-Z_]+"\)/g) ?? []).map(
    (m) => m.replace(/^.*"([A-Z_]+)"\)$/, "$1"),
  );
  assert.ok(gated.length >= 10, "requireRole の呼び出しを拾えていない（書き方を変えた？）");

  const seed = initialState();
  const listed = GUARDED.map((g) => g.act(seed).type as string);

  for (const name of gated) {
    assert.ok(
      listed.includes(name),
      `${name} が権限の関門を通っているのに、この対応表に載っていない`,
    );
  }
});

/* ══════════════════════════════════════════════
   知らせの宛先（AUDIENCE）
   ══════════════════════════════════════════════

   ★項目40：宛先の無い知らせを、1つも作らないこと。

   運営向けの文面が、そのままお客様の画面に出ると、
   担当者の名前や、社内の言い回しが、お客様に見えます。
   1回出れば、それは事故です。
*/

/** 画面から実際に押せる操作を、ひととおり並べたもの */
function everyAction(s: ConsoleState): ConsoleAction[] {
  const p = s.prizes.find((x) => x.status === "UNCHOSEN" && x.userId === PREVIEW_USER_ID)!;
  const g = s.gachas[0];
  const order = s.orders[0];
  const ticket = s.tickets[0];
  const signup = s.signups[0];

  return [
    { type: "CUSTOMER_LOGIN", userId: PREVIEW_USER_ID },
    { type: "DRAW", gachaId: g.id, key: "aud-1" },
    { type: "PRIZE_EXCHANGE", prizeId: p.id, key: "aud-2" },
    { type: "PRIZE_SHIP_REQUEST", prizeId: p.id, key: "aud-3" },
    { type: "PRIZE_SHIP_BULK", prizeIds: [p.id], key: "aud-4" },
    { type: "PRIZE_EXCHANGE_BULK", prizeIds: [p.id], key: "aud-5" },
    { type: "USER_ASK", text: "発送はいつになりますか", key: "aud-6" },
    { type: "CUSTOMER_STEP_UP", code: DEMO_STEP_UP_CODE },
    { type: "CUSTOMER_STEP_UP_CANCEL" },
    { type: "CUSTOMER_LOGOUT" },
    { type: "POINT_REQUEST", userId: PREVIEW_USER_ID, delta: 500, reason: "お詫び" },
    { type: "PUBLISH_GACHA", gachaId: g.id },
    { type: "PAUSE_GACHA", gachaId: g.id, reason: "点検" },
    ...(order ? [{ type: "SHIP", orderId: order.id } as ConsoleAction] : []),
    ...(ticket
      ? [{ type: "SUPPORT_REPLY", ticketId: ticket.id, text: "確認します" } as ConsoleAction]
      : []),
    ...(signup
      ? [{ type: "FRAUD_HANDLE", signupId: signup.id, decision: "REVIEW" } as ConsoleAction]
      : []),
    { type: "SET_CUSTOMER_AUTH", method: "EMAIL_SMS" },
    { type: "RESET" },
  ];
}

test("宛先（AUDIENCE）の無い知らせを、1つも作っていない", () => {
  const base = loggedIn();
  for (const a of everyAction(base)) {
    const next = reducer(base, a);
    if (!next.flash) continue;
    assert.ok(
      next.flash.to === "admin" || next.flash.to === "customer" || next.flash.to === "internal",
      `${a.type} の知らせに宛先が付いていない`,
    );
  }
});

test("お客様の操作で出る知らせに、運営担当者の名前が混ざらない", () => {
  /* ★項目39：運営者情報の漏れを、目視ではなくここで固定する。
     人の目で毎回確かめるのは、必ずいつか抜けます */
  const base = loggedIn();
  const names = base.admins.map((a) => a.name);

  const customerOps: ConsoleAction[] = [
    { type: "DRAW", gachaId: base.gachas.find((g) => g.status === "PUBLISHED")!.id, key: "x-1" },
    { type: "PRIZE_EXCHANGE", prizeId: mine(base).id, key: "x-2" },
    { type: "PRIZE_SHIP_REQUEST", prizeId: mine(base).id, key: "x-3" },
    { type: "USER_ASK", text: "発送はいつですか", key: "x-4" },
  ];

  for (const a of customerOps) {
    const next = reducer(base, a);
    assert.equal(next.flash?.to, "customer", `${a.type} の知らせが運営向けになっている`);
    for (const n of names) {
      assert.ok(
        !(next.flash?.text ?? "").includes(n),
        `${a.type} の知らせに運営担当者「${n}」の名前が入っている`,
      );
    }
    for (const role of ["管理者", "経理", "セキュリティ", "サポート担当"]) {
      assert.ok(
        !(next.flash?.text ?? "").includes(role),
        `${a.type} の知らせに社内の役割「${role}」が入っている`,
      );
    }
  }
});

/* ══════════════════════════════════════════════
   最後に、全部やったあとで帳尻が合っているか
   ══════════════════════════════════════════════ */

test("攻撃と正常操作を混ぜて流しても、残高と履歴が一致したまま", () => {
  let s = loggedIn();
  const other = someoneElses(s);

  const p1 = mine(s);
  s = reducer(s, { type: "PRIZE_EXCHANGE", prizeId: p1.id, key: "z-1" });
  s = reducer(s, { type: "PRIZE_EXCHANGE", prizeId: p1.id, key: "z-1" }); // 再送
  s = reducer(s, { type: "PRIZE_EXCHANGE", prizeId: p1.id, key: "z-2" }); // 二重
  s = reducer(s, { type: "PRIZE_EXCHANGE", prizeId: other.id, key: "z-3" }); // 他人
  s = reducer(s, { type: "PRIZE_SHIP_REQUEST", prizeId: other.id, key: "z-4" }); // 他人

  const p2 = mine(s);
  s = reducer(s, { type: "PRIZE_SHIP_REQUEST", prizeId: p2.id, key: "z-5" });
  s = reducer(s, { type: "PRIZE_SHIP_REQUEST", prizeId: p2.id, key: "z-5" }); // 再送

  assert.equal(reconciled(s), true, "残高と履歴が食い違った");
  assert.equal(verifyAudit(s.audit).ok, true, "監査ログの鎖が切れた");
  assert.ok(s.securityEvents.length >= 2, "止めた記録が残っていない");
});
