/**
 * 発送（Shipment）。
 *
 * ═══════════════════════════════════════════════════════
 * ★注文と、どこが違うのか
 * ═══════════════════════════════════════════════════════
 *
 *   注文は「何を買ったか」。確定したら動きません。
 *   発送は「どこへ・どう送るか」。1つの注文から、何度でも立ちます。
 *
 *       注文A（商品1・商品2・商品3）
 *          ├─ 発送1（商品1・商品2）  ← 今日出す
 *          └─ 発送2（商品3）          ← 取り寄せ後、来週出す
 *
 *   だから発送は、注文の「状態欄」ではありません。別の実体です。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルが、絶対に破らせないこと
 * ═══════════════════════════════════════════════════════
 *
 *   ① 同じ明細を、2つの発送へ入れられない。
 *
 *      止めるのは shipment_items の
 *          UNIQUE (tenant_id, order_item_id) WHERE released_at IS NULL
 *      です。画面のボタンではありません。
 *
 *      ボタンで守ろうとすると、二重クリック・再読み込み・2枚のタブ・
 *      直接の通信で、必ずすり抜けます。すり抜けた結果は、
 *      「同じ商品が2箱届いた」という形で、お客様から知らされます。
 *
 *   ② 宛先は、発送を作った時点のものを「写して」持つ。
 *
 *      会員情報の住所を参照にすると、お客様が引っ越した瞬間に、
 *      すでに箱に貼った送り状と、画面の宛先が食い違います。
 *      調査するとき、画面には新しい住所しか残っていません。
 *      「どこへ送ったのか」が、システムのどこにも無い状態になります。
 *
 *   ③ 出荷が済んだ発送の宛先は、もう変えられない。
 *
 *      変えられる作りにすると、記録の意味が消えます。
 *      出したあとで宛先を書き換えれば、
 *      どこへ送ったかを、後から自由に言い換えられます。
 *
 *   ④ 取り消した発送の商品は、また送れる状態へ戻る。
 *
 *      ただし、shipment_items の行は消しません。
 *      消すと「一度この発送に入っていた」という事実まで消えます。
 *      released_at（外した時刻）を入れて、鍵だけを空けます。
 */

import { appendAuditTx } from "./audit";
import { withWriteTx, db } from "./db";
import { id } from "./ids";
import { notifyTx } from "./notify";
import {
  addressLine,
  nextNumberTx,
  parseAddress,
  recomputeOrderStatusTx,
  type Actor,
  type AddressSnapshot,
} from "./orders";

/* ══════════════════════════════════════════════
   言葉の定義
   ══════════════════════════════════════════════ */

export type ShipmentStatus =
  | "REQUESTED"
  | "PREPARING"
  | "READY"
  | "SHIPPED"
  | "IN_TRANSIT"
  | "DELIVERED"
  | "CANCELLED";

export const SHIPMENT_STATUS_LABEL: Record<ShipmentStatus, string> = {
  REQUESTED: "依頼受付",
  PREPARING: "準備中",
  READY: "発送待ち",
  SHIPPED: "発送済み",
  IN_TRANSIT: "配送中",
  DELIVERED: "配達完了",
  CANCELLED: "取消",
};

/** お客様に見せるときの言い方（管理用語をそのまま出さない） */
export const SHIPMENT_STATUS_CUSTOMER_LABEL: Record<ShipmentStatus, string> = {
  REQUESTED: "発送準備中",
  PREPARING: "発送準備中",
  READY: "発送準備中",
  SHIPPED: "発送済み",
  IN_TRANSIT: "配送中",
  DELIVERED: "配達完了",
  CANCELLED: "取消",
};

/** まだ手を動かす必要がある状態（未発送として数えるもの） */
export const SHIPMENT_TODO: ShipmentStatus[] = [
  "REQUESTED",
  "PREPARING",
  "READY",
];

/** 出荷が済んだあと。ここから先は、宛先も中身も変えられない */
const SHIPPED_OR_LATER: ShipmentStatus[] = ["SHIPPED", "IN_TRANSIT", "DELIVERED"];

/**
 * 進んでよい順路。
 *
 * ★どこからでもどこへでも飛べる作りにしないこと。
 *   「配達完了」から「準備中」へ戻せる仕組みは、
 *   事故の隠蔽に、そのまま使えてしまいます。
 */
const NEXT_OK: Record<ShipmentStatus, ShipmentStatus[]> = {
  REQUESTED: ["PREPARING", "CANCELLED"],
  PREPARING: ["READY", "CANCELLED"],
  READY: ["SHIPPED", "CANCELLED"],
  SHIPPED: ["IN_TRANSIT", "DELIVERED"],
  IN_TRANSIT: ["DELIVERED"],
  DELIVERED: [],
  CANCELLED: [],
};

export type ShipmentErrorCode =
  | "NO_ORDER"
  | "ORDER_CANCELLED"
  | "NO_SHIPMENT"
  | "NO_ADDRESS"
  | "EMPTY"
  | "ITEM_NOT_IN_ORDER"
  | "ALREADY_ASSIGNED"
  | "ALREADY_SHIPPED"
  | "ITEM_CANCELLED"
  | "ALREADY_TRACKED"
  | "TRACKING_IN_USE"
  | "TOO_LATE"
  | "BAD_TRANSITION"
  | "NEED_TRACKING";

export class ShipmentError extends Error {
  code: ShipmentErrorCode;
  constructor(code: ShipmentErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "ShipmentError";
  }
}

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");

function isUnique(e: unknown): boolean {
  return /UNIQUE|constraint failed/i.test(String((e as Error)?.message ?? e));
}

/* ══════════════════════════════════════════════
   発送を作る（＝分割発送の本体）
   ══════════════════════════════════════════════ */

