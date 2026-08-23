/**
 * Offer Score / Survival Score / ERPM
 *
 * 仕様:
 *   docs/12_Phase1計画.md 「4. Offer Score / Survival Score」
 *   事業Vault/AI YAMATO NADESHIKO/05_ANALYTICS/KPI定義.md（ERPMの式）
 *   事業Vault/AI YAMATO NADESHIKO/02_AFFILIATE/申請学習.md（1社依存にしない）
 *
 * ★この実装が守っている前提（ここを崩すと事業判断が壊れる）
 *   1. UNKNOWN は UNKNOWN のまま。null や false に潰さない
 *   2. verified_at が無い行は「使用不可」。推薦の対象にしない
 *   3. Offer Score だけで並べない。Survival Score が下限未満なら推薦しない
 *   4. ERPM は必ず承認率を掛ける。どの段が仮定かを必ず表に出す
 *   5. offer_scores は凍結して積む（UPDATE しない）
 *   6. 成約20件未満の案件に「この案件はダメ」と書かない
 */

import { getDb, nowIso, notify } from "./db.js";

// ===========================================================================
// 型
// ===========================================================================

export type TriState = "YES" | "NO" | "UNKNOWN";

export type OfferCategory =
  | "VPN"
  | "ESIM"
  | "JAPAN_TRAVEL"
  | "JAPANESE_LANGUAGE"
  | "JAPAN_PRODUCTS"
  | "AI_TOOLS"
  | "OTHER";

export const CATEGORIES: OfferCategory[] = [
  "VPN",
  "ESIM",
  "JAPAN_TRAVEL",
  "JAPANESE_LANGUAGE",
  "JAPAN_PRODUCTS",
  "AI_TOOLS",
];

/** 申請学習.md の本命3 + バックアップ3。ここが3カテゴリを切ったら事業が止まる */
export const PRIMARY_CATEGORIES: OfferCategory[] = ["VPN", "ESIM", "JAPAN_TRAVEL"];
export const BACKUP_CATEGORIES: OfferCategory[] = [
  "JAPANESE_LANGUAGE",
  "JAPAN_PRODUCTS",
  "AI_TOOLS",
];

export type Basis = "FACT" | "MIXED" | "ASSUMPTION";

/** import-offers.ts が offers.source へ入れる出所ブロブ。生の文言をそのまま持つ */
export type OfferMeta = {
  ref?: string;
  section?: "A" | "B" | "C";
  /** 一次/二次/UNKNOWN の行数。ここから一次情報確認度を出す */
  evidence?: { primary: number; secondary: number; unknown: number };
  /** OFFERS.md セクションD の「いつ」「前提条件」。無ければ申請順に置けない */
  readiness?: { when: string; prereq: string };
  raw?: Record<string, string>;
  notes?: string;
  excluded?: boolean;
  excludedReason?: string;
  unparsed?: string[];
};

export type LoadedOffer = {
  id: string;
  name: string;
  category: OfferCategory;
  networkId: string;
  networkName: string;
  payoutType: string | null;
  payoutAmount: number | null;
  payoutCurrency: string;
  revsharePct: number | null;
  cookieDays: number | null;
  minPayoutUsd: number | null;
  approvalStatus: string;
  japanOk: TriState;
  allowsSocial: TriState;
  allowsAi: TriState;
  payoutMethods: string[];
  allowedTraffic: string;
  restrictions: string[];
  offerVerifiedAt: string | null;
  networkVerifiedAt: string | null;
  meta: OfferMeta;
};

export type Component = {
  key: string;
  label: string;
  weight: number;
  /** null = UNKNOWN。0点にしない。加重平均から外して理由を残す */
  value: number | null;
  note: string;
};

export type ScoreResult = {
  score: number;
  components: Component[];
  unknownKeys: string[];
};

export type ErpmFactor = {
  key: string;
  label: string;
  value: number;
  basis: "FACT" | "ASSUMPTION";
  source: string;
  sample: string;
};

export type ErpmResult = {
  erpmUsd: number | null;
  basis: Basis;
  factors: ErpmFactor[];
  assumedKeys: string[];
  /** 全段が仮定なら「候補の並び」までで、決定には使えない */
  usableAsDecision: boolean;
};

export type RankedOffer = {
  offer: LoadedOffer;
  offerScore: ScoreResult;
  survivalScore: ScoreResult;
  erpm: ErpmResult;
  composite: number;
  readinessTier: number;
  readinessLabel: string;
  /** 推薦できるか。できないなら理由 */
  recommendable: boolean;
  blockReasons: string[];
};

export type RankResult = {
  ranked: RankedOffer[];
  held: RankedOffer[];
  unusable: { id: string; name: string; reason: string }[];
  excluded: { id: string; name: string; reason: string }[];
  coverage: { category: OfferCategory; recommended: number; held: number }[];
  allAssumption: boolean;
  /**
   * 実測から求まった段の数。
   * ★basis='MIXED' は「実測がある」という意味ではない（OFFERS.md の一次情報の固定単価でも MIXED になる）。
   *   実測が1段でもあるかはここで見る
   */
  measuredFactors: number;
  scoredAt: string;
};

/** DBの実測から求める段。OFFERS.md の記載から求める平均報酬はここに入れない */
export const MEASURED_FACTOR_KEYS = ["profile_lp", "aff_click", "cvr", "approval"] as const;

