/**
 * ポイントの一覧・詳細・調整申請を、サーバーから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★正本は Point Ledger（point_ledger）です
 * ═══════════════════════════════════════════════════════
 *
 *   画面に出るポイントは、
 *
 *     ・ブラウザ側で足したもの
 *     ・お客様画面に出ていた数字
 *     ・見本の固定値
 *
 *   のどれでもありません。台帳（point_ledger）が正本です。
 *   残高（customers.points）は、台帳から作られた「写し」です。
 *
 *   写しと正本が食い違ったときに、写しのほうを見せて
 *   「合っている」と言ってしまうのが、いちばん危ない間違いです。
 *   だから、照合はサーバー（lib/server/pointAdmin.ts）が行い、
 *   ここは受け取って渡すだけにします。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで足し算をしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   Before・After・合計・食い違いの数は、全部サーバーが作ります。
 *   ここで作り直すと、同じ数字を出す場所が2つになります。
 *   2つあるものは、いつか必ずずれます。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに 0pt と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   Number(null) は 0 です。
 *   その1行で「見せられない」が「残高0ポイント」に化けます。
 *   0ポイントは「本当に1ptも持っていない」という意味です。
 *   見せられないときは null のまま画面へ渡し、
 *   画面は「権限がありません」と書きます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";
import type {
  LedgerLine,
  PointAdjustment,
  PointDetail,
  PointIntegrity,
  PointRow,
} from "@/lib/server/pointAdmin";

export type { LedgerLine, PointAdjustment, PointDetail, PointIntegrity, PointRow };

export type PointCounts = {
  all: number;
  hasBalance: number;
  movedToday: number;
  mismatch: number;
  adjusted: number;
  pending: number;
  /** ★null は「見せられない」。0pt ではありません */
  totalPoints: number | null;
  totalLedger: number | null;
};

export type PointListPayload = {
  /** 絞り込んだ結果の件数。★会社の会員数ではありません */
  total: number;
  /** この人に残高を見せてよいか。★false と「0pt」は別ものです */
  canSeePoints: boolean;
  /** この人が調整を申請できるか。★守りはサーバーにあります */
  canRequest: boolean;
  /** この人が承認できるか。★守りはサーバーにあります */
  canApprove: boolean;
  /** 二人承認が要る境目（pt）。★画面で決め打ちしないこと */
  fourEyesThreshold: number;
  /** 自分の番号。「これは自分が出した申請だ」を出すために使います */
  meId: string;
  counts: PointCounts;
  pendingCount: number;
  customers: PointRow[];
};

export type PointListState =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: PointListPayload }
  | { phase: "ng"; data: null; why: string; code: string };

/** 一覧の絞り込み。★画面で絞らず、この条件をサーバーへ渡すこと */
export type PointFilter = {
  q: string;
  onlyHasBalance: boolean;
  onlyMovedToday: boolean;
  onlyMismatch: boolean;
  onlyAdjusted: boolean;
  onlyPending: boolean;
};

export const EMPTY_POINT_FILTER: PointFilter = {
  q: "",
  onlyHasBalance: false,
  onlyMovedToday: false,
  onlyMismatch: false,
  onlyAdjusted: false,
  onlyPending: false,
};

const numOrNull = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