/**
 * 注文の中から商品を選んで、発送を1件作る。
 *
 * 全部を選べば1回で終わり、一部だけ選べば分割発送になります。
 * つまり「分割発送」という特別な処理はありません。
 * ★特別扱いを作らないこと。作った瞬間、
 *   通常発送と分割発送で、守りの強さが2種類になります。
 */
export async function createShipment(args: {
  tenantId: string;
  orderId: string;
  orderItemIds: string[];
  actor: Actor;
  requestId: string;
  carrier?: string | null;
  note?: string | null;
  now?: string;
}): Promise<{
  shipmentId: string;
  shipmentNumber: string;
  isSplit: boolean;
  auditSeq: number;
}> {
  const at = args.now ?? new Date().toISOString();

  if (args.orderItemIds.length === 0) {
    throw new ShipmentError("EMPTY", "発送する商品が選ばれていません。");
  }

  /* 同じ明細を2回書かれても、1回として扱う */
  const wanted = Array.from(new Set(args.orderItemIds));

  return withWriteTx(async (tx) => {
    /* ── ① 注文 ─────────────────────────────── */
    const or = await tx.execute({
      sql: `SELECT id, order_number, user_id, order_status,
                   shipping_address_snapshot
              FROM orders WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.orderId],
    });
    if (or.rows.length === 0) {
      throw new ShipmentError("NO_ORDER", "注文が見つかりません。");
    }
    const o = or.rows[0] as Row;
    if (str(o.order_status) === "CANCELLED") {
      throw new ShipmentError(
        "ORDER_CANCELLED",
        "この注文は取り消されています。発送はできません。",
      );
    }
    const userId = str(o.user_id);

    /* ── ② 宛先を写す ─────────────────────────
         ★ここが住所snapshotの本体です。
           以後、この発送は会員情報の住所を二度と見ません。

         ★写す元は、まず「注文」にすること。
           注文には、お客様が発送を依頼した時点の宛先が入っています。
           お客様は、その宛先を見て「この住所でお願いします」と押しました。

           ここで会員情報を先に見ると、依頼のあとに住所が変わっていた場合、
           お客様が確認していない宛先へ送ることになります。
           乗っ取られた場合は、まさにそれが狙われます。

           古い注文（この仕組みより前に立ったもの）には写しがありません。
           そのときだけ、会員情報の住所を使います。 */
    const cu = await tx.execute({
      sql: `SELECT id, name, address FROM customers
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, userId],
    });
    const c = cu.rows[0] as Row | undefined;
    const addr =
      parseAddress(o.shipping_address_snapshot, str(c?.name)) ??
      parseAddress(c?.address, str(c?.name));
    if (!addr) {
      throw new ShipmentError(
        "NO_ADDRESS",
        "お届け先が登録されていません。先に住所をご確認ください。",
      );
    }

    /* ── ③ 選ばれた明細を、1つずつ押さえる ───────── */
    const picked: { itemId: string; name: string }[] = [];

    for (const itemId of wanted) {
      const ir = await tx.execute({
        sql: `SELECT id, item_name_snapshot, quantity, assigned_quantity,
                     shipped_quantity, status
                FROM order_items
               WHERE tenant_id = ? AND order_id = ? AND id = ?`,
        args: [args.tenantId, args.orderId, itemId],
      });
      if (ir.rows.length === 0) {
        /* ★他の注文の明細を混ぜられないこと。
             注文をまたいだ発送は、宛先が2つになります。 */
        throw new ShipmentError(
          "ITEM_NOT_IN_ORDER",
          "この注文に含まれていない商品が選ばれています。",
        );
      }
      const i = ir.rows[0] as Row;
      const st = str(i.status);
      const name = str(i.item_name_snapshot);

      if (st === "CANCELLED") {
        throw new ShipmentError(
          "ITEM_CANCELLED",
          `「${name}」は取り消されています。発送できません。`,
        );
      }
      if (num(i.shipped_quantity) >= num(i.quantity)) {
        throw new ShipmentError(
          "ALREADY_SHIPPED",
          `「${name}」は、すでに発送が済んでいます。二重には送りません。`,
        );
      }
      if (num(i.assigned_quantity) >= num(i.quantity)) {
        throw new ShipmentError(
          "ALREADY_ASSIGNED",
          `「${name}」は、すでに別の発送に入っています。二重には送りません。`,
        );
      }

      picked.push({ itemId, name });
    }

    /* ── ④ 分割かどうか ─────────────────────────
         ★「2件目以降かどうか」だけで決めないこと。
           3点の注文に対して、2点だけ入れた1件目の箱は、
           それ自体がもう分割の始まりです。
           2件目が作られるまで分割と呼ばないと、
           記録の上では「普通の発送」として残ります。
           あとで「なぜ1点足りないのか」を調べる人は、
           分割の記録を探しますが、そこには何もありません。

           分割と呼ぶのは、次のどちらかに当てはまるときです。
             ・すでにこの注文の箱がある（2件目以降）
             ・この箱に入れても、まだ残る商品がある */
    const before = await tx.execute({
      sql: `SELECT COUNT(*) AS n FROM shipments
             WHERE tenant_id = ? AND order_id = ? AND shipment_status <> 'CANCELLED'`,
      args: [args.tenantId, args.orderId],
    });
    const hasEarlier = num((before.rows[0] as Row).n) > 0;

    const rest = await tx.execute({
      sql: `SELECT COALESCE(SUM(quantity - assigned_quantity), 0) AS n
              FROM order_items
             WHERE tenant_id = ? AND order_id = ? AND status <> 'CANCELLED'`,
      args: [args.tenantId, args.orderId],
    });
    /* この時点ではまだ割当を増やしていないので、
       今回入れるぶんを引いた数が「この箱のあとに残る数」です */
    const nokoru = num((rest.rows[0] as Row).n) - picked.length;

    const isSplit = hasEarlier || nokoru > 0;

    /* ── ⑤ 発送 ─────────────────────────────── */
    const shipmentId = id("shp");
    const shipmentNumber = await nextNumberTx(tx, args.tenantId, "SHIPMENT");

    await tx.execute({
      sql: `INSERT INTO shipments
              (id, tenant_id, order_id, user_id, shipment_number,
               shipping_address_snapshot, carrier, tracking_number,
               shipment_status, requested_at, note, created_at, updated_at)
            VALUES (?,?,?,?,?,?,?,NULL,'REQUESTED',?,?,?,?)`,
      args: [
        shipmentId,
        args.tenantId,
        args.orderId,
        userId,
        shipmentNumber,
        JSON.stringify(addr),
        args.carrier ?? null,
        at,
        args.note ?? null,
        at,
        at,
      ],
    });

    for (const p of picked) {
      /* ★ここが二重発送を止める1つ目の守り（DBのUNIQUE）。
           先に入っている割り当てがあれば、この INSERT が落ちます。 */
      try {
        await tx.execute({
          sql: `INSERT INTO shipment_items
                  (id, tenant_id, shipment_id, order_id, order_item_id,
                   quantity, name_snapshot, created_at, released_at)
                VALUES (?,?,?,?,?,1,?,?,NULL)`,
          args: [
            id("sit"),
            args.tenantId,
            shipmentId,
            args.orderId,
            p.itemId,
            p.name,
            at,
          ],
        });
      } catch (e) {
        if (isUnique(e)) {
          throw new ShipmentError(
            "ALREADY_ASSIGNED",
            `「${p.name}」は、すでに別の発送に入っています。二重には送りません。`,
          );
        }
        throw e;
      }

      /* ★2つ目の守り（条件つき更新）。
           読んでから足す、ではなく、足せるときだけ足します。 */
      const up = await tx.execute({
        sql: `UPDATE order_items
                 SET assigned_quantity = assigned_quantity + 1, updated_at = ?
               WHERE tenant_id = ? AND id = ?
                 AND status IN ('UNSHIPPED','PARTIALLY_SHIPPED')
                 AND assigned_quantity < quantity`,
        args: [at, args.tenantId, p.itemId],
      });
      if (Number(up.rowsAffected) !== 1) {
        throw new ShipmentError(
          "ALREADY_ASSIGNED",
          `「${p.name}」は、すでに別の発送に入っています。二重には送りません。`,
        );
      }
    }

    await recomputeOrderStatusTx(tx, args.tenantId, args.orderId, at);

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      /* ★2件目以降は、別の種類として残す。
           「まだ全部は送っていない」が、そこで確定するからです。 */
      action: isSplit ? "SHIPMENT_SPLIT" : "SHIPMENT_CREATE",
      target: shipmentId,
      summary: isSplit
        ? `注文 ${str(o.order_number)} を分けて、発送 ${shipmentNumber} を作りました（${picked.length}点）。`
        : `注文 ${str(o.order_number)} の発送 ${shipmentNumber} を作りました（${picked.length}点）。`,
      after: picked.map((p) => p.name).join("、"),
      requestId: args.requestId,
      data: {
        shipmentId,
        shipmentNumber,
        orderId: args.orderId,
        orderNumber: str(o.order_number),
        userId,
        itemCount: picked.length,
        isSplit,
        /* ★住所そのものは data に入れない。
             監査ログは、権限のある人が広く読む場所です。
             宛先の全文が必要なら、発送の詳細画面で見ます。 */
        shipTo: addr.zip ? `〒${addr.zip}` : "（郵便番号なし）",
      },
    });

    return { shipmentId, shipmentNumber, isSplit, auditSeq: audit.seq };
  });
}

