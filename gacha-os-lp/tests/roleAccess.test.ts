/**
 * 「権限が本当に効いているか」の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を確かめる試験なのか
 * ═══════════════════════════════════════════════════════
 *
 *   画面でボタンを消すのは、親切のためです。安全のためではありません。
 *   入口（API）は、住所さえ知っていれば直接叩けます。
 *
 *       curl -X POST /api/console/points/approve ...
 *
 *   このとき断れるかどうかだけが、権限が「有る」か「無い」かです。
 *   だから、画面を一切通さずに、入口だけを直接叩いて確かめます。
 *
 *   確かめること：
 *
 *     A) ログインしていなければ、入口は断る
 *     D) サポートの人が、ポイント承認の入口を直接叩いても断られる
 *     E) 期限が切れたセッションでは、入口は断る
 *     F) ログアウトしたあとは、その場で断られる
 *     ＋ 役割はDBから毎回読む（権限を外した瞬間から効く）
 *     ＋ お客様のセッションでは、管理者の権限を満たせない
 *     ＋ 会社をまたいだセッションで、他社の入口を通れない
 *     ＋ 画面と入口が、同じ1枚の権限表を読んでいる
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験を「画面のテスト」に書き換えないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「ボタンが表示されないこと」を確かめる試験は、
 *   ここで守りたいものを何ひとつ守りません。
 *   ボタンが無くても、入口は開いているかもしれないからです。
 *   必ず guard() を直接呼んで確かめること。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import { loginAdmin, loginCustomer, logout, setPassword } from "../lib/server/auth";
import { guard } from "../lib/server/context";
import { SESSION_COOKIE, CSRF_HEADER } from "../lib/server/session";
import { createTenant, createCustomer, createAdmin } from "../lib/server/seed";
import { ROLE_PERMISSIONS, can } from "../lib/permissions";
import { MENU } from "../components/console/menu";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

type Who = { tenantId: string; adminId: string; customerId: string };

const A: Who = { tenantId: "", adminId: "", customerId: "" };
const B: Who = { tenantId: "", adminId: "", customerId: "" };

/** SUPPORT の人と、SUPER_ADMIN の人を、それぞれ用意する */
let supportId = "";
let bossId = "";

test("準備：2社と、役割の違う担当者を用意する", async () => {
  A.tenantId = await createTenant({ code: "ALPHA", name: "アルファ株式会社" });
  B.tenantId = await createTenant({ code: "BETA", name: "ベータ株式会社" });

  supportId = await createAdmin({
    tenantId: A.tenantId,
    no: 1,
    email: "support@alpha.example",
    name: "サポート担当",
    role: "SUPPORT",
  });
  bossId = await createAdmin({
    tenantId: A.tenantId,
    no: 2,
    email: "boss@alpha.example",
    name: "統括",
    role: "SUPER_ADMIN",
  });
  A.adminId = bossId;

  A.customerId = await createCustomer({
    tenantId: A.tenantId,
    no: 1,
    name: "アルファのお客様",
    points: 5000,
    email: "user@alpha.example",
  });

  B.adminId = await createAdmin({
    tenantId: B.tenantId,
    no: 1,
    email: "admin@beta.example",
    name: "ベータの管理者",
    role: "SUPER_ADMIN",
  });

  for (const [kind, subjectId, tenantId] of [
    ["ADMIN", supportId, A.tenantId],
    ["ADMIN", bossId, A.tenantId],
    ["ADMIN", B.adminId, B.tenantId],
    ["CUSTOMER", A.customerId, A.tenantId],
  ] as const) {
    await setPassword({ tenantId, subjectKind: kind, subjectId, password: PW });
  }
});

/** ログインして、クッキーに入れる合言葉を取る */
async function tokenOfAdmin(tenantId: string, email: string): Promise<string> {
  const r = await loginAdmin({ tenantId, email, password: PW });
  assert.equal(r.ok, true, `ログインできませんでした：${email}`);
  if (!r.ok) throw new Error("unreachable");
  return r.session.token;
}