export function usePointList(filter: PointFilter): {
  state: PointListState;
  reload: () => void;
} {
  const [state, setState] = useState<PointListState>({
    phase: "loading",
    data: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const {
    q,
    onlyHasBalance,
    onlyMovedToday,
    onlyMismatch,
    onlyAdjusted,
    onlyPending,
  } = filter;

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      /* ★読み直しの間、前の残高を出したままにしないこと。
           調整した直後に古い残高が残っていると、
           「反映されていない」と思って、もう一度調整されます */
      setState({ phase: "loading", data: null });

      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (onlyHasBalance) p.set("balance", "1");
      if (onlyMovedToday) p.set("today", "1");
      if (onlyMismatch) p.set("mismatch", "1");
      if (onlyAdjusted) p.set("adjusted", "1");
      if (onlyPending) p.set("pending", "1");
      const qs = p.toString();

      try {
        const res = await fetch(`/api/console/points${qs ? `?${qs}` : ""}`, {
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
                  "ポイントを読み取れませんでした。",
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
            canSeePoints: data.canSeePoints === true,
            canRequest: data.canRequest === true,
            canApprove: data.canApprove === true,
            fourEyesThreshold: Number(data.fourEyesThreshold ?? 0),
            meId: String(data.meId ?? ""),
            counts: {
              all: Number(c.all ?? 0),
              hasBalance: Number(c.hasBalance ?? 0),
              movedToday: Number(c.movedToday ?? 0),
              mismatch: Number(c.mismatch ?? 0),
              adjusted: Number(c.adjusted ?? 0),
              pending: Number(c.pending ?? 0),
              /* ★ここを Number(x ?? 0) と書かないこと。
                   「見せられない」が「合計0pt」になります */
              totalPoints: numOrNull(c.totalPoints),
              totalLedger: numOrNull(c.totalLedger),
            },
            pendingCount: Number(data.pendingCount ?? 0),
            customers: Array.isArray(data.customers)
              ? (data.customers as PointRow[])
              : [],
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "ポイントを読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [
    q,
    onlyHasBalance,
    onlyMovedToday,
    onlyMismatch,
    onlyAdjusted,
    onlyPending,
    tick,
  ]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   1人ぶんの中身（台帳の時系列）
   ══════════════════════════════════════════════ */

export type PointDetailState =
  | { phase: "idle"; customer: null }
  | { phase: "loading"; customer: null }
  | {
      phase: "ok";
      customer: PointDetail;
      canRequest: boolean;
      canApprove: boolean;
      fourEyesThreshold: number;
      meId: string;
    }
  | { phase: "ng"; customer: null; why: string; code: string };

/**
 * 1人ぶんの台帳を読む。
 *
 * ★一覧の行を写して使わないこと。
 *   調整を1件通した瞬間に、残高も台帳も整合性も変わります。
 *   写した値を持つと、板の中だけ古いまま残り、
 *   「押しても何も起きていない」ように見えます。
 */
export function usePointDetail(userId: string | null): {
  state: PointDetailState;
  reload: () => void;
} {
  const [state, setState] = useState<PointDetailState>({
    phase: "idle",
    customer: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!userId) {
      setState({ phase: "idle", customer: null });
      return;
    }
    let ikiteru = true;

    (async () => {
      setState({ phase: "loading", customer: null });
      try {
        const res = await fetch(
          `/api/console/points?id=${encodeURIComponent(userId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          code?: string;
          canRequest?: boolean;
          canApprove?: boolean;
          fourEyesThreshold?: number;
          meId?: string;
          customer?: PointDetail;
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok || !data.customer) {
          setState({
            phase: "ng",
            customer: null,
            why:
              String(data.message ?? "") ||
              "この会員のポイントを読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }
        setState({
          phase: "ok",
          customer: data.customer,
          canRequest: data.canRequest === true,
          canApprove: data.canApprove === true,
          fourEyesThreshold: Number(data.fourEyesThreshold ?? 0),
          meId: String(data.meId ?? ""),
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            customer: null,
            why: "この会員のポイントを読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [userId, tick]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   承認待ちの一覧
   ══════════════════════════════════════════════ */

export type AdjustmentListPayload = {
  canRequest: boolean;
  canApprove: boolean;
  fourEyesThreshold: number;
  meId: string;
  pendingCount: number;
  adjustments: PointAdjustment[];
};

export type AdjustmentListState =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: AdjustmentListPayload }
  | { phase: "ng"; data: null; why: string; code: string };

export function useAdjustments(status: string): {
  state: AdjustmentListState;
  reload: () => void;
} {
  const [state, setState] = useState<AdjustmentListState>({
    phase: "loading",
    data: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      setState({ phase: "loading", data: null });

      const p = new URLSearchParams({ view: "adjustments" });
      if (status) p.set("status", status);

      try {
        const res = await fetch(`/api/console/points?${p.toString()}`, {
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
                  "申請を読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }

        setState({
          phase: "ok",
          data: {
            canRequest: data.canRequest === true,
            canApprove: data.canApprove === true,
            fourEyesThreshold: Number(data.fourEyesThreshold ?? 0),
            meId: String(data.meId ?? ""),
            pendingCount: Number(data.pendingCount ?? 0),
            adjustments: Array.isArray(data.adjustments)
              ? (data.adjustments as PointAdjustment[])
              : [],
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "申請を読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [status, tick]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   操作（申請・承認・却下）
   ══════════════════════════════════════════════ */

export type PointActionResult =
  | {
      ok: true;
      message: string;
      /** 申請だけで止まったのか、その場で反映されたのか */
      status?: string;
      needsApproval?: boolean;
      balanceBefore?: number | null;
      balanceAfter?: number | null;
      /** 同じ鍵の申請が既にあり、2件目を作らなかった */
      reused?: boolean;
      /** 承認を待つあいだに残高が動いていた */
      balanceMoved?: boolean;
    }
  | { ok: false; message: string; code: string };

/** 二度押しよけの鍵。★1回の操作につき1つ作ること */
export function newIdempotencyKey(): string {
  try {
    return crypto.randomUUID();
  } catch {
    /* 古いブラウザ向け。鍵が無くても断られはしません（申請が1件増えるだけ） */
    return `k-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

/**
 * ポイント調整を申請する。
 *
 * ★ここで「10万pt を超えるから承認待ちになるはずだ」と
 *   先回りして判断しないこと。
 *   境目を決めるのはサーバー（lib/server/points.ts の
 *   FOUR_EYES_THRESHOLD）1か所だけです。
 *   画面にも書くと、境目を変えた日に、片方だけ古いままになります。
 *
 * ★鍵（Idempotency-Key）を必ず渡すこと。
 *   申請ボタンは、たいてい2回押されます。通信が遅いときは特にです。
 *   鍵が同じなら、サーバーは2件目を作らず、1件目の結果を返します。
 */
export async function runPointRequest(args: {
  userId: string;
  delta: number;
  reason: string;
  idempotencyKey: string;
}): Promise<PointActionResult> {
  try {
    const res = await fetch("/api/console/points/request", {
      method: "POST",
      /* ★postHeaders() を必ず通すこと（CSRF の合図が付きます）。
           付け忘れると、押しても 403 で断られます。 */
      headers: {
        ...postHeaders(),
        "Idempotency-Key": args.idempotencyKey,
      },
      cache: "no-store",
      body: JSON.stringify({
        userId: args.userId,
        delta: args.delta,
        reason: args.reason ?? "",
      }),
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
        message: String(data.message ?? "") || "申請できませんでした。",
        code: String(data.code ?? `HTTP_${res.status}`),
      };
    }

    const status = String(data.status ?? "");
    return {
      ok: true,
      message:
        status === "APPLIED"
          ? "反映しました。"
          : "申請しました。別の担当者の承認を待ちます。",
      status,
      needsApproval: data.needsApproval === true,
      balanceBefore: numOrNull(data.balanceBefore),
      balanceAfter: numOrNull(data.balanceAfter),
      reused: data.reused === true,
    };
  } catch {
    return {
      ok: false,
      message:
        "通信できませんでした。ポイントは1ptも動いていません。",
      code: "NETWORK",
    };
  }
}

/**
 * 申請を承認する・却下する。
 *
 * ★却下にも理由が要ります。
 *   「却下」とだけ残っていると、申請した人は何を直せばよいのか
 *   分からないまま、同じ申請をもう一度出します。
 */
export async function runPointDecide(args: {
  adjustmentId: string;
  approve: boolean;
  note: string;
}): Promise<PointActionResult> {
  try {
    const res = await fetch("/api/console/points/approve", {
      method: "POST",
      /* ★postHeaders() を必ず通すこと（CSRF の合図が付きます）。
           付け忘れると、押しても 403 で断られます。 */
      headers: postHeaders(),
      cache: "no-store",
      body: JSON.stringify({
        adjustmentId: args.adjustmentId,
        approve: args.approve === true,
        note: args.note ?? "",
      }),
    });
    const data = (await res.json()) as Record<string, unknown> & {
      ok?: boolean;
      message?: string;
      code?: string;
    };

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        message: String(data.message ?? "") || "処理できませんでした。",
        code: String(data.code ?? `HTTP_${res.status}`),
      };
    }

    const moved = data.balanceMoved === true;
    return {
      ok: true,
      message:
        data.status === "APPROVED"
          ? moved
            ? "承認して反映しました。承認を待つあいだに残高が動いていたため、いまの残高を基準に計算しました。"
            : "承認して反映しました。"
          : "却下しました。ポイントは動いていません。",
      status: String(data.status ?? ""),
      balanceBefore: numOrNull(data.balanceBefore),
      balanceAfter: numOrNull(data.balance),
      balanceMoved: moved,
    };
  } catch {
    return {
      ok: false,
      message: "通信できませんでした。ポイントは1ptも動いていません。",
      code: "NETWORK",
    };
  }
}