// ===========================================================================
// 仮定値（★全部 ASSUMPTION。実測が出たら差し替える。ここ以外に仮定を置かない）
// ===========================================================================

/** 為替。実際の着金レートではない */
export const FX = { JPY_PER_USD: 150, USD_PER_EUR: 1.08, USD_PER_GBP: 1.27 } as const;

/** レベニューシェア案件の平均注文額。OFFERS.md に単価が無い案件はここを掛けるしかない */
export const ASSUMED_AOV_USD: Record<OfferCategory, number> = {
  VPN: 60,
  ESIM: 20,
  JAPAN_TRAVEL: 120,
  JAPANESE_LANGUAGE: 60,
  JAPAN_PRODUCTS: 40,
  AI_TOOLS: 100,
  OTHER: 50,
};

/** 想定CVR。KPI定義.md の基準2%をカテゴリで振った値 */
export const ASSUMED_CVR: Record<OfferCategory, number> = {
  VPN: 0.02,
  ESIM: 0.03,
  JAPAN_TRAVEL: 0.015,
  JAPANESE_LANGUAGE: 0.01,
  JAPAN_PRODUCTS: 0.015,
  AI_TOOLS: 0.01,
  OTHER: 0.01,
};

/**
 * 想定承認率。★ERPMで必ず掛ける段。
 * 旅行予約のキャンセル・VPNの返金期間内解約を織り込む。ここを1.0に置くと単価の高い案件を過大評価する
 */
export const ASSUMED_APPROVAL_RATE: Record<OfferCategory, number> = {
  VPN: 0.7,
  ESIM: 0.9,
  JAPAN_TRAVEL: 0.65,
  JAPANESE_LANGUAGE: 0.85,
  JAPAN_PRODUCTS: 0.85,
  AI_TOOLS: 0.8,
  OTHER: 0.8,
};

/** KPI定義.md「月10万円の逆算」の値 */
export const ASSUMED_PROFILE_LP_RATE = 0.015;
export const ASSUMED_AFFILIATE_CLICK_RATE = 0.5;

/** docs/11_計測設計.md「結論を出してよい最低サンプル」 */
export const MIN_SAMPLE = {
  IMPRESSIONS_FOR_CTR: 100_000,
  LP_VIEWS: 300,
  AFFILIATE_CLICKS_FOR_CVR: 500,
  CONVERSIONS_FOR_OFFER_VERDICT: 20,
} as const;

/**
 * Survival Score の下限。これ未満は推薦しない。
 * ★43社すべてAI可否がUNKNOWNのため、現状の満点は90点（AI可否の10点は誰も取れない）
 */
export const SURVIVAL_FLOOR = 45;

/**
 * 合成の重み。Survival を重く置く。
 * 高報酬でもプログラムが消えれば取り分は0になる（ZenPop 404 / Japan Crate 消滅可能性が実例）
 */
export const COMPOSITE_WEIGHT = { offer: 0.4, survival: 0.6 } as const;

export const SCORING_MODEL = "offer-score/v1";

// ===========================================================================
// 小道具
// ===========================================================================

function clamp(n: number, lo = 0, hi = 100): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseJsonArray(raw: string | null): string[] {
  if (!raw) return [];
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x));
    } catch {
      /* JSONでなければ生文字列として扱う */
    }
  }
  return [s];
}

function parseMeta(raw: string | null): OfferMeta {
  if (!raw) return {};
  try {
    const o: unknown = JSON.parse(raw);
    if (o && typeof o === "object" && !Array.isArray(o)) return o as OfferMeta;
  } catch {
    /* 壊れていたら空。推測で埋めない */
  }
  return {};
}

function asTri(v: unknown): TriState {
  const s = String(v ?? "UNKNOWN");
  return s === "YES" || s === "NO" ? s : "UNKNOWN";
}

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toUsd(amount: number, currency: string): number {
  const c = currency.toUpperCase();
  if (c === "JPY") return amount / FX.JPY_PER_USD;
  if (c === "EUR") return amount * FX.USD_PER_EUR;
  if (c === "GBP") return amount * FX.USD_PER_GBP;
  return amount;
}

/** 無期限Cookie（JapanesePod101）を表すセンチネル */
export const COOKIE_UNLIMITED = 36_500;

export function cookieLabel(days: number | null): string {
  if (days === null) return "UNKNOWN";
  if (days >= 3650) return "無期限";
  if (days < 1) return "セッション";
  return `${days}日`;
}

/** 生の文言をまとめて1本にする。判定は必ずこの生文言に対して行う（値を先に潰さない） */
function rawOf(o: LoadedOffer, keys: string[]): string {
  const raw = o.meta.raw ?? {};
  return keys.map((k) => raw[k] ?? "").filter(Boolean).join(" ／ ");
}

// ===========================================================================
// 読み込み
// ===========================================================================