/* ══════════════════════════════════════════════
   追跡番号
   ══════════════════════════════════════════════ */

/**
 * 追跡番号を登録する。
 *
 * ★同じ発送に、2回登録できないこと（#15）。
 *   1回目と2回目で違う番号を入れると、
 *   お客様に伝えた番号と、記録に残る番号が食い違います。
 *   どうしても直すときは、理由を必ず書かせます。
 */
export async function setTracking(args: {
  tenantId: string;
  shipmentId: string;
  carrier: string;
  trackingNumber: string;
  /** すでに登録済みのものを直すときは、理由が必須 */
  reason?: string;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ auditSeq: number; replaced: boolean }> {
  const at = args.now ?? new Date().toISOString();
  const carrier = args.carrier.trim();
  const tracking = args.trackingNumber.trim();

  if (carrier === "" || tracking === "") {
    throw new ShipmentError(
      "NEED_TRACKING",
      "配送会社と追跡番号の両方をご入力ください。",
    );
  }

  return withWriteTx(async (tx) => {
    const sr = await tx.execute({
      sql: `SELECT id, shipment_number, order_id, carrier, tracking_number, shipment_status
              FROM shipments WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.shipmentId],
    });
    if (sr.rows.length === 0) {
      throw new ShipmentError("NO_SHIPMENT", "発送が見つかりません。");
    }
    const s = sr.rows[0] as Row;
    if (str(s.shipment_status) === "CANCELLED") {
      throw new ShipmentError(
        "TOO_LATE",
        "取り消された発送には、追跡番号を登録できません。",
      );
    }

    const had = s.tracking_number != null && str(s.tracking_number) !== "";
    if (had) {
      /* 同じ番号をもう一度送ってきただけなら、何も起きていません */
      if (str(s.tracking_number) === tracking && str(s.carrier) === carrier) {
        throw new ShipmentError(
          "ALREADY_TRACKED",
          "この追跡番号は、すでに登録されています。",
        );
      }
      if (!args.reason || args.reason.trim().length < 4) {
        throw new ShipmentError(
          "ALREADY_TRACKED",
          "追跡番号を変更するには、理由の入力が必要です。",
        );
      }
    }

    try {
      await tx.execute({
        sql: `UPDATE shipments
                 SET carrier = ?, tracking_number = ?, updated_at = ?
               WHERE tenant_id = ? AND id = ?`,
        args: [carrier, tracking, at, args.tenantId, args.shipmentId],
      });
    } catch (e) {
      if (isUnique(e)) {
        throw new ShipmentError(
          "TRACKING_IN_USE",
          "その追跡番号は、すでに別の発送で使われています。",
        );
      }
      throw e;
    }

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "SHIPMENT_TRACKING_SET",
      target: args.shipmentId,
      summary: had
        ? `発送 ${str(s.shipment_number)} の追跡番号を変更しました。`
        : `発送 ${str(s.shipment_number)} に追跡番号を登録しました。`,
      before: had ? `${str(s.carrier)} ${str(s.tracking_number)}` : undefined,
      after: `${carrier} ${tracking}`,
      reason: args.reason,
      requestId: args.requestId,
      data: {
        shipmentId: args.shipmentId,
        shipmentNumber: str(s.shipment_number),
        orderId: str(s.order_id),
        carrier,
        replaced: had,
      },
    });

    return { auditSeq: audit.seq, replaced: had };
  });
}

/* ══════════════════════════════════════════════
   状態を進める
   ══════════════════════════════════════════════ */

/**
 * 発送の状態を1つ進める。
 *
 * ★SHIPPED（発送確定）だけは、追跡番号が要ります。
 *   番号のない「発送済み」は、お客様から見れば
 *   「送ったと言われたが、確かめようがない」のと同じです。
 */
export async function advanceShipment(args: {
  tenantId: string;
  shipmentId: string;
  to: ShipmentStatus;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ auditSeq: number; status: ShipmentStatus }> {
  const at = args.now ?? new Date().toISOString();

  return withWriteTx(async (tx) => {
    const sr = await tx.execute({
      sql: `SELECT id, shipment_number, order_id, user_id, shipment_status,
                   carrier, tracking_number
              FROM shipments WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.shipmentId],
    });
    if (sr.rows.length === 0) {
      throw new ShipmentError("NO_SHIPMENT", "発送が見つかりません。");
    }
    const s = sr.rows[0] as Row;
    const from = str(s.shipment_status) as ShipmentStatus;

    if (!NEXT_OK[from]?.includes(args.to)) {
      throw new ShipmentError(
        "BAD_TRANSITION",
        `「${SHIPMENT_STATUS_LABEL[from]}」から「${SHIPMENT_STATUS_LABEL[args.to]}」へは進められません。`,
      );
    }

    if (args.to === "SHIPPED") {
      if (s.tracking_number == null || str(s.tracking_number) === "") {
        throw new ShipmentError(
          "NEED_TRACKING",
          "追跡番号を登録してから、発送を確定してください。",
        );
      }
    }

    const col =
      args.to === "SHIPPED"
        ? "shipped_at"
        : args.to === "DELIVERED"
          ? "delivered_at"
          : args.to === "PREPARING"
            ? "packed_at"
            : null;

    await tx.execute({
      sql: `UPDATE shipments
               SET shipment_status = ?, updated_at = ?${col ? `, ${col} = ?` : ""}
             WHERE tenant_id = ? AND id = ? AND shipment_status = ?`,
      args: col
        ? [args.to, at, at, args.tenantId, args.shipmentId, from]
        : [args.to, at, args.tenantId, args.shipmentId, from],
    });

    /* ── 発送確定で、はじめて「発送済み数」が動く ─────
         ★作った時点で動かさないこと。
           箱に入れただけの商品を「発送済み」と数えると、
           お客様の画面に「発送済み」と出たまま、
           何日も荷物が動かないことになります。 */
    if (args.to === "SHIPPED") {
      const its = await tx.execute({
        sql: `SELECT order_item_id, quantity FROM shipment_items
               WHERE tenant_id = ? AND shipment_id = ? AND released_at IS NULL`,
        args: [args.tenantId, args.shipmentId],
      });
      for (const r of its.rows as Row[]) {
        const up = await tx.execute({
          sql: `UPDATE order_items
                   SET shipped_quantity = shipped_quantity + ?,
                       status = CASE
                                  WHEN shipped_quantity + ? >= quantity THEN 'SHIPPED'
                                  ELSE 'PARTIALLY_SHIPPED'
                                END,
                       updated_at = ?
                 WHERE tenant_id = ? AND id = ?
                   AND shipped_quantity + ? <= quantity`,
          args: [
            num(r.quantity),
            num(r.quantity),
            at,
            args.tenantId,
            str(r.order_item_id),
            num(r.quantity),
          ],
        });
        if (Number(up.rowsAffected) !== 1) {
          throw new ShipmentError(
            "ALREADY_SHIPPED",
            "この商品は、すでに発送が済んでいます。二重には送りません。",
          );
        }
      }
      await recomputeOrderStatusTx(tx, args.tenantId, str(s.order_id), at);
    }

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: args.to === "SHIPPED" ? "SHIPMENT_SHIPPED" : "SHIPMENT_STATUS",
      target: args.shipmentId,
      summary: `発送 ${str(s.shipment_number)} を「${SHIPMENT_STATUS_LABEL[args.to]}」にしました。`,
      before: SHIPMENT_STATUS_LABEL[from],
      after: SHIPMENT_STATUS_LABEL[args.to],
      requestId: args.requestId,
      data: {
        shipmentId: args.shipmentId,
        shipmentNumber: str(s.shipment_number),
        orderId: str(s.order_id),
        fromStatus: from,
        toStatus: args.to,
        carrier: str(s.carrier),
      },
    });

    /* ── お知らせ ─────────────────────────────
         ★発送が確定した「その書き込みの中で」作ること。
           あとから別に作る形にすると、途中で落ちたときに
           「発送済みなのにお知らせが無い」状態が残ります。
           お客様は、出したことを知る手段がありません。

         ★出すのは、お客様の手元が動いたときだけにすること。
           準備中→発送待ちのような、社内の段取りまで送ると、
           お客様には意味の分からない通知が並びます。
           数が多いほど、肝心の1通が読まれなくなります。 */
    if (args.to === "SHIPPED" || args.to === "DELIVERED") {
      const shipmentNumber = str(s.shipment_number);
      const carrier = str(s.carrier);
      const tracking = str(s.tracking_number);

      const nakami = await tx.execute({
        sql: `SELECT name_snapshot FROM shipment_items
               WHERE tenant_id = ? AND shipment_id = ? AND released_at IS NULL`,
        args: [args.tenantId, args.shipmentId],
      });
      const names = (nakami.rows as Row[]).map((r) => str(r.name_snapshot));

      const honbun =
        args.to === "SHIPPED"
          ? [
              `お荷物番号 ${shipmentNumber} を発送いたしました。`,
              `この荷物の中身：${names.join("、")}`,
              carrier ? `配送会社：${carrier}` : "",
              tracking ? `追跡番号：${tracking}` : "",
            ]
              .filter((x) => x !== "")
              .join("\n")
          : [
              `お荷物番号 ${shipmentNumber} のお届けが完了いたしました。`,
              `この荷物の中身：${names.join("、")}`,
            ].join("\n");

      await notifyTx(tx, {
        tenantId: args.tenantId,
        userId: str(s.user_id),
        kind:
          args.to === "SHIPPED" ? "SHIPMENT_SHIPPED" : "SHIPMENT_DELIVERED",
        title:
          args.to === "SHIPPED"
            ? "商品を発送しました"
            : "商品をお届けしました",
        body: honbun,
        refKind: "SHIPMENT",
        refId: args.shipmentId,
        /* ★発送1件・状態1つにつき、1通だけ。
             押し直しても増えません（データベースの決まりで止めます） */
        dedupeKey: `shipment:${args.shipmentId}:${args.to}`,
        at,
        requestId: args.requestId,
        actor: args.actor,
      });
    }

    return { auditSeq: audit.seq, status: args.to };
  });
}

