/**
 * 問い合わせの一覧・詳細・操作を、サーバーから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★正本は support_tickets と ticket_messages です
 * ═══════════════════════════════════════════════════════
 *
 *   ここに出る問い合わせは、
 *
 *     ・ブラウザの中だけで作った見本
 *     ・画面を開くたびに作り直される仮のもの
 *
 *   のどちらでもありません。
 *   お客様がマイページから出したものが、そのまま出ます。
 *   お客様の画面と管理画面は、同じ1つの表を読んでいます。
 *
 * ═══════════════════════════════════════════════════════
 * ★取れなかったときに「0件」と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   0件は「対応が必要な問い合わせは無い」という意味です。
 *   読み取れなかったことを0件と書くと、
 *   運営者は安心して画面を閉じます。
 *   そのあいだ、お客様は返事を待ち続けます。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで数えないこと・ここで絞らないこと
 * ═══════════════════════════════════════════════════════
 *
 *   件数も絞り込みもサーバー（lib/server/ticketAdmin.ts）が行います。
 *   ここで .filter() を書くと、
 *   ダッシュボードの件数と問い合わせ画面の件数が、いつか必ずずれます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  Assignee,
  TicketCounts,
  TicketDetail,
  TicketMessage,
  TicketRow,
} from "@/lib/server/ticketAdmin";

export type { Assignee, TicketCounts, TicketDetail, TicketMessage, TicketRow };

export type TicketListPayload = {
  /** 絞り込んだ結果の件数。★全体の件数ではありません */
  total: number;
  /** この人が返信できるか。★守りはサーバーにあります */
  canReply: boolean;
  meId: string;
  counts: TicketCounts;
  /** 担当者に選べる人。★返信できない人は入っていません */
  assignees: Assignee[];
  tickets: TicketRow[];
};

export type TicketListState =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: TicketListPayload }
  | { phase: "ng"; data: null; why: string; code: string };

/** 一覧の絞り込み（30項目の4番）。★画面で絞らず、サーバーへ渡すこと */
export type TicketFilter = {
  q: string;
  /** "" なら全部。NEW / AI_REPLIED / HUMAN_REVIEW / IN_PROGRESS / RESOLVED */
  status: string;
  onlyHigh: boolean;
  onlyUnassigned: boolean;
  onlyOpen: boolean;
  /** 担当者で絞る。"" なら全部 */
  assigneeId: string;
};

export const EMPTY_TICKET_FILTER: TicketFilter = {
  q: "",
  status: "",
  onlyHigh: false,
  onlyUnassigned: false,
  onlyOpen: false,
  assigneeId: "",
};

const EMPTY_COUNTS: TicketCounts = {
  all: 0,
  open: 0,
  new: 0,
  aiReplied: 0,
  humanReview: 0,
  inProgress: 0,
  resolved: 0,
  high: 0,
  unassigned: 0,
};

function countsOf(v: unknown): TicketCounts {
  const c = (v ?? {}) as Record<string, unknown>;
  return {
    all: Number(c.all ?? 0),
    open: Number(c.open ?? 0),
    new: Number(c.new ?? 0),
    aiReplied: Number(c.aiReplied ?? 0),
    humanReview: Number(c.humanReview ?? 0),
    inProgress: Number(c.inProgress ?? 0),
    resolved: Number(c.resolved ?? 0),
    high: Number(c.high ?? 0),
    unassigned: Number(c.unassigned ?? 0),
  };
}