export async function loadOffers(): Promise<LoadedOffer[]> {
  const rs = await getDb().execute(
    `SELECT o.id, o.name, o.category, o.network_id, o.payout_type, o.payout_amount,
            o.payout_currency, o.revshare_pct, o.cookie_days, o.min_payout_usd,
            o.approval_status, o.allowed_traffic, o.restrictions, o.source,
            o.verified_at AS offer_verified_at,
            n.name AS network_name, n.japan_ok, n.allows_social_traffic, n.allows_ai_content,
            n.payout_methods, n.verified_at AS network_verified_at
       FROM offers o
       LEFT JOIN networks n ON n.id = o.network_id
      ORDER BY o.id`,
  );

  return rs.rows.map((r): LoadedOffer => {
    const meta = parseMeta(r["source"] === null ? null : String(r["source"]));
    return {
      id: String(r["id"]),
      name: String(r["name"]),
      category: String(r["category"]) as OfferCategory,
      networkId: String(r["network_id"]),
      networkName: String(r["network_name"] ?? r["network_id"]),
      payoutType: r["payout_type"] === null ? null : String(r["payout_type"]),
      payoutAmount: num(r["payout_amount"]),
      payoutCurrency: String(r["payout_currency"] ?? "USD"),
      revsharePct: num(r["revshare_pct"]),
      cookieDays: num(r["cookie_days"]),
      minPayoutUsd: num(r["min_payout_usd"]),
      approvalStatus: String(r["approval_status"] ?? "NOT_APPLIED"),
      japanOk: asTri(r["japan_ok"]),
      allowsSocial: asTri(r["allows_social_traffic"]),
      allowsAi: asTri(r["allows_ai_content"]),
      payoutMethods: parseJsonArray(r["payout_methods"] === null ? null : String(r["payout_methods"])),
      allowedTraffic: String(r["allowed_traffic"] ?? ""),
      restrictions: parseJsonArray(r["restrictions"] === null ? null : String(r["restrictions"])),
      offerVerifiedAt: r["offer_verified_at"] === null ? null : String(r["offer_verified_at"]),
      networkVerifiedAt: r["network_verified_at"] === null ? null : String(r["network_verified_at"]),
      meta,
    };
  });
}

// ===========================================================================
// 平均報酬（1成約あたり）
// ===========================================================================

export type ExpectedPayout = {
  usd: number | null;
  basis: "FACT" | "ASSUMPTION";
  note: string;
};

export function expectedPayoutUsd(o: LoadedOffer): ExpectedPayout {
  const fixed =
    o.payoutAmount !== null ? toUsd(o.payoutAmount, o.payoutCurrency) : null;
  const rev =
    o.revsharePct !== null ? (o.revsharePct / 100) * ASSUMED_AOV_USD[o.category] : null;

  if (fixed === null && rev === null) {
    return { usd: null, basis: "ASSUMPTION", note: "報酬額がUNKNOWN（OFFERS.mdに数値なし）" };
  }
  // 固定単価とレベニューシェアが両方書いてある案件（Sakura Mobile）は、
  // どちらを売るか選べる立場なので高い方を採る
  if (fixed !== null && (rev === null || fixed >= rev)) {
    return {
      usd: fixed,
      basis: o.offerVerifiedAt ? "FACT" : "ASSUMPTION",
      note: `固定単価 ${o.payoutAmount}${o.payoutCurrency} = $${fixed.toFixed(2)}`,
    };
  }
  return {
    usd: rev ?? 0,
    basis: "ASSUMPTION",
    note: `${o.revsharePct}% × 想定AOV $${ASSUMED_AOV_USD[o.category]}（AOVは仮定）`,
  };
}

// ===========================================================================
// Offer Score（儲かるか）
// ===========================================================================

/** 入金経路の確実性。UNKNOWN は null を返して加重平均から外す */
function payoutRouteScore(o: LoadedOffer): { value: number | null; note: string } {
  const raw = rawOf(o, ["支払方法", "支払", "通貨", "USD受取", "最低支払", "最低支払 / 支払方法"]);
  const all = `${raw} ${o.payoutMethods.join(" ")}`;

  if (/JPY(のみ|建て)|日本の銀行|円建て/.test(all)) {
    return { value: 100, note: "JPY建て・日本の銀行で受け取れる（送金/為替リスクなし）" };
  }

  const methods = [
    /PayPal/i.test(all) && "PayPal",
    /Payoneer/i.test(all) && "Payoneer",
    /(銀行|bank|ACH)/i.test(all) && "銀行",
    /(暗号資産|crypto)/i.test(all) && "暗号資産",
    /クレカ|クレジット/.test(all) && "クレカ",
    /Wise/i.test(all) && "Wise",
    /Skrill/i.test(all) && "Skrill",
  ].filter((x): x is string => typeof x === "string");

  if (methods.length === 0) {
    if (/(Awin|CJ|Impact|PartnerStack|Partnerize|LinkShare|Admitad|Indoleads)/i.test(all)) {
      return { value: 60, note: "ASP規定の支払（金額・手段は承認後にしか分からない）" };
    }
    return { value: null, note: "支払手段がUNKNOWN（現金で受け取れるか未確認）" };
  }
  if (methods.length === 1 && methods[0] === "Skrill") {
    return { value: 40, note: "Skrill中心（日本からの利用可否が不透明）" };
  }

  let v = methods.length >= 3 ? 100 : methods.length === 2 ? 90 : 85;
  let note = `${methods.join("/")}（${methods.length}経路）`;
  if (/手数料/.test(all)) {
    v -= 10;
    note += "・手数料あり";
  }
  return { value: v, note };
}

function payoutScoreOf(usd: number | null): number | null {
  if (usd === null) return null;
  // 単価は対数で効かせる。$50と$100の差より $2と$20 の差の方が事業影響が大きい
  return clamp((Math.log10(usd + 1) / Math.log10(51)) * 100);
}

