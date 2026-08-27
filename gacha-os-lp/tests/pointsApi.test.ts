/**
 * ポイントの入口（API）を、画面を通さずに直接叩く試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★roleAccess.test.ts と、何が違うのか
 * ═══════════════════════════════════════════════════════
 *
 *   roleAccess.test.ts は、門番（guard）そのものを試しています。
 *   門番は正しくても、入口の側で
 *
 *       ・permission を書き忘れている
 *       ・stepUp を書き忘れている
 *
 *   ことがあり得ます。書き忘れた入口は、普通に動きます。
 *   自分の権限で使っているかぎり、何も起きません。
 *   気づくのは、権限の無い人が直接叩いたときだけです。
 *
 *   だから、この試験は本物の入口（route.ts の POST）を呼びます。
 *
 * ═══════════════════════════════════════════════════════
 * ★確かめること
 * ═══════════════════════════════════════════════════════
 *
 *   D) サポートの人が、ポイント承認の入口を直接叩く → 403
 *      （画面のボタンを消してあるかどうかとは無関係）
 *
 *   ＋ 経理は「申請」はできるが「承認」はできない
 *   ＋ 自分が出した申請は、自分では承認できない（二人承認の本体）
 *   ＋ 承認を2回押しても、ポイントは1回分しか動かない
 *   ＋ 追加の本人確認を通していなければ、承認できない
 *   ＋ 残高より多く引こうとしたら断る
 *   ＋ 承認したときだけ、監査ログに1行残る
 *   ＋ 他社の申請は、番号を知っていても承認できない
 *
 * ═══════════════════════════════════════════════════════
 * ★二人承認が要る額と、要らない額
 * ═══════════════════════════════════════════════════════
 *
 *   境目は lib/server/points.ts の fourEyesThreshold() です。
 *
 *     境目以上 … その場では1ptも動かない。別の担当者の承認を待つ
 *     境目未満 … その場で台帳へ入る（ただし理由と6桁は必ず要る）
 *
 *   ★標準は 0 です。何も設定しなければ、全件が二人承認になります。
 *     この試験では「境目のある会社」を再現するために、
 *     わざと境目を設定します。0 のままだと
 *     「境目未満はその場で入る」道を1本も試せないからです。
 *     標準が 0 であること自体は、いちばん下でまとめて試します。
 *
 *   ★判定側に、境目の数字を書き写さないこと。
 *     書き写すと、境目を変えた日に、試験だけが古い前提のまま
 *     通ってしまいます。必ず正本から読み直して使います。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import { loginAdmin, setPassword } from "../lib/server/auth";
import { SESSION_COOKIE, CSRF_HEADER, markStepUp } from "../lib/server/session";
import { createTenant, createCustomer, createAdmin } from "../lib/server/seed";
import { POST as requestPost } from "../app/api/console/points/request/route";
import { POST as approvePost } from "../app/api/console/points/approve/route";
import {
  fourEyesThreshold,
  DEFAULT_FOUR_EYES_THRESHOLD,
} from "../lib/server/points";

/*
 * ★この試験のあいだだけ、「境目のある会社」を作ります。
 *   標準は 0（全件二人承認）です。ここで上書きするのは、
 *   境目未満の道も試すためであって、標準を変えたいからではありません。
 */
process.env.POINT_ADJUST_APPROVAL_THRESHOLD = "100000";

/** 二人承認が必要になる額。★数字を書き写さず、正本から読み直すこと */
const OOGUCHI = fourEyesThreshold();
/** その場で反映される額 */
const KOGUCHI = 300;

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

type Login = { token: string; csrf: string };

let tenantA = "";
let tenantB = "";
let customerA = "";
let customerB = "";

/* 役割の違う担当者 */
let support: Login;
let finance: Login;
let boss1: Login;
let boss2: Login;
let bossB: Login;

/** ログインして、合言葉と合図をそろえる */
async function login(
  tenantId: string,
  email: string,
  opts: { stepUp?: boolean } = {},
): Promise<Login> {
  const r = await loginAdmin({ tenantId, email, password: PW });
  assert.equal(r.ok, true, `ログインできませんでした：${email}`);
  if (!r.ok) throw new Error("unreachable");

  /*
   * ★追加の本人確認（6桁）を通した状態を作ります。
   *   本物では認証アプリの数字を入れて通します。
   *   ここでは「通した」という事実だけを作れば十分です。
   *   opts.stepUp を false にすると、通していない人になります。
   */
  if (opts.stepUp !== false) await markStepUp(r.session.token);

  return { token: r.session.token, csrf: r.session.csrfToken };
}

