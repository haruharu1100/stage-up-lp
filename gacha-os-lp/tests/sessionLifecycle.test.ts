/**
 * ログインが「いつまで続き、いつ切れるか」の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを販売前に確かめるのか
 * ═══════════════════════════════════════════════════════
 *
 *   お店にとって、いちばん怖いのは「切れないログイン」です。
 *
 *   ノートパソコンを店に置いたまま帰った。
 *   共有パソコンからログインして、閉じずに帰った。
 *   このとき、次に触った人が管理画面に入れてしまうと、
 *   ポイントも会員情報も、そのまま見えます。
 *
 *   ですから、期限には2つあります。
 *
 *     ① 使っていなければ切れる期限（60分）
 *        …触るたびに、そこから60分に延びます。
 *
 *     ② 何をしても延びない期限（12時間）
 *        …これは絶対に延びません。
 *          延びる作りにすると、合言葉を盗んだ人が
 *          触り続けるだけで、永久にログインしたままになります。
 *
 *   ②が本当に延びないことを、ここで確かめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験を「短くして速くしよう」としないこと
 * ═══════════════════════════════════════════════════════
 *
 *   時間の試験は、待つのではなく、DBの日時を書き換えて進めます。
 *   本物の時計を待つと、12時間かかります。
 *   書き換えているのは、この試験の中で作った行だけです。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { db, resetDbForTests } from "../lib/server/db";
import {
  createSession,
  readSession,
  touchSession,
  rotateSession,
  destroySession,
  destroyAllSessionsOf,
  SESSION_IDLE_SECONDS,
  SESSION_ABSOLUTE_SECONDS,
} from "../lib/server/session";
import { createTenant } from "../lib/server/seed";

after(async () => {
  await resetDbForTests();
});

let tenantId = "";

test("下ごしらえ：会社を1つ作る", async () => {
  tenantId = await createTenant({ code: "SESS", name: "試験用の会社" });
  assert.ok(tenantId, "会社が作れていません");
});

/**
 * そのセッションの、いまの2つの期限をDBから読む。
 *
 * ★必ず id で引くこと。
 *   はじめ「いちばん新しい1件」で引いていたら、
 *   時計をずらした行が古い扱いになって、
 *   別の試験のセッションを読んでいました（2026-09-07）。
 */
async function kigen(sessionId: string) {
  const r = await db().execute({
    sql: `SELECT expires_at, absolute_expires_at
            FROM sessions WHERE id = ?`,
    args: [sessionId],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  assert.ok(row, "セッションが見つかりません");
  return {
    idle: Date.parse(String(row!.expires_at)),
    zettai: Date.parse(String(row!.absolute_expires_at)),
  };
}

/** そのセッションの日時を、まとめて「◯秒前のこと」にする */
async function susumeru(sessionId: string, byo: number) {
  const zurasu = (iso: string) =>
    new Date(Date.parse(iso) - byo * 1000).toISOString();
  const r = await db().execute({
    sql: `SELECT expires_at, absolute_expires_at, created_at
            FROM sessions WHERE id = ?`,
    args: [sessionId],
  });
  const row = r.rows[0] as Record<string, unknown>;
  await db().execute({
    sql: `UPDATE sessions
             SET expires_at = ?, absolute_expires_at = ?, created_at = ?
           WHERE id = ?`,
    args: [
      zurasu(String(row.expires_at)),
      zurasu(String(row.absolute_expires_at)),
      zurasu(String(row.created_at)),
      sessionId,
    ],
  });
}

/* ══════════════════════════════════════════════
   ① ふつうに続くこと
   ══════════════════════════════════════════════ */

test("① ログインしたあと、そのまま読める（毎回入れ直さない）", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-1",
  });

  const a = await readSession(s.token);
  assert.ok(a, "作った直後のセッションが読めません");
  assert.equal(a!.tenantId, tenantId, "別の会社になっています");

  /* 2回目も、同じように読めること（1回読んだら消える、では困ります） */
  const b = await readSession(s.token);
  assert.ok(b, "2回目が読めません（1回きりの合言葉になっています）");
});

