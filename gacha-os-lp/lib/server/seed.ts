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
import type { TicketStatus } from "./ticketStatus";

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

/**
 * 会員を1人作る。
 *
 * ═══════════════════════════════════════════════
 * ★最初の残高も、必ず台帳に1行残すこと
 * ═══════════════════════════════════════════════
 *
 *   会員の行に残高だけ書いて、台帳（point_ledger）に何も残さないと、
 *   こうなります。
 *
 *       残高      486,061pt
 *       履歴の合計 −13,939pt
 *
 *   お客様のポイント画面は、この2つが合わないことを見つけて
 *   「履歴の合計と残高が一致していません」と赤く出します。
 *   これは正しい動きです。おかしいのは、
 *   最初の残高がどこから来たのか、どこにも書いていないことです。
 *
 *   ですので、開始時の残高も「開始時の残高」という1行にして
 *   台帳へ入れます。こうすると、残高は必ず履歴で説明できます。
 *
 *   ★この行を消して、代わりに画面側の照合をゆるめないこと。
 *     合わないものを合っていることにするのが、いちばん危ないです。
 */
export async function createCustomer(input: {
  tenantId: string;
  no: number;
  name: string;
  points: number;
  email?: string;
}): Promise<string> {
  await migrate();
  const customerId = id("cus");
  const now = new Date().toISOString();

  /* ★2つの書き込みは、まとめて1回で通すこと（batch）。
       会員の行だけ入って台帳の行が入らないと、
       その人の残高は、最初から説明できない数になります。

     ★ここで長く開く取引（transaction）を使わないこと。
       この関数は、同時に1000件を流す試験の下ごしらえでも呼ばれます。
       そこで取引を開け閉めすると、DBの部品（ネイティブ側）が
       終了処理の途中で異常終了することがありました（SIGSEGV）。
       中の試験は全部「ok」なのに、まとめだけ「失敗」と出る壊れ方です。
       batch は1回の呼び出しで、中身はまとめて確定します。 */
  const shori = [
    {
      /* ★お店が作った会員は、メール確認済みとして入れること。
           ═══════════════════════════════════════════════
           確認メールをお送りするのは、ご自分で登録された方
           （signup_source='SELF'）だけです。
           お店が名簿から作った会員には、送っていません。

           ここを未確認のまま入れると、その方は1回も引けません。
           しかも確認メールが届いていないので、
           ご自分では、どうやっても解除できません。

           ★M015 の最後にある「既存の会員を確認済みにする」行と、
             同じ考え方です。片方だけ直さないこと。 */
      sql: `INSERT INTO customers
              (id, tenant_id, display_id, email, name, points, spent, status, created_at,
               email_verified_at, signup_source)
            VALUES (?,?,?,?,?,?,0,'ACTIVE',?,?,'ADMIN')`,
      args: [
        customerId,
        input.tenantId,
        displayNo("GD", input.no),
        input.email ?? null,
        input.name,
        input.points,
        now,
        now,
      ],
    },
  ];

  /* 残高が0の人には、0の行を作りません。
     0 と 0 は、行が無くても一致します。 */
  if (input.points !== 0) {
    shori.push({
      sql: `INSERT INTO point_ledger
              (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
            VALUES (?,?,?, 'OPENING', ?, ?, NULL, ?)`,
      args: [
        id("pl"),
        input.tenantId,
        customerId,
        input.points,
        /* ★見出しと同じ言葉を、説明にも書かないこと。
             「開始時の残高／開始時の残高」と2行並ぶだけで、
             お客様は何も分かりません。 */
        "ご登録時点のポイント",
        now,
      ],
    });
  }

  for (const q of shori) await db().execute(q);

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
      /* ★ここの既定値に "ADMIN" と書かないこと。
           役割の一覧に "ADMIN" はありません（VIEWER／SUPPORT／OPERATOR／
           FINANCE／SECURITY／SUPER_ADMIN の6つです）。
           一覧に無い名前を入れると、ログインはできるのに
           画面のデータだけが 403 で出てこない、という直しにくい形で止まります。
           実際にこれで止まりました（2026-09-05）。
           分からないときは、いちばん権限の小さい VIEWER にします。 */
      input.role ?? "VIEWER",
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

/**
 * 注文を1件作る（明細つき）。
 *
 * ★注文だけを作って、明細を作らないこと。
 *   明細が無い注文は「頼まれた物が無い注文」です。
 *   発送側は明細を数えて残数を出しているので、
 *   そこが空だと、いきなり「全部発送済み」に見えます。
 */
export async function createOrder(input: {
  tenantId: string;
  userId: string;
  prizeId: string;
  itemName?: string;
  unitValue?: number;
  orderNumber?: string;
  paymentStatus?: string;
  orderStatus?: string;
}): Promise<string> {
  await migrate();
  const orderId = id("ord");
  const now = new Date().toISOString();
  const value = input.unitValue ?? 5000;

  await withWriteTx(async (tx) => {
    await tx.execute({
      sql: `INSERT INTO orders
              (id, tenant_id, user_id, order_number, ordered_at, order_type,
               subtotal, discount, point_used, total,
               payment_status, order_status, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,0,0,?,?,?,?,?)`,
      args: [
        orderId,
        input.tenantId,
        input.userId,
        input.orderNumber ?? `ORD-${orderId.slice(-8).toUpperCase()}`,
        now,
        "PRIZE_SHIPPING",
        value,
        value,
        input.paymentStatus ?? "POINT_ONLY",
        input.orderStatus ?? "PAID",
        now,
        now,
      ],
    });

    await tx.execute({
      sql: `INSERT INTO order_items
              (id, tenant_id, order_id, prize_id, product_id, item_name_snapshot,
               quantity, unit_value, assigned_quantity, shipped_quantity,
               status, created_at, updated_at)
            VALUES (?,?,?,?,NULL,?,1,?,0,0,'UNSHIPPED',?,?)`,
      args: [
        id("oit"),
        input.tenantId,
        orderId,
        input.prizeId,
        input.itemName ?? "検証用の景品",
        value,
        now,
        now,
      ],
    });
  });

  return orderId;
}

/**
 * 発送を1件作る（注文の明細をすべて入れる）。
 *
 * ★住所は、この時点の写しとして固定します。
 *   あとで会員が住所を変えても、この箱の宛先は動きません。
 */
export async function createShipment(input: {
  tenantId: string;
  orderId: string;
  status?: string;
  shipmentNumber?: string;
  address?: { name: string; zip: string; addr: string; tel: string };
}): Promise<string> {
  await migrate();
  const shipmentId = id("shp");
  const now = new Date().toISOString();
  const addr =
    input.address ?? {
      name: "検証用のお名前",
      zip: "000-0000",
      addr: "検証用の住所（実在しません）",
      tel: "000-0000-0000",
    };

  await withWriteTx(async (tx) => {
    const order = await tx.execute({
      sql: `SELECT user_id FROM orders WHERE tenant_id = ? AND id = ? LIMIT 1`,
      args: [input.tenantId, input.orderId],
    });
    const userId = String(
      (order.rows[0] as Record<string, unknown> | undefined)?.user_id ?? "",
    );

    await tx.execute({
      sql: `INSERT INTO shipments
              (id, tenant_id, order_id, user_id, shipment_number,
               shipping_address_snapshot, carrier, tracking_number,
               shipment_status, requested_at, packed_at, shipped_at,
               delivered_at, cancelled_at, note, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,NULL,?,?,NULL,NULL,NULL,NULL,NULL,?,?)`,
      args: [
        shipmentId,
        input.tenantId,
        input.orderId,
        userId,
        input.shipmentNumber ?? `SHP-${shipmentId.slice(-8).toUpperCase()}`,
        JSON.stringify(addr),
        "MOCK-CARRIER",
        input.status ?? "PREPARING",
        now,
        now,
        now,
      ],
    });

    const items = await tx.execute({
      sql: `SELECT id, item_name_snapshot FROM order_items
             WHERE tenant_id = ? AND order_id = ?`,
      args: [input.tenantId, input.orderId],
    });

    for (const r of items.rows as Record<string, unknown>[]) {
      await tx.execute({
        sql: `INSERT INTO shipment_items
                (id, tenant_id, shipment_id, order_id, order_item_id,
                 quantity, name_snapshot, created_at, released_at)
              VALUES (?,?,?,?,?,1,?,?,NULL)`,
        args: [
          id("sit"),
          input.tenantId,
          shipmentId,
          input.orderId,
          String(r.id ?? ""),
          String(r.item_name_snapshot ?? ""),
          now,
        ],
      });
      await tx.execute({
        sql: `UPDATE order_items
                 SET assigned_quantity = 1, updated_at = ?
               WHERE tenant_id = ? AND id = ?`,
        args: [now, input.tenantId, String(r.id ?? "")],
      });
    }
  });

  return shipmentId;
}

/**
 * 問い合わせを1件作る（検証用）。
 *
 * ★状態は lib/server/ticketStatus.ts の5つだけを受け取ること。
 *   ここで好きな文字を入れられるようにしておくと、
 *   「試験は通るのに、画面には出てこない問い合わせ」が作れてしまいます。
 */
export async function createTicket(input: {
  tenantId: string;
  userId: string;
  subject?: string;
  body?: string;
  status?: TicketStatus;
}): Promise<string> {
  await migrate();
  const ticketId = id("tkt");
  const now = new Date().toISOString();
  await db().execute({
    sql: `INSERT INTO support_tickets
            (id, tenant_id, user_id, subject, body, status,
             created_at, updated_at)
          VALUES (?,?,?,?,?,?,?,?)`,
    args: [
      ticketId,
      input.tenantId,
      input.userId,
      input.subject ?? "検証用の問い合わせ",
      input.body ?? "これは試験用の本文です。",
      input.status ?? "NEW",
      now,
      now,
    ],
  });
  return ticketId;
}