/* ══════════════════════════════════════════════
   宛先を直す（出荷の前だけ）
   ══════════════════════════════════════════════ */

/**
 * 発送の宛先を直す。
 *
 * ★会員情報の変更が、ここへ自動で流れ込むことは、ありません（#19）。
 *   自動で同期すると、乗っ取った人が住所を書き換えるだけで、
 *   まだ出していない箱の宛先が、全部その人の家になります。
 *   直すのは、担当者が明示的にこの操作をしたときだけです。
 */
export async function changeShipmentAddress(args: {
  tenantId: string;
  shipmentId: string;
  address: AddressSnapshot;
  reason: string;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ auditSeq: number }> {
  const at = args.now ?? new Date().toISOString();

  if (!args.reason || args.reason.trim().length < 4) {
    throw new ShipmentError(
      "NEED_TRACKING",
      "お届け先を変更するには、理由の入力が必要です。",
    );
  }
  if (args.address.addr.trim() === "") {
    throw new ShipmentError("NO_ADDRESS", "お届け先が空です。");
  }

  return withWriteTx(async (tx) => {
    const sr = await tx.execute({
      sql: `SELECT id, shipment_number, order_id, shipment_status,
                   shipping_address_snapshot
              FROM shipments WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.shipmentId],
    });
    if (sr.rows.length === 0) {
      throw new ShipmentError("NO_SHIPMENT", "発送が見つかりません。");
    }
    const s = sr.rows[0] as Row;
    const st = str(s.shipment_status) as ShipmentStatus;

    if (SHIPPED_OR_LATER.includes(st) || st === "CANCELLED") {
      throw new ShipmentError(
        "TOO_LATE",
        "すでに発送が確定しているため、お届け先は変更できません。追跡番号から配送会社へお問い合わせください。",
      );
    }

    const before = parseAddress(s.shipping_address_snapshot, "");
    await tx.execute({
      sql: `UPDATE shipments
               SET shipping_address_snapshot = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ?`,
      args: [
        JSON.stringify(args.address),
        at,
        args.tenantId,
        args.shipmentId,
      ],
    });

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "SHIPMENT_ADDRESS_CHANGE",
      target: args.shipmentId,
      summary: `発送 ${str(s.shipment_number)} のお届け先を変更しました。`,
      /* ★前と後の両方を残すこと。片方だけでは、何が変わったか言えません */
      before: before ? addressLine(before) : "（未登録）",
      after: addressLine(args.address),
      reason: args.reason,
      requestId: args.requestId,
      data: {
        shipmentId: args.shipmentId,
        shipmentNumber: str(s.shipment_number),
        orderId: str(s.order_id),
      },
    });

    return { auditSeq: audit.seq };
  });
}

/* ══════════════════════════════════════════════
   発送を取り消す
   ══════════════════════════════════════════════ */

/**
 * 発送を取り消し、中の商品を「また送れる」状態へ戻す。
 *
 * ★行を消さないこと。released_at を入れるだけにします。
 *   消せば確かに鍵は空きますが、
 *   「一度この発送に入っていた」という事実まで消えます。
 *   後で「なぜ2回梱包されたのか」を調べるとき、
 *   いちばん見たい行が、もう無いことになります。
 */
export async function cancelShipment(args: {
  tenantId: string;
  shipmentId: string;
  reason: string;
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{ auditSeq: number; released: number }> {
  const at = args.now ?? new Date().toISOString();

  if (!args.reason || args.reason.trim().length < 4) {
    throw new ShipmentError(
      "NEED_TRACKING",
      "発送を取り消すには、理由の入力が必要です。",
    );
  }

  return withWriteTx(async (tx) => {
    const sr = await tx.execute({
      sql: `SELECT id, shipment_number, order_id, shipment_status
              FROM shipments WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.shipmentId],
    });
    if (sr.rows.length === 0) {
      throw new ShipmentError("NO_SHIPMENT", "発送が見つかりません。");
    }
    const s = sr.rows[0] as Row;
    const st = str(s.shipment_status) as ShipmentStatus;

    if (st === "CANCELLED") {
      throw new ShipmentError("TOO_LATE", "この発送は、すでに取り消されています。");
    }
    if (SHIPPED_OR_LATER.includes(st)) {
      throw new ShipmentError(
        "TOO_LATE",
        "すでに発送が確定しているため、取り消せません。返品の手続きをご案内してください。",
      );
    }

    /* 中の商品を、割り当てから外す */
    const its = await tx.execute({
      sql: `SELECT id, order_item_id, quantity, name_snapshot FROM shipment_items
             WHERE tenant_id = ? AND shipment_id = ? AND released_at IS NULL`,
      args: [args.tenantId, args.shipmentId],
    });
    const rows = its.rows as Row[];

    for (const r of rows) {
      await tx.execute({
        sql: `UPDATE shipment_items SET released_at = ?
               WHERE tenant_id = ? AND id = ? AND released_at IS NULL`,
        args: [at, args.tenantId, str(r.id)],
      });
      /* ★0を下回らせないこと。
           マイナスの割り当ては、次の発送で「まだ入れられる」に化けます。 */
      await tx.execute({
        sql: `UPDATE order_items
                 SET assigned_quantity = MAX(0, assigned_quantity - ?), updated_at = ?
               WHERE tenant_id = ? AND id = ?`,
        args: [num(r.quantity), at, args.tenantId, str(r.order_item_id)],
      });
    }

    await tx.execute({
      sql: `UPDATE shipments
               SET shipment_status = 'CANCELLED', cancelled_at = ?, updated_at = ?
             WHERE tenant_id = ? AND id = ? AND shipment_status = ?`,
      args: [at, at, args.tenantId, args.shipmentId, st],
    });

    await recomputeOrderStatusTx(tx, args.tenantId, str(s.order_id), at);

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "SHIPMENT_CANCEL",
      target: args.shipmentId,
      summary: `発送 ${str(s.shipment_number)} を取り消しました（${rows.length}点を発送待ちに戻しました）。`,
      before: SHIPMENT_STATUS_LABEL[st],
      after: "取消",
      reason: args.reason,
      requestId: args.requestId,
      data: {
        shipmentId: args.shipmentId,
        shipmentNumber: str(s.shipment_number),
        orderId: str(s.order_id),
        releasedCount: rows.length,
      },
    });

    return { auditSeq: audit.seq, released: rows.length };
  });
}