function cookieScoreOf(days: number | null): number | null {
  if (days === null) return null;
  return clamp((Math.log10(days + 1) / Math.log10(367)) * 100);
}

function minPayoutScoreOf(usd: number | null): number | null {
  if (usd === null) return null;
  // $200（Agoda）を最悪として線形。低いほど早く現金化できる
  return clamp(100 * (1 - Math.min(1, usd / 200)));
}

export function scoreOffer(o: LoadedOffer): ScoreResult {
  const pay = expectedPayoutUsd(o);
  const route = payoutRouteScore(o);
  const cvr = ASSUMED_CVR[o.category];

  const components: Component[] = [
    {
      key: "payout",
      label: "平均報酬",
      weight: 35,
      value: payoutScoreOf(pay.usd),
      note: pay.usd === null ? pay.note : `$${pay.usd.toFixed(2)}/成約（${pay.note}）`,
    },
    {
      key: "cvr",
      label: "想定CVR",
      weight: 20,
      value: clamp((cvr / 0.04) * 100),
      note: `${(cvr * 100).toFixed(1)}%（カテゴリ仮定値・実測なし）`,
    },
    {
      key: "cookie",
      label: "Cookie期間",
      weight: 15,
      value: cookieScoreOf(o.cookieDays),
      note: cookieLabel(o.cookieDays),
    },
    {
      key: "min_payout",
      label: "最低支払額",
      weight: 15,
      value: minPayoutScoreOf(o.minPayoutUsd),
      note: o.minPayoutUsd === null ? "UNKNOWN" : `$${o.minPayoutUsd}`,
    },
    {
      key: "route",
      label: "入金経路の確実性",
      weight: 15,
      value: route.value,
      note: route.note,
    },
  ];

  return weighted(components);
}

/** UNKNOWN の段は加重平均から外す。0点にすると「未確認」と「悪い」が混ざる */
function weighted(components: Component[]): ScoreResult {
  const known = components.filter((c) => c.value !== null);
  const unknownKeys = components.filter((c) => c.value === null).map((c) => c.key);
  const w = known.reduce((s, c) => s + c.weight, 0);
  // 分かっている段が1つ以下では、加重平均が実質その1段の値になり比較に使えない
  const score = known.length < 2 || w === 0
    ? 0
    : known.reduce((s, c) => s + c.weight * (c.value as number), 0) / w;
  return { score: Math.round(score * 10) / 10, components, unknownKeys };
}

// ===========================================================================
// Survival Score（続くか）
// ===========================================================================

function evidenceScore(o: LoadedOffer): { value: number; note: string } {
  const e = o.meta.evidence;
  if (!e) return { value: 0, note: "出典の内訳が取れていない" };
  const total = e.primary + e.secondary + e.unknown;
  if (total === 0) return { value: 0, note: "出典なし" };
  return {
    value: (e.primary / total) * 100,
    note: `一次${e.primary} / 二次${e.secondary} / UNKNOWN${e.unknown}（全${total}項目）`,
  };
}

function snsScore(o: LoadedOffer): { value: number; note: string } {
  const raw = `${o.allowedTraffic} ${rawOf(o, ["参加条件", "参加要件", "必須手続き"])}`.trim();
  if (!raw) return { value: 25, note: "SNS可否がUNKNOWN（沈黙は許可ではない）" };
  // ★「媒体の形」で落とされる方が国籍より現実的な関門（43社調査の結論2）
  if (/受け入れない/.test(raw)) return { value: 0, note: "SNS単体のpublisherを明示的に拒否" };
  if (/却下|編集媒体限定|媒体限定/.test(raw)) {
    return { value: 30, note: "媒体形態の制限あり（SNSプロフィール単体では通らない）" };
  }
  if (o.allowsSocial === "NO") return { value: 0, note: "SNSトラフィック不可" };
  if (/明示的に許可|必須ではない/.test(raw)) {
    return { value: 100, note: "SNSでの宣伝を一次規約で明示的に許可" };
  }
  if (/明記/.test(raw)) {
    // 「インフルエンサーを対象と明記」は、SNSでの宣伝を許可したと書いてあるのとは別物
    return o.allowsSocial === "YES"
      ? { value: 85, note: "SNS利用可と明記" }
      : { value: 60, note: "SNS利用者を対象と明記（ただし「許可」とは書かれていない）" };
  }
  if (o.allowsSocial === "YES") return { value: 80, note: "SNS可（明示の強さは中）" };
  return { value: 25, note: "SNS可否がUNKNOWN（沈黙は許可ではない）" };
}

function japanScore(o: LoadedOffer): { value: number; note: string } {
  const raw = rawOf(o, ["日本在住", "運営", "通貨", "公式"]);
  if (o.japanOk === "NO") return { value: 0, note: "日本からの参加が不可" };
  if (/禁止国リストに日本は無い|日本は無い/.test(raw)) {
    return { value: 100, note: "禁止国リストに日本が無いことを一次規約で確認" };
  }
  if (/日本法人|日本企業|日本拠点|東京の/.test(raw)) {
    return { value: 90, note: "運営が日本法人（在住可否が構造的に問題にならない）" };
  }
  if (/(地域|地理|居住国|除外|禁止)?制限(の)?記載なし|除外記載なし|制限なし/.test(raw)) {
    return { value: 40, note: "制限の記載が無いだけ（＝許可ではない）" };
  }
  return { value: 20, note: "日本在住可否がUNKNOWN" };
}

