/**
 * 1つの商品を、端から端まで辿る。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これを別に作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   問い合わせは、いつも「1つのもの」から始まります。
 *
 *       「この追跡番号、まだ届かないんですけど」
 *       「8月20日に当たったカード、どうなりました？」
 *       「このポイント、何のぶんですか」
 *
 *   このとき担当者がやることは、毎回同じです。
 *   手元にある1つの手がかりから、前後をぜんぶ出す。
 *
 *       抽選 → 景品 → 注文 → 発送 → ポイント台帳 → 監査ログ
 *
 *   画面が分かれていると、この作業は「6つの画面を開いて、
 *   IDをコピーして貼る」になります。5分かかり、3回に1回間違えます。
 *   間違えた1回は、他人の注文を見ながら答えることになります。
 *
 * ★だから、どこから入っても同じ1本が出るようにします。
 *   逆から辿れることが大事です。
 *   追跡番号しか持っていないお客様に、
 *   「抽選IDを教えてください」とは言えません。
 *
 * ═══════════════════════════════════════════════════════
 * ★守ること
 * ═══════════════════════════════════════════════════════
 *
 *   ① どの問い合わせにも tenant_id を付ける。
 *      辿る道具は、他社のデータへ入り込む道具にもなります。
 *      1か所でも抜けると、そこが穴になります。
 *
 *   ② 見つからないときは、理由を分けない。
 *      「その番号はありません」と「他社のものです」を書き分けると、
 *      番号を順に試すだけで、他社に何件あるか数えられます。
 */

import { db } from "./db";
import {
  parseAddress,
  type AddressSnapshot,
  type OrderItemStatus,
  type OrderStatus,
} from "./orders";
import type { ShipmentStatus } from "./shipments";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");

/** どこから辿り始めるか */
export type TraceKey =
  | { kind: "prize"; id: string }
  | { kind: "draw"; id: string }
  | { kind: "order"; id: string }
  | { kind: "orderItem"; id: string }
  | { kind: "shipment"; id: string }
  | { kind: "tracking"; id: string }
  | { kind: "orderNumber"; id: string }
  | { kind: "shipmentNumber"; id: string };

export type TraceResult = {
  /** 何を手がかりに辿ったか */
  from: TraceKey;
  customer: { id: string; name: string } | null;
  draw: {
    id: string;
    gachaId: string;
    gachaTitle: string;
    at: string;
    playCount: number;
    price: number;
    pointBefore: number;
    pointAfter: number;
    grade: string;
    prizeName: string;
    prizeValue: number;
  } | null;
  prize: {
    id: string;
    name: string;
    grade: string;
    value: number;
    exchangePt: number;
    status: string;
    wonAt: string;
  } | null;
  order: {
    id: string;
    orderNumber: string;
    orderedAt: string;
    orderStatus: OrderStatus;
    paymentStatus: string;
    subtotal: number;
  } | null;
  orderItem: {
    id: string;
    name: string;
    quantity: number;
    assignedQuantity: number;
    shippedQuantity: number;
    status: OrderItemStatus;
  } | null;
  /** この明細が入った発送。取り消されたものも、外した時刻つきで出す */
  shipments: {
    id: string;
    shipmentNumber: string;
    status: ShipmentStatus;
    carrier: string | null;
    trackingNumber: string | null;
    address: AddressSnapshot | null;
    requestedAt: string;
    shippedAt: string | null;
    deliveredAt: string | null;
    /** この発送から外された時刻。null なら、いま入っている */
    releasedAt: string | null;
  }[];
  /** この抽選・この注文に関係するポイントの動き */
  pointLedger: {
    id: string;
    kind: string;
    delta: number;
    memo: string;
    ref: string | null;
    at: string;
  }[];
  /** 関係する監査ログ（新しい順） */
  audit: {
    seq: number;
    at: string;
    action: string;
    actorName: string;
    actorRole: string;
    summary: string;
    reason: string | null;
  }[];
};