/* ══════════════════════════════════════════════
   読む
   ══════════════════════════════════════════════ */

export type ShipmentItemView = {
  id: string;
  orderItemId: string;
  name: string;
  quantity: number;
  releasedAt: string | null;
};

export type ShipmentView = {
  id: string;
  shipmentNumber: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  userName: string;
  address: AddressSnapshot | null;
  carrier: string | null;
  trackingNumber: string | null;
  status: ShipmentStatus;
  requestedAt: string;
  packedAt: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  cancelledAt: string | null;
  note: string | null;
  updatedAt: string;
  items: ShipmentItemView[];
};

function toShipmentView(s: Row, items: Row[]): ShipmentView {
  return {
    id: str(s.id),
    shipmentNumber: str(s.shipment_number),
    orderId: str(s.order_id),
    orderNumber: str(s.order_number),
    userId: str(s.user_id),
    userName: str(s.user_name),
    address: parseAddress(s.shipping_address_snapshot, str(s.user_name)),
    carrier: s.carrier == null ? null : str(s.carrier),
    trackingNumber: s.tracking_number == null ? null : str(s.tracking_number),
    status: str(s.shipment_status) as ShipmentStatus,
    requestedAt: str(s.requested_at),
    packedAt: s.packed_at == null ? null : str(s.packed_at),
    shippedAt: s.shipped_at == null ? null : str(s.shipped_at),
    deliveredAt: s.delivered_at == null ? null : str(s.delivered_at),
    cancelledAt: s.cancelled_at == null ? null : str(s.cancelled_at),
    note: s.note == null ? null : str(s.note),
    updatedAt: str(s.updated_at),
    items: items.map((i) => ({
      id: str(i.id),
      orderItemId: str(i.order_item_id),
      name: str(i.name_snapshot),
      quantity: num(i.quantity),
      releasedAt: i.released_at == null ? null : str(i.released_at),
    })),
  };
}