/** 入口を、画面を通さずに直接叩く */
function post(
  url: string,
  who: Login | null,
  body: unknown,
  opts: { csrf?: boolean; idem?: string } = {},
) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
  };
  if (who) {
    headers.cookie = `${SESSION_COOKIE}=${who.token}`;
    if (opts.csrf !== false) headers[CSRF_HEADER] = who.csrf;
  }
  /* 同じ操作が二重に届いたことを見分けるための鍵。画面が毎回1本だけ作ります */
  if (opts.idem) headers["idempotency-key"] = opts.idem;
  return new NextRequest(`https://example.test${url}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const REQ_URL = "/api/console/points/request";
const APR_URL = "/api/console/points/approve";

/** 残高をそのまま読む */
async function pointsOf(customerId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT points FROM customers WHERE id = ? LIMIT 1`,
    args: [customerId],
  });
  return Number((r.rows[0] as Record<string, unknown> | undefined)?.points ?? 0);
}

/** 申請を1件出して、その番号を返す */
async function makeRequest(
  who: Login,
  userId: string,
  delta: number,
  reason = "テストのための調整",
): Promise<string> {
  const res = await requestPost(post(REQ_URL, who, { userId, delta, reason }));
  const body = (await res.json()) as { ok: boolean; adjustmentId?: string };
  assert.equal(res.status, 200, `申請できませんでした：${JSON.stringify(body)}`);
  assert.ok(body.adjustmentId);
  return body.adjustmentId as string;
}

/**
 * 「承認待ち」の申請を1件作る。
 *
 * ★ただ申請するだけでなく、本当に止まっていることを確かめること。
 *   境目を下げてしまった日に、この試験は
 *   「申請したらもう反映済みだった」という形で気づきます。
 *   確かめないと、二人承認が外れたことに誰も気づけません。
 */
async function makePending(
  who: Login,
  userId: string,
  delta: number,
  reason = "テストのための調整",
): Promise<string> {
  const before = await pointsOf(userId);
  const res = await requestPost(post(REQ_URL, who, { userId, delta, reason }));
  const body = (await res.json()) as {
    ok: boolean;
    adjustmentId?: string;
    status?: string;
    balanceAfter?: number | null;
  };
  assert.equal(res.status, 200, `申請できませんでした：${JSON.stringify(body)}`);
  assert.equal(
    body.status,
    "PENDING",
    `${delta}pt の申請が、承認を待たずに反映されました。二人承認が外れています`,
  );
  assert.equal(
    body.balanceAfter,
    null,
    "まだ1ptも動いていないのに、反映後の残高を返しています",
  );
  assert.equal(
    await pointsOf(userId),
    before,
    "承認待ちのはずなのに、残高が動いています",
  );
  return body.adjustmentId as string;
}

/* ══════════════════════════════════════════════
   準備
   ══════════════════════════════════════════════ */

test("準備：2社と、役割の違う担当者を用意する", async () => {
  tenantA = await createTenant({ code: "ALPHA", name: "アルファ株式会社" });
  tenantB = await createTenant({ code: "BETA", name: "ベータ株式会社" });

  const people = [
    { email: "support@alpha.example", name: "サポート担当", role: "SUPPORT", t: () => tenantA, no: 1 },
    { email: "finance@alpha.example", name: "経理担当", role: "FINANCE", t: () => tenantA, no: 2 },
    { email: "boss1@alpha.example", name: "統括ひとり目", role: "SUPER_ADMIN", t: () => tenantA, no: 3 },
    { email: "boss2@alpha.example", name: "統括ふたり目", role: "SUPER_ADMIN", t: () => tenantA, no: 4 },
    { email: "boss@beta.example", name: "ベータの統括", role: "SUPER_ADMIN", t: () => tenantB, no: 1 },
  ];

  for (const p of people) {
    const uid = await createAdmin({
      tenantId: p.t(),
      no: p.no,
      email: p.email,
      name: p.name,
      role: p.role,
    });
    await setPassword({
      tenantId: p.t(),
      subjectKind: "ADMIN",
      subjectId: uid,
      password: PW,
    });
  }

  /* ★二人承認の試験で使うので、境目より多い残高から始めること。
       少ない残高だと「引きすぎ」の判定に先に当たってしまい、
       確かめたいこと（承認の流れ）まで届きません */
  customerA = await createCustomer({
    tenantId: tenantA,
    no: 1,
    name: "アルファのお客様",
    points: OOGUCHI * 5,
    email: "user@alpha.example",
  });
  customerB = await createCustomer({
    tenantId: tenantB,
    no: 1,
    name: "ベータのお客様",
    points: 5000,
    email: "user@beta.example",
  });

  support = await login(tenantA, "support@alpha.example");
  finance = await login(tenantA, "finance@alpha.example");
  boss1 = await login(tenantA, "boss1@alpha.example");
  boss2 = await login(tenantA, "boss2@alpha.example");
  bossB = await login(tenantB, "boss@beta.example");
});

