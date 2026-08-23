/**
 * 左メニューの並び。
 *
 * ═══════════════════════════════════════════════
 * ★大分類は5つ。増やさないこと
 * ═══════════════════════════════════════════════
 *
 *     ホーム       … 今日の状況を見る。AIに聞く
 *     ガチャ       … 売るものを作り、検証し、公開し、見張る
 *     顧客・運営   … 会員とお金と、売ったあとの約束
 *     リスク       … 損と事故を止める
 *     システム     … 数字・設定・移行・お客様サイトの見た目
 *
 *   大分類の中は、毎日その順に触る順で並べています。
 *   機能の種類ごとに並べると（「AI系」「分析系」など）、
 *   毎日の仕事の順番とズレます。使う人は機能名ではなく
 *   「次に何をするか」で探します。
 *
 * ★label は短くすること。
 *   左メニューは毎日何十回も目で走査する場所です。
 *   「公開前バックテスト」は正確ですが、長い名前が21個並ぶと
 *   どれも同じ形に見えて、探す時間がそのまま増えます。
 *   ただし、短さより「初めての人に日本語で伝わるか」が上です。
 *   RTP ではなく「実還元率」と書きます。
 *
 * ★note は消さないこと。ただし出しっぱなしにもしないこと。
 *   説明が要るのは「行き先を選ぶとき」ではなく
 *   「いまどこにいるか確かめるとき」です。
 *   ふだんは名前だけ、いま開いている項目とマウスを乗せたときだけ出します。
 *   ⌘K の一覧では、全項目の説明を出します。
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
  | "ホーム"
  | "ガチャ"
  | "顧客・運営"
  | "リスク"
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
  /* ── ホーム ───────────────────────────────── */
  {
    key: "dashboard",
    label: "ダッシュボード",
    note: "今日やることが出ます",
    group: "ホーム",
    icon: "home",
    keywords: ["dashboard", "ホーム", "トップ", "今日", "きょう", "やること"],
  },
  {
    key: "operator",
    label: "AI オペレーター",
    note: "聞くと、今の状況を調べて答えます",
    group: "ホーム",
    icon: "spark",
    keywords: ["ai", "operator", "そうだん", "相談", "質問", "アシスタント"],
  },

  /* ── ガチャ ───────────────────────────────── */
  {
    key: "gacha",
    label: "ガチャ管理",
    note: "作る・止める・公開する",
    group: "ガチャ",
    icon: "box",
    keywords: ["gacha", "ガチャ", "公開", "停止", "pause", "publish", "一覧"],
    need: "gacha.view",
  },
  {
    key: "builder",
    label: "AI ガチャ作成",
    note: "話しかけると案が出ます",
    group: "ガチャ",
    icon: "wand",
    keywords: ["ガチャ作る", "builder", "作成", "つくる", "新規", "ai", "作る"],
    need: "gacha.edit",
  },
  {
    key: "backtest",
    label: "バックテスト",
    note: "公開前に、赤字になる条件を試す",
    group: "ガチャ",
    icon: "flask",
    keywords: ["backtest", "検証", "シミュレーション", "赤字", "テスト", "公開前"],
    need: "gacha.view",
  },
  {
    key: "rtp",
    label: "実還元率",
    note: "出しすぎていないか見張る",
    group: "ガチャ",
    icon: "gauge",
    keywords: ["危険", "rtp", "還元率", "かんげんりつ", "出しすぎ", "赤字"],
    need: "gacha.view",
  },
  {
    key: "market",
    label: "相場ウォッチ",
    note: "景品の値上がりを見張る",
    group: "ガチャ",
    icon: "trend",
    keywords: ["market", "相場", "そうば", "価格", "値上がり", "高騰"],
    need: "gacha.view",
  },
  {
    key: "products",
    label: "景品マスター",
    note: "景品と仕入れ値の管理",
    group: "ガチャ",
    icon: "tag",
    keywords: ["products", "商品", "景品", "仕入", "在庫", "マスター"],
    need: "gacha.view",
  },
  {
    key: "preview",
    label: "お客様画面の確認",
    note: "公開前に、お客様の目で見る",
    group: "ガチャ",
    icon: "eye",
    keywords: ["preview", "プレビュー", "確認", "お客様", "スマホ"],
    need: "gacha.view",
  },

  /* ── 顧客・運営 ───────────────────────────── */
  {
    key: "customers",
    label: "会員管理",
    note: "会員を調べる・止める",
    group: "顧客・運営",
    icon: "people",
    keywords: ["customers", "会員", "ユーザー", "顧客", "退会"],
    need: "point.view",
  },
  {
    key: "points",
    label: "ポイント管理",
    note: "変更には理由と承認が要ります",
    group: "顧客・運営",
    icon: "coin",
    keywords: ["points", "ポイント", "残高", "付与", "返還", "承認"],
    need: "point.view",
  },
  {
    key: "orders",
    label: "発送依頼",
    note: "お客様からの依頼一覧",
    group: "顧客・運営",
    icon: "inbox",
    keywords: ["orders", "依頼", "注文", "未発送", "受付"],
    need: "shipping.view",
  },
  {
    key: "shipping",
    label: "発送管理",
    note: "伝票・追跡番号・通知",
    group: "顧客・運営",
    icon: "truck",
    keywords: ["発送", "shipping", "配送", "追跡", "伝票", "はっそう"],
    need: "shipping.view",
  },
  {
    key: "support",
    label: "問い合わせ",
    note: "AIが答え、難しいものは人へ",
    group: "顧客・運営",
    icon: "chat",
    keywords: ["support", "問い合わせ", "サポート", "質問", "チケット", "返信"],
    need: "support.view",
  },

  /* ── リスク ───────────────────────────────── */
  {
    key: "fraud",
    label: "不正対策",
    note: "怪しい登録を見つける",
    group: "リスク",
    icon: "shield",
    keywords: ["不正", "fraud", "ふせい", "怪しい", "複垢", "転売"],
    need: "fraud.view",
  },
  {
    key: "security",
    label: "セキュリティ",
    note: "改ざん検証と防御の状況",
    group: "リスク",
    icon: "lock",
    keywords: ["security", "セキュリティ", "防御", "検証", "改ざん"],
    need: "security.view",
  },
  {
    key: "audit",
    label: "監査ログ",
    note: "誰が何をしたかの記録",
    group: "リスク",
    icon: "list",
    keywords: ["audit", "監査", "ログ", "記録", "履歴"],
    need: "audit.view",
  },

  /* ── システム ─────────────────────────────── */
  {
    key: "analytics",
    label: "売上・分析",
    note: "数字の推移",
    group: "システム",
    icon: "chart",
    keywords: ["analytics", "売上", "分析", "グラフ", "粗利", "うりあげ"],
    need: "gacha.view",
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
    key: "siteEditor",
    label: "お客様サイト編集",
    note: "色・ロゴ・並び順を変える",
    group: "システム",
    icon: "brush",
    keywords: ["site", "editor", "デザイン", "色", "ロゴ", "テーマ", "ブランド"],
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
  "ホーム",
  "ガチャ",
  "顧客・運営",
  "リスク",
  "システム",
];

