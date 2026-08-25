/**
 * 会社・ガチャ・会員をDBに作る道具。
 *
 * ★ここは「箱の中身を作る唯一の場所」にすること。
 *   等級ごとの本数は lib/console/spec.ts の設計から出します。
 *   別の場所で本数を書くと、バックテストが確かめた箱と、
 *   実際に売っている箱が別物になります。
 *   そうなると、公開前の検証は何も保証しなくなります。
 */

import { poolOf } from "../console/draw";
import { db, migrate, withWriteTx } from "./db";
import { displayNo, id } from "./ids";

export async function createTenant(input: {
  code: string;
  name: string;
}): Promise<string> {
  await migrate();
  const tenantId = id("ten");
  await db().execute({
    sql: `INSERT INTO tenants (id, code, name, status, created_at)
          VALUES (?,?,?, 'ACTIVE', ?)`,
    args: [tenantId, input.code, input.name, new Date().toISOString()],
  });
  return tenantId;
}

export async function createCustomer(input: {
  tenantId: string;
  no: number;
  name: string;
  points: number;
  email?: string;
}): Promise<string> {
  await migrate();
  const customerId = id("cus");
  await db().execute({
    sql: `INSERT INTO customers
            (id, tenant_id, display_id, email, name, points, spent, status, created_at)
          VALUES (?,?,?,?,?,?,0,'ACTIVE',?)`,
    args: [
      customerId,
      input.tenantId,
      displayNo("GD", input.no),
      input.email ?? null,
      input.name,
      input.points,
      new Date().toISOString(),
    ],
  });
  return customerId;
}

/**
 * ガチャを1本作り、等級ごとの在庫も一緒に作る。
 *
 * ★在庫を作らずにガチャだけ作らないこと。
 *   在庫の行が無いと「まだ0本しか出ていない」と読めてしまい、
 *   本数の上限が効かなくなります。
 */
export async function createGacha(input: {
  tenantId: string;
  title: string;
  price: number;
  total: number;
  designedRtp: number;
  status?: "DRAFT" | "REVIEW" | "PUBLISHED" | "PAUSED" | "SOLD_OUT";
}): Promise<string> {
  await migrate();
  const gachaId = id("gac");
  const now = new Date().toISOString();
  const pool = poolOf(input.title, input.price, input.total, input.designedRtp);

  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: `INSERT INTO gachas
              (id, tenant_id, title, price, total, left_count, designed_rtp, status,
               revenue, paid_value, created_at)
            VALUES (?,?,?,?,?,?,?,?,0,0,?)`,
      args: [
        gachaId,
        input.tenantId,
        input.title,
        input.price,
        input.total,
        input.total,
        input.designedRtp,
        input.status ?? "PUBLISHED",
        now,
      ],
    });

    for (const p of pool) {
      await tx.execute({
        sql: `INSERT INTO gacha_stock
                (tenant_id, gacha_id, grade, name, value, total, drawn, reserved)
              VALUES (?,?,?,?,?,?,0,0)`,
        args: [
          input.tenantId,
          gachaId,
          p.grade,
          p.name,
          p.value,
          p.count,
        ],
      });
    }
  });

  return gachaId;
}

/* ══════════════════════════════════════════════
   ここから下は、会社ごとの切り分けを確かめるための道具。

   ★試験のためだけに、素の INSERT を書ける場所を
     ここ1か所にまとめています。
     画面やAPIからは呼ばないこと。
   ══════════════════════════════════════════════ */

/** 管理者を1人作る */
export async function createAdmin(input: {
  tenantId: string;
  no: number;
  email: string;
  name: string;
  role?: string;
  passwordHash?: string;
}): Promise<string> {
  await migrate();
  const adminId = id("usr");
  await db().execute({
    sql: `INSERT INTO app_users
            (id, tenant_id, display_id, email, name, role, password_hash,
             must_change_password, status, created_at)
          VALUES (?,?,?,?,?,?,?,0,'ACTIVE',?)`,
    args: [
      adminId,
      input.tenantId,
      displayNo("AD", input.no),
      input.email,
      input.name,
      input.role ?? "ADMIN",
      input.passwordHash ?? null,
      new Date().toISOString(),
    ],
  });
  return adminId;
}

/** 当たった景品を1件作る */
export async function createPrize(input: {
  tenantId: string;
  userId: string;
  gachaId: string;
  grade?: string;
  name?: string;
  value?: number;
  status?: string;
}): Promise<string> {
  await migrate();
  const prizeId = id("prz");
  await db().execute({
    sql: `INSERT INTO prizes
            (id, tenant_id, user_id, gacha_id, draw_id, grade, name, value,
             exchange_pt, status, won_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
    args: [
      prizeId,
      input.tenantId,
      input.userId,
      input.gachaId,
      id("drw"),
      input.grade ?? "A",
      input.name ?? "検証用の景品",
      input.value ?? 5000,
      Math.floor((input.value ?? 5000) * 0.7),
      input.status ?? "UNCHOSEN",
      new Date().toISOString(),
    ],
  });
  return prizeId;
}

/** 発送依頼を1件作る */
export async function createOrder(input: {
  tenantId: string;
  userId: string;
  prizeId: string;
  status?: string;
  address?: string;
}): Promise<string> {
  await migrate();
  const orderId = id("ord");
  const now = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO orders
            (id, tenant_id, user_id, prize_id, status, address, created_at, requested_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      orderId,
      input.tenantId,
      input.userId,
      input.prizeId,
      input.status ?? "REQUESTED",
      input.address ?? "検証用の住所（実在しません）",
      now,
      now,
    ],
  });
  return orderId;
}

/** 発送を1件作る */
export async function createShipment(input: {
  tenantId: string;
  orderId: string;
  status?: string;
}): Promise<string> {
  await migrate();
  const shipmentId = id("shp");
  await db().execute({
    sql: `INSERT INTO shipments
            (id, tenant_id, order_id, carrier, tracking_no, status, created_at)
          VALUES (?,?,?,?,?,?,?)`,
    args: [
      shipmentId,
      input.tenantId,
      input.orderId,
      "MOCK-CARRIER",
      null,
      input.status ?? "PREPARING",
      new Date().toISOString(),
    ],
  });
  return shipmentId;
}

/** 問い合わせを1件作る */
export async function createTicket(input: {
  tenantId: string;
  userId: string;
  subject?: string;
  body?: string;
  status?: string;
}): Promise<string> {
  await migrate();
  const ticketId = id("tkt");
  await db().execute({
    sql: `INSERT INTO support_tickets
            (id, tenant_id, user_id, subject, body, status, created_at)
          VALUES (?,?,?,?,?,?,?)`,
    args: [
      ticketId,
      input.tenantId,
      input.userId,
      input.subject ?? "検証用の問い合わせ",
      input.body ?? "これは試験用の本文です。",
      input.status ?? "OPEN",
      new Date().toISOString(),
    ],
  });
  return ticketId;
}