/* ══════════════════════════════════════════════
   TEST D：権限の足りない人が、直接叩く
   ══════════════════════════════════════════════ */

test("D：サポートの人が、承認の入口を直接叩いても断られる（403）", async () => {
  const adjId = await makePending(finance, customerA, OOGUCHI);
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, support, { adjustmentId: adjId, approve: true }),
  );

  assert.equal(
    res.status,
    403,
    "サポートの人が、ポイント承認の入口を通ってしまいました。" +
      "画面でボタンを消しても、これが通るなら守りはありません",
  );
  assert.equal(
    await pointsOf(customerA),
    before,
    "断ったはずなのに、残高が動いています",
  );

  /* ★足りない権限の名前を、返事に書かないこと。
       何が足りないかを教えると、どの役割を狙えばよいかの地図になります。 */
  const body = (await res.json()) as { message?: string };
  assert.equal(
    /point\.approve|SUPER_ADMIN|権限が足り/.test(String(body.message ?? "")),
    false,
    `断り文に、内部の権限名が漏れています：${body.message}`,
  );
});

test("D：サポートの人は、申請の入口も通れない（403）", async () => {
  const res = await requestPost(
    post(REQ_URL, support, {
      userId: customerA,
      delta: 100,
      reason: "サポートからの申請",
    }),
  );
  assert.equal(res.status, 403);
});

test("経理は申請できるが、承認はできない（403）", async () => {
  const adjId = await makePending(finance, customerA, OOGUCHI);

  const res = await approvePost(
    post(APR_URL, finance, { adjustmentId: adjId, approve: true }),
  );
  assert.equal(
    res.status,
    403,
    "申請した人が、そのまま承認までできてしまいます（申請と承認が分かれていません）",
  );
});

/* ══════════════════════════════════════════════
   境目：どこから二人承認になるのか
   ══════════════════════════════════════════════ */

test("境目より少ない額は、その場で台帳へ入る（承認待ちにならない）", async () => {
  const before = await pointsOf(customerA);

  const res = await requestPost(
    post(REQ_URL, finance, {
      userId: customerA,
      delta: KOGUCHI,
      reason: "少額のお詫び",
    }),
  );
  const body = (await res.json()) as {
    ok: boolean;
    adjustmentId?: string;
    status?: string;
    needsApproval?: boolean;
    balanceBefore?: number | null;
    balanceAfter?: number | null;
  };

  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(body.status, "APPLIED", "少額なのに、承認待ちで止まっています");
  assert.equal(body.needsApproval, false);

  /* ★「反映しました」と返すなら、本当に残高が動いていること。
       返事だけ先に出して台帳が後、という作りにしないための確認です。 */
  assert.equal(await pointsOf(customerA), before + KOGUCHI);
  assert.equal(body.balanceBefore, before);
  assert.equal(body.balanceAfter, before + KOGUCHI);

  /* その場で入れた分も、必ず記録に残ること */
  const rows = await db().execute({
    sql: `SELECT action FROM audit_events
           WHERE tenant_id = ? AND data LIKE ? ORDER BY seq ASC`,
    args: [tenantA, `%${body.adjustmentId}%`],
  });
  assert.deepEqual(
    rows.rows.map((r) => String((r as Record<string, unknown>).action)),
    ["POINT_ADJUST_APPLY"],
    "その場で反映した分の記録が残っていません",
  );
});

