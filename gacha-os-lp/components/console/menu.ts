/**
 * 左メニューの並び。
 *
 * ═══════════════════════════════════════════════
 * ★並び順に理由があります。入れ替えないこと
 * ═══════════════════════════════════════════════
 *
 *   毎日必ず見る順に、上から並べています。
 *
 *     売る前   … ガチャを作る・検証する・公開する
 *     売っている間 … 還元率・相場・不正登録を見張る
 *     売った後 … 発送する・問い合わせに答える
 *     その他   … 数字を見る・安全を確かめる・設定する
 *
 *   機能の種類ごとに並べると（「AI系」「分析系」など）、
 *   毎日の仕事の順番とズレます。使う人は機能名ではなく
 *   「次に何をするか」で探します。
 *
 * ★ここに項目を足したくなったら、
 *   まず既にあるどれかの中に入らないかを考えること。
 *   18個は、左メニューとしてはもう多い方です。
 */

import type { Permission } from "@/lib/console/state";

export type MenuKey =
  | "dashboard"
  | "gacha"
  | "builder"
  | "backtest"
  | "rtp"
  | "products"
  | "market"
  | "customers"
  | "fraud"
  | "points"
  | "orders"
  | "shipping"
  | "support"
  | "operator"
  | "analytics"
  | "security"
  | "audit"
  | "settings";

export type MenuItem = {
  key: MenuKey;
  label: string;
  /** メニューの下に出す一言。初めて見る人向け */
  note: string;
  group: string;
  /** この権限が無い人には、押しても中身を出さない */
  need?: Permission;
};

export const MENU: MenuItem[] = [
  { key: "dashboard", label: "ダッシュボード", note: "今日やることが出ます", group: "毎日" },

  { key: "gacha", label: "ガチャ管理", note: "作る・止める・公開する", group: "売る前", need: "gacha.view" },
  { key: "builder", label: "AI ガチャ作成", note: "話しかけると案が出ます", group: "売る前", need: "gacha.edit" },
  { key: "backtest", label: "公開前バックテスト", note: "赤字になる条件を先に試す", group: "売る前", need: "gacha.view" },
  { key: "products", label: "景品マスター", note: "景品と仕入れ値の管理", group: "売る前", need: "gacha.view" },

  { key: "rtp", label: "実還元率モニタ", note: "出しすぎていないか", group: "売っている間", need: "gacha.view" },
  { key: "market", label: "相場ウォッチ", note: "景品の値上がりを見張る", group: "売っている間", need: "gacha.view" },
  { key: "fraud", label: "不正対策センター", note: "怪しい登録を見つける", group: "売っている間", need: "fraud.view" },
  { key: "customers", label: "会員管理", note: "会員を調べる・止める", group: "売っている間", need: "point.view" },

  { key: "orders", label: "発送依頼", note: "お客様からの依頼一覧", group: "売った後", need: "shipping.view" },
  { key: "shipping", label: "発送管理", note: "伝票・追跡番号・通知", group: "売った後", need: "shipping.view" },
  { key: "support", label: "問い合わせ", note: "AIが答え、難しいものは人へ", group: "売った後", need: "support.view" },
  { key: "points", label: "ポイント管理", note: "変更には理由と承認が要ります", group: "売った後", need: "point.view" },

  { key: "operator", label: "AI オペレーター", note: "今日の状況をまとめます", group: "その他" },
  { key: "analytics", label: "売上・分析", note: "数字の推移", group: "その他", need: "gacha.view" },
  { key: "security", label: "セキュリティ", note: "監査ログの検証と防御の状況", group: "その他", need: "security.view" },
  { key: "audit", label: "監査ログ", note: "誰が何をしたかの記録", group: "その他", need: "audit.view" },
  { key: "settings", label: "設定", note: "認証方法・承認金額・お客様サイト", group: "その他" },
];

export const MENU_GROUPS = ["毎日", "売る前", "売っている間", "売った後", "その他"];

export function menuItem(key: MenuKey): MenuItem {
  return MENU.find((m) => m.key === key)!;
}
