/**
 * 動画収録・商談デモで使うサンプルデータ。
 *
 * ★重要
 * ここにある数値は、説明のために用意した「サンプル」です。
 * 実在の運営実績ではありません。画面上には必ず DEMO DATA の表示を出し、
 * 実績と誤認させない状態を保ってください（景品表示法／優良誤認の回避）。
 *
 * 収録をやり直しても毎回まったく同じ画面から始められるように、
 * 数値はここに固定で持たせ、画面側では加工しません。
 */

import type { GachaSpec } from "@/lib/backtest";

export const DEMO_BADGE = "DEMO DATA";

/**
 * 公開前バックテストに掛けるサンプルのガチャ構成。
 * 数字はサンプルですが、計算はごまかしていません（lib/backtest.ts が実際に回します）。
 */
export const demoBacktestSpec: GachaSpec = {
  name: "スニーカーBOX 第13弾（公開前）",
  price: 2_000,
  total: 800,
  prizes: [
    { grade: "S賞", name: "AJ1 Retro High OG 27.5cm", count: 1, value: 51_800 },
    { grade: "A賞", name: "限定復刻 ダンク Low 26.0cm", count: 4, value: 28_600 },
    { grade: "B賞", name: "人気モデル スニーカー", count: 20, value: 12_000 },
    { grade: "C賞", name: "スニーカーケア用品セット", count: 775, value: 1_400 },
  ],
};

export const demoKpi = {
  /** 月間売上 */
  monthlySalesYen: 12_840_000,
  /** 公開中のガチャ本数 */
  publishedGacha: 18,
  /** 市場価格ベースの実還元率（最大値） */
  realRtpMaxPct: 108.7,
  /** 未発送の件数 */
  unshipped: 26,
  /** 担当者へ回っている問い合わせ件数 */
  openInquiries: 4,
  /** 価格アラートの件数 */
  priceAlerts: 3,
} as const;

/** 収録用ダッシュボードに並べる6つの数字（並び順もここで固定する） */
export const demoKpiCards: {
  label: string;
  value: string;
  note: string;
  tone: "ink" | "ok" | "warn" | "danger";
}[] = [
  {
    label: "月間売上",
    value: `¥${demoKpi.monthlySalesYen.toLocaleString("ja-JP")}`,
    note: "サンプル",
    tone: "ink",
  },
  {
    label: "公開中ガチャ",
    value: `${demoKpi.publishedGacha}`,
    note: "本",
    tone: "ink",
  },
  {
    label: "REAL RTP（最大）",
    value: `${demoKpi.realRtpMaxPct.toFixed(1)}%`,
    note: "しきい値 105%",
    tone: "danger",
  },
  {
    label: "未発送",
    value: `${demoKpi.unshipped}`,
    note: "件",
    tone: "warn",
  },
  {
    label: "未対応の問い合わせ",
    value: `${demoKpi.openInquiries}`,
    note: "件",
    tone: "warn",
  },
  {
    label: "PRICE ALERT",
    value: `${demoKpi.priceAlerts}`,
    note: "件",
    tone: "danger",
  },
];