test("境目ちょうどは、二人承認の側に入る", async () => {
  /*
   * ★境目は「以上」か「超」かで、1ptだけ意味が変わります。
   *   ここを試験に書いておかないと、
   *   直したつもりの日に、静かに片側へずれます。
   */
  const before = await pointsOf(customerA);

  const sunzen = await requestPost(
    post(REQ_URL, finance, {
      userId: customerA,
      delta: OOGUCHI - 1,
      reason: "境目のひとつ手前",
    }),
  );
  const sunzenBody = (await sunzen.json()) as { status?: string };
  assert.equal(
    sunzenBody.status,
    "APPLIED",
    "境目のひとつ手前まで、承認待ちになっています（厳しすぎます）",
  );
  assert.equal(await pointsOf(customerA), before + (OOGUCHI - 1));

  /* ちょうどは、止まること */
  await makePending(finance, customerA, OOGUCHI, "境目ちょうど");
});

test("同じ操作が二重に届いても、申請は1件しか作られない", async () => {
  /*
   * ★通信が詰まったとき、人は同じボタンをもう一度押します。
   *   そのとき2件目が作られると、承認する人からは
   *   「同じ内容が2つ並んでいる」ようにしか見えません。
   *   両方承認すれば、2倍のポイントが出ます。
   */
  const before = await pointsOf(customerA);
  const key = "idem-test-0001";

  const one = await requestPost(
    post(REQ_URL, finance, { userId: customerA, delta: KOGUCHI, reason: "二重送信の確認" }, { idem: key }),
  );
  const oneBody = (await one.json()) as { adjustmentId?: string; reused?: boolean };
  assert.equal(one.status, 200);
  assert.notEqual(oneBody.reused, true, "1回目なのに、使い回し扱いになっています");

  const two = await requestPost(
    post(REQ_URL, finance, { userId: customerA, delta: KOGUCHI, reason: "二重送信の確認" }, { idem: key }),
  );
  const twoBody = (await two.json()) as { adjustmentId?: string; reused?: boolean };
  assert.equal(two.status, 200);
  assert.equal(
    twoBody.adjustmentId,
    oneBody.adjustmentId,
    "同じ操作なのに、2件目の申請が作られました",
  );
  assert.equal(twoBody.reused, true);

  assert.equal(
    await pointsOf(customerA),
    before + KOGUCHI,
    "2回押しただけで、ポイントが2倍動いています",
  );
});

/* ══════════════════════════════════════════════
   二人承認の本体
   ══════════════════════════════════════════════ */

test("自分が出した申請は、自分では承認できない（403）", async () => {
  const adjId = await makePending(boss1, customerA, OOGUCHI);

  const res = await approvePost(
    post(APR_URL, boss1, { adjustmentId: adjId, approve: true }),
  );

  assert.equal(
    res.status,
    403,
    "全権管理者が、自分ひとりでポイントを作れてしまいます",
  );
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "SELF_APPROVAL");
});

test("別の管理者なら承認でき、残高がその分だけ動く", async () => {
  const before = await pointsOf(customerA);
  const adjId = await makePending(boss1, customerA, OOGUCHI, "お詫びのポイント");

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as { ok: boolean; balance?: number };

  assert.equal(res.status, 200, JSON.stringify(body));
  assert.equal(await pointsOf(customerA), before + OOGUCHI);
  assert.equal(body.balance, before + OOGUCHI);
});

test("承認を2回押しても、ポイントは1回分しか動かない", async () => {
  const adjId = await makePending(boss1, customerA, OOGUCHI);
  const before = await pointsOf(customerA);

  const first = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  assert.equal(first.status, 200);
  const afterFirst = await pointsOf(customerA);
  assert.equal(afterFirst, before + OOGUCHI);

  const second = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  assert.equal(second.status, 409, "同じ申請を、2回承認できてしまいます");
  assert.equal(
    await pointsOf(customerA),
    afterFirst,
    "2回目の承認で、ポイントがもう一度足されています",
  );
});

/* ══════════════════════════════════════════════
   お金が動く操作には、追加の本人確認を求める
   ══════════════════════════════════════════════ */