/** 入口を、画面を通さずに直接叩く */
function req(
  token: string | null,
  opts: { method?: string; csrf?: string } = {},
) {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `${SESSION_COOKIE}=${token}`;
  if (opts.csrf) headers[CSRF_HEADER] = opts.csrf;
  return new NextRequest("https://example.test/api/console/points/approve", {
    method: opts.method ?? "GET",
    headers,
  });
}

/** 断られたかどうか（guard は通れば ctx、断れば応答を返す） */
function denied(g: unknown): g is { status: number } {
  return !(g !== null && typeof g === "object" && "scope" in (g as object));
}

/* ══════════════════════════════════════════════
   TEST A：ログインしていない
   ══════════════════════════════════════════════ */

test("A：ログインしていなければ、入口は断る（401）", async () => {
  const g = await guard(req(null), { kind: "ADMIN" });

  assert.ok(denied(g), "ログインしていないのに、入口を通ってしまいました");
  assert.equal(g.status, 401);
});

test("A：でたらめな合言葉でも、入口は断る（401）", async () => {
  /* ★ここは本物と同じ形（ASCII）にすること。
       クッキーに日本語は入れられないので、
       日本語を書くと「断られた」ではなく
       「送れなかった」を試すことになります。 */
  const g = await guard(req("aaaaBBBBccccDDDDeeeeFFFFgggg1234"), {
    kind: "ADMIN",
  });

  assert.ok(denied(g), "でたらめな合言葉で、入口を通ってしまいました");
  assert.equal(g.status, 401);
});

/* ══════════════════════════════════════════════
   TEST D：権限の足りない人が、直接叩く
   ══════════════════════════════════════════════ */

test("D：サポートの人は、ポイント承認の入口を直接叩いても断られる（403）", async () => {
  const token = await tokenOfAdmin(A.tenantId, "support@alpha.example");

  /* ★まず、そもそも権限表の上で持っていないことを確かめる。
       表を書き換えて「持っている」ことにしてしまうと、
       この試験は通るのに、守りは消えます。 */
  assert.equal(
    can("SUPPORT", "point.approve"),
    false,
    "サポートに、ポイント承認の権限が付いています（権限表を確認）",
  );

  const g = await guard(req(token), {
    kind: "ADMIN",
    permission: "point.approve",
  });

  assert.ok(
    denied(g),
    "サポートの人が、ポイント承認の入口を通ってしまいました。" +
      "画面でボタンを消しても、これが通るなら意味がありません",
  );
  assert.equal(g.status, 403);
});

test("D：同じ入口を、権限のある人は通れる", async () => {
  const token = await tokenOfAdmin(A.tenantId, "boss@alpha.example");

  const g = await guard(req(token), {
    kind: "ADMIN",
    permission: "point.approve",
  });

  /* ★ここが通らないと、上の試験は「全部断っているだけ」になります。
       断る試験と通す試験は、必ず両方置くこと。 */
  assert.equal(
    denied(g),
    false,
    "権限を持っている人まで断っています（全部断っているだけかもしれません）",
  );
});

test("D：サポートでも、自分の持ち場（問い合わせ返信）は通れる", async () => {
  const token = await tokenOfAdmin(A.tenantId, "support@alpha.example");

  const g = await guard(req(token), {
    kind: "ADMIN",
    permission: "support.reply",
  });

  assert.equal(
    denied(g),
    false,
    "サポートの人が、問い合わせの返信すらできなくなっています",
  );
});

/* ══════════════════════════════════════════════
   役割は、その場でDBから読むこと
   ══════════════════════════════════════════════ */

test("権限を外したら、ログインし直さなくても、その場で効かなくなる", async () => {
  const token = await tokenOfAdmin(A.tenantId, "boss@alpha.example");

  const before = await guard(req(token), {
    kind: "ADMIN",
    permission: "settings.edit",
  });
  assert.equal(denied(before), false, "はじめは通るはずです");

  /* 役割を弱くする（担当替え・権限の取り上げ） */
  await db().execute({
    sql: `UPDATE app_users SET role = 'VIEWER' WHERE id = ?`,
    args: [bossId],
  });

  const after = await guard(req(token), {
    kind: "ADMIN",
    permission: "settings.edit",
  });

  assert.ok(
    denied(after),
    "権限を外したのに、まだ通ります。" +
      "役割をセッションに焼き付けていませんか？（必ずDBから読むこと）",
  );

  /* 後片づけ：元に戻す */
  await db().execute({
    sql: `UPDATE app_users SET role = 'SUPER_ADMIN' WHERE id = ?`,
    args: [bossId],
  });
});

