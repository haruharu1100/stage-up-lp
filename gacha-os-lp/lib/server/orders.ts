/**
 * 注文（Order）。
 *
 * ═══════════════════════════════════════════════════════
 * ★注文とは何で、何ではないのか
 * ═══════════════════════════════════════════════════════
 *
 *   注文は「誰が・いつ・何を・いくらで買ったか」の記録です。
 *   確定したら、もう動きません。
 *
 *   「どこへ・どう送るか」は、注文ではありません。それは発送です。
 *   別のファイル（shipments.ts）に置いてあります。
 *
 *   この2つを1つの行にまとめたくなる気持ちは、よく分かります。
 *   最初はそのほうが短く書けます。ただし、次の日には破れます。
 *
 *       3点の依頼のうち、2点だけ先に送りたい
 *       残り1点は取り寄せで、来週になる
 *       送ったあと1点だけ破損が見つかり、送り直す
 *
 *   1行に「発送状態」を1つだけ持たせていると、この「2点だけ」が
 *   どうやっても書けません。書けない運用は、必ず画面の外へ逃げます。
 *   Excelとチャットで管理が始まり、システムは実態を知らなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルが守ること
 * ═══════════════════════════════════════════════════════
 *
 *   ① 品名は、注文した時点のものを写して持つ（item_name_snapshot）。
 *      商品マスターの名前を直したとき、
 *      去年の注文書の品名まで一緒に変わってはいけません。
 *
 *   ② 同じ景品から、2つの注文を立てられない。
 *      「発送を依頼する」を2回押されても、2件目は入りません。
 *      止めるのはDBの UNIQUE です。画面のボタンではありません。
 *
 *   ③ ポイントに交換済みの景品は、注文にできない。
 *      交換した時点でお金は払い終わっています。
 *      そこから現物も出したら、二重に払ったのと同じです。
 *
 *   ④ 注文の状態は、自分で書き換えない。明細から毎回計算する。
 *      2か所に「いまどこまで送ったか」を持つと、必ずずれます。
 *      ずれた瞬間、どちらが本当か誰にも分からなくなります。
 */

import type { Transaction } from "@libsql/client";
import { appendAuditTx } from "./audit";
import { withWriteTx, db } from "./db";
import { id } from "./ids";

/* ══════════════════════════════════════════════
   言葉の定義
   ══════════════════════════════════════════════ */

/** 注文全体の状態 */
export type OrderStatus =
  | "PENDING"
  | "PAID"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "CANCELLED";

/** 支払いの状態。ポイント交換だけで完結するものは POINT_ONLY */
export type PaymentStatus = "UNPAID" | "PAID" | "POINT_ONLY" | "REFUNDED";

/** 明細1行の状態 */
export type OrderItemStatus =
  | "UNSHIPPED"
  | "PARTIALLY_SHIPPED"
  | "SHIPPED"
  | "CANCELLED";

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING: "受付",
  PAID: "支払い済み",
  PARTIALLY_FULFILLED: "一部発送済み",
  FULFILLED: "発送完了",
  CANCELLED: "取消",
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  UNPAID: "未払い",
  PAID: "支払い済み",
  POINT_ONLY: "ポイント（支払いなし）",
  REFUNDED: "返金済み",
};

export const ORDER_ITEM_STATUS_LABEL: Record<OrderItemStatus, string> = {
  UNSHIPPED: "未発送",
  PARTIALLY_SHIPPED: "一部発送済み",
  SHIPPED: "発送済み",
  CANCELLED: "取消",
};

/** お届け先。発送のときに「写して」固定するもの */
export type AddressSnapshot = {
  name: string;
  zip: string;
  addr: string;
  tel: string;
};

/** 記録に残す「誰が」 */
export type Actor = {
  kind: "ADMIN" | "CUSTOMER" | "SYSTEM";
  id: string;
  name: string;
  role: string;
};

