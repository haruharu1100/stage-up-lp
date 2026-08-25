/**
 * マイページの中身を、サーバーから読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに「0件」「0pt」と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   これが、この1ファイルでいちばん大事な取り決めです。
 *
 *   通信が切れただけなのに「保有ポイント 0pt」と出ると、
 *   お客様は、ポイントが消えたと思います。
 *   「獲得商品 0件」と出れば、当たった商品が消えたと思います。
 *
 *   そこから何が起きるか。まず問い合わせが来ます。
 *   次に、SNSに「ポイントが消えた」と書かれます。
 *   こちらのDBは、何も壊れていません。
 *   壊れていないのに、信用だけが壊れます。
 *
 *   ですので、状態は4つに分けます。
 *
 *       loading … まだ読んでいる途中
 *       ok      … 読めた（0件も「読めた」に入ります）
 *       anon    … ログインしていない
 *       ng      … 読めなかった
 *
 *   ok 以外のときは、数字を出しません。「—」を出します。
 *
 * ═══════════════════════════════════════════════════════
 * ★数え方や状態名を、この画面側で組み立て直さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「未選択」「発送依頼済み」「発送中」…の振り分けは、
 *   サーバー（lib/server/prizes.ts）が決めた結果をそのまま出します。
 *
 *   画面側でもう一度 if を書くと、判断が2つに増えます。
 *   片方だけ直した日から、
 *   画面ではボタンが出るのに、押すと断られる、が起きます。
 *   お客様から見れば、ただの故障です。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";

/* ══════════════════════════════════════════════
   共通の入れもの
   ══════════════════════════════════════════════ */

export type Live<T> =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: T }
  | { phase: "anon"; data: null }
  | { phase: "ng"; data: null; why: string };

/**
 * 読み込みの共通部分。
 *
 * ★401/403 を「失敗」と書かないこと。
 *   ログインしていないだけの方に赤い警告を出すと、
 *   壊れていると思われます。
 */