test("追加の本人確認を通していなければ、承認できない（403）", async () => {
  const adjId = await makePending(boss1, customerA, OOGUCHI);
  const before = await pointsOf(customerA);

  /* 6桁を通していない人としてログインし直す */
  const notVerified = await login(tenantA, "boss2@alpha.example", {
    stepUp: false,
  });

  const res = await approvePost(
    post(APR_URL, notVerified, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as { code?: string };

  assert.equal(res.status, 403);
  assert.equal(
    body.code,
    "STEP_UP_REQUIRED",
    "お金が動く操作なのに、追加の本人確認を求めていません",
  );
  assert.equal(await pointsOf(customerA), before);

  /* あとの試験のために、通した状態へ戻す */
  boss2 = await login(tenantA, "boss2@alpha.example");
});

/* ══════════════════════════════════════════════
   別のサイトから踏ませる操作（CSRF）
   ══════════════════════════════════════════════ */

test("画面から送り返す合図が無ければ、承認できない（403）", async () => {
  const adjId = await makePending(boss1, customerA, OOGUCHI);
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }, { csrf: false }),
  );

  assert.equal(res.status, 403, "別のサイトに置かれたボタンで承認が通ります");
  assert.equal(await pointsOf(customerA), before);
});

/* ══════════════════════════════════════════════
   数字そのものの確かめ
   ══════════════════════════════════════════════ */

test("残高より多く引こうとしたら、断る", async () => {
  const now = await pointsOf(customerA);
  const adjId = await makePending(boss1, customerA, -(now + 1), "引きすぎの確認");

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as { code?: string };

  assert.equal(res.status, 409);
  assert.equal(body.code, "WOULD_GO_NEGATIVE");
  assert.equal(await pointsOf(customerA), now, "残高が負になっています");
});

test("0ポイントの申請と、理由の無い申請は受け付けない", async () => {
  const zero = await requestPost(
    post(REQ_URL, boss1, { userId: customerA, delta: 0, reason: "理由あり" }),
  );
  assert.equal(zero.status, 400);

  const noReason = await requestPost(
    post(REQ_URL, boss1, { userId: customerA, delta: 100, reason: "  " }),
  );
  assert.equal(noReason.status, 400);
});

/* ══════════════════════════════════════════════
   会社またぎ
   ══════════════════════════════════════════════ */

test("他社の申請は、番号を知っていても承認できない（404）", async () => {
  const adjId = await makePending(boss1, customerA, OOGUCHI);
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, bossB, { adjustmentId: adjId, approve: true }),
  );

  assert.equal(res.status, 404, "他社の申請を承認できてしまいます");
  assert.equal(await pointsOf(customerA), before);
});

test("他社のお客様への申請は、番号を知っていても出せない（404）", async () => {
  const res = await requestPost(
    post(REQ_URL, boss1, {
      userId: customerB,
      delta: 100,
      reason: "他社のお客様への申請",
    }),
  );
  assert.equal(res.status, 404, "他社のお客様のポイントを動かせてしまいます");
});

/* ══════════════════════════════════════════════
   記録が残っていること
   ══════════════════════════════════════════════ */

test("承認したときは、申請と承認が別々に監査ログへ残る", async () => {
  const adjId = await makePending(boss1, customerA, OOGUCHI, "監査ログの確認");
  await approvePost(post(APR_URL, boss2, { adjustmentId: adjId, approve: true }));

  const rows = await db().execute({
    sql: `SELECT action, actor_id, data FROM audit_events
           WHERE tenant_id = ? AND data LIKE ?
           ORDER BY seq ASC`,
    args: [tenantA, `%${adjId}%`],
  });

  const actions = rows.rows.map((r) =>
    String((r as Record<string, unknown>).action),
  );
  assert.deepEqual(
    actions,
    ["POINT_ADJUST_REQUEST", "POINT_ADJUST_APPROVE"],
    "申請と承認が、別々の行として残っていません",
  );

  /* ★申請者と承認者が別人であることを、記録だけで示せること。
       あとから「誰と誰が関わったか」を、画面なしで確かめられる形にします。 */
  const actors = rows.rows.map((r) =>
    String((r as Record<string, unknown>).actor_id),
  );
  assert.notEqual(
    actors[0],
    actors[1],
    "申請者と承認者が同じ人になっています",
  );
});