test("① 使うと、使っていない期限のほうだけが延びる", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-2",
  });
  const mae = await kigen(s.sessionId);

  /* 30分ぶん、時計を進めたことにします */
  await susumeru(s.sessionId, 30 * 60);
  const naka = await kigen(s.sessionId);
  assert.ok(naka.idle < mae.idle, "時計を進められていません（試験の準備の失敗）");

  await touchSession(s.token);
  const ato = await kigen(s.sessionId);

  assert.ok(
    ato.idle > naka.idle,
    "使っても、期限が延びていません（60分ごとに追い出されます）",
  );
  assert.equal(
    ato.zettai,
    naka.zettai,
    "使ったら、延びないはずの期限まで延びました",
  );
});

/* ══════════════════════════════════════════════
   ② 切れること
   ══════════════════════════════════════════════ */

test("② 使わないまま置いておくと、切れる", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-3",
  });

  await susumeru(s.sessionId, SESSION_IDLE_SECONDS + 60);

  const a = await readSession(s.token);
  assert.equal(a, null, "使っていない期限を過ぎても、まだ入れます");
});

test("② 切れたセッションの行は、その場で消える（残さない）", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-4",
  });
  await susumeru(s.sessionId, SESSION_IDLE_SECONDS + 60);
  await readSession(s.token);

  const r = await db().execute({
    sql: `SELECT count(*) AS n FROM sessions WHERE id = ?`,
    args: [s.sessionId],
  });
  assert.equal(
    Number((r.rows[0] as Record<string, unknown>).n),
    0,
    "切れた行が残っています（積もり続けます）",
  );
});

/* ══════════════════════════════════════════════
   ③ ★延びないほうの期限が、本当に延びないこと
   ══════════════════════════════════════════════

   ここが、この試験でいちばん大事な所です。

   合言葉を盗まれたとき、最後の頼みが「12時間で必ず切れる」です。
   触り続ければ延びるなら、盗んだ人は永久に入れます。 */

test("③ 何度使っても、12時間の期限は1秒も延びない", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-5",
  });
  const hajime = (await kigen(s.sessionId)).zettai;

  for (let i = 0; i < 5; i += 1) {
    await touchSession(s.token);
    await readSession(s.token);
  }

  assert.equal(
    (await kigen(s.sessionId)).zettai,
    hajime,
    "使い続けたら、延びないはずの期限が延びました",
  );
});

test("③ 12時間を過ぎたら、直前まで使っていても切れる", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-6",
  });

  /* 12時間ぶん進めます。そのうえで「いま使った」ことにします。
     ★使ったのだから通る、では困ります。 */
  await susumeru(s.sessionId, SESSION_ABSOLUTE_SECONDS + 60);
  await touchSession(s.token);

  const a = await readSession(s.token);
  assert.equal(
    a,
    null,
    "12時間を過ぎても、使っていれば入れてしまいます",
  );
});

test("③ 合言葉を作り直しても、12時間の期限は先送りされない", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-7",
  });
  /* 3時間たったことにします。
     ★そのあいだ、ふつうに使っていた形にします（touchSession）。
       これをしないと、使っていない期限（60分）のほうで先に切れて、
       作り直しそのものができません。 */
  await susumeru(s.sessionId, 3 * 3600);
  await touchSession(s.token);

  /* ★基準は、時計を進めた「あと」に取ること。
       はじめ、進める前の値を基準にしていたら、
       期限が作り直しで元に戻っても、その差に気づけませんでした。
       つまり、何をしても通る試験になっていました（2026-09-07）。 */
  const hajime = (await kigen(s.sessionId)).zettai;

  const atarashii = await rotateSession(s.token);
  assert.ok(atarashii, "作り直せていません");

  const ato = (await kigen(atarashii!.sessionId)).zettai;

  /* ★ここが穴になりやすい所です。
       作り直し＝新しいセッションを作る、なので、
       何もしないと 12 時間が新しく始まります。
       そうなると、作り直しを繰り返すだけで永久に居座れます。 */
  assert.ok(
    ato <= hajime + 5_000,
    `作り直したら、期限が ${Math.round((ato - hajime) / 60_000)} 分ぶん先送りされました`,
  );
});