function useLive<T>(
  url: string,
  pick: (raw: Record<string, unknown>) => T | null,
  on = true,
): { state: Live<T>; reload: () => void } {
  const [state, setState] = useState<Live<T>>({ phase: "loading", data: null });
  const [tick, setTick] = useState(0);

  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    if (!on) return;
    let ikiteru = true;

    (async () => {
      try {
        const res = await fetch(url, { cache: "no-store" });

        if (res.status === 401 || res.status === 403) {
          if (ikiteru) setState({ phase: "anon", data: null });
          return;
        }

        const raw = (await res.json()) as Record<string, unknown>;
        if (!ikiteru) return;

        const data = res.ok && raw.ok === true ? pick(raw) : null;
        if (data === null) {
          setState({
            phase: "ng",
            data: null,
            why:
              typeof raw.message === "string"
                ? raw.message
                : "情報を読み取れませんでした。",
          });
          return;
        }
        setState({ phase: "ok", data });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            /* ★「エラーが発生しました」で終わらせないこと。
                 何をすればよいかが書いていない文は、
                 読んだ方をその場に立ち止まらせます。 */
            why: "情報を読み取れませんでした。通信の状態をご確認のうえ、もう一度お試しください。",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [url, on, tick, pick]);

  return { state, reload };
}

/**
 * 状態を変える依頼を送る。
 *
 * ★成功したことにしてから送らないこと。
 *   押した瞬間に画面上で「交換済み」にしてしまうと、
 *   サーバーが断ったときに、画面だけが交換済みになります。
 *   返事を待ってから書き換えます。
 */
export async function sendChange(
  url: string,
  method: "POST" | "PUT",
  body: unknown,
): Promise<
  | { ok: true; data: Record<string, unknown> }
  | { ok: false; code: string; message: string; data: Record<string, unknown> }
> {
  try {
    const res = await fetch(url, {
      method,
      headers: postHeaders(),
      body: JSON.stringify(body),
    });
    const raw = (await res.json().catch(() => ({}))) as Record<string, unknown>;

    if (!res.ok || raw.ok !== true) {
      return {
        ok: false,
        /* ★断られた理由の合図（code）を、捨てないこと。
             文言だけを受け取る作りにすると、画面は
             「追加の本人確認が要る」と「本当に断られた」を
             区別できません。区別できないと、確認の窓を出せず、
             お客様は理由の分からない赤い字の前で止まります。 */
        code: typeof raw.code === "string" ? raw.code : "NG",
        message:
          typeof raw.message === "string"
            ? raw.message
            : "受け付けられませんでした。時間をおいて、もう一度お試しください。",
        /* ★断られたときの中身も、そのまま渡すこと。
             「確認は何分もつか」「あと何分待つか」といった、
             画面がお客様に伝えるべき数字が入っています。
             捨てると、画面がその数字を自分で決めることになり、
             サーバーと食い違った日から、嘘の案内になります。 */
        data: raw,
      };
    }
    return { ok: true, data: raw };
  } catch {
    /* ★ここで「失敗しました」と言い切らないこと。
         返事が届かなかっただけで、サーバー側では通っている
         ことがあります。もう一度押すと二重になります。
         ですので「ご確認ください」と書きます。 */
    return {
      ok: false,
      code: "NETWORK",
      message:
        "通信が途中で切れました。二重にならないよう、画面を読み込み直して結果をご確認ください。",
      data: {},
    };
  }
}

/* ══════════════════════════════════════════════
   獲得商品
   ══════════════════════════════════════════════ */

export type PrizeState =
  | "UNCHOSEN"
  | "SHIP_REQUESTED"
  | "SHIPPING"
  | "SHIPPED"
  | "EXCHANGED";

export type LivePrize = {
  id: string;
  name: string;
  grade: string;
  gachaTitle: string;
  value: number;
  exchangePt: number;
  wonAt: string;
  state: PrizeState;
  stateLabel: string;
  orderNumber: string | null;
  shipmentNumber: string | null;
  carrier: string | null;
  trackingNumber: string | null;
  /** ★この2つは、必ずサーバーの答えを使うこと */
  canShip: boolean;
  canExchange: boolean;
};

export type PrizesData = {
  prizes: LivePrize[];
  counts: Record<PrizeState, number>;
  labels: Record<PrizeState, string>;
  notes: Record<PrizeState, string>;
};

const pickPrizes = (raw: Record<string, unknown>): PrizesData | null =>
  Array.isArray(raw.prizes)
    ? {
        prizes: raw.prizes as LivePrize[],
        counts: raw.counts as Record<PrizeState, number>,
        labels: raw.labels as Record<PrizeState, string>,
        notes: raw.notes as Record<PrizeState, string>,
      }
    : null;

export function useCustomerPrizes(on = true) {
  return useLive<PrizesData>("/api/customer/prizes", pickPrizes, on);
}

/* ══════════════════════════════════════════════
   ポイント
   ══════════════════════════════════════════════ */

export type LivePointEntry = {
  id: string;
  at: string;
  kind: string;
  kindLabel: string;
  delta: number;
  memo: string;
  ref: string | null;
  balanceAfter: number;
};

export type PointsData = {
  balance: number;
  ledgerSum: number;
  /** 台帳の合計と残高が合っているか。★合っていなくても勝手に直さないこと */
  matches: boolean;
  entries: LivePointEntry[];
};

const pickPoints = (raw: Record<string, unknown>): PointsData | null =>
  typeof raw.balance === "number" && Array.isArray(raw.entries)
    ? {
        balance: raw.balance,
        ledgerSum: Number(raw.ledgerSum ?? 0),
        matches: raw.matches === true,
        entries: raw.entries as LivePointEntry[],
      }
    : null;

export function useCustomerPoints(on = true) {
  return useLive<PointsData>("/api/customer/points", pickPoints, on);
}

/* ══════════════════════════════════════════════
   お届け先
   ══════════════════════════════════════════════ */

export type LiveAddress = {
  name: string;
  zip: string;
  addr: string;
  tel: string;
};

export type AddressData = {
  address: LiveAddress | null;
  changedAt: string | null;
  /** すでに宛先が固まっている荷物の数。★変更してもここは動きません */
  frozenShipments: number;
  frozenOrders: number;
  stepUp: { need: boolean; reason: string; wouldNeed: boolean };
  /**
   * すでに「いま確かめた」印が付いているか。
   *
   * ★これで通す／通さないを決めないこと。
   *   画面の値は、開発者の道具で書き換えられます。
   *   通す判断は、必ずサーバー（PUT）が持ちます。
   *   ここは「先に確認の窓を出すかどうか」だけに使います。
   */
  stepUpFresh: boolean;
  /** 確認が何分もつか。画面の文言に出します */
  stepUpMinutes: number;
};

const pickAddress = (raw: Record<string, unknown>): AddressData | null =>
  "address" in raw
    ? {
        address: (raw.address as LiveAddress | null) ?? null,
        changedAt: (raw.changedAt as string | null) ?? null,
        frozenShipments: Number(raw.frozenShipments ?? 0),
        frozenOrders: Number(raw.frozenOrders ?? 0),
        stepUp: raw.stepUp as AddressData["stepUp"],
        stepUpFresh: raw.stepUpFresh === true,
        stepUpMinutes: Number(raw.stepUpMinutes ?? 10),
      }
    : null;

export function useCustomerAddress(on = true) {
  return useLive<AddressData>("/api/customer/address", pickAddress, on);
}

/* ══════════════════════════════════════════════
   お問い合わせ
   ══════════════════════════════════════════════ */

export type LiveTicket = {
  id: string;
  subject: string;
  body: string;
  status: string;
  statusLabel: string;
  answer: string | null;
  answeredBy: string | null;
  answeredAt: string | null;
  createdAt: string;
};

const pickTickets = (raw: Record<string, unknown>): LiveTicket[] | null =>
  Array.isArray(raw.tickets) ? (raw.tickets as LiveTicket[]) : null;

export function useCustomerSupport(on = true) {
  return useLive<LiveTicket[]>("/api/customer/support", pickTickets, on);
}

/* ══════════════════════════════════════════════
   お知らせ
   ══════════════════════════════════════════════ */

export type LiveNotice = {
  id: string;
  kind: string;
  channel: string;
  provider: string;
  status: string;
  title: string;
  body: string;
  refKind: string | null;
  refId: string | null;
  createdAt: string;
  sentAt: string | null;
  readAt: string | null;
  /**
   * 本当に外へ出たか。
   *
   * ★false のときに「送信済み」と書かないこと。
   *   いまの送り先は Mock（練習用の受け皿）です。
   *   メールもSMSも、実際には出ていません。
   */
  reallySent: boolean;
};

export type NoticesData = { notices: LiveNotice[]; unread: number };

const pickNotices = (raw: Record<string, unknown>): NoticesData | null =>
  Array.isArray(raw.notices)
    ? { notices: raw.notices as LiveNotice[], unread: Number(raw.unread ?? 0) }
    : null;

export function useCustomerNotices(on = true) {
  return useLive<NoticesData>("/api/customer/notices", pickNotices, on);
}

/* ══════════════════════════════════════════════
   画面に出す数（読めていないときは null）
   ══════════════════════════════════════════════ */

/**
 * ★null と 0 を混ぜないこと。
 *   null は「まだ数えられていない」、0 は「数えたら無かった」です。
 *   混ぜると、読めていないだけの画面が
 *   「あなたの商品はありません」に化けます。
 */
export function liveNum<T>(s: Live<T>, f: (d: T) => number): number | null {
  return s.phase === "ok" ? f(s.data) : null;
}
