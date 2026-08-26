/**
 * 本物の件数を、サーバーから1回だけ読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★「読めなかったとき」を、0にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   読めなかったときに 0 を返すと、画面には
 *
 *       未発送 0件
 *
 *   と出ます。運営者は、片づいたのだと思って画面を閉じます。
 *   本当は、数えられなかっただけです。
 *
 *   だから、この関数は「読めた数」と「読めたかどうか」を、
 *   必ずセットで返します。読めていないときに数を出すのは、
 *   画面側の責任で禁止します（「分かりません」と出すこと）。
 */

"use client";

import { useEffect, useState } from "react";

/** 還元率が危ないガチャ1本ぶん */
export type RtpAlertSummary = {
  gachaId: string;
  title: string;
  level: "WARN" | "DANGER" | "INFO" | "OK";
  message: string;
  advice?: string;
};

export type LiveCounts = {
  unshippedShipments: number;
  unassignedItems: number;
  ordersTotal: number;
  ordersPending: number;
  ordersUnpaid: number;
  ordersToday: number;

  /**
   * 還元率が危ない・注意のガチャ。
   *
   * ★見る権限が無いときは null にすること。空配列にしないこと。
   *   空配列は「異常なし」と読めます。「見ていない」とは別物です。
   */
  rtpAlerts: RtpAlertSummary[] | null;
};

export type LiveCountsState =
  /** まだ読んでいる途中 */
  | { phase: "loading"; counts: null }
  /** 読めた */
  | { phase: "ok"; counts: LiveCounts }
  /** 読めなかった（権限が無い・通信が切れた など） */
  | { phase: "ng"; counts: null; why: string };

/**
 * @param on false のときは、そもそも読みにいかない。
 *           （デモの見本データだけを見せている場面で使います）
 */
export function useLiveCounts(on = true): LiveCountsState {
  const [state, setState] = useState<LiveCountsState>({
    phase: "loading",
    counts: null,
  });

  useEffect(() => {
    if (!on) return;
    let ikiteru = true;

    (async () => {
      try {
        const res = await fetch("/api/console/summary", { cache: "no-store" });
        const data = (await res.json()) as Partial<LiveCounts> & {
          ok?: boolean;
          message?: string;
        };
        if (!ikiteru) return;

        if (!res.ok || !data.ok) {
          setState({
            phase: "ng",
            counts: null,
            why:
              res.status === 403
                ? "この件数を見る権限がありません。"
                : (data.message ?? "件数を読み取れませんでした。"),
          });
          return;
        }

        setState({
          phase: "ok",
          counts: {
            unshippedShipments: Number(data.unshippedShipments ?? 0),
            unassignedItems: Number(data.unassignedItems ?? 0),
            ordersTotal: Number(data.ordersTotal ?? 0),
            ordersPending: Number(data.ordersPending ?? 0),
            ordersUnpaid: Number(data.ordersUnpaid ?? 0),
            ordersToday: Number(data.ordersToday ?? 0),
            /* ★?? [] にしないこと。null（見る権限が無い）を
                 空っぽ（異常なし）に化けさせてしまいます */
            rtpAlerts: Array.isArray(data.rtpAlerts) ? data.rtpAlerts : null,
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            counts: null,
            why: "件数を読み取れませんでした。",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [on]);

  return state;
}

/* ══════════════════════════════════════════════
   実データから作る「今日やること」
   ══════════════════════════════════════════════ */

export type LiveTodo = {
  urgency: "MUST" | "SHOULD";
  label: string;
  count: number;
  /** 押したときに飛ぶ画面 */
  to: string;
};

/**
 * 注文と発送の「やること」を、実データから作る。
 *
 * ★ここを、ダッシュボードとAIオペレーターで別々に書かないこと。
 *   別々に書くと、片方だけ直した日に、
 *   ダッシュボードは「発送待ち6件」、AIは「ありません」になります。
 *   運営者から見れば、どちらかが壊れている、としか分かりません。
 *
 * ★読めていないとき（loading / ng）は、1件も返さないこと。
 *   件数の分からない用件を並べると、一覧そのものが信用されません。
 *   「読めていない」は、画面のカード側がはっきり書きます。
 *
 * ★ここに行き先（to）を足したら、OperatorScreen の why() にも
 *   「なぜ先にやるのか」を足すこと。
 *   足し忘れは tests/operatorReasons.test.ts が見つけます。
 */
export function liveTodos(state: LiveCountsState): LiveTodo[] {
  if (state.phase !== "ok") return [];
  const c = state.counts;
  const out: LiveTodo[] = [];

  /**
   * 還元率の異常は、いちばん上に出す。
   *
   * ★なぜ、発送や支払より先なのか。
   *   発送が1日遅れても、遅れただけです。あとから取り返せます。
   *   還元率がずれたまま売り続けると、
   *   お客様への還元が約束より少ないまま、売れた数だけ被害が増えます。
   *   これは、あとから取り返せません。
   *
   *   2026-08-26 に見つかった 88％→18.23％ は、
   *   500回ぶん売れきってから気づきました。
   *   1回目で気づける場所を、ここに作ります。
   *
   * ★INFO（データ不足）は出さないこと。
   *   毎日出る用件は、読まれなくなります。
   */
  for (const a of c.rtpAlerts ?? []) {
    if (a.level !== "DANGER" && a.level !== "WARN") continue;
    out.push({
      urgency: a.level === "DANGER" ? "MUST" : "SHOULD",
      label: `還元率の異常：${a.title}`,
      count: 1,
      to: "rtp",
    });
  }

  /* 支払の確認は、待たせるほど「入金したのに届かない」の問い合わせになります */
  if (c.ordersUnpaid > 0) {
    out.push({ urgency: "MUST", label: "支払確認", count: c.ordersUnpaid, to: "orders" });
  }

  /* まだ箱に入れていない商品＝これから作る発送の数 */
  if (c.unassignedItems > 0) {
    out.push({
      urgency: "SHOULD",
      label: "まだ箱に入れていない商品",
      count: c.unassignedItems,
      to: "orders",
    });
  }

  /* 箱はできているが、まだ出荷していないもの */
  if (c.unshippedShipments > 0) {
    out.push({
      urgency: "SHOULD",
      label: "発送待ち",
      count: c.unshippedShipments,
      to: "shipping",
    });
  }

  return out;
}
