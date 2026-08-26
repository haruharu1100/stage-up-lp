/**
 * 「分からないときは、通さない」の試験（fail closed）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この試験が要るのか（2026-08-26、公開先で見つかりました）
 * ═══════════════════════════════════════════════════════
 *
 *   門番（guard）は、担当者の役割を毎回DBから読み直します。
 *   ここまでは正しい作りです。
 *
 *   問題は、読めなかったときに何をしていたか、です。
 *
 *       const me  = res.rows[0];        // ← 行が無いと undefined
 *       role      = asRole(me?.role);   // ← asRole は「知らない値なら VIEWER」
 *
 *   asRole() は、画面に役職名を出すための道具です。
 *   「知らない値なら、いちばん弱い VIEWER にしておこう」は、
 *   表示の道具としては、まったく正しい考え方です。
 *
 *   ですが、門番がこれを使うと、意味が反転します。
 *
 *       行が読めない → 役割が分からない → ★VIEWER として通す
 *
 *   VIEWER は「見るだけ」ですが、見えるのは
 *   ガチャ・ポイント・発送・問い合わせ、つまり会社の中身ぜんぶです。
 *
 *   これが何を起こすか。
 *
 *       ・退職した担当者の行を消しても、手元のクッキーで読み続けられる
 *       ・別会社のセッションが紛れ込んでも、VIEWER として通る
 *       ・DBが一瞬答えなかっただけでも、同じことが起きる
 *
 *   3つ目がいちばん怖いところです。
 *   誰も操作していないのに、勝手に起きます。
 *
 *   ★「分からない」は「大丈夫」ではありません。
 *     読めないなら断る。ここを、いちばん厳しい側へ倒します。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験を消さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   直し方が「asRole を使わない」という地味なものなので、
 *   あとから読んだ人が「同じことでは？」と戻しかねません。
 *   同じではありません。戻した瞬間に、上の3つが復活します。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import { loginAdmin, setPassword } from "../lib/server/auth";
import { guard } from "../lib/server/context";
import { SESSION_COOKIE } from "../lib/server/session";
import { createTenant, createAdmin } from "../lib/server/seed";

after(async () => {
  await resetDbForTests();
});

const PW = "tadashii-aikotoba-2026";

let tenantId = "";
let adminId = "";
let token = "";

test("準備：会社と、運営の担当者を1人つくる", async () => {
  tenantId = await createTenant({ code: "FCLOSED", name: "フェイルクローズド商会" });
  adminId = await createAdmin({
    tenantId,
    no: 1,
    email: "unei@fclosed.example",
    name: "運営 担当",
    role: "OPERATOR",
  });
  await setPassword({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: adminId,
    password: PW,
  });

  const r = await loginAdmin({ tenantId, email: "unei@fclosed.example", password: PW });
  assert.equal(r.ok, true, "ログインできません");
  if (!r.ok) throw new Error("unreachable");
  token = r.session.token;
});

/** 入口を、画面を通さずに直接叩く */
function req() {
  return new NextRequest("https://example.test/api/console/summary", {
    method: "GET",
    headers: { cookie: `${SESSION_COOKIE}=${token}` },
  });
}

/** 断られたかどうか（guard は通れば ctx、断れば応答を返す） */
function status(g: unknown): number | null {
  return g && typeof g === "object" && "status" in g
    ? (g as { status: number }).status
    : null;
}

test("ふだんは通る（この試験の前提が正しいことを、先に見せる）", async () => {
  const g = await guard(req(), { kind: "ADMIN", permission: "shipping.view" });
  assert.equal(status(g), null, "通るはずのものが断られました");
  assert.equal((g as { role: string }).role, "OPERATOR");
});

test("★担当者の行が消えていたら、VIEWER 扱いで通さない", async () => {
  await db().execute({ sql: "DELETE FROM app_users WHERE id = ?", args: [adminId] });

  const g = await guard(req(), { kind: "ADMIN", permission: "shipping.view" });

  assert.equal(
    status(g),
    401,
    "行が無いのに通りました。asRole() の VIEWER 落ちが戻っています",
  );
});

test("★知らない役割が入っていたら、通さない", async () => {
  /* 消した行を、壊れた役割で戻します（移行の失敗・手直しのミスを想定） */
  await db().execute({
    sql: `INSERT INTO app_users
            (id, tenant_id, display_id, email, name, role,
             password_hash, password_salt, must_change_password, status, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      adminId,
      tenantId,
      "A-0001",
      "unei@fclosed.example",
      "運営 担当",
      "SUPAA_ADOMIN", /* 知らない役割 */
      "x",
      "y",
      0,
      "ACTIVE",
      new Date().toISOString(),
    ],
  });

  const g = await guard(req(), { kind: "ADMIN", permission: "shipping.view" });
  assert.equal(
    status(g),
    403,
    "知らない役割が VIEWER として通りました",
  );
});

test("★利用を止めた担当者は、開きっぱなしの画面でも通さない", async () => {
  await db().execute({
    sql: "UPDATE app_users SET role = 'OPERATOR', status = 'SUSPENDED' WHERE id = ?",
    args: [adminId],
  });

  const g = await guard(req(), { kind: "ADMIN", permission: "shipping.view" });
  assert.equal(
    status(g),
    403,
    "止めたのに、ログインし直すまで働けてしまいます",
  );
});

test("★締め出し中の担当者も、通さない", async () => {
  const ato = new Date(Date.now() + 30 * 60_000).toISOString();
  await db().execute({
    sql: "UPDATE app_users SET status = 'ACTIVE', locked_until = ? WHERE id = ?",
    args: [ato, adminId],
  });

  const g = await guard(req(), { kind: "ADMIN", permission: "shipping.view" });
  assert.equal(status(g), 403, "締め出し中なのに通りました");
});

test("締め出しが明けていれば、また通る（締め出しっぱなしにしない）", async () => {
  const mae = new Date(Date.now() - 30 * 60_000).toISOString();
  await db().execute({
    sql: "UPDATE app_users SET locked_until = ? WHERE id = ?",
    args: [mae, adminId],
  });

  const g = await guard(req(), { kind: "ADMIN", permission: "shipping.view" });
  assert.equal(status(g), null, "明けたのに通れません");
});

/**
 * ★ここは「書いてあること」を見張ります。
 *
 *   上の試験は、いま動いている門番の振る舞いを見ています。
 *   ですが、直し方の核心は「門番が asRole() を使わないこと」です。
 *   使うほうへ戻されても、たまたま行が読める限り、
 *   上の試験は全部通ってしまいます。
 *   だから、書いてあることそのものを見ます。
 */
test("★門番が asRole() を使っていないこと（弱い側へ倒れる道を残さない）", async () => {
  const { readFileSync } = await import("node:fs");
  const { join, dirname } = await import("node:path");
  const { fileURLToPath } = await import("node:url");
  const root = dirname(dirname(fileURLToPath(import.meta.url)));
  const src = readFileSync(join(root, "lib", "server", "context.ts"), "utf8");

  /* コメントを外してから見ます（説明文に asRole と書いてあるため） */
  const honbun = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  assert.ok(
    !/\basRole\s*\(/.test(honbun),
    "門番が asRole() を使っています。知らない値が VIEWER として通ります",
  );
  assert.ok(
    /status/.test(honbun) && /locked_until/.test(honbun),
    "門番が、担当者の状態（status / locked_until）を読み直していません",
  );
});
