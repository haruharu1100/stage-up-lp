/**
 * DBが壊れたときに、「それらしい数字」を返してしまわないかの試験（点検項目26・27）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、わざと壊すのか
 * ═══════════════════════════════════════════════════════
 *
 *   ふつうの試験は「正しく動くか」を見ます。
 *   ここで見たいのは、その反対です。
 *
 *       ★壊れたときに、どちらへ倒れるか
 *
 *   DBが一瞬でも答えなかったとき、次の2つは、まったく違います。
 *
 *       ① 500 を返して止まる      → 運営者は「見えていない」と分かる
 *       ② 0件 と返して先へ進む    → 運営者は「片づいた」と思う
 *
 *   ②のほうが、画面はきれいです。エラーも出ません。
 *   だから、こちらのほうが良い作りに見えます。
 *
 *   けれども②は、
 *
 *       未発送 0件
 *
 *   と表示します。運営者は安心して画面を閉じます。
 *   本当は、数えられなかっただけです。
 *   荷物は、そのまま何日も置き去りになります。
 *
 *   ★数えられないことと、0であることは、別のことです。
 *     ここを同じにした瞬間、この管理画面は嘘をつき始めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★門番（guard）が、いちばん危ない場所
 * ═══════════════════════════════════════════════════════
 *
 *   門番は、毎回DBから役割を読み直します。
 *   このとき読めなかったら、どうするか。
 *
 *   「一瞬のことだろうから、とりあえず通しておこう」は、
 *   ★DBが不調な数分間、誰でも入れる状態を作ります。
 *   しかも記録には何も残りません（読めていないので）。
 *
 *   読めないなら、断る。ここは、いちばん厳しい側へ倒します。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験の作り方
 * ═══════════════════════════════════════════════════════
 *
 *   本物のDBを止めることはできないので、
 *   DBの窓口（execute）だけを、一時的にすげ替えます。
 *
 *     ・投げる    … 接続が切れた、テーブルが無い、など
 *     ・遅れる    … 相手が黙っている（timeout）
 *
 *   すげ替えたら、必ず元に戻します。
 *   戻し忘れると、このあとの試験が全部おかしくなります。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import { loginAdmin, setPassword } from "../lib/server/auth";
import { guard, passed } from "../lib/server/context";
import { SESSION_COOKIE } from "../lib/server/session";
import { createTenant, createAdmin } from "../lib/server/seed";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";
const ROOT = join(import.meta.dirname ?? __dirname, "..");

let tenantId = "";
let token = "";

test("準備：会社と、運営の担当者を1人つくる", async () => {
  tenantId = await createTenant({ code: "FINJECT", name: "こわし試験商会" });
  const adminId = await createAdmin({
    tenantId,
    no: 1,
    email: "unei@finject.example",
    name: "運営 担当",
    role: "OPERATOR",
  });
  await setPassword({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: adminId,
    password: PW,
  });

  const r = await loginAdmin({
    tenantId,
    email: "unei@finject.example",
    password: PW,
  });
  assert.equal(r.ok, true, "ログインできません");
  if (!r.ok) throw new Error("unreachable");
  token = r.session.token;
});

function req(path = "https://example.test/api/console/summary") {
  return new NextRequest(path, {
    method: "GET",
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

function status(g: unknown): number | null {
  return g && typeof g === "object" && "status" in g
    ? (g as { status: number }).status
    : null;
}

/**
 * DBの窓口を、一時的にすげ替える。
 *
 * ★必ず finally で戻すこと。
 *   戻し忘れると、このあとの試験が全部落ちます。
 *   そして原因が、この行ではなく、落ちた試験のほうに見えます。
 */
async function kowashite<T>(
  furumai: () => Promise<never>,
  shigoto: () => Promise<T>,
): Promise<T> {
  const c = db() as unknown as { execute: unknown };
  const moto = c.execute;
  c.execute = furumai;
  try {
    return await shigoto();
  } finally {
    c.execute = moto;
  }
}

const kireta = async (): Promise<never> => {
  throw new Error("SQLITE_CANTOPEN: unable to open database file");
};