export function useTicketList(filter: TicketFilter): {
  state: TicketListState;
  reload: () => void;
} {
  const [state, setState] = useState<TicketListState>({
    phase: "loading",
    data: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const { q, status, onlyHigh, onlyUnassigned, onlyOpen, assigneeId } = filter;

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      /* ★読み直しの間、前の一覧を出したままにしないこと。
           返信した直後に古い状態が残っていると、
           「送れていない」と思って、もう一度送られます */
      setState({ phase: "loading", data: null });

      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status", status);
      if (onlyHigh) p.set("high", "1");
      if (onlyUnassigned) p.set("unassigned", "1");
      if (onlyOpen) p.set("open", "1");
      if (assigneeId) p.set("assignee", assigneeId);
      const qs = p.toString();

      try {
        const res = await fetch(`/api/console/tickets${qs ? `?${qs}` : ""}`, {
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
                  "問い合わせを読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }

        setState({
          phase: "ok",
          data: {
            total: Number(data.total ?? 0),
            /* ★?? true にしないこと。分からないときに送信ボタンが出ます */
            canReply: data.canReply === true,
            meId: String(data.meId ?? ""),
            counts: countsOf(data.counts),
            assignees: Array.isArray(data.assignees)
              ? (data.assignees as Assignee[])
              : [],
            tickets: Array.isArray(data.tickets)
              ? (data.tickets as TicketRow[])
              : [],
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "問い合わせを読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [q, status, onlyHigh, onlyUnassigned, onlyOpen, assigneeId, tick]);

  return { state, reload };
}

export { EMPTY_COUNTS };

/* ══════════════════════════════════════════════
   1件ぶんのやり取り
   ══════════════════════════════════════════════ */

export type TicketDetailState =
  | { phase: "idle"; ticket: null }
  | { phase: "loading"; ticket: null }
  | { phase: "ok"; ticket: TicketDetail; canReply: boolean; meId: string }
  | { phase: "ng"; ticket: null; why: string; code: string };

/**
 * 1件ぶんのやり取りを読む。
 *
 * ★一覧の行を写して使わないこと。
 *   返信を1件送った瞬間に、状態も件数も担当者も変わります。
 *   写した値を持つと、開いた板の中だけ古いまま残り、
 *   「押しても何も起きていない」ように見えます。
 */
export function useTicketDetail(ticketId: string | null): {
  state: TicketDetailState;
  reload: () => void;
} {
  const [state, setState] = useState<TicketDetailState>({
    phase: "idle",
    ticket: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!ticketId) {
      setState({ phase: "idle", ticket: null });
      return;
    }
    let ikiteru = true;

    (async () => {
      setState({ phase: "loading", ticket: null });
      try {
        const res = await fetch(
          `/api/console/tickets?id=${encodeURIComponent(ticketId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          code?: string;
          canReply?: boolean;
          meId?: string;
          ticket?: TicketDetail;
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok || !data.ticket) {
          setState({
            phase: "ng",
            ticket: null,
            why:
              String(data.message ?? "") ||
              "この問い合わせを読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }
        setState({
          phase: "ok",
          ticket: data.ticket,
          canReply: data.canReply === true,
          meId: String(data.meId ?? ""),
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            ticket: null,
            why: "この問い合わせを読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [ticketId, tick]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   操作
   ══════════════════════════════════════════════ */

export type TicketActionResult =
  | { ok: true; message: string; data: Record<string, unknown> }
  | { ok: false; message: string; code: string };

async function post(body: Record<string, unknown>): Promise<TicketActionResult> {
  try {
    const res = await fetch("/api/console/tickets/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify(body),
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
        message: String(data.message ?? "") || "処理できませんでした。",
        code: String(data.code ?? `HTTP_${res.status}`),
      };
    }
    return {
      ok: true,
      message: String(data.message ?? "処理しました。"),
      data: (data.result ?? {}) as Record<string, unknown>,
    };
  } catch {
    return {
      ok: false,
      message:
        "通信できませんでした。お客様には、まだ何も送られていません。",
      code: "NETWORK",
    };
  }
}

/** AIに一次回答の下書きを作らせる。★送信ではありません */
export function runAiReply(ticketId: string): Promise<TicketActionResult> {
  return post({ action: "ai-reply", ticketId });
}

/**
 * 担当者が返信を送る。
 *
 * ★送ったら取り消せません。
 *   お客様のマイページには、その場で出ます。
 */
export function runReply(args: {
  ticketId: string;
  text: string;
  resolve: boolean;
}): Promise<TicketActionResult> {
  return post({
    action: "reply",
    ticketId: args.ticketId,
    text: args.text,
    resolve: args.resolve === true,
  });
}

/** 担当者を決める・外す。null なら外す */
export function runAssign(args: {
  ticketId: string;
  assigneeId: string | null;
}): Promise<TicketActionResult> {
  return post({
    action: "assign",
    ticketId: args.ticketId,
    assigneeId: args.assigneeId,
  });
}

/** 状態を変える。★理由が要ります */
export function runStatus(args: {
  ticketId: string;
  to: string;
  reason: string;
}): Promise<TicketActionResult> {
  return post({
    action: "status",
    ticketId: args.ticketId,
    to: args.to,
    reason: args.reason,
  });
}

/** 優先度を変える。★理由が要ります */
export function runPriority(args: {
  ticketId: string;
  to: string;
  reason: string;
}): Promise<TicketActionResult> {
  return post({
    action: "priority",
    ticketId: args.ticketId,
    to: args.to,
    reason: args.reason,
  });
}