const SHIPMENT_SELECT = `
  SELECT s.*, o.order_number AS order_number, c.name AS user_name
    FROM shipments s
    LEFT JOIN orders o    ON o.tenant_id = s.tenant_id AND o.id = s.order_id
    LEFT JOIN customers c ON c.tenant_id = s.tenant_id AND c.id = s.user_id
`;

export async function getShipment(
  tenantId: string,
  shipmentId: string,
): Promise<ShipmentView | null> {
  const sr = await db().execute({
    sql: `${SHIPMENT_SELECT} WHERE s.tenant_id = ? AND s.id = ?`,
    args: [tenantId, shipmentId],
  });
  const s = sr.rows[0] as Row | undefined;
  if (!s) return null;

  const it = await db().execute({
    sql: `SELECT * FROM shipment_items
           WHERE tenant_id = ? AND shipment_id = ?
           ORDER BY created_at ASC, id ASC`,
    args: [tenantId, shipmentId],
  });
  return toShipmentView(s, it.rows as Row[]);
}

export type ShipmentListRow = {
  id: string;
  shipmentNumber: string;
  orderId: string;
  orderNumber: string;
  userId: string;
  userName: string;
  itemNames: string;
  itemCount: number;
  zip: string;
  carrier: string | null;
  trackingNumber: string | null;
  status: ShipmentStatus;
  requestedAt: string;
  shippedAt: string | null;
};