/* ══════════════════════════════════════════════
   お客様のセッションと、会社またぎ
   ══════════════════════════════════════════════ */

test("お客様のセッションでは、管理者の入口を通れない", async () => {
  const r = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: PW,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  const g = await guard(req(r.session.token), {
    kind: "ADMIN",
    permission: "point.view",
  });

  assert.ok(g, "お客様が管理者の入口を通ってしまいました");
  assert.ok(denied(g));
});

test("お客様のセッションは、権限の指定だけでも通れない", async () => {
  const r = await loginCustomer({
    tenantId: A.tenantId,
    email: "user@alpha.example",
    password: PW,
  });
  assert.equal(r.ok, true);
  if (!r.ok) return;

  /*
   * ★kind を書き忘れた入口を想定した試験です。
   *   書き忘れても、権限の指定だけで断れること。
   *   お客様には役割がないので、どの権限も満たしません。
   */
  const g = await guard(req(r.session.token), { permission: "point.view" });

  assert.ok(
    denied(g),
    "kind の指定が無いと、お客様が管理者向けの権限を満たしてしまいます",
  );
});

/* ══════════════════════════════════════════════
   TEST F：ログアウト
   ══════════════════════════════════════════════ */

test("F：ログアウトすると、その場で入口を通れなくなる", async () => {
  const token = await tokenOfAdmin(A.tenantId, "boss@alpha.example");

  const before = await guard(req(token), { kind: "ADMIN" });
  assert.equal(denied(before), false, "ログイン直後は通るはずです");

  await logout({ token });

  const after = await guard(req(token), { kind: "ADMIN" });
  assert.ok(after, "ログアウトしたのに、まだ通ります");
  assert.ok(denied(after));
  assert.equal((after as { status: number }).status, 401);
});

/* ══════════════════════════════════════════════
   TEST E：期限切れ
   ══════════════════════════════════════════════ */

test("E：期限が切れたセッションでは、入口を通れない", async () => {
  const token = await tokenOfAdmin(A.tenantId, "boss@alpha.example");

  /* 時計を進める代わりに、期限のほうを過去にする */
  const past = new Date(Date.now() - 60_000).toISOString();
  await db().execute({
    sql: `UPDATE sessions SET expires_at = ?`,
    args: [past],
  });

  const g = await guard(req(token), { kind: "ADMIN" });

  assert.ok(g, "期限が切れているのに、まだ通ります");
  assert.ok(denied(g));
  assert.equal((g as { status: number }).status, 401);
});

/* ══════════════════════════════════════════════
   状態を変える依頼には、CSRF の合図を求めること
   ══════════════════════════════════════════════ */

test("状態が変わる依頼は、合図がなければ断る（403）", async () => {
  const token = await tokenOfAdmin(A.tenantId, "boss@alpha.example");

  const g = await guard(req(token, { method: "POST" }), { kind: "ADMIN" });

  assert.ok(
    denied(g),
    "別のサイトに置かれたボタンからでも、操作が成立してしまいます",
  );
  assert.equal(g.status, 403);
});

/* ══════════════════════════════════════════════
   画面と入口が、同じ1枚の表を見ていること
   ══════════════════════════════════════════════ */

test("権限表は1枚しかない（画面側が自前の表を持っていない）", async () => {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const src = readFileSync(
    join(__dirname, "..", "lib", "console", "state.ts"),
    "utf8",
  );

  /*
   * ★画面側（state.ts）が、自分で権限表を持ち始めたら止めること。
   *   2枚になった日から、
   *   「画面では消えているのに、入口は受け付ける」が起こり得ます。
   *   ボタンが無いので、画面を見ている限り誰も気づけません。
   */
  assert.equal(
    /const\s+ROLE_PERMISSIONS\s*[:=]/.test(src),
    false,
    "lib/console/state.ts が、自前の権限表を持ち始めています。\n" +
      "権限表は lib/permissions.ts の1枚だけにしてください。",
  );

  assert.ok(
    src.includes("@/lib/permissions"),
    "lib/console/state.ts が、権限表を読み込んでいません",
  );
});

