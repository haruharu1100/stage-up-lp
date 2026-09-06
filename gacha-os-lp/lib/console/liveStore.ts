/**
 * 管理画面が「お店の設定」と「公開準備」を読み書きするための入口。
 *
 * ═══════════════════════════════════════════════════════
 * ★この画面側に、項目名や判定を書き写さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「運営法人名（販売業者）」という名前も、
 *   「これは必須です」という判定も、サーバーが持っています。
 *
 *       名前 … lib/server/tenantSettings.ts の FIELD_LABEL
 *       判定 … lib/server/launchReadiness.ts
 *
 *   便利だからと、こちらへ書き写したくなります。
 *   書き写した日は合っています。ずれるのは、その次に直した日です。
 *   そのとき、画面には「準備できています」と出ているのに、
 *   公開ボタンを押すと断られる、という形でずれます。
 *   ★お店は、自分が何を間違えたのか分からなくなります。
 *
 *   ですので、ここは「受け取って渡すだけ」にします。
 *
 * ═══════════════════════════════════════════════════════
 * ★読めなかったときに「未設定」と出さないこと
 * ═══════════════════════════════════════════════════════
 *
 *   通信が切れただけで「全部未設定です」と出すと、
 *   お店は、設定が消えたと受け取ります。
 *   そして、もう一度全部入力し直そうとします。
 *   読めていないときは、読めていないと書きます。
 */

"use client";

import { useCallback, useEffect, useState } from "react";
import { postHeaders } from "@/lib/csrf";

/* ══════════════════════════════════════════════
   受け取る形（サーバーと対）
   ══════════════════════════════════════════════ */

/** 項目のキー。★ここに一覧を書き並べないこと（サーバーから来ます） */
export type SettingField = string;

export type SettingFieldInfo = {
  field: SettingField;
  label: string;
  required: boolean;
};

export type StoreSettings = {
  values: Record<string, string | null>;
  updatedAt: string | null;
  updatedBy: string | null;
  missing: { field: string; label: string }[];
  complete: boolean;
};

export type StoreFaq = {
  id: string;
  order: number;
  question: string;
  answer: string;
  updatedAt: string;
};

export type StoreSettingsData = {
  canEdit: boolean;
  settings: StoreSettings;
  faqs: StoreFaq[];
  fields: SettingFieldInfo[];
};

export type ReadinessGroup =
  | "STORE"
  | "LEGAL"
  | "CONTACT"
  | "POINTS"
  | "CATALOG"
  | "PROVIDER";

export type ReadinessItem = {
  key: string;
  group: ReadinessGroup;
  label: string;
  done: boolean;
  todo: string | null;
  href: string | null;
  blocking: boolean;
};

export type Readiness = {
  items: ReadinessItem[];
  doneCount: number;
  totalCount: number;
  canPublish: boolean;
  blockers: ReadinessItem[];
};

export type ReadinessData = {
  readiness: Readiness;
  groups: { group: ReadinessGroup; label: string }[];
  blockMessage: string | null;
};

export type StoreCategory = {
  id: string;
  name: string;
  order: number;
  gachaCount: number;
};

export type CategoriesData = {
  canEdit: boolean;
  categories: StoreCategory[];
  limits: { maxCategories: number; maxPerGacha: number };
};

/**
 * 1本のガチャが、いまどの棚に入っているか。
 *
 * ★selected は「棚のID」の一覧です。名前ではありません。
 *   名前で持つと、棚の名前を変えた瞬間に、
 *   どの棚に入っていたのか分からなくなります。
 */
export type GachaCategoriesData = {
  selected: string[];
  categories: StoreCategory[];
};

/* ══════════════════════════════════════════════
   読む
   ══════════════════════════════════════════════ */

export type Live<T> =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: T }
  | { phase: "ng"; data: null; why: string };

function useLive<T>(
  url: string,
  pick: (raw: Record<string, unknown>) => T | null,
): { state: Live<T>; reload: () => void; put: (data: T) => void } {
  const [state, setState] = useState<Live<T>>({ phase: "loading", data: null });
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((n) => n + 1), []);

  /** 保存したあとの新しい中身を、読み直さずに差し込む */
  const put = useCallback((data: T) => setState({ phase: "ok", data }), []);

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      try {
        /* ★no-store を外さないこと。
             公開準備は、ほかの画面での操作（ガチャ作成・ポイント商品の追加）で
             変わります。古い数を出すと「直したのに直っていない」に見えます。 */
        const res = await fetch(url, { cache: "no-store" });
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
                : "設定を読み取れませんでした。",
          });
          return;
        }
        setState({ phase: "ok", data });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why: "通信できませんでした。設定は変わっていません。画面を開き直してください。",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, [url, tick, pick]);

  return { state, reload, put };
}

const pickSettings = (raw: Record<string, unknown>): StoreSettingsData | null => {
  const s = raw.settings;
  if (s === null || s === undefined || typeof s !== "object") return null;
  return {
    canEdit: raw.canEdit === true,
    settings: s as StoreSettings,
    faqs: Array.isArray(raw.faqs) ? (raw.faqs as StoreFaq[]) : [],
    fields: Array.isArray(raw.fields) ? (raw.fields as SettingFieldInfo[]) : [],
  };
};

