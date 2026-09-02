/**
 * 見学リンク（合言葉なしで「見るだけ」開く入口）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っているもの
 * ═══════════════════════════════════════════════════════
 *
 *   この入口は、合言葉を1つも聞かずに管理画面を開きます。
 *   便利な入口は、必ず「本番にも置いてほしい」と言われます。
 *   置いた瞬間、鍵のかかっていない裏口になります。
 *
 *   だから、次の3つを機械で毎回確かめます。
 *
 *     ① 本番では開かない（DEMO_MODE と 本番でないこと の両方が要る）
 *     ② 見学のセッションでは、状態が変わる依頼が1つも通らない
 *     ③ 見学の担当者には、合言葉では入れない
 *
 * ═══════════════════════════════════════════════════════
 * ★とくに大事な1本：合言葉を作り直しても、印が消えないこと
 * ═══════════════════════════════════════════════════════
 *
 *   セッションの合言葉は、途中で作り直されます（rotateSession）。
 *   このとき「見るだけ」の印を引き継ぎ忘れると、
 *   作り直した瞬間から、見学の方が何でも動かせるようになります。
 *
 *   ★しかも、その瞬間には何も起きません。
 *     画面はいつもどおりに見えます。誰も気づきません。
 *     気づけるのは、この試験だけです。消さないこと。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { NextRequest } from "next/server";
import { db, resetDbForTests } from "../lib/server/db";
import { guard } from "../lib/server/context";
import { loginAdmin, setPassword } from "../lib/server/auth";
import {
  SESSION_COOKIE,
  CSRF_HEADER,
  createSession,
  readSession,
  rotateSession,
} from "../lib/server/session";
import { createTenant, createAdmin, createCustomer } from "../lib/server/seed";
import { POST as drawPost } from "../app/api/console/draw/route";
import {
  KENGAKU_EMAIL,
  KENGAKU_TENANT_CODE,
  ensureKengakuUser,
  kengakuAllowed,
  startKengaku,
} from "../lib/server/kengaku";

after(async () => {
  await resetDbForTests();
});

/**
 * 環境変数を一時的に差し替えて試す。
 *
 * ★必ず元へ戻すこと。戻さないと、次の試験が
 *   「なぜか通る／なぜか落ちる」ようになり、原因が読めなくなります。
 */