export type OrderErrorCode =
  | "NO_CUSTOMER"
  | "CUSTOMER_SUSPENDED"
  | "NO_PRIZE"
  | "PRIZE_NOT_AVAILABLE"
  | "EMPTY"
  | "NO_ORDER"
  | "ORDER_CANCELLED"
  | "ALREADY_ORDERED"
  | "NOT_CANCELLABLE"
  /**
   * お届け先が登録されていない。
   *
   * ★ここで止めること。
   *   宛先の無いまま依頼を受けると、気づくのは
   *   運営が箱を作ろうとした時か、伝票が真っ白で出てきた時です。
   *   その間、お客様の画面には「発送依頼済み」と出ています。
   *   待っているのに、誰も動けない時間が生まれます。
   */
  | "NO_ADDRESS";

export class OrderError extends Error {
  code: OrderErrorCode;
  constructor(code: OrderErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "OrderError";
  }
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");

/* ══════════════════════════════════════════════
   お届け先を読む
   ══════════════════════════════════════════════ */

/**
 * 会員情報の住所を、決まった形にして返す。
 *
 * ★住所が入っていない会員を、黙って通さないこと。
 *   宛先の無い発送を作ると、印刷の直前まで誰も気づきません。
 *   気づくのは、伝票が真っ白で出てきたときです。
 */
export function parseAddress(
  raw: unknown,
  fallbackName: string,
): AddressSnapshot | null {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;

  /* JSONで入っている場合（新しい形） */
  if (s.startsWith("{")) {
    try {
      const o = JSON.parse(s) as Record<string, unknown>;
      const addr = str(o.addr ?? o.address).trim();
      if (addr === "") return null;
      return {
        name: str(o.name).trim() || fallbackName,
        zip: str(o.zip).trim(),
        addr,
        tel: str(o.tel).trim(),
      };
    } catch {
      /* 壊れたJSONは、住所として扱わない。推測しないこと */
      return null;
    }
  }

  /* 古い形（1行の文字列）。名前と電話は分かりません。
     ★ここで適当な値を作らないこと。空のままにして、画面で「未登録」と出します */
  return { name: fallbackName, zip: "", addr: s, tel: "" };
}

/** お届け先を1行で読める文字にする（一覧・記録用） */
export function addressLine(a: AddressSnapshot): string {
  const zip = a.zip ? `〒${a.zip} ` : "";
  return `${zip}${a.addr}`;
}

/* ══════════════════════════════════════════════
   番号を採る
   ══════════════════════════════════════════════ */

/**
 * 人が読める番号を1つ採る（ORD-00001 / SHP-00001）。
 *
 * ★COUNT(*)+1 で作らないこと。
 *   1件消したら、次の番号が前の番号とぶつかります。
 *   ぶつかった番号は、電話口で必ず取り違えられます。
 */
export async function nextNumberTx(
  tx: Transaction,
  tenantId: string,
  kind: "ORDER" | "SHIPMENT",
): Promise<string> {
  const r = await tx.execute({
    sql: `INSERT INTO number_series (tenant_id, kind, next_no)
          VALUES (?, ?, 1)
          ON CONFLICT (tenant_id, kind)
          DO UPDATE SET next_no = next_no + 1
          RETURNING next_no`,
    args: [tenantId, kind],
  });
  const n = num((r.rows[0] as Row)?.next_no);
  const prefix = kind === "ORDER" ? "ORD" : "SHP";
  return `${prefix}-${String(n).padStart(5, "0")}`;
}

/* ══════════════════════════════════════════════
   注文の状態を、明細から計算し直す
   ══════════════════════════════════════════════ */

/**
 * 明細を見て、注文全体の状態を決め直す。
 *
 * ★「発送済みにしたら FULFILLED を書く」を、呼ぶ側に書かせないこと。
 *   発送・分割・取消の3か所に同じ判断を書くことになり、
 *   1か所直し忘れた日から、一覧の状態だけが嘘になります。
 */
export async function recomputeOrderStatusTx(
  tx: Transaction,
  tenantId: string,
  orderId: string,
  at: string,
): Promise<OrderStatus> {
  const cur = await tx.execute({
    sql: `SELECT order_status, payment_status FROM orders
           WHERE tenant_id = ? AND id = ?`,
    args: [tenantId, orderId],
  });
  const o = cur.rows[0] as Row | undefined;
  if (!o) throw new OrderError("NO_ORDER", "注文が見つかりません。");

  /* ★取消された注文を、明細から復活させないこと。
       取消は人の判断です。計算で覆してはいけません。 */
  if (str(o.order_status) === "CANCELLED") return "CANCELLED";

  const it = await tx.execute({
    sql: `SELECT status, quantity, shipped_quantity FROM order_items
           WHERE tenant_id = ? AND order_id = ?`,
    args: [tenantId, orderId],
  });
  const rows = it.rows as Row[];
  const live = rows.filter((r) => str(r.status) !== "CANCELLED");

  let next: OrderStatus;
  if (live.length === 0) {
    next = "CANCELLED";
  } else if (live.every((r) => num(r.shipped_quantity) >= num(r.quantity))) {
    next = "FULFILLED";
  } else if (live.some((r) => num(r.shipped_quantity) > 0)) {
    next = "PARTIALLY_FULFILLED";
  } else {
    next = str(o.payment_status) === "UNPAID" ? "PENDING" : "PAID";
  }

  await tx.execute({
    sql: `UPDATE orders SET order_status = ?, updated_at = ?
           WHERE tenant_id = ? AND id = ?`,
    args: [next, at, tenantId, orderId],
  });
  return next;
}

/* ══════════════════════════════════════════════
   注文を立てる
   ══════════════════════════════════════════════ */

export type OrderItemView = {
  id: string;
  prizeId: string | null;
  productId: string | null;
  name: string;
  quantity: number;
  unitValue: number;
  /** いま、どれかの発送に入っている数 */
  assignedQuantity: number;
  /** 実際に出荷が終わった数 */
  shippedQuantity: number;
  /** まだどの発送にも入っていない数 */
  unassignedQuantity: number;
  status: OrderItemStatus;
};

export type OrderView = {
  id: string;
  orderNumber: string;
  tenantId: string;
  userId: string;
  userName: string;
  orderedAt: string;
  orderType: string;
  subtotal: number;
  discount: number;
  pointUsed: number;
  total: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  updatedAt: string;
  items: OrderItemView[];
};

/**
 * 当たった景品について「発送してほしい」という注文を立てる。
 *
 * @param prizeIds まとめて依頼された景品。1件でも複数でもよい。
 */
export async function createShippingOrder(args: {
  tenantId: string;
  userId: string;
  prizeIds: string[];
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ orderId: string; orderNumber: string; auditSeq: number }> {
  const at = args.now ?? new Date().toISOString();

  if (args.prizeIds.length === 0) {
    throw new OrderError("EMPTY", "発送するものが選ばれていません。");
  }

  return withWriteTx(async (tx) => {
    /* ── ① お客様 ─────────────────────────────── */
    const cu = await tx.execute({
      sql: `SELECT id, name, status, address FROM customers
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    if (cu.rows.length === 0) {
      throw new OrderError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const user = cu.rows[0] as Row;
    if (str(user.status) !== "ACTIVE") {
      throw new OrderError(
        "CUSTOMER_SUSPENDED",
        "このアカウントは現在ご利用いただけません。",
      );
    }

    /* ── ①-2 依頼した時点のお届け先を、写して固定する ──────
         ★会員情報の住所を「あとで見る」形にしないこと。
           お客様は「この住所でお願いします」と押しています。
           押したあとに住所を変えると、
           確認した宛先と、実際に送る宛先が、静かに食い違います。

           住所を変えたときに効くのは、次の依頼からです。
           すでに出した依頼は、押したときの宛先のままにします。 */
    const shipTo = parseAddress(user.address, str(user.name));
    if (!shipTo) {
      throw new OrderError(
        "NO_ADDRESS",
        "お届け先が登録されていません。先にお届け先をご登録ください。",
      );
    }

    /* ── ② 景品を1つずつ確かめて、押さえる ─────────
         ★「読んでから、あとでまとめて更新する」をしないこと。
           読んでから更新するまでの間に、別の依頼が同じ景品を押さえます。
           確かめるのと押さえるのを、1つの命令にします。 */
    const items: {
      itemId: string;
      prizeId: string;
      name: string;
      value: number;
    }[] = [];

    for (const prizeId of args.prizeIds) {
      const pr = await tx.execute({
        sql: `SELECT id, name, value, status, user_id FROM prizes
               WHERE tenant_id = ? AND id = ?`,
        args: [args.tenantId, prizeId],
      });
      if (pr.rows.length === 0) {
        throw new OrderError("NO_PRIZE", "景品が見つかりません。");
      }
      const p = pr.rows[0] as Row;

      /* ★他人の景品を、注文に入れられないこと。
           IDを1つ書き換えるだけで他人の当選品を自分の住所へ送れる、
           という穴は、ここを飛ばすと本当に開きます。 */
      if (str(p.user_id) !== args.userId) {
        throw new OrderError("NO_PRIZE", "景品が見つかりません。");
      }

      /* UNCHOSEN のときだけ押さえる。
         すでに発送依頼済み・ポイント交換済みなら 0件で、ここで止まります。 */
      const claim = await tx.execute({
        sql: `UPDATE prizes SET status = 'SHIP_REQUESTED'
               WHERE tenant_id = ? AND id = ? AND user_id = ? AND status = 'UNCHOSEN'`,
        args: [args.tenantId, prizeId, args.userId],
      });
      if (Number(claim.rowsAffected) !== 1) {
        const now = str(p.status);
        throw new OrderError(
          "PRIZE_NOT_AVAILABLE",
          now === "EXCHANGED"
            ? `「${str(p.name)}」は、すでにポイントへ交換されています。発送はできません。`
            : `「${str(p.name)}」は、すでに発送のお手続きが済んでいます。`,
        );
      }

      items.push({
        itemId: id("oit"),
        prizeId,
        name: str(p.name),
        value: num(p.value),
      });
    }

    /* ── ③ 注文 ─────────────────────────────── */
    const orderId = id("ord");
    const orderNumber = await nextNumberTx(tx, args.tenantId, "ORDER");
    const subtotal = items.reduce((a, b) => a + b.value, 0);

    await tx.execute({
      sql: `INSERT INTO orders
              (id, tenant_id, user_id, order_number, ordered_at, order_type,
               subtotal, discount, point_used, total,
               payment_status, order_status, shipping_address_snapshot,
               created_at, updated_at)
            VALUES (?,?,?,?,?, 'PRIZE_SHIPPING', ?, 0, 0, 0, 'POINT_ONLY', 'PAID', ?, ?, ?)`,
      args: [
        orderId,
        args.tenantId,
        args.userId,
        orderNumber,
        at,
        subtotal,
        JSON.stringify(shipTo),
        at,
        at,
      ],
    });

    for (const it of items) {
      try {
        await tx.execute({
          sql: `INSERT INTO order_items
                  (id, tenant_id, order_id, prize_id, product_id,
                   item_name_snapshot, quantity, unit_value,
                   assigned_quantity, shipped_quantity, status, created_at, updated_at)
                VALUES (?,?,?,?,NULL,?,1,?,0,0,'UNSHIPPED',?,?)`,
          args: [
            it.itemId,
            args.tenantId,
            orderId,
            it.prizeId,
            it.name,
            it.value,
            at,
            at,
          ],
        });
      } catch (e) {
        /* ★UNIQUE に当たったということは、
             その景品はすでに別の注文に入っている、ということです。
             上の押さえと二重の守りになっています。 */
        if (/UNIQUE|constraint/i.test(String((e as Error)?.message ?? e))) {
          throw new OrderError(
            "ALREADY_ORDERED",
            `「${it.name}」は、すでに別のご注文に入っています。`,
          );
        }
        throw e;
      }
    }

    /* ── ④ 記録 ─────────────────────────────── */
    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "ORDER_CREATE",
      target: orderId,
      summary: `注文 ${orderNumber} を受け付けました（${items.length}点）。`,
      after: items.map((i) => i.name).join("、"),
      requestId: args.requestId,
      data: {
        orderId,
        orderNumber,
        userId: args.userId,
        userName: str(user.name),
        itemCount: items.length,
        subtotal,
        orderType: "PRIZE_SHIPPING",
        prizeIds: args.prizeIds.join(","),
        /* ★依頼した時点の宛先を、記録にも残すこと。
             あとで「宛先が違う」と言われたときに、
             お客様が押した時点の宛先を示せるのは、ここだけです。 */
        shipTo: addressLine(shipTo),
      },
    });

    return { orderId, orderNumber, auditSeq: audit.seq };
  });
}

/* ══════════════════════════════════════════════
   注文を取り消す
   ══════════════════════════════════════════════ */

/**
 * 注文を取り消す。
 *
 * ★もう1点でも出荷が終わっている注文は、取り消せません。
 *   取り消せるようにすると、帳簿の上では「無かったこと」になり、
 *   現物だけがお客様の手元にある、という状態が作れてしまいます。
 */
export async function cancelOrder(args: {
  tenantId: string;
  orderId: string;
  reason: string;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ auditSeq: number }> {
  const at = args.now ?? new Date().toISOString();

  return withWriteTx(async (tx) => {
    const or = await tx.execute({
      sql: `SELECT id, order_number, order_status FROM orders
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.orderId],
    });
    if (or.rows.length === 0) {
      throw new OrderError("NO_ORDER", "注文が見つかりません。");
    }
    const o = or.rows[0] as Row;
    if (str(o.order_status) === "CANCELLED") {
      throw new OrderError("ORDER_CANCELLED", "この注文は、すでに取り消されています。");
    }

    const shipped = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM order_items
             WHERE tenant_id = ? AND order_id = ? AND shipped_quantity > 0`,
      args: [args.tenantId, args.orderId],
    });
    if (num((shipped.rows[0] as Row).n) > 0) {
      throw new OrderError(
        "NOT_CANCELLABLE",
        "すでに発送が済んでいる商品があるため、この注文は取り消せません。返品の手続きをご案内してください。",
      );
    }

    /* 生きている発送があれば、先に外す */
    await tx.execute({
      sql: `UPDATE shipment_items SET released_at = ?
             WHERE tenant_id = ? AND order_id = ? AND released_at IS NULL`,
      args: [at, args.tenantId, args.orderId],
    });
    await tx.execute({
      sql: `UPDATE shipments
               SET shipment_status = 'CANCELLED', cancelled_at = ?, updated_at = ?
             WHERE tenant_id = ? AND order_id = ?
               AND shipment_status NOT IN ('SHIPPED','IN_TRANSIT','DELIVERED','CANCELLED')`,
      args: [at, at, args.tenantId, args.orderId],
    });

    /* 景品を、選び直せる状態に戻す */
    const its = await tx.execute({
      sql: `SELECT prize_id FROM order_items
             WHERE tenant_id = ? AND order_id = ? AND prize_id IS NOT NULL`,
      args: [args.tenantId, args.orderId],
    });
    for (const r of its.rows as Row[]) {
      await tx.execute({
        sql: `UPDATE prizes SET status = 'UNCHOSEN'
               WHERE tenant_id = ? AND id = ? AND status = 'SHIP_REQUESTED'`,
        args: [args.tenantId, str(r.prize_id)],
      });
    }

    await tx.execute({
      sql: `UPDATE order_items
               SET status = 'CANCELLED', assigned_quantity = 0, updated_at = ?
             WHERE tenant_id = ? AND order_id = ?`,
      args: [at, args.tenantId, args.orderId],
    });
    await tx.execute({
      sql: `UPDATE orders SET order_status = 'CANCELLED', updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [at, args.tenantId, args.orderId],
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "ORDER_CANCEL",
      target: args.orderId,
      summary: `注文 ${str(o.order_number)} を取り消しました。`,
      before: str(o.order_status),
      after: "CANCELLED",
      reason: args.reason,
      requestId: args.requestId,
      data: {
        orderId: args.orderId,
        orderNumber: str(o.order_number),
      },
    });

    return { auditSeq: audit.seq };
  });
}

