/**
 * ══════════════════════════════════════════════════════════
 *  料金設定ファイル（ここだけ直せば、サイト全体の料金が変わります）
 * ══════════════════════════════════════════════════════════
 *
 * このファイルは「非エンジニアが金額を書き換えられる場所」です。
 * 画面のどこにも金額を直書きしていないので、
 * 変更が必要になったらここの数字だけを直してください。
 *
 * ■ 金額の考え方
 * 　monthlyYen / setupYen は「税別・円」の数値で入れます（例: 50000）。
 * 　null にすると自動的に「個別お見積り」と表示されます。
 *
 * ■ 環境変数でも上書きできます（コードを触らずに変えたいとき）
 * 　NEXT_PUBLIC_PRICE_STARTER=49800
 * 　NEXT_PUBLIC_PRICE_GROWTH=98000
 * 　NEXT_PUBLIC_PRICE_ENTERPRISE=       ← 空にすると個別お見積り
 * 　NEXT_PUBLIC_PRICE_SETUP=            ← 初期構築費（下限）
 * 　NEXT_PUBLIC_PRICE_SETUP_MAX=        ← 初期構築費（上限）
 *
 * ■ 表示に関する決まり（景品表示法対策・必ず守る）
 * 　・通常価格のみを表示する。取り消し線の二重価格は使わない
 * 　・「今だけ」「残りn社」などのカウントダウンで購入を急かさない
 * 　・キャンペーンは「実際に適用している条件」しか書かない
 * 　・募集枠の数（先着3社など）は、本当にその数で締め切るときだけ表示する
 *
 * ■ 価格の考え方（この金額にした理由）
 * 　低価格帯のガチャ「サイト」構築サービスとは、同じ土俵で比べさせません。
 * 　こちらが売るのは、運営・リスク管理・AI自動化まで含んだ運営基盤です。
 * 　そのため、金額の隣には必ず「何が含まれるか」を並べて表示します（項目18）。
 */

/* ────────────────────────────────
   1. 月額プラン（MONTHLY OS）
   ──────────────────────────────── */

export type OsTier = {
  /** 内部キー。計測イベントにも使うので変えない */
  key: "starter" | "growth" | "enterprise";
  name: string;
  /** 誰向けか（1行） */
  target: string;
  /**
   * 月額（税別・円）。null = 個別お見積り。
   * 幅を持たせたい場合は monthlyYenMax に上限を入れる（例: 100000〜150000）
   */
  monthlyYen: number | null;
  monthlyYenMax?: number | null;
  /** 「おすすめ」表示 */
  featured?: boolean;
  note?: string;
  /** 前のプランからの差分を強調するときの見出し */
  inherits?: string;
  points: string[];
};

export const osTiers: OsTier[] = [
  {
    key: "starter",
    name: "STARTER",
    target: "これから始めたい方・小〜中規模の運営向け",
    monthlyYen: 49_800,
    points: [
      "ガチャ管理（作成・在庫・口数・公開停止）",
      "AIガチャ設計（候補生成・承認フロー）",
      "還元率管理（設定時／残数ベース）",
      "公開前バックテスト（複数シナリオでの事前シミュレーション）",
      "市場価格管理",
      "発送管理（対象選択・伝票データ・追跡番号通知）",
      "AI OPERATOR（基本）",
      "基本サポート",
    ],
  },
  {
    key: "growth",
    name: "GROWTH",
    target: "本格運営・複数ガチャを高度に管理したい方向け",
    monthlyYen: 98_000,
    featured: true,
    note: "本格運営",
    inherits: "STARTER の内容すべて",
    points: [
      "AI OPERATOR（高度：優先順位つきの提案）",
      "複数ガチャの横断分析",
      "高度な還元率監視（市場価格ベース・自動警告）",
      "営業分析（流入元別・担当者別）",
      "詳細レポート",
      "優先サポート",
      "自動化機能の拡張",
    ],
  },
  {
    key: "enterprise",
    name: "ENTERPRISE",
    target: "既存の大型サイト・複数ブランド・独自連携・移行支援が必要な方向け",
    monthlyYen: null,
    inherits: "GROWTH の内容すべて",
    points: [
      "複数サイトの一括管理",
      "独自機能の追加開発",
      "API連携",
      "専用AWS構成",
      "カスタムAI（自社データでの調整）",
      "専任担当による専用サポート",
      "既存の基幹業務・外部システムとの連携",
    ],
  },
];

/* ────────────────────────────────
   2. 初期構築（INITIAL SETUP）
   ──────────────────────────────── */

/**
 * 初期費用。
 * 3通りの出し方ができる。
 * ・minYen と maxYen 両方  → 「300,000〜800,000円」と幅で表示
 * ・minYen だけ            → 「300,000円〜」と下限だけ表示
 * ・minYen が null         → 「個別お見積り」と表示
 *
 * 幅を持たせているのは、ブランド設定・決済・AWS・既存サイトからの移行・
 * 独自機能・AIの調整範囲で、実際に必要な作業量が大きく変わるためです。
 */
