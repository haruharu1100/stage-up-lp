/**
 * 本物の数字を、サーバーから1回だけ読む。
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
 *
 * ═══════════════════════════════════════════════════════
 * ★null を Number() に通さないこと（いちばん間違えやすい所）
 * ═══════════════════════════════════════════════════════
 *
 *   Number(null) は 0 です。
 *   つまり Number(data.revenueToday ?? 0) と書いた瞬間、
 *   「見せられない」が「0円」に化けます。
 *
 *   サーバーは、見せられない数字を必ず null で返します。
 *   その null を、ここで壊さないこと。
 *   下の kazu() は、null を null のまま返すためだけの道具です。
 */

"use client";

import { useEffect, useState } from "react";
import type { AdminSummary } from "@/lib/server/adminSummary";

/**
 * 画面が受け取る数字のかたまり。
 *
 * ★サーバー側（lib/server/adminSummary.ts）の型をそのまま借りること。
 *   ここで作り直すと、サーバーに項目を足した日に、
 *   画面側だけ古いままになります。
 *   借りていれば、足し忘れは tsc が見つけます。
 *
 * ★import type なので、サーバーのコードは画面に入りません。
 *   型はビルド時に消えます。
 */
export type LiveCounts = AdminSummary;

/** 還元率が危ないガチャ1本ぶん */
export type RtpAlertSummary = NonNullable<AdminSummary["rtpAlerts"]>[number];

export type LiveCountsState =
  /** まだ読んでいる途中 */
  | { phase: "loading"; counts: null }
  /** 読めた */
  | { phase: "ok"; counts: LiveCounts }
  /** 読めなかった（入っていない・通信が切れた など） */
  | { phase: "ng"; counts: null; why: string };

/** 数にする。★null は null のまま返すこと（0 にしない） */
const kazu = (v: unknown): number | null =>
  v === null || v === undefined ? null : Number(v);