export async function listShipments(
  tenantId: string,
  opts: { status?: string; orderId?: string; userId?: string; todo?: boolean; limit?: number } = {},
): Promise<{ rows: ShipmentListRow[]; total: number; todo: number }> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 500);
  const where: string[] = ["s.tenant_id = ?"];
  const args: (string | number)[] = [tenantId];
  if (opts.status) {
    where.push("s.shipment_status = ?");
    args.push(opts.status);
  }
  if (opts.todo) {
    where.push(
      `s.shipment_status IN (${SHIPMENT_TODO.map(() => "?").join(",")})`,
    );
    args.push(...SHIPMENT_TODO);
  }
  if (opts.orderId) {
    where.push("s.order_id = ?");
    args.push(opts.orderId);
  }
  if (opts.userId) {
    where.push("s.user_id = ?");
    args.push(opts.userId);
  }
  const cond = where.join(" AND ");

  const r = await db().execute({
    sql: `${SHIPMENT_SELECT}
           WHERE ${cond}
           ORDER BY s.requested_at ASC, s.id ASC
           LIMIT ?`,
    args: [...args, limit],
  });

  const ids = (r.rows as Row[]).map((s) => str(s.id));
  const names = new Map<string, { names: string[]; count: number }>();
  if (ids.length > 0) {
    const ir = await db().execute({
      sql: `SELECT shipment_id, name_snapshot, quantity FROM shipment_items
             WHERE tenant_id = ? AND released_at IS NULL
               AND shipment_id IN (${ids.map(() => "?").join(",")})
             ORDER BY created_at ASC`,
      args: [tenantId, ...ids],
    });
    for (const i of ir.rows as Row[]) {
      const k = str(i.shipment_id);
      const cur = names.get(k) ?? { names: [], count: 0 };
      cur.names.push(str(i.name_snapshot));
      cur.count += num(i.quantity);
      names.set(k, cur);
    }
  }

  const t = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM shipments s WHERE ${cond}`,
    args,
  });

  const todoRes = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM shipments
           WHERE tenant_id = ?
             AND shipment_status IN (${SHIPMENT_TODO.map(() => "?").join(",")})`,
    args: [tenantId, ...SHIPMENT_TODO],
  });

  return {
    rows: (r.rows as Row[]).map((s) => {
      const n = names.get(str(s.id)) ?? { names: [], count: 0 };
      const addr = parseAddress(s.shipping_address_snapshot, "");
      return {
        id: str(s.id),
        shipmentNumber: str(s.shipment_number),
        orderId: str(s.order_id),
        orderNumber: str(s.order_number),
        userId: str(s.user_id),
        userName: str(s.user_name),
        itemNames: n.names.join("、"),
        itemCount: n.count,
        zip: addr?.zip ?? "",
        carrier: s.carrier == null ? null : str(s.carrier),
        trackingNumber:
          s.tracking_number == null ? null : str(s.tracking_number),
        status: str(s.shipment_status) as ShipmentStatus,
        requestedAt: str(s.requested_at),
        shippedAt: s.shipped_at == null ? null : str(s.shipped_at),
      };
    }),
    total: num((t.rows[0] as Row).n),
    todo: num((todoRes.rows[0] as Row).n),
  };
}

/* ══════════════════════════════════════════════
   お客様に見せる形
   ══════════════════════════════════════════════ */

export type CustomerOrderView = {
  orderId: string;
  orderNumber: string;
  orderedAt: string;
  orderStatus: OrderStatusLite;
  itemCount: number;
  shippedCount: number;
  /** 「3点中2点発送済み、残り1点準備中」の1行（#17） */
  progress: string;
  items: {
    name: string;
    /** この商品が、いまどうなっているか（お客様の言葉で） */
    state: string;
    shipmentNumber: string | null;
    carrier: string | null;
    trackingNumber: string | null;
  }[];
  shipments: {
    shipmentNumber: string;
    status: ShipmentStatus;
    statusLabel: string;
    carrier: string | null;
    trackingNumber: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
    itemNames: string[];
  }[];
};

type OrderStatusLite =
  | "PENDING"
  | "PAID"
  | "PARTIALLY_FULFILLED"
  | "FULFILLED"
  | "CANCELLED";

/**
 * お客様のご注文一覧。
 *
 * ═══════════════════════════════════════════════════════
 * ★「発送済み」の一言で済ませないこと
 * ═══════════════════════════════════════════════════════
 *
 *   3点のうち2点だけ出したとき、画面に「発送済み」とだけ出すと、
 *   お客様は3点が届くと思って待ちます。2点しか届きません。
 *   そこから「1点足りない」という問い合わせが立ちます。
 *
 *   逆に「準備中」とだけ出すと、
 *   もう手元にある2点について、届いていないことになります。
 *
 *   どちらも、書ける情報を書かなかったせいで起きる問い合わせです。
 *   だから、点数で書きます。
 */
