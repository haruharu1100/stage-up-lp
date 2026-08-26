/**
 * ガチャ一覧・ガチャ詳細を、サーバーから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここで数えないこと
 * ═══════════════════════════════════════════════════════
 *
 *   還元率も、売上も、残り口数も、サーバーが作った値を
 *   そのまま画面へ渡すだけにします。
 *
 *   2026-08-26、画面に 88.0％ と出ているのに、
 *   実際にお客様へ返っていたのは 18.23％ でした。
 *   同じ数字を出す場所が2つあると、こうなります。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに、0件と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   通信が切れただけなのに「ガチャは0件です」と出すと、
 *   運営の方は、登録が消えたと思います。
 *   読めていないときは、読めていないと書きます。
 *
 * ★売上の null を 0 に変えないこと。
 *   Number(null) は 0 です。
 *   その1行で「見せられない」が「1円も売れていない」に化けます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import type { GachaDetail, GachaRow } from "@/lib/server/gachaAdmin";

export type { GachaDetail, GachaRow };

/** 一覧を読んだ結果 */
export type GachaListPayload = {
  total: number;
  /** この人に売上を見せてよいか。★false と「売上0円」は別ものです */
  canSeeRevenue: boolean;
  dangerCount: number;
  warnCount: number;
  unverifiedCount: number;
  gachas: GachaRow[];
};

export type GachaListState =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: GachaListPayload }
  | { phase: "ng"; data: null; why: string; code: string };

/** 一覧の絞り込み。★画面で絞らず、この条件をサーバーへ渡すこと */
export type GachaFilter = {
  q: string;
  status: string;
  onlyAlert: boolean;
};

export const EMPTY_FILTER: GachaFilter = { q: "", status: "", onlyAlert: false };

/**
 * 一覧を読む。
 *
 * ★絞り込みを、読んだあとの配列に対して掛けないこと。
 *   件数が増えた日に、上限で切られた中だけを絞ることになります。
 *   出てこないガチャがあっても、画面には何も出ません。
 */
export function useGachaList(filter: GachaFilter): {
  state: GachaListState;
  reload: () => void;
} {
  const [state, setState] = useState<GachaListState>({
    phase: "loading",
    data: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  const { q, status, onlyAlert } = filter;

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      /* 読み直しの間も、前の数字を出したままにしない。
         古い数字を新しい数字だと思って読まれるのが、いちばん困ります */
      setState({ phase: "loading", data: null });

      const p = new URLSearchParams();
      if (q.trim()) p.set("q", q.trim());
      if (status) p.set("status", status);
      if (onlyAlert) p.set("alert", "1");
      const qs = p.toString();

      try {
        const res = await fetch(`/api/console/gachas${qs ? `?${qs}` : ""}`, {
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
                : String(data.message ?? "") || "ガチャを読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }

        setState({
          phase: "ok",
          data: {
            total: Number(data.total ?? 0),
            /* ★?? true にしないこと。分からないときに見せてしまいます */
            canSeeRevenue: data.canSeeRevenue === true,
            dangerCount: Number(data.dangerCount ?? 0),
            warnCount: Number(data.warnCount ?? 0),
            unverifiedCount: Number(data.unverifiedCount ?? 0),
            gachas: Array.isArray(data.gachas) ? (data.gachas as GachaRow[]) : [],
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "ガチャを読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [q, status, onlyAlert, tick]);

  return { state, reload };
}

export type GachaDetailState =
  | { phase: "idle"; gacha: null }
  | { phase: "loading"; gacha: null }
  | { phase: "ok"; gacha: GachaDetail }
  | { phase: "ng"; gacha: null; why: string; code: string };

/**
 * 1本ぶんの中身を読む。
 *
 * ★一覧の行を写して使わないこと。
 *   公開・停止を押した瞬間に、状態も還元率も変わります。
 *   写した値を持つと、板の中だけ古いまま残り、
 *   押しても何も起きていないように見えます。
 */
export function useGachaDetail(gachaId: string | null): {
  state: GachaDetailState;
  reload: () => void;
} {
  const [state, setState] = useState<GachaDetailState>({
    phase: "idle",
    gacha: null,
  });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!gachaId) {
      setState({ phase: "idle", gacha: null });
      return;
    }
    let ikiteru = true;

    (async () => {
      setState({ phase: "loading", gacha: null });
      try {
        const res = await fetch(
          `/api/console/gachas?id=${encodeURIComponent(gachaId)}`,
          { cache: "no-store" },
        );
        const data = (await res.json()) as {
          ok?: boolean;
          message?: string;
          code?: string;
          gacha?: GachaDetail;
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok || !data.gacha) {
          setState({
            phase: "ng",
            gacha: null,
            why: String(data.message ?? "") || "このガチャを読み取れませんでした。",
            code: String(data.code ?? `HTTP_${res.status}`),
          });
          return;
        }
        setState({ phase: "ok", gacha: data.gacha });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            gacha: null,
            why: "このガチャを読み取れませんでした。",
            code: "NETWORK",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [gachaId, tick]);

  return { state, reload };
}

/* ══════════════════════════════════════════════
   操作（検証・公開・停止・再開）
   ══════════════════════════════════════════════ */

export type GachaActionKind = "verify" | "publish" | "pause" | "resume";

export type GachaActionResult =
  | { ok: true; message: string }
  | { ok: false; message: string; code: string };

/**
 * 操作を1つ送る。
 *
 * ★ここで「できるかどうか」を判断しないこと。
 *   押せる・押せないの見た目は親切のためであって、守りではありません。
 *   守りはサーバー（lib/server/gachaAdmin.ts）にあります。
 *   ここで先回りして判断すると、判断が2か所になり、必ずずれます。
 */
export async function runGachaAction(args: {
  action: GachaActionKind;
  gachaId: string;
  reason?: string;
}): Promise<GachaActionResult> {
  try {
    const res = await fetch("/api/console/gachas/action", {
      method: "POST",
      headers: { "content-type": "application/json" },
      cache: "no-store",
      body: JSON.stringify({
        action: args.action,
        gachaId: args.gachaId,
        reason: args.reason ?? "",
      }),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      code?: string;
      detail?: string;
    };

    if (!res.ok || !data.ok) {
      return {
        ok: false,
        /* ★「失敗しました」で終わらせないこと。
             サーバーは、なぜ断ったかを日本語で返しています */
        message:
          [String(data.message ?? ""), String(data.detail ?? "")]
            .filter(Boolean)
            .join(" ") || "操作できませんでした。",
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