/* ══════════════════════════════════════════════
   読む
   ══════════════════════════════════════════════ */

function toItemView(r: Row): OrderItemView {
  const quantity = num(r.quantity);
  const assigned = num(r.assigned_quantity);
  return {
    id: str(r.id),
    prizeId: r.prize_id == null ? null : str(r.prize_id),
    productId: r.product_id == null ? null : str(r.product_id),
    name: str(r.item_name_snapshot),
    quantity,
    unitValue: num(r.unit_value),
    assignedQuantity: assigned,
    shippedQuantity: num(r.shipped_quantity),
    unassignedQuantity: Math.max(0, quantity - assigned),
    status: str(r.status) as OrderItemStatus,
  };
}

/** 注文1件を、明細つきで読む */
export async function getOrder(
  tenantId: string,
  orderId: string,
): Promise<OrderView | null> {
  const or = await db().execute({
    sql: `SELECT o.*, c.name AS user_name
            FROM orders o
            LEFT JOIN customers c
              ON c.tenant_id = o.tenant_id AND c.id = o.user_id
           WHERE o.tenant_id = ? AND o.id = ?`,
    args: [tenantId, orderId],
  });
  const o = or.rows[0] as Row | undefined;
  if (!o) return null;

  const it = await db().execute({
    sql: `SELECT * FROM order_items
           WHERE tenant_id = ? AND order_id = ?
           ORDER BY created_at ASC, id ASC`,
    args: [tenantId, orderId],
  });

  return {
    id: str(o.id),
    orderNumber: str(o.order_number),
    tenantId: str(o.tenant_id),
    userId: str(o.user_id),
    userName: str(o.user_name),
    orderedAt: str(o.ordered_at),
    orderType: str(o.order_type),
    subtotal: num(o.subtotal),
    discount: num(o.discount),
    pointUsed: num(o.point_used),
    total: num(o.total),
    paymentStatus: str(o.payment_status) as PaymentStatus,
    orderStatus: str(o.order_status) as OrderStatus,
    updatedAt: str(o.updated_at),
    items: (it.rows as Row[]).map(toItemView),
  };
}

