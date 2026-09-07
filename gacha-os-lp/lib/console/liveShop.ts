/**
 * お客様の売り場を、サーバーから読む／実際に引く。
 *
 * ═══════════════════════════════════════════════════════
 * ★見本データを、このファイルへ持ち込まないこと
 * ═══════════════════════════════════════════════════════
 *
 *   lib/console/state.ts には、説明用の見本ガチャが入っています。
 *   便利なので、つい混ぜたくなります。混ぜないでください。
 *
 *   お客様が見る棚に見本が1本でも混ざると、
 *   その1本は「押しても引けないガチャ」になります。
 *   お客様には、故障にしか見えません。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに「0件」と書かないこと
 * ═══════════════════════════════════════════════════════
 *
 *   lib/console/liveMyPage.ts と同じ決まりです。
 *   通信が切れただけで「販売中のガチャはありません」と出すと、
 *   お客様は、店が閉まったと受け取ります。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";

/* ══════════════════════════════════════════════
   受け取る形（サーバーの lib/server/shop.ts と対）
   ══════════════════════════════════════════════ */

export type ShopItem = {
  id: string;
  title: string;
  price: number;
  total: number;
  left: number;
  publishedAt: string | null;
  top: { grade: string; name: string; value: number } | null;
  sLeft: number;
  /**
   * 表紙の写真のID。お店がまだ入れていなければ null。
   *
   * ★null のときに、画面側で絵を描かないこと。
   *   「画像未登録」と出します（components/console/customer/art.tsx）。
   */
  coverImageId: string | null;

  /**
   * この1本が入っている棚（カテゴリ）のID。
   *
   * ★棚の名前を、この画面側に書き置きしないこと。
   *   名前は categories の側にあります（お店が作った値です）。
   */
  categoryIds: string[];
};

/** 絞り込みに出す棚。★中身が0本の棚は、サーバーが返しません */
export type ShopCategory = { id: string; name: string; count: number };

/** 売り場ぜんぶ（並ぶガチャと、絞り込みの棚） */
export type ShopBoard = { gachas: ShopItem[]; categories: ShopCategory[] };

export type ShopPrize = {
  grade: string;
  name: string;
  value: number;
  total: number;
  left: number;
  /** この賞の写真。無ければ null */
  imageId: string | null;
};

export type ShopDetail = ShopItem & { prizes: ShopPrize[] };

/** 引いた結果（サーバーの DrawResult のうち、画面で使う分だけ） */
export type DrawOutcome = {
  drawId: string;
  replayed: boolean;
  gachaId: string;
  gachaTitle: string;
  price: number;
  pointBefore: number;
  pointAfter: number;
  pointReturned: number;
  grade: string;
  prizeName: string;
  prizeValue: number;
  lastOne: boolean;
  needsShipping: boolean;
  remainingAfter: number;
  at: string;
  /** 当たった賞の写真。無ければ null（結果画面は「画像未登録」と出します） */
  imageId: string | null;
};

export type Live<T> =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: T }
  | { phase: "anon"; data: null }
  | { phase: "ng"; data: null; why: string };

/* ══════════════════════════════════════════════
   読む
   ══════════════════════════════════════════════ */

