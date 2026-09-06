/**
 * お店の情報（店名・特商法・規約・プライバシー・FAQ）を、画面から読む。
 *
 * ═══════════════════════════════════════════════════════
 * ★ここに、文言を書き置きしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   「未設定のときは、とりあえず当社の規約を出しておく」は、
 *   いちばんやってはいけない親切です。
 *   AI GACHA OS の運営会社の住所と電話が、
 *   導入店舗の特定商取引法の表記として世に出ます。
 *
 *   ですので、この道具は「サーバーが返した値」しか持ちません。
 *   空なら空のまま画面へ渡し、画面は「未設定」と書きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★ログインしていない方も読めること
 * ═══════════════════════════════════════════════════════
 *
 *   特商法・規約・プライバシーは「買う前の人」が読むものです。
 *   401 が返る作りにすると、置いていないのと同じになります。
 *   /api/shop/info はログインを求めません。
 */

"use client";

import { useEffect, useState } from "react";

export type ShopFaq = { id: string; question: string; answer: string };

/** サーバー（lib/server/publicShop.ts の PublicShopInfo）と対の形 */
export type ShopInfo = {
  tenantId: string;
  shopName: string | null;
  logoImageId: string | null;
  brandColor: string | null;

  legalName: string | null;
  legalKana: string | null;
  representative: string | null;
  postalCode: string | null;
  address: string | null;
  phone: string | null;
  antiqueLicense: string | null;
  priceNote: string | null;
  extraFeeNote: string | null;
  paymentMethod: string | null;
  paymentTiming: string | null;
  deliveryTime: string | null;
  returnsNote: string | null;

  contactEmail: string | null;
  contactHours: string | null;
  contactNote: string | null;

  termsText: string | null;
  privacyText: string | null;

  faqs: ShopFaq[];

  legalReady: boolean;
};

export type ShopInfoState =
  | { phase: "loading"; data: null }
  | { phase: "ok"; data: ShopInfo }
  | { phase: "ng"; data: null; why: string };

/**
 * お店の情報を1回だけ読む。
 *
 * ★読めなかったときに、空の ShopInfo を作って返さないこと。
 *   すべての項目が「未設定」に見えます。
 *   お店は自分の設定が消えたと思い、こちらへ連絡が来ます。
 */
export function useShopInfo(): ShopInfoState {
  const [state, setState] = useState<ShopInfoState>({
    phase: "loading",
    data: null,
  });

  useEffect(() => {
    let ikiteru = true;

    (async () => {
      try {
        const res = await fetch("/api/shop/info", { cache: "no-store" });
        const raw = (await res.json().catch(() => ({}))) as Record<
          string,
          unknown
        >;
        if (!ikiteru) return;

        if (res.ok && raw.ok === true && raw.shop && typeof raw.shop === "object") {
          setState({ phase: "ok", data: raw.shop as ShopInfo });
          return;
        }
        setState({
          phase: "ng",
          data: null,
          why:
            typeof raw.message === "string"
              ? raw.message
              : "お店の情報を読み込めませんでした。",
        });
      } catch {
        if (ikiteru) {
          setState({
            phase: "ng",
            data: null,
            why:
              "お店の情報を読み込めませんでした。通信の状態をご確認のうえ、もう一度お試しください。",
          });
        }
      }
    })();

    return () => {
      ikiteru = false;
    };
  }, []);

  return state;
}

/* ══════════════════════════════════════════════
   フッターに常設する6つのページ
   ══════════════════════════════════════════════ */

/**
 * ★この6つを減らさないこと。
 *   特定商取引法・利用規約・プライバシーポリシー・問い合わせ先は、
 *   「買う前の人」がいつでも読めるところに無ければなりません。
 *   奥まった場所に1つずつ置くのではなく、
 *   どの画面のいちばん下にも同じ並びで出します。
 */
export const SHOP_DOCS = [
  "company",
  "legal",
  "terms",
  "privacy",
  "faq",
  "contact",
] as const;

export type ShopDoc = (typeof SHOP_DOCS)[number];

export const SHOP_DOC_LABEL: Record<ShopDoc, string> = {
  company: "会社情報",
  legal: "特定商取引法に基づく表記",
  terms: "利用規約",
  privacy: "プライバシーポリシー",
  faq: "よくあるご質問",
  contact: "お問い合わせ",
};

export function isShopDoc(v: string): v is ShopDoc {
  return (SHOP_DOCS as readonly string[]).includes(v);
}