export type OrderListRow = {
  id: string;
  orderNumber: string;
  userId: string;
  userName: string;
  orderedAt: string;
  itemCount: number;
  itemNames: string;
  subtotal: number;
  paymentStatus: PaymentStatus;
  orderStatus: OrderStatus;
  shipmentCount: number;
};

/** 注文の一覧。新しい順 */
export async function listOrders(
  tenantId: string,
  opts: { status?: string; userId?: string; limit?: number } = {},
): Promise<{ rows: OrderListRow[]; total: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where: string[] = ["o.tenant_id = ?"];
  const args: (string | number)[] = [tenantId];
  if (opts.status) {
    where.push("o.order_status = ?");
    args.push(opts.status);
  }
  if (opts.userId) {
    where.push("o.user_id = ?");
    args.push(opts.userId);
  }
  const cond = where.join(" AND ");

  const r = await db().execute({
    sql: `SELECT o.id, o.order_number, o.user_id, o.ordered_at, o.subtotal,
                 o.payment_status, o.order_status,
                 c.name AS user_name,
                 (SELECT COUNT(*) FROM order_items i
                   WHERE i.tenant_id = o.tenant_id AND i.order_id = o.id) AS item_count,
                 (SELECT GROUP_CONCAT(i.item_name_snapshot, '、') FROM order_items i
                   WHERE i.tenant_id = o.tenant_id AND i.order_id = o.id) AS item_names,
                 (SELECT COUNT(*) FROM shipments s
                   WHERE s.tenant_id = o.tenant_id AND s.order_id = o.id
                     AND s.shipment_status <> 'CANCELLED') AS shipment_count
            FROM orders o
            LEFT JOIN customers c
              ON c.tenant_id = o.tenant_id AND c.id = o.user_id
           WHERE ${cond}
           ORDER BY o.ordered_at DESC, o.id DESC
           LIMIT ?`,
    args: [...args, limit],
  });

  const t = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM orders o WHERE ${cond}`,
    args,
  });

  return {
    rows: (r.rows as Row[]).map((o) => ({
      id: str(o.id),
      orderNumber: str(o.order_number),
      userId: str(o.user_id),
      userName: str(o.user_name),
      orderedAt: str(o.ordered_at),
      itemCount: num(o.item_count),
      itemNames: str(o.item_names),
      subtotal: num(o.subtotal),
      paymentStatus: str(o.payment_status) as PaymentStatus,
      orderStatus: str(o.order_status) as OrderStatus,
      shipmentCount: num(o.shipment_count),
    })),
    total: num((t.rows[0] as Row).n),
  };
}