function useLive<T>(
  url: string,
  pick: (raw: Record<string, unknown>) => T | null,
): { state: Live<T>; reload: () => void } {
  const [state, setState] = useState<Live<T>>({ phase: "loading", data: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      try {
        /* ★no-store を外さないこと。
             残り口数は、他の方が引くたびに変わります。
             取っておいた古い数を出すと、
             「残り1口」と書いてある画面で売り切れが起きます。 */
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
            why: "情報を読み取れませんでした。通信の状態をご確認のうえ、もう一度お試しください。",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [url, tick, pick]);

  return { state, reload };
}

const pickList = (raw: Record<string, unknown>): ShopBoard | null =>
  Array.isArray(raw.gachas)
    ? {
        gachas: raw.gachas as ShopItem[],
        /* ★棚が無くても、売り場は出すこと。
             棚を1つも作っていないお店でも、ガチャは並びます。 */
        categories: Array.isArray(raw.categories)
          ? (raw.categories as ShopCategory[])
          : [],
      }
    : null;

const pickDetail = (raw: Record<string, unknown>) =>
  raw.gacha && typeof raw.gacha === "object" ? (raw.gacha as ShopDetail) : null;

/*
 * ★入口が2つある理由（2026-09-07）
 *
 *   /api/customer/... … ログインしている方。合言葉からお店が決まります。
 *   /api/shop/...     … ログインしていない方。住所からお店が決まります。
 *
 *   返す中身は、どちらもまったく同じ関数（lib/server/shop.ts）で
 *   作っています。ですので、画面はどちらから来た値かを気にしません。
 *
 *   ★guest 側にだけ列を足さないこと。
 *     ログイン前の人にだけ見える情報、という置き場所になります。
 */

/** 販売中のガチャと、絞り込みの棚を読む */
export function useShopList(guest = false) {
  return useLive<ShopBoard>(
    guest ? "/api/shop/gachas" : "/api/customer/gachas",
    pickList,
  );
}

/** ガチャ1本の中身を読む */
export function useShopDetail(gachaId: string, guest = false) {
  const base = guest ? "/api/shop/gachas" : "/api/customer/gachas";
  return useLive<ShopDetail>(
    `${base}/${encodeURIComponent(gachaId)}`,
    pickDetail,
  );
}

/* ══════════════════════════════════════════════
   引く
   ══════════════════════════════════════════════ */

export type DrawAnswer =
  | { ok: true; result: DrawOutcome }
  | { ok: false; code: string; message: string };

/**
 * 二重実行を防ぐ鍵を1つ作る。
 *
 * ★1回の「引く」につき1つ。やり直すときは同じ値を送ること。
 *   押すたびに新しくすると、通信のやり直しがそのまま二重抽選になります。
 */
export function newDrawKey(): string {
  try {
    return `draw_${crypto.randomUUID()}`;
  } catch {
    /* 古い環境で randomUUID が無い場合。
       ★ここで Math.random だけにしないこと。
         同じ鍵が二人に当たると、片方が引けません。 */
    return `draw_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 12)}`;
  }
}

/**
 * 実際に1回引く。
 *
 * ★結果を、この画面側で作らないこと。
 *   当選・料金・残高は、すべてサーバーが決めた値をそのまま出します。
 *   画面側で計算すると、画面とDBで違う数字が出ます。
 *
 * ★送るのは「どのガチャか」と「鍵」だけ。
 *   金額や当選確率を送る作りにすると、そこが書き換えられます。
 */
export async function drawOnce(
  gachaId: string,
  idempotencyKey: string,
): Promise<DrawAnswer> {
  try {
    const res = await fetch("/api/console/draw", {
      method: "POST",
      headers: { ...postHeaders(), "Idempotency-Key": idempotencyKey },
      body: JSON.stringify({ gachaId }),
    });
    const raw = (await res.json()) as Record<string, unknown>;

    if (res.ok && raw.ok === true && raw.result) {
      return { ok: true, result: raw.result as DrawOutcome };
    }
    return {
      ok: false,
      code: typeof raw.code === "string" ? raw.code : "UNKNOWN",
      message:
        typeof raw.message === "string"
          ? raw.message
          : "引くことができませんでした。もう一度お試しください。",
    };
  } catch {
    /* ★ここで「失敗しました」だけを返さないこと。
         通信が切れた場合、サーバー側では成立しているかもしれません。
         同じ鍵で送り直せば二重には引かれない、と伝えます。 */
    return {
      ok: false,
      code: "NETWORK",
      message:
        "通信が切れました。もう一度お試しください。同じ操作で二重に引かれることはありません。",
    };
  }
}
