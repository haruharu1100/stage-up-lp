/**
 * 会社ごとの切り分け（TENANT ISOLATION）の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を確かめる試験なのか
 * ═══════════════════════════════════════════════════════
 *
 *   このシステムは、これから複数の会社に売ります。
 *   A社の管理者が、B社のものを1件でも見られたら、その時点で売れません。
 *
 *   ここで確かめるのは、次のことだけです。
 *
 *     1) A社の入れ物から、B社の会員・ガチャ・景品・発送依頼・発送・
 *        問い合わせ・管理者を、IDを直接指定しても取れない
 *     2) 取れないときの返り方が、「無いとき」と「他社のとき」で同じ
 *        （違うと、IDを順に試すだけで他社の件数が分かります）
 *     3) 一覧・件数・合計にも、他社のものが1件も混ざらない
 *     4) 会社の指定を空にして呼ぶと、その場で止まる
 *        （空のまま通ると、全社ぶんが見えてしまいます）
 *     5) 一覧に無い表の名前や、危ない並び順の指定は通らない
 *
 * ═══════════════════════════════════════════════════════
 * ★「見つかりません」を、どちらにも使う理由
 * ═══════════════════════════════════════════════════════
 *
 *   他社のIDを指定したときに「それは他社のものです」と返すと、
 *   中身は見えていなくても、そのIDが実在することを教えています。
 *   IDを順に試すだけで「B社には注文が何件あるか」が分かります。
 *
 *   だから、他社のものも・そもそも無いものも、
 *   まったく同じ失敗にします。この試験はそこを見ます。
 */

/* ★これを一番上に置くこと。接続先を使い捨てのファイルに固定する */
import "./helpers/testDb";

import test, { after } from "node:test";
import assert from "node:assert/strict";
import { resetDbForTests } from "../lib/server/db";
import {
  scopeFor,
  NotFoundError,
  NoTenantError,
  TENANT_TABLES,
  countAcrossAllTenants,
} from "../lib/server/tenant";
import {
  createTenant,
  createCustomer,
  createGacha,
  createAdmin,
  createPrize,
  createOrder,
  createShipment,
  createTicket,
} from "../lib/server/seed";

after(async () => {
  await resetDbForTests();
});

/** 会社を1社ぶん、ひととおり作る */
async function buildTenant(code: string, no: number) {
  const tenantId = await createTenant({ code, name: `${code}株式会社` });

  const adminId = await createAdmin({
    tenantId,
    no,
    email: `admin@${code.toLowerCase()}.example`,
    name: `${code}の管理者`,
  });

  const customerId = await createCustomer({
    tenantId,
    no,
    name: `${code}のお客様`,
    points: 10_000,
    email: `user@${code.toLowerCase()}.example`,
  });

  const gachaId = await createGacha({
    tenantId,
    title: `${code}のガチャ`,
    price: 500,
    total: 100,
    designedRtp: 0.9,
  });

  const prizeId = await createPrize({ tenantId, userId: customerId, gachaId });
  const orderId = await createOrder({ tenantId, userId: customerId, prizeId });
  const shipmentId = await createShipment({ tenantId, orderId });
  const ticketId = await createTicket({ tenantId, userId: customerId });

  return {
    tenantId,
    adminId,
    customerId,
    gachaId,
    prizeId,
    orderId,
    shipmentId,
    ticketId,
  };
}

/* 2社ぶん作って、A社の入れ物からB社を狙う */
let A: Awaited<ReturnType<typeof buildTenant>>;
let B: Awaited<ReturnType<typeof buildTenant>>;

test("下ごしらえ：A社とB社を、それぞれ一式そろえて作る", async () => {
  A = await buildTenant("ALPHA", 1);
  B = await buildTenant("BRAVO", 2);

  assert.notEqual(A.tenantId, B.tenantId);

  /* 自分の会社のものは、ちゃんと取れること。
     取れない状態で「他社が取れない」と言っても意味がありません。 */
  const a = scopeFor(A.tenantId);
  assert.ok(await a.get("customers", A.customerId));
  assert.ok(await a.get("gachas", A.gachaId));
  assert.ok(await a.get("prizes", A.prizeId));
  assert.ok(await a.get("orders", A.orderId));
  assert.ok(await a.get("shipments", A.shipmentId));
  assert.ok(await a.get("support_tickets", A.ticketId));
  assert.ok(await a.get("app_users", A.adminId));
});

test("A社の入れ物から、B社のIDを直接指定しても、1件も取れない", async () => {
  const a = scopeFor(A.tenantId);

  const targets: Array<[Parameters<typeof a.get>[0], string]> = [
    ["customers", B.customerId],
    ["app_users", B.adminId],
    ["gachas", B.gachaId],
    ["prizes", B.prizeId],
    ["orders", B.orderId],
    ["shipments", B.shipmentId],
    ["support_tickets", B.ticketId],
  ];

  for (const [table, foreignId] of targets) {
    assert.equal(
      await a.get(table, foreignId),
      null,
      `${table} で他社の行が取れてしまいました`,
    );
    assert.equal(
      await a.owns(table, foreignId),
      false,
      `${table} で他社の行を自社のものと判定しました`,
    );
  }
});

test("「無いID」と「他社のID」が、まったく同じ失敗になる（実在を教えない）", async () => {
  const a = scopeFor(A.tenantId);

  const shapeOf = async (targetId: string) => {
    try {
      await a.require("orders", targetId);
      return { threw: false, code: "", name: "", message: "" };
    } catch (e) {
      const err = e as NotFoundError;
      return {
        threw: true,
        code: err.code,
        name: err.name,
        message: err.message,
      };
    }
  };

  /* まったく存在しないID */
  const missing = await shapeOf("ord_this_id_does_not_exist_anywhere");
  /* 実在するが、B社のもの */
  const foreign = await shapeOf(B.orderId);

  assert.equal(missing.threw, true);
  assert.equal(foreign.threw, true);

  /* ★ここが本題。返り方が1文字でも違えば、そこから実在が読めます。 */
  assert.deepEqual(
    foreign,
    missing,
    "他社のIDと、無いIDで、失敗の返り方が違います",
  );
  assert.equal(foreign.code, "NOT_FOUND");
});