function aiScore(o: LoadedOffer): { value: number; note: string } {
  if (o.allowsAi === "YES") return { value: 100, note: "AI生成コンテンツ可の回答を取得済み" };
  if (o.allowsAi === "NO") return { value: 0, note: "AI生成コンテンツ不可" };
  // 43社すべてUNKNOWN。申請時の自己申告で書面回答を取るまで誰も点を取れない
  return { value: 0, note: "AI可否UNKNOWN（申請時の自己申告で書面回答を取るまで0点）" };
}

function continuityScore(o: LoadedOffer): { value: number; note: string } {
  const raw = `${o.meta.notes ?? ""} ${rawOf(o, ["評判", "注記", "保留理由", "公式"])} ${o.meta.excludedReason ?? ""}`;
  if (/404|閉鎖|消滅|終了/.test(raw)) return { value: 0, note: "プログラム消滅の兆候（404/閉鎖）" };
  if (/稼働していない/.test(raw)) return { value: 20, note: "稼働状況に矛盾する情報" };
  if (/403|Cloudflare|(確認|取得)でき(ず|ない|なかった)|取得不可/.test(raw)) {
    return { value: 40, note: "公式情報を機械取得できず、継続性を確認できない" };
  }
  if (/非公開|交渉制|個別連絡/.test(raw)) return { value: 60, note: "条件が非公開/個別交渉（変更が読めない）" };
  if (/安定|大手/.test(raw)) return { value: 100, note: "大手・運営が安定との評価" };
  return { value: 75, note: "公式ページ生存・条件公開（特段の消滅兆候なし）" };
}

function adminScore(o: LoadedOffer): { value: number; note: string } {
  const raw = `${rawOf(o, ["支払方法", "支払", "通貨", "ネットワーク", "★必須手続き", "最低支払 / 支払方法"])} ${o.payoutMethods.join(" ")}`;
  if (/W-8BEN/i.test(raw)) {
    return { value: 30, note: "W-8BEN提出が必須（未提出だと出金がブロックされる）" };
  }
  if (/JPY(のみ|建て)|日本の銀行/.test(raw)) return { value: 100, note: "日本の銀行口座だけで完結" };
  const route = payoutRouteScore(o);
  // 自社プログラムに直接参加するなら、他ASPにも出稿していることは事務障壁にならない
  const inHouse = /自社/.test(raw);
  if (!inHouse && /(Impact|CJ|Partnerize|Amazon)/i.test(raw)) {
    return { value: 40, note: "米国系ASP＝W-8BENが発生する見込み" };
  }
  if (route.value !== null && route.value >= 90) return { value: 90, note: "支払経路が複数あり詰まりにくい" };
  if (/PayPal/i.test(raw)) return { value: 70, note: "PayPalのみ（口座が止まると全額止まる）" };
  return { value: 30, note: "事務手続きがUNKNOWN" };
}

export function scoreSurvival(o: LoadedOffer): ScoreResult {
  const ev = evidenceScore(o);
  const sns = snsScore(o);
  const jp = japanScore(o);
  const ai = aiScore(o);
  const cont = continuityScore(o);
  const adm = adminScore(o);

  const components: Component[] = [
    { key: "evidence", label: "一次情報での確認度", weight: 25, value: ev.value, note: ev.note },
    { key: "sns", label: "SNS可否の明示度", weight: 20, value: sns.value, note: sns.note },
    { key: "japan", label: "日本在住可否の確認度", weight: 15, value: jp.value, note: jp.note },
    { key: "ai", label: "AI可否の回答有無", weight: 10, value: ai.value, note: ai.note },
    { key: "continuity", label: "プログラム継続性", weight: 20, value: cont.value, note: cont.note },
    { key: "admin", label: "事務障壁の低さ", weight: 10, value: adm.value, note: adm.note },
  ];

  // Survival は「未確認であること自体」を減点する軸なので、UNKNOWN を除外せず低い点として扱う
  const w = components.reduce((s, c) => s + c.weight, 0);
  const score = components.reduce((s, c) => s + c.weight * (c.value ?? 0), 0) / w;
  return { score: Math.round(score * 10) / 10, components, unknownKeys: [] };
}

// ===========================================================================
// ERPM（見込み）
//   ERPM = 1000 × Profile/LP率 × Affiliateクリック率 × CVR × 承認率 × 平均報酬
//   ★承認率を必ず掛ける（KPI定義.md）
// ===========================================================================

type Measured = { value: number; sample: string } | null;