/** 必ず数で来るはずのもの。来なかったら 0 ではなく、読めなかった扱いにする */
const hissu = (v: unknown): number => Number(v ?? 0);

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
        const data = (await res.json()) as Partial<Record<string, unknown>> & {
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
                ? "この数字を見る権限がありません。"
                : (String(data.message ?? "") || "数字を読み取れませんでした。"),
          });
          return;
        }

        setState({
          phase: "ok",
          counts: {
            /* お金。見る権限が無ければ null で来る */
            revenueToday: kazu(data.revenueToday),
            revenueMonth: kazu(data.revenueMonth),
            grossProfitMonth: kazu(data.grossProfitMonth),

            /* 動き */
            playsToday: kazu(data.playsToday),
            customersTotal: kazu(data.customersTotal),
            gachasPublished: kazu(data.gachasPublished),

            /* 仕事の残り */
            unshippedShipments: hissu(data.unshippedShipments),
            unassignedItems: hissu(data.unassignedItems),
            ordersTotal: hissu(data.ordersTotal),
            ordersPending: hissu(data.ordersPending),
            ordersUnpaid: hissu(data.ordersUnpaid),
            ordersToday: hissu(data.ordersToday),
            prizesUnchosen: kazu(data.prizesUnchosen),

            /* 対応の残り */
            supportOpen: kazu(data.supportOpen),
            supportHumanReview: kazu(data.supportHumanReview),
            supportNew: kazu(data.supportNew),
            supportHigh: kazu(data.supportHigh),

            /* ポイントの見張り。★null（見せられない）を 0 に潰さないこと */
            pointMismatch: kazu(data.pointMismatch),
            pointPending: kazu(data.pointPending),

            /* 危ないもの */
            fraudHighRisk: kazu(data.fraudHighRisk),
            rtpDangerCount: kazu(data.rtpDangerCount),
            rtpWarnCount: kazu(data.rtpWarnCount),
            /* ★?? [] にしないこと。null（見る権限が無い）を
                 空っぽ（異常なし）に化けさせてしまいます */
            rtpAlerts: Array.isArray(data.rtpAlerts)
              ? (data.rtpAlerts as RtpAlertSummary[])
              : null,
          },
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            counts: null,
            why: "数字を読み取れませんでした。",
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
  /**
   * 飛んだ先での絞り込み。
   *
   * ★件数を押したのに、全件の一覧が出る、をやらないこと。
   *   「人の確認が必要 3件」を押した人が見たいのは、その3件です。
   *   200件の中から3件を探させると、その画面は使われなくなります。
   */
  query?: Record<string, string>;
};

/**
 * 「やること」を、実データだけから作る。
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
 * ★見る権限が無い数字（null）からは、用件を作らないこと。
 *   0件と同じ扱いにすると、「あなたには無い」が
 *   「今日は無い」に化けます。
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

  /**
   * 人の確認が要る問い合わせ。
   *
   * ★これを「対応中」と一緒に数えないこと。
   *   AIが答えられずに止まっている件だけが、
   *   人が動かないかぎり一生進みません。
   */
  if (c.supportHumanReview !== null && c.supportHumanReview > 0) {
    out.push({
      urgency: "MUST",
      label: "人の確認が必要な問い合わせ",
      count: c.supportHumanReview,
      to: "support",
      /* 押したら、その件だけが出るようにする */
      query: { status: "HUMAN_REVIEW" },
    });
  }

  /**
   * まだ誰も何もしていない問い合わせ。
   *
   * ★「人の確認が必要」と混ぜないこと。
   *   やることが違います。
   *     人の確認 … AIが答えられなかった。人が読んで書く
   *     未対応  … まだ誰も開いていない。まず開く
   */
  if (c.supportNew !== null && c.supportNew > 0) {
    out.push({
      urgency: "SHOULD",
      label: "まだ誰も見ていない問い合わせ",
      count: c.supportNew,
      to: "support",
      query: { status: "NEW" },
    });
  }

  /**
   * 危ない会員。
   *
   * ★まだ人が見ていない（OPEN）ものだけが入っています。
   *   処理済みまで数えると、いつまでも赤いままになり、
   *   そのうち誰も見なくなります。
   */
  if (c.fraudHighRisk !== null && c.fraudHighRisk > 0) {
    out.push({
      urgency: "MUST",
      label: "確認が必要な会員（高リスク）",
      count: c.fraudHighRisk,
      to: "fraud",
    });
  }

  /**
   * ポイント台帳と残高が合っていない会員。
   *
   * ★なぜ、発送より先なのか。
   *   残高と台帳が食い違っている状態は、
   *   「お客様の持っているポイントが、記録と違う」ということです。
   *   放っておくと、その残高のままガチャが回り、景品が出て、
   *   どこまでが正しかったのかを、あとから決められなくなります。
   *
   * ★0件のときは出さないこと。
   *   0件は「全員合っている」という良い知らせです。
   *   用件として並べると、毎日出て、読まれなくなります。
   *
   * ★null（見る権限が無い）からは作らないこと。
   *   「あなたには見えない」が「今日は無い」に化けます。
   */
  if (c.pointMismatch !== null && c.pointMismatch > 0) {
    out.push({
      urgency: "MUST",
      label: "ポイント確認が必要",
      count: c.pointMismatch,
      to: "points",
    });
  }

  /**
   * 承認を待っているポイント調整。
   *
   * ★これを「不整合」と同じ行にまとめないこと。
   *   不整合は「壊れている」、承認待ちは「人の判断を待っている」で、
   *   やることが違います。まとめると、どちらの対処もされません。
   */
  if (c.pointPending !== null && c.pointPending > 0) {
    out.push({
      urgency: "SHOULD",
      label: "承認待ちのポイント調整",
      count: c.pointPending,
      to: "points",
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

  /*
    ★「相場の更新が止まっている」は、まだここに足しません。
      相場（market_prices）は、いま画面が固定表を見ています。
      つないでいないものを「4件止まっています」と出すと、
      それは実データではなく、作り話になります。
      相場をDBにつないだ日に、ここへ足します。
  */

  return out;
}