const damatta = async (): Promise<never> => {
  /* 相手が黙っている状態。待たされたあげく、切られます */
  await new Promise((r) => setTimeout(r, 30));
  throw new Error("Request timed out after 30000ms");
};

test("前提：ふだんは、ちゃんと通る", async () => {
  const g = await guard(req(), { kind: "ADMIN", permission: "shipping.view" });
  assert.equal(status(g), null, "通るはずのものが断られました");
});

test("★DBが答えないとき、門番は通さない（接続が切れた場合）", async () => {
  const g = await kowashite(kireta, () =>
    guard(req(), { kind: "ADMIN", permission: "shipping.view" }),
  );
  const s = status(g);
  assert.notEqual(
    s,
    null,
    "DBが読めないのに通りました。DBが不調な間、誰でも入れる状態です",
  );
  assert.ok(
    s !== null && s >= 400,
    `断り方が 4xx/5xx ではありません（${s}）`,
  );
});

test("★DBが黙っているとき（timeout）も、門番は通さない", async () => {
  const g = await kowashite(damatta, () =>
    guard(req(), { kind: "ADMIN", permission: "shipping.view" }),
  );
  assert.notEqual(
    status(g),
    null,
    "返事が来ないのに通りました。「たぶん大丈夫」で通してはいけません",
  );
});

test("★DBが読めないとき、件数の入口は「0件」と答えない", async () => {
  const { GET } = await import("../app/api/console/summary/route");

  /**
   * ★ここが、この試験のいちばん大事なところです。
   *
   *   500 が返ること自体より、
   *   ★0 という数字が返らないこと が大事です。
   *
   *   0件 は「片づいた」と読まれます。
   *   読めなかっただけなのに、片づいたことにされます。
   */
  const res = await kowashite(kireta, () => GET(req()));
  assert.ok(
    res.status >= 400,
    `DBが読めないのに ${res.status} を返しました`,
  );

  const body = await res.text();
  assert.ok(
    !/"unshippedShipments"\s*:\s*0/.test(body),
    "未発送を 0件 と答えました。数えられていないのに「片づいた」と伝わります",
  );
  assert.ok(
    !/"unassignedItems"\s*:\s*0/.test(body),
    "箱待ちを 0点 と答えました",
  );
  assert.ok(
    !/"ordersTotal"\s*:\s*0/.test(body),
    "注文を 0件 と答えました",
  );
});

test("★DBが読めないとき、監査ログの検証は「問題なし」と答えない", async () => {
  const { GET } = await import("../app/api/console/audit/verify/route");

  /**
   * ★ここも同じです。
   *   「調べられなかった」を「問題なし」と出したら、
   *   改ざんを見逃したのと同じ結果になります。
   *   しかも「確かめた」という記憶だけが残るぶん、たちが悪いです。
   */
  const res = await kowashite(kireta, () =>
    GET(req("https://example.test/api/console/audit/verify")),
  );
  const body = await res.text();

  assert.ok(
    res.status >= 400 || !/"verified"\s*:\s*true/.test(body),
    "調べられていないのに「問題なし（verified: true）」と答えました",
  );
});

test("★件数を読む画面の道具が、失敗したときに 0 を持たせない", () => {
  /**
   * lib/console/liveCounts.ts は、画面が件数を読む道具です。
   *
   *   読めた   → { phase: "ok",  counts: {...} }
   *   読めない → { phase: "ng",  counts: null  }
   *
   * ★ng のときに counts を持たせないこと。
   *   持たせた瞬間、画面のどこかが、それを数字として出します。
   *   型の上で null にしておけば、出そうとした人の手が止まります。
   */
  const honbun = readFileSync(join(ROOT, "lib/console/liveCounts.ts"), "utf8");

  assert.ok(
    /phase:\s*"ng";\s*counts:\s*null/.test(honbun),
    "読めなかったときに counts が null でなくなっています",
  );
  assert.ok(
    !/phase:\s*"ng"[^}]*counts:\s*\{/.test(honbun),
    "読めなかったときに、数の入れ物を作っています",
  );
});
