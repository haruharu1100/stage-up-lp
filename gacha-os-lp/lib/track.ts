/**
 * 計測イベントの送信口。
 *
 * ・GA4 / Clarity が未設定でもエラーにならない（何も起きないだけ）
 * ・イベント名はこのファイルに集約する（画面ごとにバラバラの名前を付けない）
 * ・全イベントに「営業担当（ref）」と「流入経路（channel）」を自動で付ける
 *   → 誰の営業から来た人が、どこまで進んだかを後から追える
 *
 * ★個人情報は絶対に送らない（氏名・メール・電話・相談内容）。
 */

import { readLeadSource } from "./lead";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
  }
}

/**
 * 取得するイベント（この14種が計測の骨格）。
 *
 * 見たい指標との対応：
 * 　Hero離脱率   → hero_cta_click
 * 　デモクリック → demo_start / demo_complete
 * 　ROI利用率    → roi_start / roi_complete
 * 　料金閲覧     → pricing_view
 * 　CTAクリック  → contact_start
 * 　問い合わせ率 → contact_submit
 */
export const EV = {
  /** Heroの主要ボタンを押した */
  heroCta: "hero_cta_click",
  /** デモ画面を開いた */
  demoStart: "demo_start",
  /** デモの主要機能を一通り触った */
  demoComplete: "demo_complete",
  /** ROI試算を動かし始めた */
  roiStart: "roi_start",
  /** ROI試算の結果（料金との比較）まで到達した */
  roiComplete: "roi_complete",
  /** 料金セクションが画面に入った */
  pricingView: "pricing_view",
  /** 診断ウィザードを開始した */
  diagnosisStart: "diagnosis_start",
  /** 診断結果まで到達した */
  diagnosisComplete: "diagnosis_complete",
  /** 問い合わせフォームに入力を始めた */
  contactStart: "contact_start",
  /** 問い合わせを送信できた */
  contactSubmit: "contact_submit",
  /** 商談用ページを開いた */
  salesDemoStart: "sales_demo_start",
  /** 商談用ページを最後まで進めた */
  salesDemoComplete: "sales_demo_complete",
  /** デモ動画の再生を始めた */
  videoPlay: "video_play",
  /** デモ動画を最後まで見た */
  videoComplete: "video_complete",

  /* ── 補助的に見る動き（上の14種の内訳） ── */
  /** 価格急騰シミュレーションを操作した */
  shockUse: "price_shock_use",
  /** 診断結果からフォームへ進んだ */
  diagnoseToForm: "diagnose_to_form",
  /** サイト内のCTAを押した */
  ctaClick: "cta_click",
  /** 公開前バックテストのセクションが画面に入った */
  backtestView: "backtest_view",
  /**
   * お客様側のデモでガチャを引いた（params に count: 1 | 10）。
   * 「管理画面のデモ」と「お客様側のデモ」のどちらが触られているかを分けて見るため。
   */
  playDraw: "customer_play_draw",
  /** お客様側のデモを、発送依頼まで進めた */
  playComplete: "customer_play_complete",
  /**
   * お客様側のデモで問い合わせを送った。
   * params は q（質問の種類）と mode（"auto" = AIが即答 / "escalate" = 人へ引き継ぎ）。
   * ★どの質問が押されるかを見ておくと、実際の運用でAIに任せる範囲を決める材料になります。
   */
  playAsk: "customer_play_ask",
  /**
   * 料金プランのボタンを押した（params に plan: "starter" 等を付ける）。
   * 「プラン別の成約率」を出すための入口。
   * 実際の成約はサイト側では分からないので、受け取り側の台帳と突き合わせます。
   */
  planSelect: "plan_select",
} as const;

export type EventName = (typeof EV)[keyof typeof EV];

/**
 * 全イベントに共通で付ける情報。
 * 個人情報は含めず、「どの経路・どの営業担当から来たか」だけを渡す。
 */
function commonParams(): Record<string, string> {
  try {
    const s = readLeadSource();
    const p: Record<string, string> = {};
    if (s.ref) p.sales_ref = s.ref;
    if (s.channel) p.lead_channel = s.channel;
    if (s.utmSource) p.utm_source = s.utmSource;
    if (s.utmMedium) p.utm_medium = s.utmMedium;
    if (s.utmCampaign) p.utm_campaign = s.utmCampaign;
    if (s.variant) p.hero_variant = s.variant;
    return p;
  } catch {
    return {};
  }
}

/** 同じイベントを何度も数えないための記録 */
const once = new Set<string>();

/**
 * イベントを送る。
 * params には個人情報を入れないこと。
 */
export function track(
  name: EventName | string,
  params: Record<string, unknown> = {}
) {
  if (typeof window === "undefined") return;
  const payload = { ...commonParams(), ...params };
  try {
    window.gtag?.("event", name, payload);
  } catch {
    /* 計測の失敗で画面を壊さない */
  }
  try {
    // Clarity 側でも、後から「このイベントが起きた人」で絞り込めるようにする
    window.clarity?.("event", name);
  } catch {
    /* 同上 */
  }
}

/** 1回だけ送る（スライダー操作など、何度も起きる動きに使う） */
export function trackOnce(
  name: EventName | string,
  params: Record<string, unknown> = {}
) {
  if (once.has(name)) return;
  once.add(name);
  track(name, params);
}
