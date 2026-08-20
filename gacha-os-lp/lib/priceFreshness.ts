/**
 * 価格の鮮度と「SAFE FAIL」の決まりごと。
 *
 * ────────────────────────────────────────────
 * ★このファイルが存在する理由（いちばん危ない不具合を止めるため）
 * ────────────────────────────────────────────
 *
 * 実還元率は「残っている景品の価値 ÷ 残りの売上」で計算します。
 * このうち「景品の価値」は、外部から取り込んだ市場価格です。
 *
 * ここで、価格の取得に失敗したとします。
 * 何も考えずに作ると、システムは**前回取り込んだ古い価格**を使って計算を続け、
 * 画面には「実還元率 94% ／ SAFE」と、いつもと同じ顔で表示されます。
 *
 * これが最悪の状態です。
 * 運営者は「今日も安全だ」と思って販売を続けますが、
 * 実際には相場が上がっていて、すでに赤字になっているかもしれません。
 * **画面は正常に見えているのに、判断の材料だけが古い。**
 *
 * だからこの製品では、価格が古い・取れないときは
 * 「安全です」と言わずに、はっきり「わかりません」と言います。
 *
 *   価格が新しい   → 実還元率を計算して表示する（SAFE / CAUTION / DANGER）
 *   価格が古い     → STALE。実還元率は UNKNOWN。安全とは表示しない
 *   価格が取れない → UNKNOWN。同上
 *
 * 安全側に倒して失敗する、という意味で SAFE FAIL と呼びます。
 */

export type Freshness = "FRESH" | "STALE" | "UNKNOWN";

/** 実還元率の判定。価格が古いときは数字を出さず UNKNOWN にする。 */
export type RtpVerdict = "SAFE" | "CAUTION" | "DANGER" | "UNKNOWN";

/**
 * 何時間を過ぎたら「古い」とみなすか。
 *
 * 既定の更新周期は週1回（毎週月曜 04:00）なので、
 * 1周期ぶん＋1日の猶予＝8日を上限にしています。
 * これを過ぎているということは、少なくとも1回は取り込みに失敗しています。
 */
export const STALE_AFTER_HOURS = 24 * 8;

/** 実還元率のしきい値（バックテストと同じ基準を使う） */
export const RTP_CAUTION = 105;
export const RTP_DANGER = 110;

export type FreshnessResult = {
  state: Freshness;
  /** 最終更新からの経過時間（時間）。取得できていない場合は null */
  ageHours: number | null;
  /** 画面に出す短いラベル */
  label: string;
  /** なぜその状態なのかの説明（商談で聞かれたときにそのまま読める文） */
  reason: string;
};

/**
 * 価格の最終更新時刻から鮮度を判定する。
 *
 * @param fetchedAt 最終更新時刻。取得できていない場合は null / 空文字
 * @param now       判定時刻（テストのために差し替えられるようにしている）
 */
export function priceFreshness(
  fetchedAt: string | Date | null | undefined,
  now: Date = new Date()
): FreshnessResult {
  if (!fetchedAt) {
    return {
      state: "UNKNOWN",
      ageHours: null,
      label: "PRICE DATA UNKNOWN",
      reason:
        "市場価格をまだ一度も取り込めていません。実還元率は計算できないため、安全とも危険とも表示しません。",
    };
  }

  const t = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  const ms = t.getTime();
  if (!Number.isFinite(ms)) {
    return {
      state: "UNKNOWN",
      ageHours: null,
      label: "PRICE DATA UNKNOWN",
      reason:
        "市場価格の取得時刻が読み取れませんでした。実還元率は計算できないため、安全とも危険とも表示しません。",
    };
  }

  const ageHours = (now.getTime() - ms) / 3_600_000;

  // 未来の時刻が入っていたら、それは正しく取り込めていないということ
  if (ageHours < 0) {
    return {
      state: "UNKNOWN",
      ageHours: null,
      label: "PRICE DATA UNKNOWN",
      reason:
        "市場価格の取得時刻が未来になっています。取り込みが正しく行われていないため、実還元率は表示しません。",
    };
  }

  if (ageHours > STALE_AFTER_HOURS) {
    const days = Math.floor(ageHours / 24);
    return {
      state: "STALE",
      ageHours,
      label: "PRICE DATA STALE",
      reason: `市場価格が ${days} 日間 更新されていません。この価格で計算した実還元率は現状と合っていない可能性があるため、UNKNOWN として扱います。`,
    };
  }

  return {
    state: "FRESH",
    ageHours,
    label: "PRICE DATA FRESH",
    reason: "市場価格は最新です。実還元率はこの価格で計算しています。",
  };
}

/**
 * 実還元率の判定。
 *
 * ★ここが SAFE FAIL の実体です。
 * 価格が FRESH でない限り、たとえ計算結果が 94%（＝いつもなら SAFE）でも
 * SAFE とは返しません。UNKNOWN を返します。
 */
export function rtpVerdict(
  rtpPercent: number,
  freshness: Freshness
): { verdict: RtpVerdict; display: string } {
  if (freshness !== "FRESH") {
    return { verdict: "UNKNOWN", display: "—" };
  }
  if (!Number.isFinite(rtpPercent)) {
    return { verdict: "UNKNOWN", display: "—" };
  }
  const verdict: RtpVerdict =
    rtpPercent >= RTP_DANGER
      ? "DANGER"
      : rtpPercent >= RTP_CAUTION
        ? "CAUTION"
        : "SAFE";
  return { verdict, display: `${rtpPercent.toFixed(1)}%` };
}

/** 「2026-08-18 04:00」の形にする（画面表示用） */
export function formatFetchedAt(fetchedAt: string | Date | null | undefined) {
  if (!fetchedAt) return "—";
  const t = fetchedAt instanceof Date ? fetchedAt : new Date(fetchedAt);
  if (!Number.isFinite(t.getTime())) return "—";
  const p = (n: number) => String(n).padStart(2, "0");
  return `${t.getFullYear()}-${p(t.getMonth() + 1)}-${p(t.getDate())} ${p(
    t.getHours()
  )}:${p(t.getMinutes())}`;
}

/**
 * デモ画面用の「直近の取り込み時刻」。
 *
 * 更新周期は毎週月曜 04:00 なので、いま時点から見て
 * 直近に過ぎた月曜 04:00 を返します。
 * 固定の日付を書いてしまうと、時間が経つほど
 * デモ画面が「何か月も更新されていない」状態に見えてしまうためです。
 */
export function lastScheduledFetch(now: Date = new Date()): Date {
  const d = new Date(now);
  d.setHours(4, 0, 0, 0);
  // 月曜=1。直近の月曜まで戻す
  const back = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - back);
  if (d.getTime() > now.getTime()) d.setDate(d.getDate() - 7);
  return d;
}
