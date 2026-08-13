// ブランド差分の一元管理。
// 1コードベース × 3独立デプロイ。差分はこのファイルと環境変数のみ。
// 売却時はリポジトリをフォークして NEXT_PUBLIC_BRAND を差し替えるだけで別号機が立つ。

export type BrandKey = "gacha" | "sneaker" | "hub";

export interface Brand {
  key: BrandKey;
  // 表示名
  name: string;
  // Xでの主要ハンドル（UI表示用。実接続はP1以降）
  handle: string;
  // アクセント色（ヘッダー帯・主要ボタン・選択枠に流す）
  accent: string;
  accentSoft: string;
  // LINE連携の有効フラグ（gacha / sneaker のみ true）
  lineEnabled: boolean;
  // ネタ供給パネルの種別（P2以降で分岐）
  feedType: "gacha_data" | "sneaker_drop" | "trend_template";
  tagline: string;
}

const BRANDS: Record<BrandKey, Brand> = {
  gacha: {
    key: "gacha",
    name: "AURA / オンラインガチャ",
    handle: "gorogoro_gacha",
    accent: "#C8552B",
    accentSoft: "#F3D9CB",
    lineEnabled: true,
    feedType: "gacha_data",
    tagline: "当選報告と在庫を、丁寧に届ける",
  },
  sneaker: {
    key: "sneaker",
    name: "AURA / スニーカー限定ガチャ",
    handle: "KIKUSORA_gacha",
    accent: "#2B5DC8",
    accentSoft: "#CBD8F3",
    lineEnabled: true,
    feedType: "sneaker_drop",
    tagline: "ドロップと当落を、いちばん早く",
  },
  hub: {
    key: "hub",
    name: "AURA / 何でも話しておけ",
    handle: "aura_hub",
    accent: "#3E7D5A",
    accentSoft: "#CFE4D6",
    lineEnabled: false,
    feedType: "trend_template",
    tagline: "その一言に、ちゃんと向き合う",
  },
};

// 環境変数で号機を切替（未指定は gacha）
export function getBrand(): Brand {
  const key = (process.env.NEXT_PUBLIC_BRAND as BrandKey) || "gacha";
  return BRANDS[key] ?? BRANDS.gacha;
}

export const BRAND = getBrand();

// AURA_MODE=test の間は外部に一切出ない（P2までモックのみ）
export const IS_TEST_MODE =
  (process.env.NEXT_PUBLIC_AURA_MODE || process.env.AURA_MODE || "test") ===
  "test";
