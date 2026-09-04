/**
 * 計測イベントの送信口。
 *
 * ・GA4 / Clarity が未設定でもエラーにならない（何も起きないだけ）
 * ・タグの読み込みより先に起きた出来事も、取りこぼさない（下の「待たせる仕組み」）
 * ・イベント名はこのファイルに集約する（画面ごとにバラバラの名前を付けない）
 * ・全イベントに「営業担当（ref）」と「流入経路（channel）」を自動で付ける
 *   → 誰の営業から来た人が、どこまで進んだかを後から追える
 *
 * ★個人情報は絶対に送らない（氏名・メール・電話・相談内容）。
 */

import { readLeadSource } from "./lead";
import { ads, AD_CONVERSION_BY_EVENT, type AdConversion } from "@/config/ads";

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
    clarity?: (...args: unknown[]) => void;
    /** Meta（Instagram / Facebook）広告 */
    fbq?: (...args: unknown[]) => void;
    /** X（旧Twitter）広告 */
    twq?: (...args: unknown[]) => void;
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
 * 広告側にも「成果が起きた」ことを返す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、GA4 とは別に送るのか
 * ═══════════════════════════════════════════════════════
 *
 *   GA4 は「あとから人が見る」ための道具です。
 *   広告の自動調整は、広告側のタグが受け取った成果でしか学習しません。
 *   GA4 にだけ記録しても、広告は何も学びません。
 *   同じ出来事を、見る用と、学習用に、2か所へ渡します。
 *
 * ★出稿していない媒体には、何も送りません。
 *   設定が空なら、この関数は静かに終わります。
 *   「タグが無いのに送ろうとして画面が固まる」を作らないためです。
 *
 * ★成果は、必ず1回だけ返すこと。
 *   フォームの二度押しで2件に数えると、
 *   広告側の単価がその場で半分に見えます。
 *   安く見えた広告に予算を寄せて、実際には損をします。
 */
const conversionSent = new Set<AdConversion>();

function sendAdConversion(kind: AdConversion) {
  if (conversionSent.has(kind)) return;
  conversionSent.add(kind);

  /* ── Google 広告 ── */
  const label = kind === "contact" ? ads.google.labelContact : ads.google.labelDemo;
  if (ads.google.id && label) {
    try {
      window.gtag?.("event", "conversion", {
        send_to: `${ads.google.id}/${label}`,
      });
    } catch {
      /* 計測の失敗で画面を壊さない */
    }
  }

  /* ── Meta（Instagram / Facebook）──
       ★標準イベント名を使うこと。独自名にすると、
         Meta 側の最適化の対象から外れます。 */
  if (ads.meta.id) {
    try {
      window.fbq?.("track", kind === "contact" ? "Lead" : "ViewContent");
    } catch {
      /* 同上 */
    }
  }

  /* ── X（旧Twitter）── */
  const xEvent = kind === "contact" ? ads.x.eventContact : ads.x.eventDemo;
  if (ads.x.id && xEvent) {
    try {
      window.twq?.("event", xEvent, {});
    } catch {
      /* 同上 */
    }
  }
}

/** 実際に送る（タグが読み込み済みであることが前提） */
function sendNow(name: string, payload: Record<string, unknown>) {
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

  /* ★成果にあたる動きなら、広告側にも返す。
       ここを呼び出し側（画面）に書かせないこと。
       画面は35箇所あります。1つ書き忘れても誰も気づきません。
       どのイベントが成果かは config/ads.ts の対応表1枚だけが決めます。 */
  const conv = AD_CONVERSION_BY_EVENT[name];
  if (conv) sendAdConversion(conv);
}