export async function listCustomerOrders(
  tenantId: string,
  userId: string,
  limit = 50,
): Promise<CustomerOrderView[]> {
  const or = await db().execute({
    sql: `SELECT id, order_number, ordered_at, order_status
            FROM orders
           WHERE tenant_id = ? AND user_id = ?
           ORDER BY ordered_at DESC, id DESC
           LIMIT ?`,
    args: [tenantId, userId, Math.min(Math.max(limit, 1), 200)],
  });
  const orders = or.rows as Row[];
  if (orders.length === 0) return [];

  const ids = orders.map((o) => str(o.id));
  const q = ids.map(() => "?").join(",");

  const ir = await db().execute({
    sql: `SELECT * FROM order_items
           WHERE tenant_id = ? AND order_id IN (${q})
           ORDER BY created_at ASC, id ASC`,
    args: [tenantId, ...ids],
  });

  const sr = await db().execute({
    sql: `SELECT * FROM shipments
           WHERE tenant_id = ? AND order_id IN (${q})
           ORDER BY requested_at ASC, id ASC`,
    args: [tenantId, ...ids],
  });

  const sir = await db().execute({
    sql: `SELECT * FROM shipment_items
           WHERE tenant_id = ? AND order_id IN (${q}) AND released_at IS NULL
           ORDER BY created_at ASC`,
    args: [tenantId, ...ids],
  });

  /* 明細ID → その明細が入っている発送 */
  const byItem = new Map<string, string>();
  const byShipment = new Map<string, string[]>();
  for (const si of sir.rows as Row[]) {
    byItem.set(str(si.order_item_id), str(si.shipment_id));
    const cur = byShipment.get(str(si.shipment_id)) ?? [];
    cur.push(str(si.name_snapshot));
    byShipment.set(str(si.shipment_id), cur);
  }

  const shipmentById = new Map<string, Row>();
  for (const s of sr.rows as Row[]) shipmentById.set(str(s.id), s);

  return orders.map((o) => {
    const oid = str(o.id);
    const items = (ir.rows as Row[]).filter((i) => str(i.order_id) === oid);
    const ships = (sr.rows as Row[]).filter(
      (s) => str(s.order_id) === oid && str(s.shipment_status) !== "CANCELLED",
    );

    let shippedCount = 0;
    let preparing = 0;
    let notYet = 0;

    const itemViews = items.map((i) => {
      const shipId = byItem.get(str(i.id));
      const s = shipId ? shipmentById.get(shipId) : undefined;
      const st = s ? (str(s.shipment_status) as ShipmentStatus) : null;

      let state: string;
      if (str(i.status) === "CANCELLED") {
        state = "取消";
      } else if (num(i.shipped_quantity) >= num(i.quantity)) {
        state = st ? SHIPMENT_STATUS_CUSTOMER_LABEL[st] : "発送済み";
        shippedCount += 1;
      } else if (st && st !== "CANCELLED") {
        state = "発送準備中";
        preparing += 1;
      } else {
        state = "お手続き中";
        notYet += 1;
      }

      return {
        name: str(i.item_name_snapshot),
        state,
        shipmentNumber: s ? str(s.shipment_number) : null,
        carrier: s?.carrier == null ? null : str(s.carrier),
        trackingNumber:
          s?.tracking_number == null ? null : str(s.tracking_number),
      };
    });

    const total = itemViews.length;
    const nokori = preparing + notYet;
    const progress =
      total === 0
        ? "商品がありません。"
        : shippedCount === 0
          ? `${total}点すべて準備中です。`
          : shippedCount >= total
            ? `${total}点すべて発送済みです。`
            : `${total}点中${shippedCount}点発送済み、残り${nokori}点準備中です。`;

    return {
      orderId: oid,
      orderNumber: str(o.order_number),
      orderedAt: str(o.ordered_at),
      orderStatus: str(o.order_status) as OrderStatusLite,
      itemCount: total,
      shippedCount,
      progress,
      items: itemViews,
      shipments: ships.map((s) => {
        const st = str(s.shipment_status) as ShipmentStatus;
        return {
          shipmentNumber: str(s.shipment_number),
          status: st,
          statusLabel: SHIPMENT_STATUS_CUSTOMER_LABEL[st],
          carrier: s.carrier == null ? null : str(s.carrier),
          trackingNumber:
            s.tracking_number == null ? null : str(s.tracking_number),
          shippedAt: s.shipped_at == null ? null : str(s.shipped_at),
          deliveredAt: s.delivered_at == null ? null : str(s.delivered_at),
          itemNames: byShipment.get(str(s.id)) ?? [],
        };
      }),
    };
  });
}

/** 未発送の件数（ダッシュボード・TODAY・AIが同じ数を見るための1か所） */
export async function countUnshipped(tenantId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM shipments
           WHERE tenant_id = ?
             AND shipment_status IN (${SHIPMENT_TODO.map(() => "?").join(",")})`,
    args: [tenantId, ...SHIPMENT_TODO],
  });
  return num((r.rows[0] as Row).n);
}

/** まだ1つも発送に入っていない明細の件数（＝発送を作る仕事が残っている数） */
export async function countUnassignedItems(tenantId: string): Promise<number> {
  const r = await db().execute({
    sql: `SELECT COUNT(*) AS n FROM order_items i
            JOIN orders o ON o.tenant_id = i.tenant_id AND o.id = i.order_id
           WHERE i.tenant_id = ?
             AND i.status IN ('UNSHIPPED','PARTIALLY_SHIPPED')
             AND i.assigned_quantity < i.quantity
             AND o.order_status <> 'CANCELLED'`,
    args: [tenantId],
  });
  return num((r.rows[0] as Row).n);
}
