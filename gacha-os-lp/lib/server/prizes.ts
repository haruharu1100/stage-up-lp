/**
 * 獲得商品（当たった景品）。
 *
 * ═══════════════════════════════════════════════════════
 * ★「発送依頼済み」で止めないこと
 * ═══════════════════════════════════════════════════════
 *
 *   景品そのものが持っている状態は、たった3つです。
 *
 *       UNCHOSEN … まだ選んでいない
 *       SHIP_REQUESTED … 発送を頼んだ
 *       EXCHANGED … ポイントに交換した
 *
 *   ですが、お客様が知りたいのは、そこではありません。
 *   頼んだあと、いま荷物がどこにあるのか、です。
 *
 *   「発送依頼済み」のまま何日も変わらない画面は、
 *   止まっているのと区別がつきません。
 *   問い合わせは、そこから来ます。
 *
 *   なので、発送の側（shipments）まで見て、5つに分けます。
 *
 *       未選択 → 発送依頼済み → 発送中 → 発送済み
 *                            ↘ ポイント交換済み
 *
 * ═══════════════════════════════════════════════════════
 * ★発送とポイント交換は、どちらか片方しか通らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   これを画面のボタンで止めてはいけません。
 *   2つの端末で同時に押されたら、両方通ります。
 *   現物を送ったうえで、ポイントも渡すことになります。
 *
 *   だから、押さえるのと確かめるのを、1つの命令にします。
 *
 *       UPDATE prizes SET status='EXCHANGED'
 *        WHERE ... AND status='UNCHOSEN'
 *
 *   これが0件を返した時点で、その景品はもう他方に取られています。
 */

import { appendAuditTx } from "./audit";
import { withWriteTx, db } from "./db";
import { id } from "./ids";
import type { Actor } from "./orders";

type Row = Record<string, unknown>;
const num = (v: unknown) => Number(v ?? 0);
const str = (v: unknown) => String(v ?? "");
const nul = (v: unknown) => (v == null ? null : String(v));

/* ══════════════════════════════════════════════
   5つの状態
   ══════════════════════════════════════════════ */

export type PrizeState =
  | "UNCHOSEN"
  | "SHIP_REQUESTED"
  | "SHIPPING"
  | "SHIPPED"
  | "EXCHANGED";

/** お客様に、そのまま出す言葉 */
export const PRIZE_STATE_LABEL: Record<PrizeState, string> = {
  UNCHOSEN: "未選択",
  SHIP_REQUESTED: "発送依頼済み",
  SHIPPING: "発送中",
  SHIPPED: "発送済み",
  EXCHANGED: "ポイント交換済み",
};

/** その状態が何を意味するのか。1行で添える */
export const PRIZE_STATE_NOTE: Record<PrizeState, string> = {
  UNCHOSEN: "発送か、ポイント交換かをお選びください。",
  SHIP_REQUESTED: "承りました。運営が発送の準備をしています。",
  SHIPPING: "発送しました。追跡番号でご確認いただけます。",
  SHIPPED: "お届けが完了しました。",
  EXCHANGED: "ポイントへ交換済みです。発送はできません。",
};

export type PrizeView = {
  id: string;
  gachaId: string;
  gachaTitle: string;
  grade: string;
  name: string;
  value: number;
  exchangePt: number;
  wonAt: string;
  state: PrizeState;
  stateLabel: string;
  stateNote: string;
  /** いま、この景品にできること */
  canShip: boolean;
  canExchange: boolean;
  /** つながっている注文・発送（ある場合） */
  orderNumber: string | null;
  shipmentNumber: string | null;
  carrier: string | null;
  trackingNumber: string | null;
};

/**
 * 発送の状態から、お客様に見せる状態を決める。
 *
 * ★取り消された発送を、ここへ持ち込まないこと。
 *   取り消しは shipment_items.released_at で外れるので、
 *   呼び出し側の SQL で除いてあります。
 */
function stateOf(prizeStatus: string, shipmentStatus: string | null): PrizeState {
  if (prizeStatus === "EXCHANGED") return "EXCHANGED";
  if (prizeStatus === "UNCHOSEN") return "UNCHOSEN";

  /* ここから先は SHIP_REQUESTED */
  if (shipmentStatus === "DELIVERED") return "SHIPPED";
  if (shipmentStatus === "SHIPPED" || shipmentStatus === "IN_TRANSIT") {
    return "SHIPPING";
  }
  /* 箱がまだ無い／作っただけ（REQUESTED・PREPARING・READY） */
  return "SHIP_REQUESTED";
}