async function measuredProfileLpRate(offerId: string): Promise<Measured> {
  const db = getDb();
  // 各投稿の最新スナップショットだけを使う。fetched_ok=0（未取得）は分母に入れない
  const sql = (where: string) => `
    SELECT SUM(impressions) AS imp, SUM(url_link_clicks) AS clk FROM (
      SELECT pm.impressions, pm.url_link_clicks,
             ROW_NUMBER() OVER (PARTITION BY pm.post_id
                                ORDER BY pm.days_since_post DESC, pm.snapshot_at DESC) AS rn
        FROM post_metrics pm JOIN posts p ON p.id = pm.post_id
       WHERE pm.fetched_ok = 1 ${where}
    ) WHERE rn = 1`;

  for (const scope of [
    { where: "AND p.offer_id = ?", args: [offerId], label: "案件別" },
    { where: "", args: [] as string[], label: "全体" },
  ]) {
    const rs = await db.execute({ sql: sql(scope.where), args: scope.args });
    const row = rs.rows[0];
    const imp = num(row?.["imp"]) ?? 0;
    const clk = num(row?.["clk"]) ?? 0;
    if (imp >= MIN_SAMPLE.IMPRESSIONS_FOR_CTR && imp > 0) {
      return { value: clk / imp, sample: `${scope.label} 表示${imp.toLocaleString()}` };
    }
  }
  return null;
}

async function lpViewProxy(): Promise<number> {
  const rs = await getDb().execute(`
    SELECT SUM(url_link_clicks) AS clk FROM (
      SELECT url_link_clicks,
             ROW_NUMBER() OVER (PARTITION BY post_id ORDER BY days_since_post DESC, snapshot_at DESC) AS rn
        FROM post_metrics WHERE fetched_ok = 1
    ) WHERE rn = 1`);
  return num(rs.rows[0]?.["clk"]) ?? 0;
}

async function affiliateClickCount(offerId: string): Promise<number> {
  const rs = await getDb().execute({
    sql: `SELECT COUNT(*) AS n FROM clicks WHERE offer_id = ?`,
    args: [offerId],
  });
  return num(rs.rows[0]?.["n"]) ?? 0;
}

type ConvAgg = { approved: number; rejected: number; pending: number; avgPayout: number | null };

async function conversionAgg(offerId: string): Promise<ConvAgg> {
  const rs = await getDb().execute({
    sql: `SELECT
            SUM(CASE WHEN status='APPROVED' THEN 1 ELSE 0 END) AS ap,
            SUM(CASE WHEN status='REJECTED' THEN 1 ELSE 0 END) AS rj,
            SUM(CASE WHEN status='PENDING'  THEN 1 ELSE 0 END) AS pd,
            AVG(CASE WHEN status='APPROVED' THEN payout_usd END) AS avg_payout
          FROM conversions WHERE offer_id = ?`,
    args: [offerId],
  });
  const row = rs.rows[0];
  return {
    approved: num(row?.["ap"]) ?? 0,
    rejected: num(row?.["rj"]) ?? 0,
    pending: num(row?.["pd"]) ?? 0,
    avgPayout: num(row?.["avg_payout"]),
  };
}

export async function computeErpm(o: LoadedOffer): Promise<ErpmResult> {
  const factors: ErpmFactor[] = [];

  // 1. Profile/LP率
  const m1 = await measuredProfileLpRate(o.id);
  factors.push(
    m1
      ? { key: "profile_lp", label: "Profile/LP率", value: m1.value, basis: "FACT", source: "post_metrics", sample: m1.sample }
      : {
          key: "profile_lp",
          label: "Profile/LP率",
          value: ASSUMED_PROFILE_LP_RATE,
          basis: "ASSUMPTION",
          source: "KPI定義.md 逆算値",
          sample: `実測が最低サンプル(表示${MIN_SAMPLE.IMPRESSIONS_FOR_CTR.toLocaleString()})未満`,
        },
  );

  // 2. Affiliateクリック率（LP通過率）
  const lpViews = await lpViewProxy();
  const clicks = await affiliateClickCount(o.id);
  factors.push(
    lpViews >= MIN_SAMPLE.LP_VIEWS
      ? {
          key: "aff_click",
          label: "Affiliateクリック率",
          value: clicks / lpViews,
          basis: "FACT",
          source: "clicks / post_metrics.url_link_clicks",
          sample: `LP訪問${lpViews}`,
        }
      : {
          key: "aff_click",
          label: "Affiliateクリック率",
          value: ASSUMED_AFFILIATE_CLICK_RATE,
          basis: "ASSUMPTION",
          source: "KPI定義.md 逆算値",
          sample: `LP訪問${lpViews}（最低${MIN_SAMPLE.LP_VIEWS}未満）`,
        },
  );

  // 3. CVR
  const agg = await conversionAgg(o.id);
  factors.push(
    clicks >= MIN_SAMPLE.AFFILIATE_CLICKS_FOR_CVR
      ? {
          key: "cvr",
          label: "CVR",
          value: agg.approved / clicks,
          basis: "FACT",
          source: "conversions(APPROVED) / clicks",
          sample: `アフィリクリック${clicks}`,
        }
      : {
          key: "cvr",
          label: "CVR",
          value: ASSUMED_CVR[o.category],
          basis: "ASSUMPTION",
          source: `カテゴリ仮定 ${o.category}`,
          sample: `アフィリクリック${clicks}（最低${MIN_SAMPLE.AFFILIATE_CLICKS_FOR_CVR}未満）`,
        },
  );

  // 4. 承認率（★これを外すとキャンセルの多い案件を過大評価する）
  const decided = agg.approved + agg.rejected;
  factors.push(
    decided >= MIN_SAMPLE.CONVERSIONS_FOR_OFFER_VERDICT
      ? {
          key: "approval",
          label: "承認率",
          value: agg.approved / decided,
          basis: "FACT",
          source: "conversions APPROVED/(APPROVED+REJECTED)",
          sample: `確定成約${decided}（PENDING${agg.pending}件は分母外）`,
        }
      : {
          key: "approval",
          label: "承認率",
          value: ASSUMED_APPROVAL_RATE[o.category],
          basis: "ASSUMPTION",
          source: `カテゴリ仮定 ${o.category}`,
          sample: `確定成約${decided}（最低${MIN_SAMPLE.CONVERSIONS_FOR_OFFER_VERDICT}未満）`,
        },
  );

  // 5. 平均報酬
  const pay = expectedPayoutUsd(o);
  if (agg.approved >= MIN_SAMPLE.CONVERSIONS_FOR_OFFER_VERDICT && agg.avgPayout !== null) {
    factors.push({
      key: "payout",
      label: "平均報酬",
      value: agg.avgPayout,
      basis: "FACT",
      source: "conversions.payout_usd 実績平均",
      sample: `承認${agg.approved}件`,
    });
  } else if (pay.usd === null) {
    return {
      erpmUsd: null,
      basis: "ASSUMPTION",
      factors,
      assumedKeys: factors.filter((f) => f.basis === "ASSUMPTION").map((f) => f.key),
      usableAsDecision: false,
    };
  } else {
    factors.push({
      key: "payout",
      label: "平均報酬",
      value: pay.usd,
      basis: pay.basis,
      source: pay.note,
      sample: pay.basis === "FACT" ? "OFFERS.md 一次情報の固定単価" : "AOV仮定を含む",
    });
  }

  const erpm = factors.reduce((acc, f) => acc * f.value, 1000);
  const assumed = factors.filter((f) => f.basis === "ASSUMPTION");
  const basis: Basis =
    assumed.length === 0 ? "FACT" : assumed.length === factors.length ? "ASSUMPTION" : "MIXED";

  return {
    erpmUsd: Math.round(erpm * 1000) / 1000,
    basis,
    factors,
    assumedKeys: assumed.map((f) => f.key),
    // 全段が仮定なら「候補の並び」までで、DECISION にはできない（KPI定義.md 使い方のルール3）
    usableAsDecision: basis !== "ASSUMPTION",
  };
}