/**
 * 手がかりを1つ受け取って、前後をぜんぶ出す。
 *
 * @returns 見つからなければ null（理由は分けない）
 */
export async function trace(
  tenantId: string,
  key: TraceKey,
): Promise<TraceResult | null> {
  const c = db();

  /* ── ① まず「注文明細」か「景品」まで降りる ─────────
       どこから入っても、この2つのどちらかに着けば、
       あとは同じ道を通れます。 */
  let prizeId: string | null = null;
  let orderItemId: string | null = null;
  let orderId: string | null = null;
  let shipmentId: string | null = null;
  let drawId: string | null = null;

  switch (key.kind) {
    case "prize":
      prizeId = key.id;
      break;

    case "draw": {
      const r = await c.execute({
        sql: `SELECT id, prize_id FROM draws WHERE tenant_id = ? AND id = ?`,
        args: [tenantId, key.id],
      });
      const d = r.rows[0] as Row | undefined;
      if (!d) return null;
      drawId = str(d.id);
      prizeId = d.prize_id == null ? null : str(d.prize_id);
      break;
    }

    case "order":
      orderId = key.id;
      break;

    case "orderNumber": {
      const r = await c.execute({
        sql: `SELECT id FROM orders WHERE tenant_id = ? AND order_number = ?`,
        args: [tenantId, key.id],
      });
      const o = r.rows[0] as Row | undefined;
      if (!o) return null;
      orderId = str(o.id);
      break;
    }

    case "orderItem":
      orderItemId = key.id;
      break;

    case "shipment":
      shipmentId = key.id;
      break;

    case "shipmentNumber": {
      const r = await c.execute({
        sql: `SELECT id FROM shipments WHERE tenant_id = ? AND shipment_number = ?`,
        args: [tenantId, key.id],
      });
      const s = r.rows[0] as Row | undefined;
      if (!s) return null;
      shipmentId = str(s.id);
      break;
    }

    case "tracking": {
      /* ★逆から辿る道。お客様が持っているのは、たいていこれだけです */
      const r = await c.execute({
        sql: `SELECT id FROM shipments
               WHERE tenant_id = ? AND tracking_number = ?
               ORDER BY created_at DESC LIMIT 1`,
        args: [tenantId, key.id],
      });
      const s = r.rows[0] as Row | undefined;
      if (!s) return null;
      shipmentId = str(s.id);
      break;
    }
  }

  /* 発送から入ったなら、中の最初の明細まで降りる */
  if (shipmentId && !orderItemId) {
    const r = await c.execute({
      sql: `SELECT order_item_id, order_id FROM shipment_items
             WHERE tenant_id = ? AND shipment_id = ?
             ORDER BY created_at ASC LIMIT 1`,
      args: [tenantId, shipmentId],
    });
    const si = r.rows[0] as Row | undefined;
    if (si) {
      orderItemId = str(si.order_item_id);
      orderId = str(si.order_id);
    } else {
      const so = await c.execute({
        sql: `SELECT order_id FROM shipments WHERE tenant_id = ? AND id = ?`,
        args: [tenantId, shipmentId],
      });
      const s = so.rows[0] as Row | undefined;
      if (!s) return null;
      orderId = str(s.order_id);
    }
  }

  /* 注文から入ったなら、最初の明細まで降りる */
  if (orderId && !orderItemId) {
    const r = await c.execute({
      sql: `SELECT id FROM order_items
             WHERE tenant_id = ? AND order_id = ?
             ORDER BY created_at ASC, id ASC LIMIT 1`,
      args: [tenantId, orderId],
    });
    const i = r.rows[0] as Row | undefined;
    if (i) orderItemId = str(i.id);
  }

  /* 景品から入ったなら、明細を探す（無い＝まだ注文になっていない） */
  if (prizeId && !orderItemId) {
    const r = await c.execute({
      sql: `SELECT id, order_id FROM order_items
             WHERE tenant_id = ? AND prize_id = ?`,
      args: [tenantId, prizeId],
    });
    const i = r.rows[0] as Row | undefined;
    if (i) {
      orderItemId = str(i.id);
      orderId = str(i.order_id);
    }
  }

  /* ── ② 明細から、景品と注文を確定させる ───────── */
  let orderItem: TraceResult["orderItem"] = null;
  if (orderItemId) {
    const r = await c.execute({
      sql: `SELECT * FROM order_items WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, orderItemId],
    });
    const i = r.rows[0] as Row | undefined;
    if (i) {
      orderId = str(i.order_id);
      if (!prizeId && i.prize_id != null) prizeId = str(i.prize_id);
      orderItem = {
        id: str(i.id),
        name: str(i.item_name_snapshot),
        quantity: num(i.quantity),
        assignedQuantity: num(i.assigned_quantity),
        shippedQuantity: num(i.shipped_quantity),
        status: str(i.status) as OrderItemStatus,
      };
    }
  }

  /* ── ③ 景品 → 抽選 ──────────────────────── */
  let prize: TraceResult["prize"] = null;
  let userId: string | null = null;

  if (prizeId) {
    const r = await c.execute({
      sql: `SELECT * FROM prizes WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, prizeId],
    });
    const p = r.rows[0] as Row | undefined;
    if (p) {
      userId = str(p.user_id);
      if (!drawId) drawId = str(p.draw_id);
      prize = {
        id: str(p.id),
        name: str(p.name),
        grade: str(p.grade),
        value: num(p.value),
        exchangePt: num(p.exchange_pt),
        status: str(p.status),
        wonAt: str(p.won_at),
      };
    }
  }

  /* 抽選IDが分からないときは、景品IDから逆に引く */
  let draw: TraceResult["draw"] = null;
  if (drawId || prizeId) {
    const r = drawId
      ? await c.execute({
          sql: `SELECT d.*, g.title AS gacha_title
                  FROM draws d
                  LEFT JOIN gachas g ON g.tenant_id = d.tenant_id AND g.id = d.gacha_id
                 WHERE d.tenant_id = ? AND d.id = ?`,
          args: [tenantId, drawId],
        })
      : await c.execute({
          sql: `SELECT d.*, g.title AS gacha_title
                  FROM draws d
                  LEFT JOIN gachas g ON g.tenant_id = d.tenant_id AND g.id = d.gacha_id
                 WHERE d.tenant_id = ? AND d.prize_id = ?`,
          args: [tenantId, prizeId as string],
        });
    const d = r.rows[0] as Row | undefined;
    if (d) {
      drawId = str(d.id);
      if (!userId) userId = str(d.user_id);
      draw = {
        id: str(d.id),
        gachaId: str(d.gacha_id),
        gachaTitle: str(d.gacha_title),
        at: str(d.created_at),
        playCount: num(d.play_count),
        price: num(d.price),
        pointBefore: num(d.point_before),
        pointAfter: num(d.point_after),
        grade: str(d.prize_rank),
        prizeName: str(d.prize_name),
        prizeValue: num(d.prize_value),
      };
    }
  }

  /* ── ④ 注文 ─────────────────────────────── */
  let order: TraceResult["order"] = null;
  if (orderId) {
    const r = await c.execute({
      sql: `SELECT * FROM orders WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, orderId],
    });
    const o = r.rows[0] as Row | undefined;
    if (o) {
      if (!userId) userId = str(o.user_id);
      order = {
        id: str(o.id),
        orderNumber: str(o.order_number),
        orderedAt: str(o.ordered_at),
        orderStatus: str(o.order_status) as OrderStatus,
        paymentStatus: str(o.payment_status),
        subtotal: num(o.subtotal),
      };
    }
  }

  /* 何ひとつ見つからなければ、見つからなかったということ */
  if (!prize && !order && !draw && !orderItem) return null;

  /* ── ⑤ 発送（取り消したものも出す） ───────────── */
  const shipments: TraceResult["shipments"] = [];
  if (orderItemId) {
    const r = await c.execute({
      sql: `SELECT s.*, si.released_at AS si_released_at
              FROM shipment_items si
              JOIN shipments s
                ON s.tenant_id = si.tenant_id AND s.id = si.shipment_id
             WHERE si.tenant_id = ? AND si.order_item_id = ?
             ORDER BY si.created_at ASC`,
      args: [tenantId, orderItemId],
    });
    for (const s of r.rows as Row[]) {
      shipments.push({
        id: str(s.id),
        shipmentNumber: str(s.shipment_number),
        status: str(s.shipment_status) as ShipmentStatus,
        carrier: s.carrier == null ? null : str(s.carrier),
        trackingNumber:
          s.tracking_number == null ? null : str(s.tracking_number),
        address: parseAddress(s.shipping_address_snapshot, ""),
        requestedAt: str(s.requested_at),
        shippedAt: s.shipped_at == null ? null : str(s.shipped_at),
        deliveredAt: s.delivered_at == null ? null : str(s.delivered_at),
        releasedAt: s.si_released_at == null ? null : str(s.si_released_at),
      });
    }
  }

  /* ── ⑥ ポイント台帳 ─────────────────────────
       ★抽選IDで引くこと。
         「同じ人の、近い時刻のもの」で引くと、
         たまたま隣り合った別の動きを、その注文のせいにします。 */
  const pointLedger: TraceResult["pointLedger"] = [];
  const refs = [drawId, prizeId, orderId].filter(Boolean) as string[];
  if (refs.length > 0) {
    const r = await c.execute({
      sql: `SELECT * FROM point_ledger
             WHERE tenant_id = ? AND ref IN (${refs.map(() => "?").join(",")})
             ORDER BY created_at ASC, id ASC`,
      args: [tenantId, ...refs],
    });
    for (const l of r.rows as Row[]) {
      pointLedger.push({
        id: str(l.id),
        kind: str(l.kind),
        delta: num(l.delta),
        memo: str(l.memo),
        ref: l.ref == null ? null : str(l.ref),
        at: str(l.created_at),
      });
    }
  }

  /* ── ⑦ 監査ログ ─────────────────────────────
       ★target で引くこと。
         この1本に関係する行だけを出します。
         人で引くと、その人の全部の操作が混ざります。 */
  const audit: TraceResult["audit"] = [];
  const targets = [
    drawId,
    prizeId,
    orderId,
    ...shipments.map((s) => s.id),
  ].filter(Boolean) as string[];

  if (targets.length > 0) {
    const uniq = Array.from(new Set(targets));
    const r = await c.execute({
      sql: `SELECT seq, at, action, actor_name, actor_role, summary, reason
              FROM audit_events
             WHERE tenant_id = ? AND target IN (${uniq.map(() => "?").join(",")})
             ORDER BY seq DESC`,
      args: [tenantId, ...uniq],
    });
    for (const a of r.rows as Row[]) {
      audit.push({
        seq: num(a.seq),
        at: str(a.at),
        action: str(a.action),
        actorName: str(a.actor_name),
        actorRole: str(a.actor_role),
        summary: str(a.summary),
        reason: a.reason == null ? null : str(a.reason),
      });
    }
  }

  /* ── ⑧ お客様 ─────────────────────────────── */
  let customer: TraceResult["customer"] = null;
  if (userId) {
    const r = await c.execute({
      sql: `SELECT id, name FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [tenantId, userId],
    });
    const u = r.rows[0] as Row | undefined;
    if (u) customer = { id: str(u.id), name: str(u.name) };
  }

  return {
    from: key,
    customer,
    draw,
    prize,
    order,
    orderItem,
    shipments,
    pointLedger,
    audit,
  };
}