/**
 * ご自身の獲得商品を、新しい順に読む。
 *
 * ★userId は、必ずクッキーから来たものを渡すこと。
 *   本文で受け取ると、1文字書き換えるだけで
 *   他人の当選品と追跡番号が読めます。
 */
export async function listCustomerPrizes(
  tenantId: string,
  userId: string,
): Promise<PrizeView[]> {
  const r = await db().execute({
    sql: `SELECT p.id, p.gacha_id, p.grade, p.name, p.value,
                 p.exchange_pt, p.status, p.won_at,
                 g.title           AS gacha_title,
                 o.order_number    AS order_number,
                 s.shipment_number AS shipment_number,
                 s.shipment_status AS shipment_status,
                 s.carrier         AS carrier,
                 s.tracking_number AS tracking_number
            FROM prizes p
            LEFT JOIN gachas g
                   ON g.id = p.gacha_id AND g.tenant_id = p.tenant_id
            LEFT JOIN order_items oi
                   ON oi.prize_id = p.id AND oi.tenant_id = p.tenant_id
            LEFT JOIN orders o
                   ON o.id = oi.order_id AND o.tenant_id = p.tenant_id
            /* ★released_at IS NULL を外さないこと。
                 取り消した箱まで数えると、
                 発送待ちへ戻した商品が「発送中」のまま残ります */
            LEFT JOIN shipment_items si
                   ON si.order_item_id = oi.id
                  AND si.tenant_id = p.tenant_id
                  AND si.released_at IS NULL
            LEFT JOIN shipments s
                   ON s.id = si.shipment_id AND s.tenant_id = p.tenant_id
           WHERE p.tenant_id = ? AND p.user_id = ?
           ORDER BY p.won_at DESC, p.id DESC`,
    args: [tenantId, userId],
  });

  return (r.rows as Row[]).map((p) => {
    const state = stateOf(str(p.status), nul(p.shipment_status));
    return {
      id: str(p.id),
      gachaId: str(p.gacha_id),
      gachaTitle: str(p.gacha_title) || "（ガチャ情報なし）",
      grade: str(p.grade),
      name: str(p.name),
      value: num(p.value),
      exchangePt: num(p.exchange_pt),
      wonAt: str(p.won_at),
      state,
      stateLabel: PRIZE_STATE_LABEL[state],
      stateNote: PRIZE_STATE_NOTE[state],
      /* ★できることを、画面に判断させないこと。
           判断が2か所にあると、片方だけ直した日から食い違います。 */
      canShip: state === "UNCHOSEN",
      canExchange: state === "UNCHOSEN",
      orderNumber: nul(p.order_number),
      shipmentNumber: nul(p.shipment_number),
      carrier: nul(p.carrier),
      trackingNumber: nul(p.tracking_number),
    };
  });
}

/** 状態ごとの件数（画面の見出し用） */
export function countByState(list: PrizeView[]): Record<PrizeState, number> {
  const out: Record<PrizeState, number> = {
    UNCHOSEN: 0,
    SHIP_REQUESTED: 0,
    SHIPPING: 0,
    SHIPPED: 0,
    EXCHANGED: 0,
  };
  for (const p of list) out[p.state] += 1;
  return out;
}

/* ══════════════════════════════════════════════
   ポイントに交換する
   ══════════════════════════════════════════════ */

export type PrizeErrorCode =
  | "NO_CUSTOMER"
  | "CUSTOMER_SUSPENDED"
  | "NO_PRIZE"
  | "PRIZE_NOT_AVAILABLE"
  | "EMPTY";

export class PrizeError extends Error {
  code: PrizeErrorCode;
  constructor(code: PrizeErrorCode, message: string) {
    super(message);
    this.code = code;
    this.name = "PrizeError";
  }
}

/**
 * 獲得商品をポイントへ交換する。
 *
 * ★1つの書き込みの中で、最後までやること。
 *   「景品の状態を変える」「台帳に足す」「残高を増やす」は、
 *   3つで1つの出来事です。途中で落ちると、
 *   交換済みなのにポイントが増えていない状態が残ります。
 *   お客様から見れば、商品が消えたのと同じです。
 *
 * @param prizeIds まとめて交換されることがあります（1件でも複数でも）
 */
