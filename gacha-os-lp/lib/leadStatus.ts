/**
 * 営業ステータス。
 *
 * 問い合わせAPIは常に NEW で作成し、以降の更新はこのアプリでは行わない。
 * 受け取り側（スプレッドシート／CRM）でこの順に進めていく前提の値。
 */
export const LEAD_STATUSES = [
  "NEW", // 受付直後
  "CONTACTED", // 一次連絡済み
  "DEMO", // デモ実施
  "PROPOSAL", // 提案・見積り提出
  "WON", // 受注
  "LOST", // 失注
] as const;

export type LeadStatus = (typeof LEAD_STATUSES)[number];

/**
 * 失注の理由。
 *
 * ★なぜ決まった選択肢にするのか
 * 自由記述だけにすると、あとから「価格で負けた件数」を数えられません。
 * 数えられない情報は、営業のやり方を直すのに使えません。
 * 詳しい事情は別途メモ欄に書く前提で、まず分類だけは固定します。
 *
 * ★受け取り側（スプレッドシート／CRM）でこの値を使ってください。
 * このアプリからは書き込みません。
 */
export const LOST_REASONS = [
  "価格",
  "機能",
  "タイミング",
  "信頼",
  "競合",
  "決裁",
  "不要",
  "その他",
] as const;

export type LostReason = (typeof LOST_REASONS)[number];

/**
 * 8分類がそれぞれ何を指すか。
 * 人によって入れる場所がぶれると集計が使いものにならないので、
 * 「こういう言われ方をしたらここ」を決めておきます。
 */
export const LOST_REASON_MEANING: Record<LostReason, string> = {
  価格:
    "金額そのものが折り合わなかった。「高い」「その予算は出せない」「初期費用が厳しい」など。",
  機能:
    "必要な機能が無い・足りない。「◯◯ができないなら使えない」と具体的な不足を言われた場合。",
  タイミング:
    "中身は評価されたが今ではない。「来期に」「繁忙期を過ぎてから」「今は別件で手が回らない」など。",
  信頼:
    "実績・会社規模・セキュリティ・継続性への不安。「導入事例を見てから」「まだ新しいので様子見」など。",
  競合: "他社サービスに決まった。どこに決まったかは必ずメモ欄に書く。",
  決裁:
    "担当者は前向きだったが社内で通らなかった。決裁者に会えていない場合もここ。",
  不要: "そもそも課題が無かった。ターゲットがずれていた場合もここ。",
  その他: "上のどれにも当てはまらない。必ずメモ欄に事情を書く。",
};

/**
 * 価格に対する反応。
 *
 * ★これを取る理由
 * 今の価格（STARTER 49,800円／GROWTH 98,000円／初期構築費 300,000〜800,000円）は
 * 「営業を始めてよい価格」であって「正解の価格」ではありません。
 * 最初の商談10〜20件でこの反応を全部記録し、値段自体もあとから検証します。
 *
 * 失注したときだけでなく、受注したときも必ず記録します。
 * 「安い」と言われて受注した件が続くなら、値上げの材料になるからです。
 */
export const PRICE_FEEDBACKS = [
  "高い",
  "安い",
  "その価格なら欲しい",
  "初期費用がネック",
  "月額がネック",
  "反応なし（価格の話にならなかった）",
] as const;

export type PriceFeedback = (typeof PRICE_FEEDBACKS)[number];

/**
 * 商談で提示したプラン。
 * 「プラン別の成約率」を出すために、失注・受注どちらの場合も必ず入れます。
 */
export const PROPOSED_PLANS = ["STARTER", "GROWTH", "ENTERPRISE", "未提示"] as const;

export type ProposedPlan = (typeof PROPOSED_PLANS)[number];

/**
 * 営業管理として最低限そろえたい項目。
 * ここがそろって初めて「どの営業担当の、どの経路の、どのプランが、なぜ決まらなかったか」
 * を数字で追えます。
 */
export type LeadRecord = {
  /** 受付日時 */
  receivedAt: string;
  status: LeadStatus;

  /* ── 流入元（問い合わせフォームから自動で入る） ──
     FIRST TOUCH ＝ そのセッションで最初に入ってきたときの情報。上書きしない。
     LAST TOUCH  ＝ 最後に入り直してきたときの情報。
     例：最初X広告 → あとで sales02 のURLから入り直して問い合わせ
         ⇒ first=X広告 / last=sales02。
     成果をどちらに付けるかは受け取り側で決められるよう、両方残します。 */

  /** 営業担当の識別子（?ref=sales01 の値） */
  salesRef: string | null;
  /** 流入経路（?channel=tel など） */
  channel: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;

  /** 入り直したときの営業担当 */
  lastSalesRef: string | null;
  lastChannel: string | null;
  lastUtmSource: string | null;
  lastUtmMedium: string | null;
  lastUtmCampaign: string | null;
  /** 入り直した時刻（ISO）。入り直しが無ければ null */
  lastTouchAt: string | null;

  /** 問い合わせ前に本人が押した料金プラン。押していなければ null */
  clickedPlan: string | null;

  /* ── 商談の中身（受け取り側で人が入力する） ── */
  proposedPlan: ProposedPlan;
  /** 提示した初期構築費（円）。未提示なら null */
  proposedSetupYen: number | null;
  /**
   * 価格への反応。受注・失注どちらでも必ず入れる。
   * これが最初の10〜20件そろった時点で、価格自体を見直します。
   */
  priceFeedback: PriceFeedback | null;
  /** 「いくらなら買うか」を言われた場合の月額（円）。言われなければ null */
  saidAcceptableMonthlyYen: number | null;

  /* ── 結果 ── */
  /** LOST のときだけ必須 */
  lostReason: LostReason | null;
  /** 分類に収まらない事情を書く欄（集計には使わない） */
  note: string;
};

/**
 * 最初の商談で必ず埋める欄。ここが空のまま溜まると、
 * あとから「なぜ売れなかったのか」を数えられなくなります。
 */
export const REQUIRED_AFTER_MEETING: (keyof LeadRecord)[] = [
  "proposedPlan",
  "priceFeedback",
];