test("一覧・件数・合計に、他社のものが1件も混ざらない", async () => {
  const a = scopeFor(A.tenantId);
  const b = scopeFor(B.tenantId);

  /* 一覧 */
  const aCustomers = await a.list<{ id: string; tenant_id: string }>("customers");
  assert.equal(aCustomers.length, 1);
  assert.equal(aCustomers[0].id, A.customerId);
  for (const row of aCustomers) {
    assert.equal(row.tenant_id, A.tenantId);
  }

  /* 件数：会社ごとに1件ずつ。全社を数えれば2件になる */
  assert.equal(await a.count("orders"), 1);
  assert.equal(await b.count("orders"), 1);
  assert.equal(await countAcrossAllTenants("orders"), 2);

  /* 合計：A社のポイントだけを足す（B社ぶんが混ざれば2倍になる） */
  assert.equal(await a.sum("customers", "points"), 10_000);
  assert.equal(await b.sum("customers", "points"), 10_000);

  /* 条件つきの絞り込みでも、会社の壁は外れない */
  const found = await a.findOne("orders", "order_status = ?", ["PAID"]);
  assert.ok(found);
  assert.equal((found as { id: string }).id, A.orderId);

  const notFound = await a.findOne("orders", "id = ?", [B.orderId]);
  assert.equal(notFound, null, "条件で他社のIDを指定したら取れてしまいました");
});

test("追加の絞り込みを書いても、会社の指定を外して上書きできない", async () => {
  const a = scopeFor(A.tenantId);

  /* ★「1=1」や「OR」を混ぜて、会社の条件を無効にしようとする形。
       WHERE tenant_id = ? AND (…) の形なので、外側は外せません。 */
  const rows = await a.list("orders", {
    where: "1=1 OR tenant_id IS NOT NULL",
    args: [],
  });
  assert.equal(rows.length, 1, "追加条件で他社ぶんまで見えてしまいました");

  const rows2 = await a.list<{ tenant_id: string }>("customers", {
    where: "tenant_id = ?",
    args: [B.tenantId],
  });
  assert.equal(
    rows2.length,
    0,
    "追加条件で他社を指定したら、他社が見えてしまいました",
  );
});

test("会社の指定が空のまま呼ぶと、その場で止まる", () => {
  for (const bad of [undefined, null, "", "   "]) {
    assert.throws(
      () => scopeFor(bad as string | undefined | null),
      (e: unknown) => e instanceof NoTenantError && (e as NoTenantError).code === "NO_TENANT",
      `会社の指定が ${JSON.stringify(bad)} でも通ってしまいました`,
    );
  }
});

test("一覧に無い表の名前は、そもそも通らない", async () => {
  const a = scopeFor(A.tenantId);

  const badTables = [
    "tenants",
    "schema_migrations",
    "orders; DROP TABLE orders",
    "sqlite_master",
  ];

  for (const bad of badTables) {
    await assert.rejects(
      async () => a.list(bad as never),
      /会社ごとの一覧にありません/,
      `表「${bad}」が通ってしまいました`,
    );
  }
});

test("並び順の指定に、危ないものは通らない", async () => {
  const a = scopeFor(A.tenantId);

  /* まともな指定は通ること */
  await a.list("orders", { orderBy: "created_at DESC" });
  await a.list("orders", { orderBy: "order_status ASC, created_at DESC" });

  const bad = [
    "created_at; DROP TABLE orders",
    "(SELECT id FROM customers)",
    "1 UNION SELECT 1",
    "created_at --",
  ];

  for (const raw of bad) {
    await assert.rejects(
      async () => a.list("orders", { orderBy: raw }),
      /並び順の指定が正しくありません/,
      `並び順「${raw}」が通ってしまいました`,
    );
  }
});

test("合計を出す列の名前に、危ないものは通らない", async () => {
  const a = scopeFor(A.tenantId);

  await a.sum("customers", "points"); /* まともな指定は通る */

  for (const raw of ["points) FROM customers --", "points; DROP TABLE x", "*"]) {
    await assert.rejects(
      async () => a.sum("customers", raw),
      /列の名前が正しくありません/,
      `列「${raw}」が通ってしまいました`,
    );
  }
});

test("会社ごとに分かれる表が、すべて一覧に載っている（書き忘れの見張り）", async () => {
  /* ★新しい表を足したとき、TENANT_TABLES へ足し忘れると、
       その表だけ会社の壁が無いまま運用されます。
       DBの実物を見て、tenant_id を持つ表が全部載っているか確かめます。 */
  const { db, migrate } = await import("../lib/server/db");
  await migrate();

  const tables = await db().execute(
    `SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`,
  );

  const missing: string[] = [];
  for (const row of tables.rows) {
    const name = String((row as Record<string, unknown>).name);
    const info = await db().execute(`PRAGMA table_info(${name})`);
    const hasTenant = info.rows.some(
      (c) => String((c as Record<string, unknown>).name) === "tenant_id",
    );
    if (hasTenant && !(TENANT_TABLES as readonly string[]).includes(name)) {
      missing.push(name);
    }
  }

  assert.deepEqual(
    missing,
    [],
    `tenant_id を持つのに TENANT_TABLES に無い表があります: ${missing.join(", ")}\n` +
      "  lib/server/tenant.ts の TENANT_TABLES に足してください。",
  );
});
