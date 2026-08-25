/**
 * お客様ご自身のご注文と、その発送の進み具合を、サーバーから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★管理画面と、同じ1つのデータを見ること
 * ═══════════════════════════════════════════════════════
 *
 *   運営者が「発送済み」にした瞬間に、お客様の画面も発送済みになる。
 *   これが出来ていないと、次のことが起きます。
 *
 *       運営者「もう出しました」
 *       お客様「私の画面には準備中と出ています」
 *
 *   どちらも嘘をついていません。画面が2つあるだけです。
 *   だから、ここは自前で状態を組み立てません。
 *   /api/customer/orders が返した文言を、そのまま出します。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに、「ご注文はありません」と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   通信が切れただけなのに「発送のご依頼はありません」と出すと、
 *   お客様は、依頼が消えたと思います。そこから問い合わせが立ちます。
 *   読めていないときは、読めていないと書きます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";

/** サーバーが返す形（lib/server/shipments.ts の CustomerOrderView と同じ） */
export type CustomerShipment = {
  shipmentNumber: string;
  status: string;
  statusLabel: string;
  carrier: string | null;
  trackingNumber: string | null;
  shippedAt: string | null;
  deliveredAt: string | null;
  itemNames: string[];
};

export type CustomerOrder = {
  orderId: string;
  orderNumber: string;
  orderedAt: string;
  orderStatus: string;
  itemCount: number;
  shippedCount: number;
  /** 「3点中2点発送済み、残り1点準備中です。」の1行 */
  progress: string;
  items: {
    name: string;
    state: string;
    shipmentNumber: string | null;
    carrier: string | null;
    trackingNumber: string | null;
  }[];
  shipments: CustomerShipment[];
};

export type CustomerOrdersState =
  /** まだ読んでいる途中 */
  | { phase: "loading"; orders: null }
  /** 読めた（0件も「読めた」に入ります） */
  | { phase: "ok"; orders: CustomerOrder[] }
  /** ログインしていない。＝本物の状況は、まだ出せない */
  | { phase: "anon"; orders: null }
  /** 読めなかった（通信が切れた など） */
  | { phase: "ng"; orders: null; why: string };

export function useCustomerOrders(on = true): {
  state: CustomerOrdersState;
  reload: () => void;
} {
  const [state, setState] = useState<CustomerOrdersState>({
    phase: "loading",
    orders: null,
  });
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!on) return;
    let ikiteru = true;

    (async () => {
      try {
        const res = await fetch("/api/customer/orders", { cache: "no-store" });

        /* ★401/403 を「失敗」と書かないこと。
             ログインしていないだけの人に赤い警告を出すと、
             壊れていると思われます。 */
        if (res.status === 401 || res.status === 403) {
          if (ikiteru) setState({ phase: "anon", orders: null });
          return;
        }

        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          orders?: CustomerOrder[];
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok || !Array.isArray(data.orders)) {
          setState({
            phase: "ng",
            orders: null,
            why: data.message ?? "お届け状況を読み取れませんでした。",
          });
          return;
        }

        setState({ phase: "ok", orders: data.orders });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            orders: null,
            why: "お届け状況を読み取れませんでした。",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [on, tick]);

  return { state, reload };
}

/**
 * 「いま動いている（＝お届け完了ではない）ご注文」の数。
 *
 * ★読めていないときは null を返すこと。
 *   0 を返すと、マイページの入口に「発送中 0件」と出ます。
 *   お客様は、依頼が通っていないと判断します。
 */
export function movingCount(state: CustomerOrdersState): number | null {
  if (state.phase !== "ok") return null;

  return state.orders.filter((o) => {
    if (o.orderStatus === "CANCELLED") return false;

    /* すでにお手元へ届いた荷物 */
    const todoita = new Set(
      o.shipments
        .filter((s) => s.status === "DELIVERED")
        .map((s) => s.shipmentNumber),
    );

    /* ★「荷物を見て終わり」にしないこと。
         3点のうち2点だけ荷物にして、その荷物が届いた場合、
         荷物だけを見ると「全部届いた」になります。
         残り1点は、まだ荷物にすらなっていません。
         だから、商品の側から数えます。 */
    return o.items.some((i) => {
      if (i.state === "取消") return false;
      if (i.shipmentNumber === null) return true;
      return !todoita.has(i.shipmentNumber);
    });
  }).length;
}
