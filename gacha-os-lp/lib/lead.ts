/**
 * 流入元の記録と、診断結果の受け渡し。
 *
 * 目的：
 * - 「どの経路（LP / 広告 / 電話営業 / 紹介 / X / Google など）からの問い合わせか」を
 *   お問い合わせ時に一緒に送れるようにする。
 * - 営業担当ごとのURL（例 ?ref=sales01）で、誰の営業からの問い合わせかを追える形にする。
 *
 * 方針：
 * - 最初に着地したページの情報だけを保存し、サイト内で回遊しても上書きしない。
 * - 保存先はブラウザの sessionStorage のみ。個人情報は入れない。
 * - Cookie は使わない（同意バナーが必要になる範囲を広げない）。
 */

export type LeadSource = {
  /** 営業担当・紹介コード（?ref=sales01） */
  ref: string;
  /** 経路の手動指定（?channel=tel など） */
  channel: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  /** 最初に着地したページ */
  landing: string;
  /** 直前の参照元 */
  referrer: string;
  /** Heroコピーのテスト記号 */
  variant: string;
};

/**
 * 直近の流入元（LAST TOUCH）。
 *
 * FIRST TOUCH（上の LeadSource）は最初の着地で確定し、二度と上書きしません。
 * それとは別に「最後にどの入口から入り直したか」を持ちます。
 *
 * 例：X広告で来た人が、あとで営業sales02のURLから入り直して問い合わせた場合
 *   first_touch = X広告 ／ last_touch = sales02
 *
 * ★ここは正直に書いておきます。
 * 保存先は sessionStorage なので、この2つを分けられるのは
 * 「同じタブを開いたままの1回の訪問の中」だけです。
 * タブを閉じて数日後に入り直した場合、その時点が改めて FIRST TOUCH になります。
 * 日をまたいで first / last を分けたい場合は localStorage か Cookie が必要ですが、
 * 同意バナーが必要になる範囲を広げないため、今回は入れていません。
 */
export type LastTouch = {
  ref: string;
  channel: string;
  utmSource: string;
  utmMedium: string;
  utmCampaign: string;
  /** 入り直したページ */
  landing: string;
  /** 入り直した時刻（ISO） */
  at: string;
};

const SOURCE_KEY = "gos.lead.source";
const LAST_KEY = "gos.lead.last";
const PLAN_KEY = "gos.lead.plan";
const DIAG_KEY = "gos.diagnosis";

const EMPTY: LeadSource = {
  ref: "",
  channel: "",
  utmSource: "",
  utmMedium: "",
  utmCampaign: "",
  landing: "",
  referrer: "",
  variant: "",
};

function safeGet(key: string) {
  try {
    return window.sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string) {
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    /* プライベートブラウズ等で失敗しても、フォーム送信自体は止めない */
  }
}

/**
 * いま開いているURLから流入元を読み取る（保存はしない）。
 *
 * ★パラメータが競合したときの決まりごと（ここが唯一の判断場所）
 *
 * `?ref=sales01&utm_source=x` のように、営業コードと広告UTMが同時に来ることがあります。
 * このとき「どちらか一方を捨てる」ことはしません。混ざると後から復元できなくなるためです。
 *
 *   sales_ref     … `?ref=` の値だけ。UTMの影響を受けない
 *   utm_source    … `?utm_source=` の値だけ。refの影響を受けない
 *   utm_medium    … `?utm_medium=` の値だけ
 *   utm_campaign  … `?utm_campaign=` の値だけ
 *   lead_channel  … 「この人をどの経路に数えるか」の1つの答え。下の優先順で決める
 *
 * lead_channel の優先順位（上が強い）：
 *   1. `?channel=` の明示指定（営業が意図的に付けた値。例 tel / dm）
 *   2. `?ref=` があれば "sales"（営業経由を広告経由より優先して数える）
 *   3. `?utm_source=` の値
 *   4. 参照元ドメインからの推定（google / yahoo / x / bing / そのホスト名）
 *   5. 参照元なし → "direct"
 *
 * つまり `?ref=sales01&utm_source=x` は
 *   sales_ref=sales01 / utm_source=x / lead_channel=sales
 * になります。営業の成果として数えつつ、広告から来た事実も残ります。
 */
function readUrlSource(): LeadSource {
  const q = new URLSearchParams(window.location.search);
  const referrer = document.referrer || "";

  const guessChannel = () => {
    const explicit = q.get("channel");
    if (explicit) return explicit;
    if (q.get("ref")) return "sales";
    if (q.get("utm_source")) return q.get("utm_source") as string;
    if (!referrer) return "direct";
    try {
      const h = new URL(referrer).hostname.replace(/^www\./, "");
      if (h === window.location.hostname) return "internal";
      if (h.includes("google")) return "google";
      if (h.includes("yahoo")) return "yahoo";
      if (h === "t.co" || h.includes("twitter") || h.includes("x.com")) return "x";
      if (h.includes("bing")) return "bing";
      return h;
    } catch {
      return "referral";
    }
  };

  return {
    ref: (q.get("ref") ?? "").slice(0, 40),
    channel: guessChannel().slice(0, 40),
    utmSource: (q.get("utm_source") ?? "").slice(0, 80),
    utmMedium: (q.get("utm_medium") ?? "").slice(0, 80),
    utmCampaign: (q.get("utm_campaign") ?? "").slice(0, 120),
    landing: `${window.location.pathname}${window.location.search}`.slice(0, 300),
    referrer: referrer.slice(0, 300),
    variant: (q.get("v") ?? "").slice(0, 20),
  };
}