// ===========================================================================
// 最低サンプル：この案件について「ダメ」と書いてよいか
// ===========================================================================

export async function offerVerdictAllowed(
  offerId: string,
): Promise<{ allowed: boolean; conversions: number; reason: string }> {
  const agg = await conversionAgg(offerId);
  const n = agg.approved + agg.rejected;
  return n >= MIN_SAMPLE.CONVERSIONS_FOR_OFFER_VERDICT
    ? { allowed: true, conversions: n, reason: `確定成約${n}件（最低サンプル達成）` }
    : {
        allowed: false,
        conversions: n,
        reason: `確定成約${n}件。${MIN_SAMPLE.CONVERSIONS_FOR_OFFER_VERDICT}件未満のため「この案件はダメ」と書けない（CONTINUEのみ）`,
      };
}

// ===========================================================================
// 申請可能タイミング（OFFERS.md セクションD の「いつ」）
// ===========================================================================

export function readinessTierOf(o: LoadedOffer): { tier: number; label: string } {
  const when = o.meta.readiness?.when ?? "";
  if (/今すぐ/.test(when)) return { tier: 0, label: "今すぐ申請可" };
  if (/X運用/.test(when)) return { tier: 1, label: "X運用開始後" };
  if (/W-8BEN|税務/.test(when)) return { tier: 2, label: "W-8BEN準備後" };
  if (/LP完成|サイト完成/.test(when)) return { tier: 3, label: "LP完成後" };
  return { tier: 99, label: "申請時期UNKNOWN" };
}

// ===========================================================================
// ランキング
// ===========================================================================