export async function exchangePrizes(args: {
  tenantId: string;
  userId: string;
  prizeIds: string[];
  actor: Actor;
  requestId: string;
  now?: string;
}): Promise<{
  exchanged: { id: string; name: string; pt: number }[];
  gainedPt: number;
  balance: number;
  auditSeq: number;
}> {
  const at = args.now ?? new Date().toISOString();
  const wanted = Array.from(new Set(args.prizeIds));

  if (wanted.length === 0) {
    throw new PrizeError("EMPTY", "交換する商品が選ばれていません。");
  }

  return withWriteTx(async (tx) => {
    const cu = await tx.execute({
      sql: `SELECT id, name, status, points FROM customers
             WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    if (cu.rows.length === 0) {
      throw new PrizeError("NO_CUSTOMER", "会員情報が見つかりません。");
    }
    const user = cu.rows[0] as Row;
    if (str(user.status) !== "ACTIVE") {
      throw new PrizeError(
        "CUSTOMER_SUSPENDED",
        "このアカウントは現在ご利用いただけません。",
      );
    }

    const done: { id: string; name: string; pt: number }[] = [];

    for (const prizeId of wanted) {
      const pr = await tx.execute({
        sql: `SELECT id, name, exchange_pt, status, user_id FROM prizes
               WHERE tenant_id = ? AND id = ?`,
        args: [args.tenantId, prizeId],
      });
      if (pr.rows.length === 0) {
        throw new PrizeError("NO_PRIZE", "商品が見つかりません。");
      }
      const p = pr.rows[0] as Row;

      /* ★他人の景品を交換できないこと。
           できてしまうと、他人の当選品を自分のポイントに変えられます。
           「見つかりません」で返すのは、
           IDの当たり外れを教えないためです。 */
      if (str(p.user_id) !== args.userId) {
        throw new PrizeError("NO_PRIZE", "商品が見つかりません。");
      }

      const claim = await tx.execute({
        sql: `UPDATE prizes SET status = 'EXCHANGED'
               WHERE tenant_id = ? AND id = ? AND user_id = ?
                 AND status = 'UNCHOSEN'`,
        args: [args.tenantId, prizeId, args.userId],
      });
      if (Number(claim.rowsAffected) !== 1) {
        const now = str(p.status);
        throw new PrizeError(
          "PRIZE_NOT_AVAILABLE",
          now === "SHIP_REQUESTED"
            ? `「${str(p.name)}」は、すでに発送のお手続きが済んでいます。ポイントへは交換できません。`
            : `「${str(p.name)}」は、すでにポイントへ交換されています。`,
        );
      }

      const pt = num(p.exchange_pt);
      await tx.execute({
        sql: `INSERT INTO point_ledger
                (id, tenant_id, user_id, kind, delta, memo, ref, created_at)
              VALUES (?,?,?, 'PRIZE_EXCHANGE', ?, ?, ?, ?)`,
        args: [
          id("led"),
          args.tenantId,
          args.userId,
          pt,
          `${str(p.name)} をポイントに交換`,
          prizeId,
          at,
        ],
      });

      done.push({ id: prizeId, name: str(p.name), pt });
    }

    const gained = done.reduce((a, b) => a + b.pt, 0);

    await tx.execute({
      sql: `UPDATE customers SET points = points + ?
             WHERE tenant_id = ? AND id = ?`,
      args: [gained, args.tenantId, args.userId],
    });

    const after = await tx.execute({
      sql: `SELECT points FROM customers WHERE tenant_id = ? AND id = ?`,
      args: [args.tenantId, args.userId],
    });
    const balance = num((after.rows[0] as Row)?.points);

    const audit = await appendAuditTx(tx, {
      tenantId: args.tenantId,
      at,
      actorKind: args.actor.kind,
      actorId: args.actor.id,
      actorName: args.actor.name,
      actorRole: args.actor.role,
      action: "PRIZE_EXCHANGE",
      target: done.map((d) => d.id).join(","),
      summary: `獲得商品 ${done.length}点 をポイントへ交換しました（+${gained}pt）。`,
      before: done.map((d) => d.name).join("、"),
      after: `残高 ${balance}pt`,
      requestId: args.requestId,
      data: {
        userId: args.userId,
        userName: str(user.name),
        prizeIds: done.map((d) => d.id).join(","),
        prizeNames: done.map((d) => d.name).join("、"),
        gainedPt: gained,
        balanceBefore: num(user.points),
        balanceAfter: balance,
      },
    });

    return { exchanged: done, gainedPt: gained, balance, auditSeq: audit.seq };
  });
}