/**
 * ═══════════════════════════════════════════════════════
 * ★タグが読み込まれる前に起きた出来事を、取りこぼさない
 * ═══════════════════════════════════════════════════════
 *
 *   計測タグは「画面が動き出したあと」に読み込まれます（afterInteractive）。
 *   一方、画面によっては「開いた瞬間」に成果を送ります。
 *   例：デモ画面は、開いた直後に demo_start を送ります。
 *
 *   ★この2つの順番が入れ替わると、成果が消えます。
 *     window.gtag?.(...) は、まだ無ければ「何もしない」だけで、
 *     エラーも出ません。画面は正常に動き、成果だけが0件になります。
 *     実測で、本番のデモ画面がこの状態でした。
 *
 *   ですので、タグがまだ無い間は、いったん手元にためて、
 *   読み込みが終わってから、起きた順番どおりに送ります。
 *
 * ★自分で window.gtag を作らないこと。
 *   作れば確かにためられますが、その場合こちらの出来事が
 *   タグ本体の「どのアカウント宛か」の指定より前に並びます。
 *   宛先が決まる前に届いた成果は、正しく数えられません。
 *
 * ★いつまでも待たないこと。
 *   タグを1つも入れていない環境（開発中など）では、
 *   待っても永久に来ません。一定時間で静かにあきらめます。
 */

/**
 * このサイトが読み込むはずのタグ（未設定なら、そもそも待たない）。
 *
 * ★待つ対象を gtag だけに絞ってあります。
 *   Clarity は「あとから人が見る」ための録画で、広告の成果には関係しません。
 *   これを待つ対象に入れると、Clarity だけが遮断された人の成果まで
 *   丸ごと消えます。守るべきはお金のほうです。
 *
 * ★なお window.gtag は、外部ファイルの到着を待たずに用意されます
 *   （タグの先頭に「function gtag(){dataLayer.push(arguments)}」が
 *     書かれているため）。ですので、ここが true になった時点で
 *   送った出来事は、外部ファイルが遅れて届いても、あとから処理されます。
 */
const WANT_GTAG = Boolean(process.env.NEXT_PUBLIC_GA4_ID || ads.google.id);

/** ためておける上限（これ以上は捨てる。際限なく増やさないため） */
const PENDING_MAX = 50;
/** 待つ時間の上限 */
const WAIT_LIMIT_MS = 10_000;
/** 読み込み終わったかを見に行く間隔 */
const RETRY_MS = 200;

const pending: { name: string; payload: Record<string, unknown> }[] = [];
let waitStartedAt = 0;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let loadBound = false;

/** 送れる状態になったか */
function tagsReady(): boolean {
  if (WANT_GTAG && typeof window.gtag !== "function") return false;
  return true;
}

/** ためた分を、起きた順番どおりに送る */
function flushPending() {
  while (pending.length > 0) {
    const e = pending.shift()!;
    sendNow(e.name, e.payload);
  }
  waitStartedAt = 0;
}

function tick() {
  if (retryTimer) {
    clearTimeout(retryTimer);
    retryTimer = null;
  }
  if (pending.length === 0) {
    waitStartedAt = 0;
    return;
  }
  if (tagsReady()) {
    flushPending();
    return;
  }
  if (Date.now() - waitStartedAt >= WAIT_LIMIT_MS) {
    /* ★あきらめる。タグを入れていない環境で、ためたまま増やし続けない。 */
    pending.length = 0;
    waitStartedAt = 0;
    return;
  }
  scheduleFlush();
}

function scheduleFlush() {
  if (retryTimer) return;
  if (waitStartedAt === 0) waitStartedAt = Date.now();
  if (!loadBound) {
    loadBound = true;
    try {
      /* 読み込み完了の合図が来たら、待たずにすぐ送る */
      window.addEventListener?.("load", () => tick(), { once: true });
    } catch {
      /* 合図が使えない環境でも、下のタイマーで拾える */
    }
  }
  try {
    retryTimer = setTimeout(tick, RETRY_MS);
  } catch {
    /* タイマーが使えないなら、次の track() のときに拾う */
  }
}

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

  if (!tagsReady()) {
    /* ★まだタグが無い。捨てずに、ためておく。 */
    if (pending.length < PENDING_MAX) pending.push({ name, payload });
    scheduleFlush();
    return;
  }

  /* ★ためた分を先に出すこと。順番が入れ替わると、
       「デモを見る前に相談した人」という有り得ない並びになります。 */
  if (pending.length > 0) flushPending();
  sendNow(name, payload);
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