/* ══════════════════════════════════════════════
   承認を待つあいだに、残高が動いていた場合
   ══════════════════════════════════════════════ */

test("承認を待つあいだに残高が動いたら、いまの残高を基準に計算する", async () => {
  /*
   * ★これが、この試験でいちばん大事なところです。
   *
   *   申請したとき      100,000pt だった
   *   承認するまでの間に  80,000pt へ減った（お客様がガチャを引いた）
   *   そこで承認した
   *
   *   このとき「申請したときの100,000」を基準に書き戻すと、
   *   間に減った20,000ptが、なかったことになります。
   *   お客様は、使ったはずのポイントを取り戻します。
   *
   *   だから、承認の瞬間に残高をもう一度読み直して、
   *   そこへ変更量を足すこと。
   *   申請時の残高は「そのとき何を見て決めたか」の控えであって、
   *   計算には使いません。
   */
  const atRequest = await pointsOf(customerA);
  const adjId = await makePending(boss1, customerA, OOGUCHI, "待っているあいだに動く分");

  /* 承認を待つあいだに、別の処理で残高が減る */
  const genryou = 20_000;
  const wariko = await requestPost(
    post(REQ_URL, finance, {
      userId: customerA,
      delta: -genryou,
      reason: "あいだに入った別の処理",
    }),
  );
  assert.equal(wariko.status, 200);
  const atDecision = await pointsOf(customerA);
  assert.equal(
    atDecision,
    atRequest - genryou,
    "あいだの処理が入っていません。この試験の前提が崩れています",
  );

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as {
    ok: boolean;
    balance?: number;
    balanceBefore?: number;
    balanceAtDecision?: number;
    balanceMoved?: boolean;
  };
  assert.equal(res.status, 200, JSON.stringify(body));

  assert.equal(
    await pointsOf(customerA),
    atDecision + OOGUCHI,
    "申請したときの古い残高を、そのまま書き戻しています。" +
      "あいだに使われたポイントが、なかったことになります",
  );
  assert.equal(body.balance, atDecision + OOGUCHI);

  /* ★動いていたことを、承認した人に必ず伝えること */
  assert.equal(
    body.balanceMoved,
    true,
    "残高が動いていたのに、承認した人へ何も伝えていません",
  );
  assert.equal(body.balanceBefore, atRequest, "申請したときの残高の控えが違います");
  assert.equal(body.balanceAtDecision, atDecision);
});

test("残高が動いていなければ、動いたとは言わない", async () => {
  /* ★何もなくても毎回「動きました」と出すなら、警告として読まれなくなります */
  const adjId = await makePending(boss1, customerA, OOGUCHI, "あいだに何も起きない分");

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: true }),
  );
  const body = (await res.json()) as { balanceMoved?: boolean };
  assert.equal(res.status, 200);
  assert.equal(body.balanceMoved, false);
});

test("却下したときは、ポイントは動かず、却下の記録だけが残る", async () => {
  const adjId = await makePending(boss1, customerA, OOGUCHI, "却下される申請");
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: false, note: "根拠が不足" }),
  );
  const body = (await res.json()) as { status?: string };

  assert.equal(res.status, 200);
  assert.equal(body.status, "REJECTED");
  assert.equal(await pointsOf(customerA), before, "却下したのに残高が動いています");

  const rows = await db().execute({
    sql: `SELECT action FROM audit_events
           WHERE tenant_id = ? AND data LIKE ? ORDER BY seq ASC`,
    args: [tenantA, `%${adjId}%`],
  });
  const actions = rows.rows.map((r) =>
    String((r as Record<string, unknown>).action),
  );
  assert.deepEqual(actions, ["POINT_ADJUST_REQUEST", "POINT_ADJUST_REJECT"]);
});