export const initialSetup = {
  code: "INITIAL SETUP",
  name: "初期構築費",
  /** 下限。null にすると「個別お見積り」表示になる */
  minYen: 300_000 as number | null,
  /** 上限。null にすると「◯◯円〜」表示になる */
  maxYen: 800_000 as number | null,
  lead: "月額とは別に、立ち上げ時だけかかる費用です。必要な範囲が事業者ごとに大きく変わるため、内容をうかがってからお出しします。",
  includes: [
    "初期設定（アカウント・権限・基本設定）",
    "ブランド設定（ロゴ・配色・文言）",
    "LP（サイトの入口ページ）",
    "サーバー構築（AWS環境）",
    "決済の接続",
    "ガチャ設定（等級構成・確率・在庫）",
    "発送設定（伝票・追跡番号の流れ）",
    "AI設定（回答範囲・エスカレーション条件）",
    "初期研修（管理画面の操作レクチャー）",
  ],
  note: "既存サイトからの移行、独自機能、複数ブランドの同時立ち上げなどは別途お見積りとなります。",
};

/* ────────────────────────────────
   3. モニター条件（キャンペーン）
   ──────────────────────────────── */

/**
 * 導入モニター制度。
 *
 * ★重要（景品表示法）— ここを必ず読んでから true にしてください
 *
 * 1. enabled を true にするのは、その条件を「実際に適用している」ときだけ。
 *
 * 2. slots（募集枠の数）を表示するのは、本当にその数で締め切るときだけ。
 *    3社と書いて4社目も受けるなら、それは虚偽の希少性になります。
 *    数を決めていない／決めたくない場合は slots を null にしてください。
 *    その場合は「先着3社」ではなく「導入モニター企業を募集しています」と表示されます。
 *
 * 3. 「今だけ」「残りわずか」「あと◯日」で急かす表現は入れない。
 *
 * 4. conditions（協力していただく内容）は、実際にお願いすることだけを書く。
 *    導入事例の掲載は本人の許可が前提なので、ここでは「別途確認」と明示します。
 */
export const monitorOffer = {
  /** ★実際に募集を始めるまでは false のままにしてください */
  enabled: false,

  label: "導入モニター企業",

  /** 募集枠の数。本当にこの数で締め切るときだけ数値を入れる。決めていなければ null */
  slots: null as number | null,

  /** 無料にする月数。0 にすると「無料期間なし」扱い */
  freeMonths: 3,

  /**
   * 何を無料にするか。
   * "os"    … 月額のOS利用料のみ無料（初期構築費は別途かかる）
   * "setup" … 初期構築費の割引
   */
  target: "os" as "os" | "setup",

  /** 初期構築費を割り引く場合の割引率（0〜1）。target が "setup" のときだけ使う */
  setupDiscountRate: 0 as number,

  body: "実際の運営データをもとにシステムを育てる段階のため、ご協力いただける事業者様に限って条件をご用意しています。適用可否はご相談時にお伝えします。",

  /** 協力していただく内容（実際にお願いすることだけを書く） */
  conditions: [
    "使用感のヒアリング（月1回・30分程度）",
    "改善のご要望を共有いただくこと",
    "匿名化した運営データを、システム改善のために利用させていただくこと",
    "導入事例としての掲載は、別途あらためて許可をいただいてからになります",
  ],
};

/** モニター条件の見出し文（設定内容から自動で作る） */
export function monitorHeadline(): string {
  const m = monitorOffer;
  const who = m.slots === null ? "導入モニター企業" : `先着${m.slots}社`;
  if (m.target === "setup") {
    return `${who}：初期構築費 ${Math.round(m.setupDiscountRate * 100)}% 割引`;
  }
  return `${who}：OS利用料 ${m.freeMonths}か月無料`;
}

/* ────────────────────────────────
   4. オプション（利益の柱）
   ──────────────────────────────── */

export type OptionItem = {
  name: string;
  body: string;
  /** null = 個別お見積り */
  yen: number | null;
  /** 課金の単位 */
  unit?: "月額" | "都度";
};