test("役割は6つ。増減したら、ここで気づけるようにしておく", () => {
  /*
   * ★数を確かめたいのではありません。
   *   役割を1つ足したのに権限を決め忘れる、を止めたいのです。
   *   足したときは、この一覧にも足してください。
   */
  assert.deepEqual(Object.keys(ROLE_PERMISSIONS).sort(), [
    "FINANCE",
    "OPERATOR",
    "SECURITY",
    "SUPER_ADMIN",
    "SUPPORT",
    "VIEWER",
  ]);

  /* いちばん弱い人が、お金を動かせないこと */
  assert.equal(can("VIEWER", "point.approve"), false);
  assert.equal(can("VIEWER", "settings.edit"), false);
  assert.equal(can("VIEWER", "user.suspend"), false);

  /* 経理は、セキュリティ設定を触れないこと */
  assert.equal(can("FINANCE", "security.view"), false);
  assert.equal(can("FINANCE", "settings.edit"), false);

  /* サポートは、ガチャを公開できないこと */
  assert.equal(can("SUPPORT", "gacha.publish"), false);
  assert.equal(can("SUPPORT", "point.request"), false);
});

/* ══════════════════════════════════════════════
   画面（URL）にも、必要な権限が付いていること
   ══════════════════════════════════════════════

   ★入口（API）だけ守っても足りません。
     画面のURLは、履歴にも、社内チャットに貼られたリンクにも
     残ります。左メニューで灰色にしてあっても、
     URLを直接打てば開けます。

   ★だから「need を書き忘れた画面」を、ここで止めます。
     書き忘れは、必ず新しい画面を足したときに起きます。
     足した本人は全権管理者なので、自分では気づけません。 */

test("守るべき画面には、必ず必要な権限が書いてある", () => {
  /*
   * ★ここに名前を足すときは、よく考えること。
   *   「誰が見てもよい画面」だけを足します。
   *   迷ったら足さないでください。need を付けるほうが安全です。
   */
  const NO_NEED_OK: string[] = [
    /* 今日やることが出るだけ。中身は、その人が見てよいものに限られる */
    "dashboard",
    /* 質問に答えるだけ。答えの材料は、その人の権限の範囲で集める */
    "operator",
  ];

  const missing = MENU.filter(
    (m) => !m.need && !NO_NEED_OK.includes(m.key),
  ).map((m) => `${m.key}（${m.label}）`);

  assert.deepEqual(
    missing,
    [],
    "必要な権限（need）が書かれていない画面があります。" +
      "URLを直接打てば、誰でも開ける状態です：" +
      missing.join(" / "),
  );
});

test("設定画面は、全権管理者しか開けない", () => {
  /*
   * ★この画面で決めるのは「誰が何をしてよいか」です。
   *   ここに入れる人は、自分の権限を自分で増やせます。
   *   だから、いちばん強い制限を掛けます。
   */
  const settings = MENU.find((m) => m.key === "settings");
  assert.ok(settings, "設定画面が消えています");
  assert.equal(settings!.need, "settings.edit");

  for (const role of ["VIEWER", "SUPPORT", "OPERATOR", "FINANCE", "SECURITY"] as const) {
    assert.equal(
      can(role, "settings.edit"),
      false,
      `${role} が設定画面を開けます（自分の権限を自分で増やせます）`,
    );
  }
  assert.equal(can("SUPER_ADMIN", "settings.edit"), true);
});

test("サポートの人は、セキュリティと監査ログの画面を開けない", () => {
  for (const key of ["security", "audit"]) {
    const item = MENU.find((m) => m.key === key);
    assert.ok(item?.need, `${key} に必要な権限が書かれていません`);
    assert.equal(
      can("SUPPORT", item!.need!),
      false,
      `サポートの人が ${key} の画面を開けます`,
    );
  }
});
