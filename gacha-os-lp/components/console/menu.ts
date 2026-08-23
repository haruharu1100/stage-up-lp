/**
 * 左メニューの並び。
 *
 * ═══════════════════════════════════════════════
 * ★並び順に理由があります。入れ替えないこと
 * ═══════════════════════════════════════════════
 *
 *   大分類は「その仕事は何のためにあるか」で分けています。
 *
 *     毎日の運営 … 売るものを作り、検証し、公開し、会員を見る
 *     売上とポイント … お金そのものを動かす
 *     発送とサポート … 売ったあとの約束を果たす
 *     リスク管理 … 損と事故を止める
 *     システム   … 設定・移行・お客様サイトの見た目
 *
 *   大分類の中は、毎日その順に触る順で並べています。
 *   機能の種類ごとに並べると（「AI系」「分析系」など）、
 *   毎日の仕事の順番とズレます。使う人は機能名ではなく
 *   「次に何をするか」で探します。
 *
 * ★ここに項目を足したくなったら、
 *   まず既にあるどれかの中に入らないかを考えること。
 *   21個は、左メニューとしてはもう多い方です。
 *   だから畳めるようにし、検索でも飛べるようにしてあります。
 *
 * ★icon を必ず付けること。
 *   畳んだとき（アイコンのみ表示）に、印が無い項目は
 *   ただの空白になり、押す手がかりが消えます。
 *
 * ★keywords は、探す人の言葉で書くこと。
 *   画面名で探せる人は、もうその画面を知っている人だけです。
 *   「ふりがな」「英語名」「その画面でやること」を入れておきます。
 */

import type { Permission } from "@/lib/console/state";

export type MenuKey =
  | "dashboard"
  | "operator"
  | "gacha"
  | "builder"
  | "backtest"
  | "preview"
  | "products"
  | "customers"
  | "analytics"
  | "points"
  | "orders"
  | "shipping"
  | "support"
  | "rtp"
  | "market"
  | "fraud"
  | "security"
  | "audit"
  | "siteEditor"
  | "migration"
  | "settings";

/** 畳んだときに出す印。中身は components/console/Icon.tsx */
export type IconKey =
  | "home"
  | "spark"
  | "box"
  | "wand"
  | "flask"
  | "eye"
  | "tag"
  | "people"
  | "chart"
  | "coin"
  | "inbox"
  | "truck"
  | "chat"
  | "gauge"
  | "trend"
  | "shield"
  | "lock"
  | "list"
  | "brush"
  | "swap"
  | "gear";

export type MenuGroup =
  | "毎日の運営"
  | "売上とポイント"
  | "発送とサポート"
  | "リスク管理"
  | "システム";

export type MenuItem = {
  key: MenuKey;
  label: string;
  /** メニューの下に出す一言。初めて見る人向け */
  note: string;
  group: MenuGroup;
  icon: IconKey;
  /** 検索で引っかかってほしい言葉 */
  keywords: string[];
  /** この権限が無い人には、押しても中身を出さない */
  need?: Permission;
};

