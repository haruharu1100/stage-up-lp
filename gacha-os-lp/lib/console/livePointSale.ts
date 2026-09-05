/**
 * ポイント販売（売っている商品・購入・決済会社からの確定通知）を、サーバーから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここから、ポイントを足せるようにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   この画面は「お金は払ったのに、ポイントが増えていません」を
 *   調べるための画面です。調べていると、必ずこう思います。
 *
 *       「足りていないようなので、足しておきました」
 *
 *   これを1回でも許すと、遅れて届いた確定通知が入った日に、
 *   同じ入金で2回ポイントが増えます。
 *   足りない分は、既存のポイント調整（二人承認）で扱います。
 *
 * ═══════════════════════════════════════════════════════
 * ★金額と付与ptは、この画面が正本です
 * ═══════════════════════════════════════════════════════
 *
 *   売っているものの値段をコードに書くと、
 *   店舗が値段を変えるたびに、こちらへ依頼が来ます。
 *   ですので、金額・付与pt・おまけpt・並び順・停止は、
 *   すべて point_products の行として、この画面から変えます。
 *
 *   ★ただし、ここを変えても、過去の注文は動きません。
 *     注文を作った時点で金額と付与ptを注文へ写し取っています。
 *     画面にもそう書いてあります。書いておかないと、
 *     「値段を直したら、昨日の注文はどうなるのか」が分からず、
 *     怖くて誰も値段を直せなくなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに 0 と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   Number(null) は 0 です。
 *   その1行で「見せられない」が「0円」「0件」に化けます。
 *   分からないときは null のまま画面へ渡します。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";
import type { OrderView, PointProduct } from "@/lib/server/pointPurchase";

export type { OrderView, PointProduct };

/** 管理画面の購入一覧は、誰が買ったかまで出す */
export type AdminOrder = OrderView & { userId: string; userName: string };

/** 決済会社からの確定通知の受信記録 */
export type PaymentEvent = {
  provider: string;
  eventId: string;
  orderId: string | null;
  /** APPLIED / DUPLICATE / MISMATCH / REJECTED など。サーバーが決めます */
  result: string;
  /** ★null は「金額が通知に入っていなかった」。0円ではありません */
  amountYen: number | null;
  note: string;
  createdAt: string;
};

export type PointProductsPayload = {
  /**
   * この人が商品を変えてよいか。
   *
   * ★?? true にしないこと。分からないときに変えさせてしまいます。
   *   守りはサーバー（point.request）にあります。ここは見た目だけです。
   */
  canEdit: boolean;
  /** いま使っている決済のしくみ（mock / stripe / gmo）。読めなければ null */
  provider: string | null;
  /**
   * 決済のしくみが決まっていない・設定が足りないときの理由。
   *
   * ★null でないときは、画面のいちばん上に必ず出すこと。
   *   出さないと「商品を作ったのに、誰も買えない」ことに気づけません。
   */
  providerError: string | null;
  products: PointProduct[];
};

export type PointOrdersPayload = {
  orders: AdminOrder[];
  events: PaymentEvent[];
  /** ★0 でないときは、いちばん上に出すこと。下に置くと誰も気づきません */
  mismatchCount: number;
};

export type PointSaleState<T> =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: T }
  | { phase: "ng"; data: null; why: string; code: string };

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/* ══════════════════════════════════════════════
   売っている商品
   ══════════════════════════════════════════════ */