const pickReadiness = (raw: Record<string, unknown>): ReadinessData | null => {
  const r = raw.readiness;
  if (r === null || r === undefined || typeof r !== "object") return null;
  return {
    readiness: r as Readiness,
    groups: Array.isArray(raw.groups)
      ? (raw.groups as { group: ReadinessGroup; label: string }[])
      : [],
    blockMessage:
      typeof raw.blockMessage === "string" ? raw.blockMessage : null,
  };
};

const pickCategories = (raw: Record<string, unknown>): CategoriesData | null =>
  Array.isArray(raw.categories)
    ? {
        canEdit: raw.canEdit === true,
        categories: raw.categories as StoreCategory[],
        limits:
          raw.limits !== null && typeof raw.limits === "object"
            ? (raw.limits as CategoriesData["limits"])
            : { maxCategories: 0, maxPerGacha: 0 },
      }
    : null;

/** お店の設定と、よくある質問を読む */
export function useStoreSettings() {
  return useLive<StoreSettingsData>("/api/console/settings/store", pickSettings);
}

/** 公開準備（○/○ 完了）を読む */
export function useReadiness() {
  return useLive<ReadinessData>("/api/console/launch-readiness", pickReadiness);
}

/** カテゴリ（棚）を読む */
export function useCategories() {
  return useLive<CategoriesData>("/api/console/categories", pickCategories);
}

const pickGachaCategories = (
  raw: Record<string, unknown>,
): GachaCategoriesData | null =>
  Array.isArray(raw.categories) && Array.isArray(raw.selected)
    ? {
        selected: (raw.selected as unknown[]).map(String),
        categories: raw.categories as StoreCategory[],
      }
    : null;

/** そのガチャが、いまどの棚に入っているかを読む */
export function useGachaCategories(gachaId: string) {
  return useLive<GachaCategoriesData>(
    `/api/console/gachas/categories?gachaId=${encodeURIComponent(gachaId)}`,
    pickGachaCategories,
  );
}

/**
 * そのガチャの棚を入れ替える。
 *
 * ★差分ではなく「これが全部です」と送ります。
 *   1件ずつ足す・消すにすると、途中で切れたときに
 *   片方だけ付いた状態が残ります。
 */
export async function saveGachaCategories(
  gachaId: string,
  categoryIds: string[],
): Promise<SaveAnswer<string[]>> {
  try {
    const res = await fetch("/api/console/gachas/categories", {
      method: "POST",
      headers: postHeaders(),
      body: JSON.stringify({ gachaId, categoryIds }),
    });
    const raw = (await res.json()) as Record<string, unknown>;

    if (res.ok && raw.ok === true && Array.isArray(raw.selected)) {
      return { ok: true, data: (raw.selected as unknown[]).map(String) };
    }
    return {
      ok: false,
      message:
        typeof raw.message === "string"
          ? raw.message
          : "カテゴリを変更できませんでした。",
    };
  } catch {
    return {
      ok: false,
      message: "通信できませんでした。カテゴリは変わっていません。",
    };
  }
}

/* ══════════════════════════════════════════════
   書く
   ══════════════════════════════════════════════ */

export type SaveAnswer<T> =
  | { ok: true; data: T }
  | { ok: false; message: string };

/**
 * 設定を保存する。
 *
 * ★送るのは、その画面で触った項目だけにすること。
 *   全項目を毎回送ると、まだ開いていない画面の入力が
 *   空で上書きされます。サーバーは「来た項目だけ」を書き換えます。
 */
export async function saveStoreSettings(
  patch: Record<string, string>,
): Promise<SaveAnswer<StoreSettingsData>> {
  return post({ patch });
}

/** よくある質問を、まとめて入れ替える */
export async function saveStoreFaqs(
  faqs: { question: string; answer: string }[],
): Promise<SaveAnswer<StoreSettingsData>> {
  return post({ faqs });
}

async function post(
  body: Record<string, unknown>,
): Promise<SaveAnswer<StoreSettingsData>> {
  try {
    const res = await fetch("/api/console/settings/store", {
      method: "POST",
      headers: postHeaders(),
      body: JSON.stringify(body),
    });
    const raw = (await res.json()) as Record<string, unknown>;

    if (res.ok && raw.ok === true) {
      const data = pickSettings({ ...raw, canEdit: true });
      if (data !== null) return { ok: true, data };
    }
    return {
      ok: false,
      message:
        typeof raw.message === "string"
          ? raw.message
          : "保存できませんでした。もう一度お試しください。",
    };
  } catch {
    /* ★「保存されたかもしれません」と書かないこと。
         送れていません。入力はそのまま残っています。 */
    return {
      ok: false,
      message: "通信できませんでした。入力はそのまま残っています。",
    };
  }
}

/** カテゴリを作る・名前を変える・消す */
export async function categoryOp(
  body: Record<string, unknown>,
): Promise<SaveAnswer<{ categories: StoreCategory[]; message: string | null }>> {
  try {
    const res = await fetch("/api/console/categories", {
      method: "POST",
      headers: postHeaders(),
      body: JSON.stringify(body),
    });
    const raw = (await res.json()) as Record<string, unknown>;

    if (res.ok && raw.ok === true && Array.isArray(raw.categories)) {
      return {
        ok: true,
        data: {
          categories: raw.categories as StoreCategory[],
          message: typeof raw.message === "string" ? raw.message : null,
        },
      };
    }
    return {
      ok: false,
      message:
        typeof raw.message === "string"
          ? raw.message
          : "カテゴリを変更できませんでした。",
    };
  } catch {
    return {
      ok: false,
      message: "通信できませんでした。カテゴリは変わっていません。",
    };
  }
}
