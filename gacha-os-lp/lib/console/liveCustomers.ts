/**
 * 会員一覧・会員詳細を、サーバーから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで数えないこと
 * ═══════════════════════════════════════════════════════
 *
 *   会員数も、危険度も、ポイントの食い違いも、
 *   サーバーが作った値をそのまま画面へ渡すだけにします。
 *
 *   同じ数字を出す場所が2つあると、必ずずれます。
 *   ずれた日に、どちらが正しいかを調べる人はいません。
 *   両方が信じられなくなるだけです。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに、0名と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   通信が切れただけなのに「会員は0名です」と出すと、
 *   運営の方は、会員が消えたと思います。
 *   読めていないときは、読めていないと書きます。
 *
 * ★使った金額の null を 0 に変えないこと。
 *   Number(null) は 0 です。
 *   その1行で「見せられない」が「1円も使っていない」に化けます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { CustomerDetail, CustomerRow } from "@/lib/server/customerAdmin";

export type { CustomerDetail, CustomerRow };

export type CustomerCounts = {
  all: number;
  active: number;
  suspended: number;
  other: number;
  highRisk: number;
  mismatch: number;
};

export type CustomerListPayload = {
  /** 絞り込んだ結果の件数。★会社の会員数ではありません */
  total: number;
  /** この人に金額を見せてよいか。★false と「0円」は別ものです */
  canSeeMoney: boolean;
  /** この人が会員を止められるか。★守りはサーバーにあります */
  canSuspend: boolean;
  counts: CustomerCounts;
  customers: CustomerRow[];
};

export type CustomerListState =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: CustomerListPayload }
  | { phase: "ng"; data: null; why: string; code: string };

/** 一覧の絞り込み。★画面で絞らず、この条件をサーバーへ渡すこと */
export type CustomerFilter = {
  q: string;
  status: string;
  risk: string;
  onlyMismatch: boolean;
};

export const EMPTY_CUSTOMER_FILTER: CustomerFilter = {
  q: "",
  status: "",
  risk: "",
  onlyMismatch: false,
};

export function useCustomerList(filter: CustomerFilter): {
  state: CustomerListState;
  reload: () => void;
} {
  const [state, setState] = useState<CustomerListState>({
    phase: "loading",
    data: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const { q, status, risk, onlyMismatch } = filter;

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      /* 読み直しの間も、前の数字を出したままにしない。
         古い数字を新しい数字だと思って読まれるのが、いちばん困ります */
      setState({ phase: "loading", data: null });

      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status", status);
      if (risk) p.set("risk", risk);
      if (onlyMismatch) p.set("mismatch", "1");
      const qs = p.toString();

      try {
        const res = await fetch(`/api/console/customers${qs ? `?${qs}` : ""}`, {
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
                : String(data.message ?? "") || "会員を読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }

        const c = (data.counts ?? {}) as Record<string, unknown>;

        setState({
          phase: "ok",
          data: {
            total: Number(data.total ?? 0),
            /* ★?? true にしないこと。分からないときに見せてしまいます */
            canSeeMoney: data.canSeeMoney === true,
            canSuspend: data.canSuspend === true,
            counts: {
              all: Number(c.all ?? 0),
              active: Number(c.active ?? 0),
              suspended: Number(c.suspended ?? 0),
              other: Number(c.other ?? 0),
              highRisk: Number(c.highRisk ?? 0),
              mismatch: Number(c.mismatch ?? 0),
            },
            customers: Array.isArray(data.customers)
              ? (data.customers as CustomerRow[])
              : [],
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "会員を読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [q, status, risk, onlyMismatch, tick]);

  return { state, reload };
}

export type CustomerDetailState =
  | { phase: "idle"; customer: null }
  | { phase: "loading"; customer: null }
  | { phase: "ok"; customer: CustomerDetail; canSuspend: boolean }
  | { phase: "ng"; customer: null; why: string; code: string };

/**
 * 1人ぶんの中身を読む。
 *
 * ★一覧の行を写して使わないこと。
 *   止める・戻すを押した瞬間に、状態も履歴も変わります。
 *   写した値を持つと、板の中だけ古いまま残り、
 *   押しても何も起きていないように見えます。
 */
export function useCustomerDetail(customerId: string | null): {
  state: CustomerDetailState;
  reload: () => void;
} {
  const [state, setState] = useState<CustomerDetailState>({
    phase: "idle",
    customer: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!customerId) {
      setState({ phase: "idle", customer: null });
      return;
    }
    let ikiteru = true;

    (async () => {
      setState({ phase: "loading", customer: null });
      try {
        const res = await fetch(
          `/api/console/customers?id=${encodeURIComponent(customerId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          code?: string;
          canSuspend?: boolean;
          customer?: CustomerDetail;
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok || !data.customer) {
          setState({
            phase: "ng",
            customer: null,
            why:
              String(data.message ?? "") || "この会員を読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }
        setState({
          phase: "ok",
          customer: data.customer,
          canSuspend: data.canSuspend === true,
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            customer: null,
            why: "この会員を読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [customerId, tick]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   操作（停止・停止解除）
   ══════════════════════════════════════════════ */

export type CustomerActionKind = "suspend" | "resume";

export type CustomerActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; code: string };

/**
 * 操作を1つ送る。
 *
 * ★ここで「できるかどうか」を判断しないこと。
 *   押せる・押せないの見た目は親切のためであって、守りではありません。
 *   守りはサーバー（lib/server/customerAdmin.ts）にあります。
 *   ここで先回りして判断すると、判断が2か所になり、必ずずれます。
 */
export async function runCustomerAction(args: {
  action: CustomerActionKind;
  customerId: string;
  reason: string;
}): Promise<CustomerActionResult> {
  try {
    const res = await fetch("/api/console/customers/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        action: args.action,
        customerId: args.customerId,
        reason: args.reason ?? "",
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      code?: string;
    };

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        /* ★「失敗しました」で終わらせないこと。
             サーバーは、なぜ断ったかを日本語で返しています */
        message: String(data.message ?? "") || "操作できませんでした。",
        code: String(data.code ?? `HTTP_${res.status}`),
      };
    }
    return { ok: true, message: String(data.message ?? "完了しました。") };
  } catch {
    return {
      ok: false,
      message:
        "通信できませんでした。保存されているデータは変わっていません。",
      code: "NETWORK",
    };
  }
}