export async function rankOffers(): Promise<RankResult> {
  const offers = await loadOffers();
  const scoredAt = nowIso();

  const unusable: RankResult["unusable"] = [];
  const excluded: RankResult["excluded"] = [];
  const candidates: RankedOffer[] = [];

  for (const o of offers) {
    if (o.meta.excluded) {
      excluded.push({ id: o.id, name: o.name, reason: o.meta.excludedReason ?? "調査で不採用" });
      continue;
    }
    // ★verified_at が無い行は使用不可。ここで落とし、理由を必ず持ち帰る
    if (!o.offerVerifiedAt) {
      unusable.push({
        id: o.id,
        name: o.name,
        reason: "offers.verified_at なし（条件を一次情報で確認できていない）",
      });
      continue;
    }
    if (!o.networkVerifiedAt) {
      unusable.push({
        id: o.id,
        name: o.name,
        reason: `networks.verified_at なし（${o.networkName} の条件が未確認）`,
      });
      continue;
    }

    const offerScore = scoreOffer(o);
    const survivalScore = scoreSurvival(o);
    const erpm = await computeErpm(o);
    const { tier, label } = readinessTierOf(o);
    const composite =
      Math.round(
        (COMPOSITE_WEIGHT.offer * offerScore.score +
          COMPOSITE_WEIGHT.survival * survivalScore.score) *
          10,
      ) / 10;

    const blockReasons: string[] = [];
    if (survivalScore.score < SURVIVAL_FLOOR) {
      blockReasons.push(
        `Survival ${survivalScore.score} < 下限${SURVIVAL_FLOOR}（承認後に条件変更・報酬没収・終了で消える確率が読めない）`,
      );
    }
    if (tier === 99) {
      blockReasons.push("申請可能タイミングがUNKNOWN（いつ出せるか決まらないので申請順に置けない）");
    }
    if (o.japanOk === "NO") blockReasons.push("日本からの参加が不可");
    if (offerScore.unknownKeys.includes("route")) {
      blockReasons.push("入金経路がUNKNOWN（現金で受け取れるか未確認）");
    }

    candidates.push({
      offer: o,
      offerScore,
      survivalScore,
      erpm,
      composite,
      readinessTier: tier,
      readinessLabel: label,
      recommendable: blockReasons.length === 0,
      blockReasons,
    });
  }

  // 申請順 = ①いつ申請できるか（前提条件）②同じタイミングなら合成スコアの高い方
  const sorter = (a: RankedOffer, b: RankedOffer) =>
    a.readinessTier - b.readinessTier ||
    b.composite - a.composite ||
    b.survivalScore.score - a.survivalScore.score ||
    a.offer.id.localeCompare(b.offer.id);

  const ranked = candidates.filter((c) => c.recommendable).sort(sorter);
  const held = candidates.filter((c) => !c.recommendable).sort(sorter);

  const coverage = CATEGORIES.map((category) => ({
    category,
    recommended: ranked.filter((r) => r.offer.category === category).length,
    held: held.filter((r) => r.offer.category === category).length,
  }));

  const allAssumption = ranked.every((r) => r.erpm.basis === "ASSUMPTION");
  const measuredFactors = candidates.reduce(
    (n, c) =>
      n +
      c.erpm.factors.filter(
        (f) =>
          f.basis === "FACT" &&
          (MEASURED_FACTOR_KEYS as readonly string[]).includes(f.key),
      ).length,
    0,
  );

  return { ranked, held, unusable, excluded, coverage, allAssumption, measuredFactors, scoredAt };
}

// ===========================================================================
// 凍結保存（★append-only。UPDATE しない）
// ===========================================================================

export async function freezeScores(result: RankResult, country = "ALL"): Promise<number> {
  const db = getDb();
  let n = 0;
  for (const r of [...result.ranked, ...result.held]) {
    const breakdown = {
      model: SCORING_MODEL,
      composite: r.composite,
      composite_weight: COMPOSITE_WEIGHT,
      survival_floor: SURVIVAL_FLOOR,
      readiness: { tier: r.readinessTier, label: r.readinessLabel, raw: r.offer.meta.readiness ?? null },
      recommendable: r.recommendable,
      block_reasons: r.blockReasons,
      offer_components: r.offerScore.components,
      offer_unknown: r.offerScore.unknownKeys,
      survival_components: r.survivalScore.components,
      erpm_factors: r.erpm.factors,
      erpm_assumed: r.erpm.assumedKeys,
      erpm_usable_as_decision: r.erpm.usableAsDecision,
      assumptions: { FX, ASSUMED_AOV_USD, ASSUMED_CVR, ASSUMED_APPROVAL_RATE, ASSUMED_PROFILE_LP_RATE, ASSUMED_AFFILIATE_CLICK_RATE },
    };
    await db.execute({
      sql: `INSERT INTO offer_scores
              (offer_id, country, offer_score, survival_score, erpm_usd, erpm_basis,
               breakdown_json, scored_at, model, frozen)
            VALUES (?,?,?,?,?,?,?,?,?,1)`,
      args: [
        r.offer.id,
        country,
        r.offerScore.score,
        r.survivalScore.score,
        r.erpm.erpmUsd,
        r.erpm.basis,
        JSON.stringify(breakdown),
        result.scoredAt,
        SCORING_MODEL,
      ],
    });
    n++;
  }
  return n;
}

/** 直近2回の採点を突き合わせ、順位が動いた理由を出す（上書きしないから比較できる） */
export async function scoreHistory(offerId: string, limit = 5) {
  const rs = await getDb().execute({
    sql: `SELECT scored_at, offer_score, survival_score, erpm_usd, erpm_basis, breakdown_json
            FROM offer_scores WHERE offer_id = ? ORDER BY id DESC LIMIT ?`,
    args: [offerId, limit],
  });
  return rs.rows;
}

/** 本命3 + バックアップ3のうち、候補が居ないカテゴリを人間へ通知する */
export async function warnThinCoverage(result: RankResult): Promise<OfferCategory[]> {
  const empty = result.coverage.filter((c) => c.recommended === 0).map((c) => c.category);
  const primaryAlive = result.coverage.filter(
    (c) => c.recommended > 0 && PRIMARY_CATEGORIES.includes(c.category),
  ).length;
  const aliveTotal = result.coverage.filter((c) => c.recommended > 0).length;

  if (aliveTotal < 3) {
    await notify(
      "CRITICAL",
      "OFFER_COVERAGE_THIN",
      `申請可能な候補があるカテゴリが${aliveTotal}件しかない（申請学習.md: 常に3カテゴリ以上）。空: ${empty.join(", ")}`,
    );
  } else if (primaryAlive < 2) {
    await notify(
      "WARN",
      "OFFER_COVERAGE_PRIMARY",
      `本命カテゴリ(VPN/eSIM/Japan Travel)で候補があるのは${primaryAlive}件。1社依存に近づいている`,
    );
  }
  return empty;
}