export function menuItem(key: MenuKey): MenuItem {
  return MENU.find((m) => m.key === key)!;
}

/**
 * 検索（⌘K）。
 *
 * ═══════════════════════════════════════════════
 * ★「出る」だけでは足りません。「1番目に出る」こと
 * ═══════════════════════════════════════════════
 *
 *   「発送」と打つと、発送依頼と発送管理の両方が当たります。
 *   当たった順に並べると、たまたま先に定義した方が上に来ます。
 *   探している人は、いちばん上を Enter で選びます。
 *   つまり、並び順を運任せにすると、行き先も運任せになります。
 *
 *   だから点数を付けます。
 *
 *       言葉がぴったり一致        … 100点（いちばん強い）
 *       画面名がその言葉で始まる  …  60点
 *       画面名に含まれる          …  40点
 *       探す言葉に含まれる        …  25点
 *       説明・分類に含まれる      …  10点
 *
 *   これで、次の4つは必ず1番目に出ます。
 *
 *       発送     → 発送管理
 *       危険     → 実還元率
 *       不正     → 不正対策
 *       ガチャ作る → AI ガチャ作成
 *
 * ★同点のときは、メニューの並び順のままにすること。
 *   並びが日によって変わると、体が場所を覚えられません。
 */
function score(m: MenuItem, k: string): number {
  const label = m.label.toLowerCase();
  const words = m.keywords.map((w) => w.toLowerCase());

  if (words.includes(k) || label === k) return 100;
  if (label.startsWith(k)) return 60;
  if (label.includes(k)) return 40;
  if (words.some((w) => w.includes(k))) return 25;
  if (m.note.toLowerCase().includes(k) || m.group.toLowerCase().includes(k)) return 10;
  return 0;
}

export function searchMenu(q: string): MenuItem[] {
  const k = q.trim().toLowerCase();
  if (!k) return [];
  return MENU.map((m, i) => ({ m, i, sc: score(m, k) }))
    .filter((x) => x.sc > 0)
    .sort((a, b) => b.sc - a.sc || a.i - b.i)
    .map((x) => x.m);
}