export function usePointProducts(): {
  state: PointSaleState<PointProductsPayload>;
  reload: () => void;
} {
  const [state, setState] = useState<PointSaleState<PointProductsPayload>>({
    phase: "loading",
    data: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      /* ★読み直しの間、前の値段を出したままにしないこと。
           直した直後に古い値段が残っていると、
           「保存できていない」と思って、もう一度保存されます */
      setState({ phase: "loading", data: null });

      try {
        const res = await fetch("/api/console/point-products", {
          cache: "no-store",
        });
        const data = (await res.json()) as Record<string, unknown> & {
          ok?: boolean;
          message?: string;
          code?: string;
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok) {
          setState({
            phase: "ng",
            data: null,
            why:
              res.status === 403
                ? "この画面を見る権限がありません。"
                : String(data.message ?? "") ||
                  "ポイント商品を読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }

        setState({
          phase: "ok",
          data: {
            canEdit: data.canEdit === true,
            provider:
              typeof data.provider === "string" && data.provider !== ""
                ? data.provider
                : null,
            providerError:
              typeof data.providerError === "string" &&
              data.providerError !== ""
                ? data.providerError
                : null,
            products: Array.isArray(data.products)
              ? (data.products as PointProduct[])
              : [],
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "ポイント商品を読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [tick]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   購入と、確定通知の受信記録
   ══════════════════════════════════════════════ */

export function usePointOrders(): {
  state: PointSaleState<PointOrdersPayload>;
  reload: () => void;
} {
  const [state, setState] = useState<PointSaleState<PointOrdersPayload>>({
    phase: "loading",
    data: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      setState({ phase: "loading", data: null });

      try {
        const res = await fetch("/api/console/point-orders", {
          cache: "no-store",
        });
        const data = (await res.json()) as Record<string, unknown> & {
          ok?: boolean;
          message?: string;
          code?: string;
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok) {
          setState({
            phase: "ng",
            data: null,
            why:
              res.status === 403
                ? "購入の記録を見る権限がありません。"
                : String(data.message ?? "") ||
                  "購入の記録を読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }

        const events = Array.isArray(data.events)
          ? (data.events as Record<string, unknown>[]).map((e) => ({
              provider: String(e.provider ?? ""),
              eventId: String(e.eventId ?? ""),
              orderId: e.orderId ? String(e.orderId) : null,
              result: String(e.result ?? ""),
              /* ★Number(x ?? 0) と書かないこと。
                   「金額が入っていない通知」が「0円の通知」になります */
              amountYen: numOrNull(e.amountYen),
              note: String(e.note ?? ""),
              createdAt: String(e.createdAt ?? ""),
            }))
          : [];

        setState({
          phase: "ok",
          data: {
            orders: Array.isArray(data.orders)
              ? (data.orders as AdminOrder[])
              : [],
            events,
            /* ★ここで数え直さないこと。
                 サーバーが数えた数と2つになり、いつか必ずずれます */
            mismatchCount: Number(data.mismatchCount ?? 0),
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "購入の記録を読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [tick]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   商品を作る・直す
   ══════════════════════════════════════════════ */

export type SaveProductResult =
  | { ok: true; productId: string; created: boolean }
  | { ok: false; message: string; code: string };

/**
 * ポイント商品を保存する。
 *
 * ★ここで数字を丸めないこと。
 *   「1.5 と打たれたので 1 にしておきました」を画面側でやると、
 *   打った本人は 1.5 で保存されたと思ったまま帰ります。
 *   整数かどうかを見るのは、サーバー1か所だけです。
 *
 * ★止めるときも、この保存を使うこと（status を DISABLED にする）。
 *   行を消す口は、わざと作っていません。
 *   消すと、過去の注文が「何を買ったのか」を誰も答えられなくなります。
 */
export async function savePointProduct(args: {
  productId?: string;
  name: string;
  priceYen: number;
  points: number;
  bonusPoints: number;
  status: "ACTIVE" | "DISABLED";
  sortOrder: number;
}): Promise<SaveProductResult> {
  try {
    const res = await fetch("/api/console/point-products", {
      method: "POST",
      /* ★postHeaders() を必ず通すこと（CSRF の合図が付きます）。
           付け忘れると、押しても 403 で断られます。 */
      headers: postHeaders(),
      cache: "no-store",
      body: JSON.stringify(args),
    });
    const data = (await res.json()) as Record<string, unknown> & {
      ok?: boolean;
      message?: string;
      code?: string;
    };

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        /* ★「失敗しました」で終わらせないこと。
             サーバーは、なぜ断ったかを日本語で返しています */
        message: String(data.message ?? "") || "保存できませんでした。",
        code: String(data.code ?? `HTTP_${res.status}`),
      };
    }

    return {
      ok: true,
      productId: String(data.productId ?? ""),
      created: data.created === true,
    };
  } catch {
    return {
      ok: false,
      message:
        "通信できませんでした。売っている商品は、1つも変わっていません。",
      code: "NETWORK",
    };
  }
}