test("却下にも理由が要る（空のまま却下できない）", async () => {
  /*
   * ★却下は、申請した人から見ると「断られた」という結果だけが残ります。
   *   理由が無いと、同じ申請がもう一度出てきます。
   *   断る側にも、必ず一言を書かせること。
   */
  const adjId = await makePending(boss1, customerA, OOGUCHI, "理由なしで却下される申請");
  const before = await pointsOf(customerA);

  const res = await approvePost(
    post(APR_URL, boss2, { adjustmentId: adjId, approve: false }),
  );
  const body = (await res.json()) as { code?: string };

  assert.equal(res.status, 400, "理由を書かないまま、却下できてしまいます");
  assert.equal(body.code, "REASON_REQUIRED");
  assert.equal(await pointsOf(customerA), before);

  /* 断られたままにせず、理由をつければ通ること */
  const ok = await approvePost(
    post(APR_URL, boss2, {
      adjustmentId: adjId,
      approve: false,
      note: "根拠となる問い合わせ番号がありません",
    }),
  );
  assert.equal(ok.status, 200);
});

/* ══════════════════════════════════════════════
   ログインしていない人
   ══════════════════════════════════════════════ */

test("A：ログインしていなければ、どちらの入口も断る（401）", async () => {
  const a = await requestPost(
    post(REQ_URL, null, { userId: customerA, delta: 100, reason: "誰でもない人" }),
  );
  assert.equal(a.status, 401);

  const b = await approvePost(
    post(APR_URL, null, { adjustmentId: "adj_dummy", approve: true }),
  );
  assert.equal(b.status, 401);
});

/* ══════════════════════════════════════════════
   標準は「全件二人承認」
   ══════════════════════════════════════════════

   ★ここが、この試験でいちばん大事なところです。

     1回あたりの金額で線を引く決まりは、回数で必ず抜けられます。
     境目が 100,000pt なら、99,999pt を10回に分けるだけで
     1人で 999,990pt を動かせます。
     だから、何も設定しなかった会社は
     「金額に関係なく、全件が二人承認」で始まります。

   ★この試験のあいだだけ、設定を外して素の状態に戻します。
     終わったら必ず戻します。戻さないと、
     このあとの試験が別の前提で走ってしまいます。 */

test("何も設定しなければ、境目は 0（＝全件が二人承認）", async () => {
  const moto = process.env.POINT_ADJUST_APPROVAL_THRESHOLD;
  try {
    delete process.env.POINT_ADJUST_APPROVAL_THRESHOLD;
    assert.equal(DEFAULT_FOUR_EYES_THRESHOLD, 0, "標準が 0 でなくなっています");
    assert.equal(fourEyesThreshold(), 0, "何も設定していないのに、境目があります");

    /* ★1pt でも承認待ちになること。ここが「全件」の意味です */
    const before = await pointsOf(customerA);
    const res = await requestPost(
      post(REQ_URL, boss1, {
        userId: customerA,
        delta: 1,
        reason: "たった1ptでも、ひとりでは動かせないこと",
      }),
    );
    const body = (await res.json()) as { status?: string; needsApproval?: boolean };

    assert.equal(res.status, 200);
    assert.equal(body.status, "PENDING", "1pt の調整が、ひとりで通ってしまいました");
    assert.equal(body.needsApproval, true);
    assert.equal(
      await pointsOf(customerA),
      before,
      "承認前なのに、残高が動いています",
    );
  } finally {
    if (moto === undefined) delete process.env.POINT_ADJUST_APPROVAL_THRESHOLD;
    else process.env.POINT_ADJUST_APPROVAL_THRESHOLD = moto;
  }
});

test("設定が読めない値なら、いちばん厳しい側（全件二人承認）に倒す", () => {
  const moto = process.env.POINT_ADJUST_APPROVAL_THRESHOLD;
  try {
    /*
     * ★読めない値を「制限なし」と受け取らないこと。
     *   設定を打ち間違えた日から、誰も気づかないまま
     *   全部の調整がひとりで通るようになります。
     */
    for (const warui of ["", "   ", "abc", "-5", "1e999", "NaN"]) {
      process.env.POINT_ADJUST_APPROVAL_THRESHOLD = warui;
      assert.equal(
        fourEyesThreshold(),
        0,
        `「${warui}」という設定が、素通りの側に倒れています`,
      );
    }

    /* 正しく設定したときは、その値になること */
    process.env.POINT_ADJUST_APPROVAL_THRESHOLD = "50000";
    assert.equal(fourEyesThreshold(), 50_000);
  } finally {
    if (moto === undefined) delete process.env.POINT_ADJUST_APPROVAL_THRESHOLD;
    else process.env.POINT_ADJUST_APPROVAL_THRESHOLD = moto;
  }
});
