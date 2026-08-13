// P0 用のモックデータ。AURA_MODE=test の間は外部に一切出ないため、
// 画面確認はすべてこのダミー値で行う。P1以降で実データに差し替える。

export interface TodayStat {
  label: string;
  value: number;
  delta: number; // 前日比
  unit?: string;
}

export const todayStats: TodayStat[] = [
  { label: "投稿", value: 4, delta: 1 },
  { label: "いいね", value: 22, delta: -3 },
  { label: "返信", value: 11, delta: 4 },
  { label: "フォロワー", value: 1842, delta: 12 },
];

// 残り枠（guard_settings の初期値に対する消化状況）
export interface QuotaBar {
  label: string;
  used: number;
  limit: number;
}

export const quotas: QuotaBar[] = [
  { label: "投稿", used: 4, limit: 6 },
  { label: "返信", used: 11, limit: 25 },
  { label: "いいね", used: 22, limit: 50 },
];

export const pendingApprovals = 3;

export interface ActionLogItem {
  id: string;
  time: string;
  type: "post" | "reply" | "like";
  actor: "human" | "system";
  text: string;
}

export const actionLog: ActionLogItem[] = [
  {
    id: "1",
    time: "12:04",
    type: "post",
    actor: "human",
    text: "新弾オリパの当選報告を投稿しました",
  },
  {
    id: "2",
    time: "11:32",
    type: "reply",
    actor: "human",
    text: "「封入率どのくらいですか？」への返信を送信",
  },
  {
    id: "3",
    time: "10:58",
    type: "like",
    actor: "human",
    text: "フォロワーの開封報告に いいね",
  },
  {
    id: "4",
    time: "09:15",
    type: "post",
    actor: "system",
    text: "予約投稿（在庫状況）を公開",
  },
];

// やること6タイル（section 4 ①）
export interface Tile {
  key: string;
  label: string;
  href: string;
  badge?: number;
}

export const tiles: Tile[] = [
  { key: "post", label: "ポスト投稿", href: "/post" },
  { key: "reply", label: "届いたリプ", href: "/inbox", badge: pendingApprovals },
  { key: "around", label: "リプ周り", href: "#", badge: 5 },
  { key: "feed", label: "ネタ供給", href: "#" },
  { key: "research", label: "リサーチ", href: "#" },
  { key: "analytics", label: "分析", href: "#" },
];