test("③ 作り直した瞬間、古い合言葉は使えない", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-8",
  });
  const atarashii = await rotateSession(s.token);
  assert.ok(atarashii, "作り直せていません");

  assert.equal(
    await readSession(s.token),
    null,
    "古い合言葉が、まだ使えます",
  );
  assert.ok(
    await readSession(atarashii!.token),
    "新しい合言葉が使えません",
  );
});

/* ══════════════════════════════════════════════
   ④ こちらから切れること
   ══════════════════════════════════════════════ */

test("④ ログアウトすると、その場で使えなくなる", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "CUSTOMER",
    subjectId: "cus-1",
  });
  await destroySession(s.token);
  assert.equal(await readSession(s.token), null, "ログアウトしても入れます");
});

test("④ 全部の端末を切ると、どの合言葉も使えなくなる", async () => {
  const a = await createSession({
    tenantId,
    subjectKind: "CUSTOMER",
    subjectId: "cus-2",
  });
  const b = await createSession({
    tenantId,
    subjectKind: "CUSTOMER",
    subjectId: "cus-2",
  });

  assert.ok(await readSession(a.token), "1台目が読めません");
  assert.ok(await readSession(b.token), "2台目が読めません");

  await destroyAllSessionsOf(tenantId, "cus-2");

  assert.equal(await readSession(a.token), null, "1台目が残っています");
  assert.equal(await readSession(b.token), null, "2台目が残っています");
});

test("④ 全部の端末を切っても、よその人のログインは切れない", async () => {
  const watashi = await createSession({
    tenantId,
    subjectKind: "CUSTOMER",
    subjectId: "cus-3",
  });
  const hoka = await createSession({
    tenantId,
    subjectKind: "CUSTOMER",
    subjectId: "cus-4",
  });

  await destroyAllSessionsOf(tenantId, "cus-3");

  assert.equal(await readSession(watashi.token), null, "自分が切れていません");
  assert.ok(
    await readSession(hoka.token),
    "よその方のログインまで切っています（全員が追い出されます）",
  );
});

/* ══════════════════════════════════════════════
   ⑤ 合言葉そのものの作り
   ══════════════════════════════════════════════ */

test("⑤ 合言葉は、そのままDBに入っていない", async () => {
  const s = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-9",
  });

  const r = await db().execute({
    sql: `SELECT token_hash, csrf_hash FROM sessions WHERE id = ?`,
    args: [s.sessionId],
  });
  const row = r.rows[0] as Record<string, unknown>;

  assert.notEqual(
    String(row.token_hash),
    s.token,
    "合言葉が、そのままDBに入っています（控えが漏れたら全員なりすませます）",
  );
  assert.notEqual(
    String(row.csrf_hash),
    s.csrfToken,
    "画面用の合図が、そのままDBに入っています",
  );
});

test("⑤ 2回作れば、毎回ちがう合言葉になる", async () => {
  const a = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-10",
  });
  const b = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: "adm-10",
  });
  assert.notEqual(a.token, b.token, "同じ合言葉が2回出ました");
  assert.notEqual(a.csrfToken, b.csrfToken, "同じ合図が2回出ました");
});

test("⑤ でたらめな合言葉では、入れない", async () => {
  for (const dame of ["", "abc", "0".repeat(64), "../../etc/passwd"]) {
    assert.equal(
      await readSession(dame),
      null,
      `でたらめな合言葉「${dame}」で入れてしまいます`,
    );
  }
});