export const MENU: MenuItem[] = [
  /* ── 毎日の運営 ───────────────────────────── */
  {
    key: "dashboard",
    label: "ダッシュボード",
    note: "今日やることが出ます",
    group: "毎日の運営",
    icon: "home",
    keywords: ["dashboard", "ホーム", "トップ", "今日", "きょう"],
  },
  {
    key: "operator",
    label: "AI オペレーター",
    note: "聞くと、今の状況を調べて答えます",
    group: "毎日の運営",
    icon: "spark",
    keywords: ["ai", "operator", "そうだん", "質問", "アシスタント"],
  },
  {
    key: "gacha",
    label: "ガチャ管理",
    note: "作る・止める・公開する",
    group: "毎日の運営",
    icon: "box",
    keywords: ["gacha", "ガチャ", "公開", "停止", "pause", "publish"],
    need: "gacha.view",
  },
  {
    key: "builder",
    label: "AI ガチャ作成",
    note: "話しかけると案が出ます",
    group: "毎日の運営",
    icon: "wand",
    keywords: ["builder", "作成", "つくる", "新規", "ai"],
    need: "gacha.edit",
  },
  {
    key: "backtest",
    label: "公開前バックテスト",
    note: "赤字になる条件を先に試す",
    group: "毎日の運営",
    icon: "flask",
    keywords: ["backtest", "検証", "シミュレーション", "赤字", "テスト"],
    need: "gacha.view",
  },
  {
    key: "preview",
    label: "お客様画面の確認",
    note: "公開前に、お客様の目で見る",
    group: "毎日の運営",
    icon: "eye",
    keywords: ["preview", "プレビュー", "確認", "お客様", "スマホ"],
    need: "gacha.view",
  },
  {
    key: "products",
    label: "景品マスター",
    note: "景品と仕入れ値の管理",
    group: "毎日の運営",
    icon: "tag",
    keywords: ["products", "商品", "景品", "仕入", "在庫", "マスター"],
    need: "gacha.view",
  },
  {
    key: "customers",
    label: "会員管理",
    note: "会員を調べる・止める",
    group: "毎日の運営",
    icon: "people",
    keywords: ["customers", "会員", "ユーザー", "顧客"],
    need: "point.view",
  },

  /* ── 売上とポイント ───────────────────────── */
  {
    key: "analytics",
    label: "売上・分析",
    note: "数字の推移",
    group: "売上とポイント",
    icon: "chart",
    keywords: ["analytics", "売上", "分析", "グラフ", "粗利"],
    need: "gacha.view",
  },
  {
    key: "points",
    label: "ポイント管理",
    note: "変更には理由と承認が要ります",
    group: "売上とポイント",
    icon: "coin",
    keywords: ["points", "ポイント", "残高", "付与", "返還"],
    need: "point.view",
  },

  /* ── 発送とサポート ───────────────────────── */
  {
    key: "orders",
    label: "発送依頼",
    note: "お客様からの依頼一覧",
    group: "発送とサポート",
    icon: "inbox",
    keywords: ["orders", "依頼", "注文", "未発送"],
    need: "shipping.view",
  },
  {
    key: "shipping",
    label: "発送管理",
    note: "伝票・追跡番号・通知",
    group: "発送とサポート",
    icon: "truck",
    keywords: ["shipping", "発送", "配送", "追跡", "伝票"],
    need: "shipping.view",
  },
  {
    key: "support",
    label: "問い合わせ",
    note: "AIが答え、難しいものは人へ",
    group: "発送とサポート",
    icon: "chat",
    keywords: ["support", "問い合わせ", "サポート", "質問", "チケット"],
    need: "support.view",
  },

  /* ── リスク管理 ───────────────────────────── */
  {
    key: "rtp",
    label: "実還元率モニタ",
    note: "出しすぎていないか",
    group: "リスク管理",
    icon: "gauge",
    keywords: ["rtp", "還元率", "かんげんりつ", "出しすぎ"],
    need: "gacha.view",
  },
  {
    key: "market",
    label: "相場ウォッチ",
    note: "景品の値上がりを見張る",
    group: "リスク管理",
    icon: "trend",
    keywords: ["market", "相場", "そうば", "価格", "値上がり"],
    need: "gacha.view",
  },
  {
    key: "fraud",
    label: "不正対策センター",
    note: "怪しい登録を見つける",
    group: "リスク管理",
    icon: "shield",
    keywords: ["fraud", "不正", "ふせい", "怪しい", "複垢"],
    need: "fraud.view",
  },
  {
    key: "security",
    label: "セキュリティ",
    note: "監査ログの検証と防御の状況",
    group: "リスク管理",
    icon: "lock",
    keywords: ["security", "セキュリティ", "防御", "検証"],
    need: "security.view",
  },
  {
    key: "audit",
    label: "監査ログ",
    note: "誰が何をしたかの記録",
    group: "リスク管理",
    icon: "list",
    keywords: ["audit", "監査", "ログ", "記録", "履歴"],
    need: "audit.view",
  },

  /* ── システム ─────────────────────────────── */
  {
    key: "siteEditor",
    label: "お客様サイト編集",
    note: "色・ロゴ・並び順を変える",
    group: "システム",
    icon: "brush",
    keywords: ["site", "editor", "デザイン", "色", "ロゴ", "テーマ", "ブランド"],
    need: "settings.edit",
  },
  {
    key: "migration",
    label: "移行センター",
    note: "今のサイトから引っ越す",
    group: "システム",
    icon: "swap",
    keywords: ["migration", "移行", "引っ越し", "乗り換え", "インポート"],
    need: "settings.edit",
  },
  {
    key: "settings",
    label: "設定",
    note: "認証方法・承認金額・権限",
    group: "システム",
    icon: "gear",
    keywords: ["settings", "設定", "認証", "権限", "role"],
  },
];

export const MENU_GROUPS: MenuGroup[] = [
  "毎日の運営",
  "売上とポイント",
  "発送とサポート",
  "リスク管理",
  "システム",
];

export function menuItem(key: MenuKey): MenuItem {
  return MENU.find((m) => m.key === key)!;
}

/**
 * 検索。
 *
 * ★ひらがな・英語・やることのどれで打っても出ること。
 *   「はっそう」でも「shipping」でも「追跡」でも
 *   発送管理に辿り着けないと、21項目の中から目で探すことになります。
 */
export function searchMenu(q: string): MenuItem[] {
  const k = q.trim().toLowerCase();
  if (!k) return [];
  return MENU.filter((m) =>
    [m.label, m.note, m.group, ...m.keywords].some((t) =>
      t.toLowerCase().includes(k),
    ),
  );
}
