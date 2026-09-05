/**
 * 公開中のガチャの写真を差し替える（画面側）。
 *
 * ═══════════════════════════════════════════════════════
 * ★保存を押すまで、売り場は1ミリも変わらないこと
 * ═══════════════════════════════════════════════════════
 *
 *   写真を選んだ瞬間に売り場が変わると、
 *   「並べて見比べてから決める」ができません。
 *   間違えた1枚が、そのままお客様に見えます。
 *
 *   ですので、この部品は2段になっています。
 *
 *     ① 写真を預ける（uploadImage）… IDをもらうだけ。売り場は変わらない
 *     ② 保存を押す（saveGachaImages）… ここで初めて入れ替わる
 *
 *   ①と②の間が「保存前プレビュー」です。
 *   ★①の直後に②を自動で呼ばないこと。プレビューが消えます。
 *
 * ★ここで「たぶん保存できました」と書かないこと。
 *   通信できなかったときは、写真は変わっていません。
 *   曖昧に書くと、変わっていないのに変わったと思って画面を閉じます。
 */

"use client";

import { postHeaders } from "@/lib/csrf";

/** 表紙をあらわす合図。サーバー側（lib/server/gachaImages.ts）と必ず同じ文字 */
export const COVER_SLOT = "COVER";

export type SlotView = {
  slot: string;
  label: string;
  imageId: string | null;
  url: string | null;
  drawn: number;
  total: number;
};

export type HistoryRow = {
  id: string;
  slot: string;
  kind: string;
  oldImageId: string | null;
  newImageId: string | null;
  reason: string | null;
  at: string;
  byName: string | null;
};

export type ImagesView = {
  gacha: { id: string; title: string; status: string };
  slots: SlotView[];
  history: HistoryRow[];
};

export type LoadResult =
  | { ok: true; view: ImagesView }
  | { ok: false; message: string };

export async function loadGachaImages(gachaId: string): Promise<LoadResult> {
  try {
    const res = await fetch(
      `/api/console/gacha-images?gachaId=${encodeURIComponent(gachaId)}`,
      { cache: "no-store" },
    );
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      gacha?: ImagesView["gacha"];
      slots?: SlotView[];
      history?: HistoryRow[];
    };
    if (!res.ok || !data.ok || !data.gacha) {
      return {
        ok: false,
        message: String(data.message ?? "") || "写真の情報を読み取れませんでした。",
      };
    }
    return {
      ok: true,
      view: {
        gacha: data.gacha,
        slots: Array.isArray(data.slots) ? data.slots : [],
        history: Array.isArray(data.history) ? data.history : [],
      },
    };
  } catch {
    return { ok: false, message: "通信できませんでした。もう一度お試しください。" };
  }
}

export type SaveResult =
  | {
      ok: true;
      changed: { slot: string; from: string | null; to: string | null }[];
      note: string;
    }
  | { ok: false; message: string };

/**
 * 差し替えを保存する。
 *
 * ★slots には「変えたところだけ」を入れること。
 *   全部を毎回送ると、画面の読み込みが1回失敗しただけで
 *   「全部を null で上書き」が起きます。写真が全消えします。
 */
export async function saveGachaImages(args: {
  gachaId: string;
  slots: Record<string, string | null>;
  reason: string;
}): Promise<SaveResult> {
  try {
    const res = await fetch("/api/console/gacha-images", {
      method: "POST",
      headers: postHeaders(),
      cache: "no-store",
      body: JSON.stringify(args),
    });
    const data = (await res.json()) as {
      ok?: boolean;
      message?: string;
      note?: string;
      changed?: { slot: string; from: string | null; to: string | null }[];
    };
    if (!res.ok || !data.ok) {
      return {
        ok: false,
        message: String(data.message ?? "") || "保存できませんでした。写真は変わっていません。",
      };
    }
    return {
      ok: true,
      changed: Array.isArray(data.changed) ? data.changed : [],
      note: String(data.note ?? ""),
    };
  } catch {
    /* ★「変わったかもしれません」と書かないこと。送れていません */
    return { ok: false, message: "通信できませんでした。写真は変わっていません。" };
  }
}