async function withEnv(
  vars: Record<string, string | undefined>,
  fn: () => Promise<void> | void,
): Promise<void> {
  const before: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(vars)) {
    before[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    await fn();
  } finally {
    for (const [k, v] of Object.entries(before)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
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

/** 断られたか（guard は通れば ctx、断れば応答を返す） */
function isDenied(g: unknown): g is Response {
  return !(g !== null && typeof g === "object" && "scope" in (g as object));
}

/* ══════════════════════════════════════════════
   ① 本番では開かない
   ══════════════════════════════════════════════ */

test("DEMO_MODE が無ければ、見学の入口は開かない", async () => {
  await withEnv({ DEMO_MODE: undefined, VERCEL_ENV: undefined }, () => {
    assert.equal(kengakuAllowed(), false);
  });
});

test("DEMO_MODE=true でも、本番なら開かない（片方だけでは開かない）", async () => {
  await withEnv({ DEMO_MODE: "true", VERCEL_ENV: "production" }, () => {
    assert.equal(
      kengakuAllowed(),
      false,
      "本番で開いています。ここが開くと、鍵のかかっていない裏口になります。",
    );
  });
});

test("DEMO_MODE=true かつ 本番でなければ、開く", async () => {
  await withEnv({ DEMO_MODE: "true", VERCEL_ENV: "preview" }, () => {
    assert.equal(kengakuAllowed(), true);
  });
});

test("開いてよくない場所では、セッションを1つも作らない", async () => {
  await withEnv({ DEMO_MODE: undefined, VERCEL_ENV: undefined }, async () => {
    const r = await startKengaku();
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.equal(r.why, "NOT_ALLOWED");
  });
});

test("見本データの会社が無ければ、セッションを作らない", async () => {
  await withEnv({ DEMO_MODE: "true", VERCEL_ENV: "preview" }, async () => {
    const r = await startKengaku();
    assert.equal(r.ok, false);
    if (r.ok) throw new Error("unreachable");
    assert.equal(r.why, "NO_TENANT");
  });
});

/* ══════════════════════════════════════════════
   ここから先は、見本データの会社がある前提
   ══════════════════════════════════════════════ */

let demoTenantId = "";
let kengakuToken = "";
let kengakuCsrf = "";

test("準備：見本データの会社を用意して、見学を始める", async () => {
  demoTenantId = await createTenant({
    code: KENGAKU_TENANT_CODE,
    name: "見本データ株式会社",
  });

  await withEnv({ DEMO_MODE: "true", VERCEL_ENV: "preview" }, async () => {
    const r = await startKengaku("test-agent");
    assert.equal(r.ok, true);
    if (!r.ok) throw new Error("unreachable");
    kengakuToken = r.token;
    kengakuCsrf = r.csrfToken;
  });

  const s = await readSession(kengakuToken);
  assert.ok(s, "見学のセッションが読めません");
  assert.equal(s!.readOnly, true, "「見るだけ」の印が付いていません");
  assert.equal(s!.subjectKind, "ADMIN");
  assert.equal(s!.tenantId, demoTenantId);
});

test("見学の担当者は、いちばん強い役職で作られる（21画面すべてを見るため）", async () => {
  const r = await db().execute({
    sql: `SELECT role, password_hash, mfa_required, mfa_enabled, status
            FROM app_users WHERE tenant_id = ? AND lower(email) = ?`,
    args: [demoTenantId, KENGAKU_EMAIL],
  });
  const row = r.rows[0] as Record<string, unknown> | undefined;
  assert.ok(row, "見学の担当者が作られていません");
  assert.equal(String(row!.role), "SUPER_ADMIN");
  assert.equal(String(row!.status), "ACTIVE");
  assert.equal(row!.password_hash, null, "合言葉が設定されています");
});

/* ══════════════════════════════════════════════
   ② 見学のセッションでは、1つも動かせない
   ══════════════════════════════════════════════ */

test("見学のセッションでも、見るだけ（GET）は通る", async () => {
  const g = await guard(req(kengakuToken), {});
  assert.equal(
    isDenied(g),
    false,
    "見るだけの依頼まで断っています。これでは見学になりません。",
  );
});

test("見学のセッションは、状態が変わる依頼を1つも通さない", async () => {
  for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
    const g = await guard(req(kengakuToken, { method, csrf: kengakuCsrf }), {});
    assert.equal(isDenied(g), true, `${method} が通ってしまいました`);
    const res = g as Response;
    assert.equal(res.status, 403, `${method} の返し方が 403 ではありません`);
    const body = (await res.clone().json()) as { code?: string };
    assert.equal(body.code, "READ_ONLY", `${method} の理由が READ_ONLY ではありません`);
  }
});

test("いちばん強い役職を持っていても、印が付いていれば止まる", async () => {
  /* ★役職で止めているのではないことを、はっきりさせる試験。
       SUPER_ADMIN は、権限の表ではすべてを持っています。
       それでも、印のほうが勝つこと。 */
  const g = await guard(req(kengakuToken, { method: "POST", csrf: kengakuCsrf }), {
    kind: "ADMIN",
    permission: "point.approve",
  });
  assert.equal(isDenied(g), true);
  const body = (await (g as Response).clone().json()) as { code?: string };
  assert.equal(body.code, "READ_ONLY");
});

/* ══════════════════════════════════════════════
   ★合言葉を作り直しても、印が消えないこと
   ══════════════════════════════════════════════ */

test("合言葉を作り直しても、「見るだけ」の印は消えない", async () => {
  const again = await rotateSession(kengakuToken);
  assert.ok(again, "作り直せませんでした");

  const s = await readSession(again!.token);
  assert.ok(s);
  assert.equal(
    s!.readOnly,
    true,
    "作り直したら印が消えました。ここが消えると、誰も気づかないまま全部動かせます。",
  );

  const g = await guard(
    req(again!.token, { method: "POST", csrf: again!.csrfToken }),
    {},
  );
  assert.equal(isDenied(g), true);
  const body = (await (g as Response).clone().json()) as { code?: string };
  assert.equal(body.code, "READ_ONLY");

  kengakuToken = again!.token;
  kengakuCsrf = again!.csrfToken;
});

/* ══════════════════════════════════════════════
   ③ 見学の担当者には、合言葉では入れない
   ══════════════════════════════════════════════ */

test("見学の担当者に合言葉を付けても、次に呼ばれた時点で消える", async () => {
  const userId = await ensureKengakuUser(demoTenantId);

  /* わざと合言葉を設定してみる（管理画面から設定された状況の再現） */
  await setPassword({
    tenantId: demoTenantId,
    subjectKind: "ADMIN",
    subjectId: userId,
    password: "dareka-ga-tsuketa-aikotoba-2026",
  });

  const before = await loginAdmin({
    tenantId: demoTenantId,
    email: KENGAKU_EMAIL,
    password: "dareka-ga-tsuketa-aikotoba-2026",
  });
  assert.equal(before.ok, true, "前提が崩れています（合言葉が設定できていない）");

  /* ★あるべき状態へ戻す */
  await ensureKengakuUser(demoTenantId);

  const after2 = await loginAdmin({
    tenantId: demoTenantId,
    email: KENGAKU_EMAIL,
    password: "dareka-ga-tsuketa-aikotoba-2026",
  });
  assert.equal(
    after2.ok,
    false,
    "合言葉が生き残っています。この入口以外から、この人になれてしまいます。",
  );

  const r = await db().execute({
    sql: `SELECT password_hash, role FROM app_users
           WHERE tenant_id = ? AND lower(email) = ?`,
    args: [demoTenantId, KENGAKU_EMAIL],
  });
  const row = r.rows[0] as Record<string, unknown>;
  assert.equal(row.password_hash, null);
  assert.equal(String(row.role), "SUPER_ADMIN");
});

/* ══════════════════════════════════════════════
   ★門番を通っていない、ただ1つの入口（抽選）
   ══════════════════════════════════════════════ */

test("抽選の入口も、「見るだけ」のセッションは通さない", async () => {
  /* ★ここは lib/server/context.ts の門番を通っていません。
       ポイントが実際に減る唯一の入口なので、同じ判断を
       入口の側にも置いてあります。その1本を守る試験です。 */
  const customerId = await createCustomer({
    tenantId: demoTenantId,
    no: 1,
    name: "見学中のお客様",
    points: 10000,
    email: "kengaku-cus@demo.example",
  });

  const issued = await createSession({
    tenantId: demoTenantId,
    subjectKind: "CUSTOMER",
    subjectId: customerId,
    readOnly: true,
  });

  const res = await drawPost(
    new NextRequest("https://example.test/api/console/draw", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: `${SESSION_COOKIE}=${issued.token}`,
        "Idempotency-Key": "kengaku-test-key-0001",
      },
      body: JSON.stringify({ gachaId: "gac_dummy" }),
    }),
  );

  assert.equal(res.status, 403, "見学の方が抽選を引けてしまいます");
  const body = (await res.json()) as { code?: string };
  assert.equal(body.code, "READ_ONLY");
});

/* ══════════════════════════════════════════════
   ふつうのセッションは、これまでどおり動くこと
   ══════════════════════════════════════════════ */

test("ふつうのセッションには印が付かず、これまでどおり通る", async () => {
  const tenantId = await createTenant({ code: "NORMAL", name: "ふつう株式会社" });
  const adminId = await createAdmin({
    tenantId,
    no: 1,
    email: "boss@normal.example",
    name: "統括",
    role: "SUPER_ADMIN",
  });

  const issued = await createSession({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: adminId,
  });

  const s = await readSession(issued.token);
  assert.ok(s);
  assert.equal(
    s!.readOnly,
    false,
    "ふつうのセッションに印が付いています。これでは全員が何もできません。",
  );

  const g = await guard(
    req(issued.token, { method: "POST", csrf: issued.csrfToken }),
    { kind: "ADMIN" },
  );
  assert.equal(
    isDenied(g),
    false,
    "ふつうのセッションが断られました。見学の判断が全員に効いています。",
  );
});