/**
 * 「この訪問は、識別できる入口から入り直したか」。
 *
 * `?ref` `?utm_source` `?channel` のどれかが付いているときだけ true。
 * サイト内をただ回遊しただけで LAST TOUCH を空で塗りつぶさないための判定です。
 */
function hasEntryParams(s: LeadSource) {
  return Boolean(s.ref || s.utmSource || new URLSearchParams(window.location.search).get("channel"));
}

/** 識別できる入口から入り直したときだけ、LAST TOUCH を更新する */
function updateLastTouch(s: LeadSource) {
  if (!hasEntryParams(s)) return;
  const last: LastTouch = {
    ref: s.ref,
    channel: s.channel,
    utmSource: s.utmSource,
    utmMedium: s.utmMedium,
    utmCampaign: s.utmCampaign,
    landing: s.landing,
    at: new Date().toISOString(),
  };
  safeSet(LAST_KEY, JSON.stringify(last));
}

/**
 * 着地時に呼ぶ。
 *
 * FIRST TOUCH（最初の着地）はすでに記録があれば上書きしません。
 * LAST TOUCH（直近の入口）は、識別できるパラメータ付きで入り直すたびに更新します。
 */
export function captureLeadSource(): LeadSource {
  if (typeof window === "undefined") return EMPTY;

  const current = readUrlSource();
  updateLastTouch(current);

  const saved = safeGet(SOURCE_KEY);
  if (saved) {
    try {
      return { ...EMPTY, ...(JSON.parse(saved) as Partial<LeadSource>) };
    } catch {
      /* 壊れていたら取り直す */
    }
  }

  safeSet(SOURCE_KEY, JSON.stringify(current));
  return current;
}

/** 直近の入口。まだ一度も識別できる入口を通っていなければ null。 */
export function readLastTouch(): LastTouch | null {
  if (typeof window === "undefined") return null;
  const saved = safeGet(LAST_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as LastTouch;
  } catch {
    return null;
  }
}

/** フォーム送信時に読む。未記録なら空の値を返す。 */
export function readLeadSource(): LeadSource {
  if (typeof window === "undefined") return EMPTY;
  const saved = safeGet(SOURCE_KEY);
  if (!saved) return EMPTY;
  try {
    return { ...EMPTY, ...(JSON.parse(saved) as Partial<LeadSource>) };
  } catch {
    return EMPTY;
  }
}

/**
 * Heroコピーのテスト記号だけ後から確定させる場合に使う。
 *
 * 注意：この関数はHeroの表示時（＝ページ内で最初）に走る。
 * 先に captureLeadSource() を呼んで流入元を確定させないと、
 * 中身が空のまま記録が作られてしまい、?ref= や utm_* を取りこぼす。
 */
export function setLeadVariant(variant: string) {
  if (typeof window === "undefined" || !variant) return;
  const cur = captureLeadSource();
  if (cur.variant === variant) return;
  safeSet(SOURCE_KEY, JSON.stringify({ ...cur, variant: variant.slice(0, 20) }));
}

/* ────────────────────────────────
   選んだ料金プラン
   ──────────────────────────────── */

/**
 * 料金セクションで押されたプランのボタンを覚えておく。
 *
 * ★なぜ保存するのか
 * 「どのプランのボタンから問い合わせに来たか」は、計測イベント（plan_select）だけでは
 * 個別の問い合わせと結びつきません。GA4は人数を数えるものであって、
 * 「この山田さんはGROWTHのボタンを押した」とは教えてくれないためです。
 * プラン別の成約率を出すには、問い合わせ1件ごとに残す必要があります。
 *
 * 最後に押したプランで上書きします（迷って押し直した場合、最後の意思を採る）。
 */
export type SelectedPlan = { plan: string; at: string };

export function saveSelectedPlan(plan: string) {
  if (typeof window === "undefined" || !plan) return;
  const value: SelectedPlan = {
    plan: plan.slice(0, 40),
    at: new Date().toISOString(),
  };
  safeSet(PLAN_KEY, JSON.stringify(value));
  // 同じページ内にあるご相談フォームへ、押されたプランをその場で伝える
  window.dispatchEvent(new CustomEvent("gos:plan", { detail: value }));
}

export function readSelectedPlan(): SelectedPlan | null {
  if (typeof window === "undefined") return null;
  const saved = safeGet(PLAN_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as SelectedPlan;
  } catch {
    return null;
  }
}

/* ────────────────────────────────
   診断結果（「今何に困っていますか？」）
   ──────────────────────────────── */

export type Diagnosis = {
  /** ご相談フォームの補足欄へそのまま入れる文面 */
  summary: string;
  /** 見出し用の短い構成名 */
  headline: string;
};

export function saveDiagnosis(d: Diagnosis) {
  if (typeof window === "undefined") return;
  safeSet(DIAG_KEY, JSON.stringify(d));
  window.dispatchEvent(new CustomEvent("gos:diagnosis", { detail: d }));
}

export function readDiagnosis(): Diagnosis | null {
  if (typeof window === "undefined") return null;
  const saved = safeGet(DIAG_KEY);
  if (!saved) return null;
  try {
    return JSON.parse(saved) as Diagnosis;
  } catch {
    return null;
  }
}