export const optionCatalog: {
  code: string;
  name: string;
  body: string;
  items: OptionItem[];
}[] = [
  {
    code: "ACQUISITION",
    name: "集客・販促を任せたい",
    body: "お客様を集める側をまとめてお任せいただけます。売上データと合わせて調整します。",
    items: [
      { name: "広告運用", body: "配信設計から改善まで。売上データと連動させて調整します。", yen: null, unit: "月額" },
      { name: "X運用", body: "投稿設計・作成・投稿の代行と分析。", yen: null, unit: "月額" },
      { name: "LINE運用", body: "友だち追加導線・配信設計・セグメント配信。", yen: null, unit: "月額" },
      { name: "メルマガ", body: "会員向け配信の設計と作成。", yen: null, unit: "月額" },
      { name: "LP制作", body: "新ガチャ・キャンペーンごとの訴求ページを制作します。", yen: null, unit: "都度" },
      { name: "バナー制作", body: "広告・サイト内バナーの制作。", yen: null, unit: "都度" },
      { name: "SEO", body: "検索からの継続流入を作るための設計と記事。", yen: null, unit: "月額" },
    ],
  },
  {
    code: "OPERATION",
    name: "運営作業まで任せたい",
    body: "AIで拾いきれない部分と、手を動かす作業そのものを外部化できます。",
    items: [
      { name: "ガチャ作成代行", body: "等級構成・確率・在庫の組み立てまで代行します。", yen: null, unit: "都度" },
      { name: "発送代行", body: "梱包・発送作業そのものの外部化。", yen: null, unit: "月額" },
      { name: "CS代行", body: "AIで拾いきれない問い合わせの有人対応。", yen: null, unit: "月額" },
      { name: "AI電話", body: "電話での一次対応・折り返し受付の自動化。", yen: null, unit: "月額" },
    ],
  },
  {
    code: "MERCHANDISE",
    name: "商品まわりを任せたい",
    body: "何を仕入れて、いくらで組むか。ここを一緒に見る形です。",
    items: [
      { name: "商品リサーチ", body: "ジャンル別の売れ筋・相場動向の調査。", yen: null, unit: "月額" },
      { name: "商品仕入れ支援", body: "仕入れ先の選定と、原価から見た構成の相談。", yen: null, unit: "月額" },
      {
        name: "商品価格監視",
        body: "許諾済みのデータソース・公式APIを前提に、対象商品の相場を定期取得して変動を通知。",
        yen: null,
        unit: "月額",
      },
    ],
  },
];

/* ────────────────────────────────
   5. 表示用のヘルパー（触らなくて大丈夫）
   ──────────────────────────────── */

const envYen = (key: string): number | null | undefined => {
  const raw = process.env[key];
  if (raw === undefined) return undefined; // 未指定＝設定ファイルの値を使う
  if (raw.trim() === "") return null; // 空＝個別お見積り
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
};

const ENV_PRICE: Record<OsTier["key"], number | null | undefined> = {
  starter: envYen("NEXT_PUBLIC_PRICE_STARTER"),
  growth: envYen("NEXT_PUBLIC_PRICE_GROWTH"),
  enterprise: envYen("NEXT_PUBLIC_PRICE_ENTERPRISE"),
};

const ENV_SETUP = envYen("NEXT_PUBLIC_PRICE_SETUP");
const ENV_SETUP_MAX = envYen("NEXT_PUBLIC_PRICE_SETUP_MAX");

/** 環境変数の指定があればそちらを優先した、実際に表示するプラン */
export const activeTiers: OsTier[] = osTiers.map((t) => {
  const e = ENV_PRICE[t.key];
  return e === undefined ? t : { ...t, monthlyYen: e, monthlyYenMax: null };
});

/** 初期構築費の下限（null = 個別お見積り） */
export const activeSetupYen: number | null =
  ENV_SETUP === undefined ? initialSetup.minYen : ENV_SETUP;

/** 初期構築費の上限（null = 「◯◯円〜」表示） */
export const activeSetupYenMax: number | null =
  ENV_SETUP_MAX === undefined ? initialSetup.maxYen : ENV_SETUP_MAX;

/** 12,345 → 「12,345円」 */
export const yen = (n: number) => `${n.toLocaleString("ja-JP")}円`;

/** プラン価格の表示文字列。金額が無ければ「個別お見積り」 */
export function tierPriceLabel(t: OsTier): string {
  if (t.monthlyYen === null) return "個別お見積り";
  if (t.monthlyYenMax && t.monthlyYenMax > t.monthlyYen) {
    return `月額 ${t.monthlyYen.toLocaleString("ja-JP")}〜${t.monthlyYenMax.toLocaleString("ja-JP")}円`;
  }
  return `月額 ${t.monthlyYen.toLocaleString("ja-JP")}円`;
}

/** 初期構築費の表示文字列 */
export const setupPriceLabel: string = (() => {
  if (activeSetupYen === null) return "個別お見積り";
  if (activeSetupYenMax !== null && activeSetupYenMax > activeSetupYen) {
    return `${activeSetupYen.toLocaleString("ja-JP")}〜${yen(activeSetupYenMax)}`;
  }
  return `${yen(activeSetupYen)}〜`;
})();

/**
 * ROIシミュレーターと突き合わせるための「年間のOS費用」。
 * 金額が決まっていないプランは計算に使えないので、
 * 金額が入っている一番安いプランを基準にする。
 */
export const annualOsCostYen: number | null = (() => {
  const priced = activeTiers.filter((t) => t.monthlyYen !== null);
  if (priced.length === 0) return null;
  const min = Math.min(...priced.map((t) => t.monthlyYen as number));
  return min * 12;
})();

/** 上の金額がどのプランのものかを文章で示すためのラベル */
export const annualOsCostBase: string | null = (() => {
  const priced = activeTiers.filter((t) => t.monthlyYen !== null);
  if (priced.length === 0) return null;
  const min = priced.reduce((a, b) =>
    (a.monthlyYen as number) <= (b.monthlyYen as number) ? a : b
  );
  return min.name;
})();

/** 税表記。全ての金額表示に添える */
export const taxNote = "表示はすべて税別です。";
