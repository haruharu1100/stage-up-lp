/**
 * Phase 6 / LEGAL USAGE GATE（利用可否の門）
 *
 * ------------------------------------------------------------------
 * このファイルの役割は1つだけ。
 *   「その市場の口を、実データ取得に使ってよいか」を YES / NO / UNKNOWN で持ち、
 *   1つでも足りなければ **BLOCKED** を返す。
 *
 * ★ UNKNOWN を YES 扱いしない（ルール58 / ルール144）。
 * ★ 「禁止と書かれていない」は、やってよい根拠にしない（ルール58）。
 * ★ 判定の根拠は、一次資料の**原文引用 + 出典URL + 確認日**を必ず持つ。
 *   引用が無い項目は、値が YES でも YES として数えない（ルール146）。
 *
 * ------------------------------------------------------------------
 * 【依存ゼロ】
 * このファイルは何もimportしない。画面（'use client'）へそのまま載る（ルール37）。
 * 通信コードは持たない。ここは「判断」だけを持つ。
 */

/* ================================================================
 * 3値
 * ================================================================ */

export const TRI_STATES = ['YES', 'NO', 'UNKNOWN'] as const;
export type TriState = (typeof TRI_STATES)[number];

/** UNKNOWN を YES 扱いしない。この定数は「そう決めた」ことをコードに残すためにある。 */
export const LEGAL_GATE_UNKNOWN_IS_NOT_YES = true;

/** 既定値は必ず UNKNOWN。調べていない口が「使える」側に置かれない。 */
export const LEGAL_CHECK_DEFAULT: TriState = 'UNKNOWN';

/* ================================================================
 * 確認する10項目
 * ================================================================ */

export const LEGAL_CHECK_KEYS = [
  'API_EXISTS',
  'COMMERCIAL_USE_ALLOWED',
  'INTERNAL_BUSINESS_RESEARCH_ALLOWED',
  'PRICE_COMPARISON_ALLOWED',
  'DATA_STORAGE_ALLOWED',
  'AUTOMATED_RETRIEVAL_ALLOWED',
  'PRODUCT_URL_USE_ALLOWED',
  'AFFILIATE_REQUIRED_OR_OPTIONAL',
  'CREDIT_DISPLAY_REQUIRED',
  'RATE_LIMIT',
] as const;
export type LegalCheckKey = (typeof LEGAL_CHECK_KEYS)[number];

/**
 * 項目の種類。門の通し方が種類ごとに違う。
 *
 *  PRECONDITION … 前提。YES でなければ BLOCKED（口そのものが無い等）
 *  PERMISSION   … 許可。YES でなければ BLOCKED（UNKNOWN も BLOCKED）
 *  OBLIGATION   … 義務。YES なら「果たしているか」も見る。UNKNOWN も果たす側に倒す
 *  FACT         … 事実。UNKNOWN なら自動リサーチに載せない（叩く間隔が決まらない）
 */
export const LEGAL_CHECK_KINDS = ['PRECONDITION', 'PERMISSION', 'OBLIGATION', 'FACT'] as const;
export type LegalCheckKind = (typeof LEGAL_CHECK_KINDS)[number];

export type LegalEvidence = {
  /** 一次資料の原文。要約しない。 */
  quoteJa: string;
  sourceUrl: string;
  /** 実際にそのURLを開いて確かめた日（ルール73）。 */
  checkedAt: string;
};

export type LegalCheckItem = {
  key: LegalCheckKey;
  labelJa: string;
  kind: LegalCheckKind;
  value: TriState;
  /** 値が「確定した中身」を持つ場合の答え（例：任意 / 1クエリー毎秒）。 */
  answerJa: string | null;
  /** 根拠。空配列＝根拠なし＝YESとして数えない。 */
  evidence: LegalEvidence[];
  /** なぜこの値なのかを一言で。 */
  noteJa: string;
};

/** 根拠が1つも無い項目は、値が YES でも YES と数えない（ルール146）。 */
export function effectiveValue(item: LegalCheckItem): TriState {
  if (item.evidence.length === 0) return 'UNKNOWN';
  return item.value;
}

/* ================================================================
 * Yahoo!ショッピング（商品検索v3）— 2026-08-26 に一次資料を開いて確認
 * ================================================================
 *
 * ★ヤフオク!とは別サービスとして扱う（ルール66）。ここは「Yahoo!ショッピング」だけ。
 */

const YAHOO_V3_DOC = 'https://developer.yahoo.co.jp/webapi/shopping/v3/itemsearch.html';
const YAHOO_GUIDELINE_FAQ = 'https://support.yahoo-net.jp/PccDeveloper/s/article/H000011080';
const YAHOO_ATTRIBUTION = 'https://developer.yahoo.co.jp/attribution/';
const LYCORP_TERMS = 'https://www.lycorp.co.jp/ja/company/terms/';
const CHECKED_AT = '2026-08-26';

export const YAHOO_SHOPPING_LEGAL_CHECKS: LegalCheckItem[] = [
  {
    key: 'API_EXISTS',
    labelJa: '公式の口が今あるか',
    kind: 'PRECONDITION',
    value: 'YES',
    answerJa: '商品検索API v3（現役）',
    evidence: [
      {
        quoteJa: 'https://shopping.yahooapis.jp/ShoppingWebService/V3/itemSearch',
        sourceUrl: YAHOO_V3_DOC,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa: 'JANでの検索（jan_code）も、商品ページURL（hits/url）も、口の側には用意されている。',
  },
  {
    key: 'COMMERCIAL_USE_ALLOWED',
    labelJa: '事業者としての商用利用が認められているか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          '利用者自身の便宜をはかる非商用目的のみに使用することが認められています',
        sourceUrl: YAHOO_GUIDELINE_FAQ,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'このガイドラインは商用サイトや企業による利用をすべて禁じるものではありません',
        sourceUrl: YAHOO_GUIDELINE_FAQ,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          '営業、宣伝、広告、勧誘、その他営利を目的とする行為',
        sourceUrl: LYCORP_TERMS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '同じ記事に「非商用のみ」と「すべてを禁じるものではない」が並んでおり、当社の用途が入るか読み取れない。個別の問い合わせが要る（＝人がやる）。',
  },
  {
    key: 'INTERNAL_BUSINESS_RESEARCH_ALLOWED',
    labelJa: '社内の仕入調査に使ってよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          '当社サービスやそれらを構成するデータを、その提供目的を超えて利用することができません',
        sourceUrl: LYCORP_TERMS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa: '社内利用・非公開画面での利用について、可否を述べた記述が見つからない。',
  },
  {
    key: 'PRICE_COMPARISON_ALLOWED',
    labelJa: '他社（Amazon）の価格と突き合わせてよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          '当社サービスやそれらを構成するデータを、その提供目的を超えて利用することができません',
        sourceUrl: LYCORP_TERMS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa: '比較利用を許す記述も禁じる記述も見つからない。よって UNKNOWN。',
  },
  {
    key: 'DATA_STORAGE_ALLOWED',
    labelJa: '取得したデータを自社DBへ保存してよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          '当社サービスやそれらを構成するデータを、その提供目的を超えて利用することができません',
        sourceUrl: LYCORP_TERMS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa: '保存期間・保存可否を定めたページが見当たらない（API側の文書にも無い）。',
  },
  {
    key: 'AUTOMATED_RETRIEVAL_ALLOWED',
    labelJa: 'プログラムから自動で取得してよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          '短い時間の間に同一URLに大量にアクセスを行った場合、一定時間利用できなくなることもございます。（1クエリー/秒）',
        sourceUrl: YAHOO_V3_DOC,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'BOT、チートツール、その他の技術的手段を利用して当社サービスを不正に操作する行為',
        sourceUrl: LYCORP_TERMS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '毎秒の上限が書かれている以上プログラム呼び出しは前提と「読める」が、許可すると書いた文は無い。読めるを根拠にしない（ルール58）。',
  },
  {
    key: 'PRODUCT_URL_USE_ALLOWED',
    labelJa: '商品ページURLを保存・表示してよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: 'URLの「取得」自体は口から返る（hits/url）',
    evidence: [
      {
        quoteJa: 'hits/url … 商品ページURL',
        sourceUrl: YAHOO_V3_DOC,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '口が正式に返すのでAIがURLを組み立てる必要は無い（ルール55/98）。ただし利用可否は商用可否と同じくUNKNOWN。',
  },
  {
    key: 'AFFILIATE_REQUIRED_OR_OPTIONAL',
    labelJa: 'アフィリエイト連携は必須か任意か',
    kind: 'FACT',
    value: 'YES',
    answerJa: '任意（OPTIONAL）',
    evidence: [
      {
        quoteJa: 'affiliate_type … 任意 / affiliate_id … 任意',
        sourceUrl: YAHOO_V3_DOC,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa: '両方とも任意指定。連携しなくても検索そのものは行える（＝この項目は確定）。',
  },
  {
    key: 'CREDIT_DISPLAY_REQUIRED',
    labelJa: 'クレジット表示の義務があるか',
    kind: 'OBLIGATION',
    value: 'YES',
    answerJa: '義務（すべてのサイト・アプリケーション）',
    evidence: [
      {
        quoteJa:
          'Yahoo!デベロッパーネットワークの提供するAPIを利用するすべてのサイトやアプリケーションには、クレジットを表示する必要があります',
        sourceUrl: YAHOO_ATTRIBUTION,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '社内の非公開画面での扱いは書かれていない。書かれていない側へ甘くしないため、社内画面にも表示する実装にする。',
  },
  {
    key: 'RATE_LIMIT',
    labelJa: '叩いてよい間隔が分かるか',
    kind: 'FACT',
    value: 'YES',
    answerJa: '1クエリー/秒（公式v3ページに明記）',
    evidence: [
      {
        quoteJa:
          '短い時間の間に同一URLに大量にアクセスを行った場合、一定時間利用できなくなることもございます。（1クエリー/秒）',
        sourceUrl: YAHOO_V3_DOC,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '過去の記録にあった「1分30回」「1日50,000回」は、2026-08-26のv3ページには見当たらなかった。消さずに矛盾のまま残し、一番厳しい値で設計する（ルール70/76）。',
  },
];

/* ================================================================
 * Rate Limit — 矛盾したまま全部持ち、一番厳しい値を使う（ルール70）
 * ================================================================ */

export type RateLimitObservation = {
  labelJa: string;
  /** 1分あたりに直した回数。 */
  perMinute: number;
  sourceUrl: string;
  /** 実際に開いて確かめた日。確かめられていないものは null。 */
  confirmedAt: string | null;
  noteJa: string;
};

export const YAHOO_SHOPPING_RATE_LIMITS: RateLimitObservation[] = [
  {
    labelJa: '1クエリー/秒',
    perMinute: 60,
    sourceUrl: YAHOO_V3_DOC,
    confirmedAt: CHECKED_AT,
    noteJa: '商品検索v3のページに明記。今回いちばん確かな数字。',
  },
  {
    labelJa: '1分あたり30回',
    perMinute: 30,
    sourceUrl: YAHOO_V3_DOC,
    confirmedAt: null,
    noteJa: '過去の調査記録に残っていた数字。今回のv3ページには見当たらない（要再確認）。',
  },
  {
    labelJa: '1日あたり50,000回',
    perMinute: Math.floor(50000 / (24 * 60)),
    sourceUrl: YAHOO_V3_DOC,
    confirmedAt: null,
    noteJa: '過去の調査記録に残っていた数字。今回のv3ページには見当たらない（要再確認）。',
  },
];

export const YAHOO_SHOPPING_RATE_LIMIT_CONFLICT = true;

/** いちばん厳しい（＝少ない）値を返す。確かめられていない数字も落とさず入れる。 */
export function strictestRateLimitPerMinute(obs: RateLimitObservation[]): number | null {
  const values = obs.map((o) => o.perMinute).filter((n) => Number.isFinite(n) && n > 0);
  if (values.length === 0) return null;
  return Math.min(...values);
}

/** 叩いてよい最短の間隔（ミリ秒）。分からないときは null（＝自動に載せない）。 */
export function minIntervalMs(perMinute: number | null): number | null {
  if (perMinute === null || perMinute <= 0) return null;
  return Math.ceil(60000 / perMinute);
}

/* ================================================================
 * 果たすべき義務を、実装しているか
 * ================================================================ */

export type ObligationStatus = {
  key: LegalCheckKey;
  labelJa: string;
  satisfied: boolean;
  howJa: string;
};

/** クレジット表示の文言（公式が示す4形式のうち、日本語テキストリンク形式）。 */
export const YAHOO_CREDIT_TEXT_JA = 'Webサービス by Yahoo! JAPAN';
export const YAHOO_CREDIT_LINK_URL = 'https://developer.yahoo.co.jp/sitemap/';

/** 社内の非公開画面にも表示する（書かれていない側へ甘くしない）。 */
export const YAHOO_CREDIT_SHOWN_ON_INTERNAL_SCREEN = true;

export const YAHOO_SHOPPING_OBLIGATIONS: ObligationStatus[] = [
  {
    key: 'CREDIT_DISPLAY_REQUIRED',
    labelJa: 'クレジット表示',
    satisfied: YAHOO_CREDIT_SHOWN_ON_INTERNAL_SCREEN,
    howJa: `画面に「${YAHOO_CREDIT_TEXT_JA}」を ${YAHOO_CREDIT_LINK_URL} へのリンク付きで表示する。`,
  },
];

/* ================================================================
 * 門の判定
 * ================================================================ */

export const LEGAL_USAGE_GATE_STATES = ['ALLOWED', 'BLOCKED'] as const;
export type LegalUsageGate = (typeof LEGAL_USAGE_GATE_STATES)[number];

export type LegalGateResult = {
  gate: LegalUsageGate;
  /** 足りない項目（UNKNOWN）。 */
  unknownKeys: LegalCheckKey[];
  /** 禁止と確認できた項目（NO）。 */
  prohibitedKeys: LegalCheckKey[];
  /** 義務のうち、まだ果たしていないもの。 */
  unmetObligationKeys: LegalCheckKey[];
  /** 叩いてよい間隔（ミリ秒）。分からないときは null。 */
  minIntervalMs: number | null;
  reasonsJa: string[];
  /** 人が読む1行。 */
  summaryJa: string;
};

export type LegalGateInput = {
  venueCode: string;
  labelJa: string;
  checks: LegalCheckItem[];
  obligations: ObligationStatus[];
  rateLimits: RateLimitObservation[];
};

export function evaluateLegalGate(input: LegalGateInput): LegalGateResult {
  const unknownKeys: LegalCheckKey[] = [];
  const prohibitedKeys: LegalCheckKey[] = [];
  const unmetObligationKeys: LegalCheckKey[] = [];
  const reasonsJa: string[] = [];

  for (const item of input.checks) {
    const v = effectiveValue(item);

    if (v === 'NO') {
      prohibitedKeys.push(item.key);
      reasonsJa.push(`${item.labelJa}：禁止と確認できた。`);
      continue;
    }

    if (item.kind === 'OBLIGATION') {
      // 義務は「不明」でも果たす側へ倒す。果たしていなければ門は開けない。
      const st = input.obligations.find((o) => o.key === item.key);
      if (!st || !st.satisfied) {
        unmetObligationKeys.push(item.key);
        reasonsJa.push(`${item.labelJa}：果たす実装がまだ無い。`);
      }
      if (v === 'UNKNOWN') {
        unknownKeys.push(item.key);
        reasonsJa.push(`${item.labelJa}：不明。義務がある前提で扱う。`);
      }
      continue;
    }

    if (v === 'UNKNOWN') {
      unknownKeys.push(item.key);
      reasonsJa.push(`${item.labelJa}：一次資料で確認できていない。`);
    }
  }

  const perMinute = strictestRateLimitPerMinute(input.rateLimits);
  const interval = minIntervalMs(perMinute);
  if (interval === null) {
    reasonsJa.push('叩いてよい間隔が分からない。');
  }

  const blocked =
    unknownKeys.length > 0 ||
    prohibitedKeys.length > 0 ||
    unmetObligationKeys.length > 0 ||
    interval === null;

  const gate: LegalUsageGate = blocked ? 'BLOCKED' : 'ALLOWED';

  const summaryJa = blocked
    ? `${input.labelJa}：本番の取得は行わない（BLOCKED）。不明 ${unknownKeys.length}件／禁止 ${prohibitedKeys.length}件／未実装の義務 ${unmetObligationKeys.length}件。`
    : `${input.labelJa}：本番の取得を行ってよい（ALLOWED）。最短間隔 ${interval}ミリ秒。`;

  return { gate, unknownKeys, prohibitedKeys, unmetObligationKeys, minIntervalMs: interval, reasonsJa, summaryJa };
}

/* ================================================================
 * eBay Browse API — 2026-08-26 に一次資料（英語原文）を開いて確認
 * ================================================================
 *
 * ★Yahoo!ショッピングとは別の市場として、同じ10項目で並べる（ルール66）。
 * ★Browse（探す）と Offer/Order（入札・購入）は別のAPIで、必要な認可も別。
 *   当社が触るのは Browse だけ。購入用のスコープを1つも要求しない＝コード上も発注できない。
 * ★原文は英語なので、引用は原文のまま置く（訳して意味を変えない）。
 */

const EBAY_BROWSE_DOC = 'https://developer.ebay.com/develop/api/buy/browse_api';
const EBAY_SEARCH_DOC = 'https://developer.ebay.com/develop/api/buy/browse_api/item_summary/search';
const EBAY_BUY_REQUIREMENTS = 'https://developer.ebay.com/api-docs/buy/static/buy-requirements.html';
const EBAY_LICENSE = 'https://developer.ebay.com/join/api-license-agreement';
const EBAY_CALL_LIMITS = 'https://developer.ebay.com/develop/get-started/api-call-limits';
const EBAY_MARKETPLACES = 'https://developer.ebay.com/api-docs/buy/static/ref-marketplace-supported.html';

export const EBAY_BROWSE_LEGAL_CHECKS: LegalCheckItem[] = [
  {
    key: 'API_EXISTS',
    labelJa: '公式の口が今あるか',
    kind: 'PRECONDITION',
    value: 'YES',
    answerJa: 'Browse API v1（現役・最新のリリース記録は 2026-07-14 の v1.20.5）',
    evidence: [
      {
        quoteJa:
          'The Browse API lets shoppers search eBay listings by keyword, category, GTIN, product, charity, compatibility criteria, or image',
        sourceUrl: EBAY_BROWSE_DOC,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa: 'JAN/EAN（GTIN）での検索も、商品ページURL（itemWebUrl）も、口の側には用意されている。',
  },
  {
    key: 'COMMERCIAL_USE_ALLOWED',
    labelJa: '事業者としての商用利用が認められているか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          "The use of eBay's Buy APIs in production is intended for eBay partners only. You must apply for production access through the eBay Partner Network.",
        sourceUrl: EBAY_BUY_REQUIREMENTS,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'There is no guarantee that your application for production use of the APIs will be approved.',
        sourceUrl: EBAY_BUY_REQUIREMENTS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '同じ公式サイト内で矛盾している。Buy APIの一覧では Deal / Feed / Offer / Order にだけ「(Limited Release)」の札が付き、Browse には付いていない。どちらが当社に当たるかは書面で確認しないと決まらない（＝人がやる）。',
  },
  {
    key: 'INTERNAL_BUSINESS_RESEARCH_ALLOWED',
    labelJa: '社内の仕入調査に使ってよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          "eBay grants you a non-exclusive ... license to use the Developer Tools ... solely for the purpose of facilitating your own or Your Users' use of eBay Services",
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'Use eBay Content or Developer Tools to compete with eBay Services or to design, build, promote or augment any site or service competitive to eBay Services',
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '社内限定・非公開の道具としての利用を、許すとも禁じるとも書いていない。書かれていないことを許可の根拠にしない（ルール58）。',
  },
  {
    key: 'PRICE_COMPARISON_ALLOWED',
    labelJa: '他社（Amazon）の価格と突き合わせてよいか',
    kind: 'PERMISSION',
    value: 'NO',
    answerJa: '書面の事前許可が無ければ不可',
    evidence: [
      {
        quoteJa:
          "You must have eBay's express prior written permission to use or display eBay Content in any way that enables derivation of ... Average selling price or gross merchandise sold for any eBay category",
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'Use eBay Content, either alone or in combination with third-party information, to suggest or model prices for items listed on eBay Site',
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '当社がやろうとしている「相場の平均を出す」「他社データと合わせて価格を組み立てる」は、条文が名指しで書面許可を要求している。ここは UNKNOWN ではなく NO。',
  },
  {
    key: 'DATA_STORAGE_ALLOWED',
    labelJa: '取得したデータを自社DBへ保存してよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa:
          'Making limited intermediate copies of eBay Content only as necessary to perform an activity permitted under this API License Agreement. All intermediate copies must be deleted when they are no longer required for the purpose for which they were created',
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'Displayed item listing information may not be more than six (6) hours older than information displayed on the eBay Site, and other eBay Content must be no more than twenty-four (24) hours older',
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '許されているのは「一時的な中間コピー」で、目的が済んだら消す義務がある。当社は判断の記録を消さずに残す設計（SHADOW）なので、そのまま当てはまらない。よって UNKNOWN。',
  },
  {
    key: 'AUTOMATED_RETRIEVAL_ALLOWED',
    labelJa: 'プログラムから自動で取得してよいか',
    kind: 'PERMISSION',
    value: 'YES',
    answerJa: 'API自体がプログラム利用の前提（量の上限あり）',
    evidence: [
      {
        quoteJa:
          'All methods in the Browse API require an Application access token, which is obtained using the client credentials grant flow.',
        sourceUrl: EBAY_BROWSE_DOC,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'Use any API in a manner that exceeds reasonable request volume, constitutes excessive or abusive usage',
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa: '人の同意を取らずアプリだけで呼べる方式が公式に定められている。ただし量の上限は守る。',
  },
  {
    key: 'PRODUCT_URL_USE_ALLOWED',
    labelJa: '商品ページURLを保存・表示してよいか',
    kind: 'PERMISSION',
    value: 'UNKNOWN',
    answerJa: 'URLの「取得」自体は口から返る（itemWebUrl）',
    evidence: [
      {
        quoteJa: 'itemWebUrl / itemAffiliateWebUrl',
        sourceUrl: EBAY_SEARCH_DOC,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'eBay Content in a Public Display may not be co-mingled or combined with non-eBay Content. For example, all eBay Content in a Public Display must be visually isolated from third-party listings or other non-eBay information',
        sourceUrl: EBAY_LICENSE,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '口が返すのでAIが組み立てる必要は無い（ルール55/98）。ただしAmazonの数字と同じ行に並べる当社の画面は、この「混ぜてはいけない」に触れる恐れがある。社内画面が Public Display に当たるかが不明。',
  },
  {
    key: 'AFFILIATE_REQUIRED_OR_OPTIONAL',
    labelJa: 'アフィリエイト連携は必須か任意か',
    kind: 'FACT',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa: 'If you haven\'t already, sign up for an eBay Partner Network (EPN) account',
        sourceUrl: EBAY_BUY_REQUIREMENTS,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa:
          'If you are part of the eBay Partner Network you must pass in the values for affiliateCampaignId',
        sourceUrl: EBAY_SEARCH_DOC,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '「本番申請はEPN経由」と「EPNに入っているなら」が併存しており、Browse だけを使う当社に加入が要るのか決まらない。',
  },
  {
    key: 'CREDIT_DISPLAY_REQUIRED',
    labelJa: 'クレジット表示の義務があるか',
    kind: 'OBLIGATION',
    value: 'UNKNOWN',
    answerJa: null,
    evidence: [
      {
        quoteJa: 'Show the eBay logo / In Footer: Links to eBay User Agreement',
        sourceUrl: EBAY_BUY_REQUIREMENTS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      'ロゴ表示の義務が書かれているのは「ゲスト決済のパートナー向け」の章だけで、Browse だけを社内で使う場合の定めが見つからない。義務がある前提で扱う（不明は甘い側へ倒さない）。',
  },
  {
    key: 'RATE_LIMIT',
    labelJa: '叩いてよい間隔が分かるか',
    kind: 'FACT',
    value: 'YES',
    answerJa: '1日5,000回（Browse・既定）。1秒あたりの上限は非公開。',
    evidence: [
      {
        quoteJa: 'Browse API — All methods except getItems: 5000 API calls per day',
        sourceUrl: EBAY_CALL_LIMITS,
        checkedAt: CHECKED_AT,
      },
      {
        quoteJa: 'Client credentials grant ... Application access token 1,000 requests/day',
        sourceUrl: EBAY_CALL_LIMITS,
        checkedAt: CHECKED_AT,
      },
    ],
    noteJa:
      '1日の上限は明記されているので間隔は出せる。1秒あたりの上限は公表されていない（本番キー取得後に実測するしかない）。',
  },
];

/**
 * トークン（合鍵）の発行そのものにも別枠の上限がある。
 * ★これは商品を探す回数の上限ではないので、`EBAY_BROWSE_RATE_LIMITS` には混ぜない。
 *   合鍵は2時間有効なので、使い回せば1日十数回で足りる。
 */
export const EBAY_APP_TOKEN_ISSUE_LIMIT_PER_DAY = 1000;
export const EBAY_APP_TOKEN_LIFETIME_SECONDS = 7200;

export const EBAY_BROWSE_RATE_LIMITS: RateLimitObservation[] = [
  {
    labelJa: '1日あたり5,000回（getItems以外の全メソッド）',
    perMinute: 5000 / (24 * 60),
    sourceUrl: EBAY_CALL_LIMITS,
    confirmedAt: CHECKED_AT,
    noteJa: '公式のレート表に明記。ならすと1分あたり約3.4回。',
  },
  {
    labelJa: '1日あたり5,000回（getItems）',
    perMinute: 5000 / (24 * 60),
    sourceUrl: EBAY_CALL_LIMITS,
    confirmedAt: CHECKED_AT,
    noteJa: 'getItems は別枠でさらに5,000回と書かれている（原文どおり両方5,000）。',
  },
];

/** 1秒あたりの上限は公表されていない。分からないものを「無い」と書かない（ルール97）。 */
export const EBAY_BROWSE_PER_SECOND_LIMIT_KNOWN = false;

export const EBAY_BROWSE_OBLIGATIONS: ObligationStatus[] = [
  {
    key: 'CREDIT_DISPLAY_REQUIRED',
    labelJa: 'クレジット表示',
    satisfied: false,
    howJa: 'Browse だけを社内で使う場合の表示義務が公式に見つかっていないため、実装も決めていない。',
  },
];

/* ================================================================
 * eBay の条文が、当社の設計を直接禁じている点（最重要）
 * ================================================================
 *
 * ★ここは UNKNOWN ではない。原文が名指しで禁じている。
 *   仮に本番の許可が下りても、この2つは設計を変えないかぎり守れない。
 */

/**
 * eBayから取ったデータを、AIの学習へ入れてはならない。
 * 原文：「Use eBay Content ... to train algorithms, conduct machine learning,
 *        develop synthetic data sets, train large learning models,
 *        and/or train artificial intelligence systems.」（RESTRICTED ACTIVITIES）
 *
 * 当社の Phase 3（SHADOW学習・答え合わせでスコアを動かす）へ1件でも流し込むと違反になる。
 * → eBayのデータは「人が読む材料」までに留め、学習の輪へ入れる道は最初から作らない。
 */
export const EBAY_CONTENT_MAY_ENTER_AI_LEARNING = false;

/**
 * eBayのデータを、eBay以外のデータと同じ画面で混ぜてはならない（Public Display）。
 * 当社の「Amazonの売値」と「eBayの仕入値」を1行に並べる表は、ここに触れる恐れがある。
 * 社内の非公開画面が Public Display に当たるかは不明なので、厳しい側で扱う。
 */
export const EBAY_CONTENT_MAY_BE_MIXED_WITH_OTHER_VENUES = false;

/**
 * eBayには日本のマーケットプレイスが無い（対応16か国に EBAY_JP は無い）。
 * 仕入は海外の出品者から「日本へ送れる商品」を探す形になり、国際送料・関税が必ず乗る。
 * → §19（国をまたぐ仕入は費用がそろわないとBUYにしない）が全件に当たる。
 */
export const EBAY_JAPAN_MARKETPLACE_EXISTS = false;
export const EBAY_MARKETPLACE_LIST_SOURCE_URL = EBAY_MARKETPLACES;

/* ================================================================
 * 登録済みの市場
 * ================================================================ */

export const LEGAL_GATE_INPUTS: LegalGateInput[] = [
  {
    venueCode: 'YAHOO_SHOPPING',
    labelJa: 'Yahoo!ショッピング（商品検索v3）',
    checks: YAHOO_SHOPPING_LEGAL_CHECKS,
    obligations: YAHOO_SHOPPING_OBLIGATIONS,
    rateLimits: YAHOO_SHOPPING_RATE_LIMITS,
  },
  {
    venueCode: 'EBAY_BROWSE',
    labelJa: 'eBay（Browse API）',
    checks: EBAY_BROWSE_LEGAL_CHECKS,
    obligations: EBAY_BROWSE_OBLIGATIONS,
    rateLimits: EBAY_BROWSE_RATE_LIMITS,
  },
];

export function legalGateFor(venueCode: string): LegalGateResult | null {
  const input = LEGAL_GATE_INPUTS.find((x) => x.venueCode === venueCode);
  if (!input) return null;
  return evaluateLegalGate(input);
}

/**
 * 調べていない市場は「使ってよい」に落ちない。
 * 登録が無い＝BLOCKED として扱うためのヘルパ（Fail Closed）。
 */
export function isLiveFetchAllowed(venueCode: string): boolean {
  const r = legalGateFor(venueCode);
  if (r === null) return false;
  return r.gate === 'ALLOWED';
}

/* ================================================================
 * 本番の取得コードを持っているか（＝実装の有無）
 * ================================================================
 *
 * ★ 門が開いていても、ここが false なら通信は起きない。
 *   フラグOFFではなく「実装が無い」ことを、はっきり残す。
 */

export const YAHOO_SHOPPING_LIVE_FETCH_IMPLEMENTED = false;
export const EBAY_BROWSE_LIVE_FETCH_IMPLEMENTED = false;

/** 仕入先を自動で探す動きは、テストが通るまで動かさない（§29）。 */
export const AUTO_SUPPLIER_RESEARCH = false;

/** 実購入は、フラグではなくコードごと存在しない（§30）。 */
export const AUTO_PURCHASE_IMPLEMENTED = false;
export const AUTO_ORDER_API_IMPLEMENTED = false;

/** 無許可の収集は、取り方の選択肢として存在しない（Phase 5から継続）。 */
export const SCRAPING_IMPLEMENTED = false;

/** 人が外部へ問い合わせる。AIが連絡しない。 */
export const CONTACT_VENUE_BY_AI_ALLOWED = false;

export function liveFetchImplemented(venueCode: string): boolean {
  if (venueCode === 'YAHOO_SHOPPING') return YAHOO_SHOPPING_LIVE_FETCH_IMPLEMENTED;
  if (venueCode === 'EBAY_BROWSE') return EBAY_BROWSE_LIVE_FETCH_IMPLEMENTED;
  return false;
}

/**
 * 実際に通信してよいか。門・実装・全体スイッチの3つがそろって初めて true。
 */
export function canFetchLive(venueCode: string): { ok: boolean; reasonsJa: string[] } {
  const reasonsJa: string[] = [];
  if (!AUTO_SUPPLIER_RESEARCH) reasonsJa.push('仕入先の自動検索がまだ解禁されていない（AUTO_SUPPLIER_RESEARCH = false）。');
  if (!isLiveFetchAllowed(venueCode)) reasonsJa.push('利用可否の門が開いていない（LEGAL_USAGE_GATE = BLOCKED）。');
  if (!liveFetchImplemented(venueCode)) reasonsJa.push('本番の取得コードが存在しない。');
  return { ok: reasonsJa.length === 0, reasonsJa };
}

/* ================================================================
 * 人がやる残作業（AIはここへ手を出さない）
 * ================================================================ */

export type HumanTodo = {
  venueCode: string;
  titleJa: string;
  whyJa: string;
  whereJa: string;
};

export const HUMAN_TODOS: HumanTodo[] = [
  {
    venueCode: 'YAHOO_SHOPPING',
    titleJa: '商用・社内利用の可否を、Yahoo!デベロッパーネットワークへ問い合わせる',
    whyJa:
      '「非商用目的のみ」と「商用をすべて禁じるものではない」が同じ記事に併記されており、当社の用途が入るか公式の文だけでは決まらないため。',
    whereJa: `${YAHOO_GUIDELINE_FAQ}（法人の商用希望は各APIの問い合わせ窓口へ相談、と案内されている）`,
  },
  {
    venueCode: 'EBAY_BROWSE',
    titleJa: 'Browse APIだけを本番で使う場合に、パートナー承認とEPN加入が要るかを書面で確認する',
    whyJa:
      '「Buy APIの本番はパートナー限定」と書かれている一方で、Limited Release の札は Browse には付いていない。公式サイトの中で食い違っており、読むだけでは決まらないため。',
    whereJa: `${EBAY_BUY_REQUIREMENTS}（本番申請の手順ページ）／eBay Developer Support への問い合わせ`,
  },
  {
    venueCode: 'EBAY_BROWSE',
    titleJa: '「eBayで買ってAmazonで売る」が seller arbitrage の禁止に当たるかを確認する',
    whyJa:
      '条文が挙げる例はどれも「eBayで売る側」の話で、当社の向きは文言上入っていない。ただし柱書きが「eBayの事業上の利益を損なう使い方」を広く禁じており、当たるかどうかが決まらない。ここが該当すれば接続そのものができない。',
    whereJa: `${EBAY_LICENSE}（API License Agreement 第9条）`,
  },
  {
    venueCode: 'EBAY_BROWSE',
    titleJa: '社内の非公開画面が Public Display に当たるか（Amazonの数字と並べてよいか）を確認する',
    whyJa:
      '「eBayのデータを他社のデータと混ぜてはいけない」と明記されている。当社の画面は仕入値と売値を1行に並べる作りなので、当たるなら画面ごと作り直しになる。',
    whereJa: `${EBAY_LICENSE}（Public Display の条項）`,
  },
  {
    venueCode: 'EBAY_BROWSE',
    titleJa: '相場の平均を出す使い方について、書面の事前許可を申請する',
    whyJa:
      'カテゴリの平均販売価格を導けるような使い方は「express prior written permission」が必要と明記されている。当社の相場分析はここに当たる。',
    whereJa: `${EBAY_LICENSE}（eBay Content の利用制限）`,
  },
];

/* ================================================================
 * Phase 6.5：仕入先の門（Legal Gate）の待ち状況ボード
 * ================================================================
 *
 * ここは「誰の返事を待っているか」を1枚で見せるだけの板。
 * 通信もしないし、判定を勝手に動かすこともしない。
 *
 * ★ 最初に門を完全通過した仕入先が FIRST_LIVE_SUPPLIER になる。
 *   順位でも過去のスコアでもなく、通過が最優先条件（ユーザー指示 2026-08-26）。
 */

/** 返事の分類。CONDITIONAL は「条件付きで可」。条件を実装しきるまでは通過にしない。 */
export const ANSWER_STATES = ['YES', 'NO', 'CONDITIONAL', 'UNKNOWN'] as const;
export type AnswerState = (typeof ANSWER_STATES)[number];

export const ANSWER_STATE_JA: Record<AnswerState, string> = {
  YES: '可',
  NO: '不可',
  CONDITIONAL: '条件付きで可',
  UNKNOWN: '不明',
};

/** 1問ぶんの回答記録。出典が無い YES は採用しない（ルール144）。 */
export type GateAnswer = {
  /** 質問の識別子（問い合わせ文の Q1〜Q8 / チェックリストの #1〜#13 に対応） */
  key: string;
  /** 何を聞いたか */
  questionJa: string;
  value: AnswerState;
  /** CONDITIONAL のときの条件。原文のまま入れる。 */
  conditionJa: string | null;
  /** 回答メールの原文引用、または規約の原文引用 */
  quoteJa: string | null;
  /** 出典（メールの件名・受信日、または規約ページのURL） */
  sourceJa: string | null;
  /** 規約を確認した日 / メールを受け取った日（YYYY-MM-DD） */
  checkedAt: string | null;
};

/** 出典3点（原文・出典・確認日）が揃っていない回答は UNKNOWN に落とす。 */
export function effectiveAnswer(a: GateAnswer): AnswerState {
  if (a.value === 'UNKNOWN') return 'UNKNOWN';
  if (a.value === 'NO') return 'NO';
  if (!a.quoteJa || !a.sourceJa || !a.checkedAt) return 'UNKNOWN';
  return a.value;
}

export const SUPPLIER_GATE_WAY = ['MAIL_INQUIRY', 'HUMAN_READ_TERMS'] as const;
export type SupplierGateWay = (typeof SUPPLIER_GATE_WAY)[number];

export const SUPPLIER_GATE_WAY_JA: Record<SupplierGateWay, string> = {
  MAIL_INQUIRY: '人がメールで問い合わせる',
  HUMAN_READ_TERMS: '人がブラウザで規約を読む',
};

export type SupplierGateWaiting = {
  /** 突破に取り組む順番（1が先） */
  order: number;
  supplierCode: string;
  labelJa: string;
  /** この相手が仕入先候補か、価格比較用の情報源か */
  roleJa: string;
  way: SupplierGateWay;
  /** 待っている理由を1行で */
  waitingForJa: string;
  /** 必要な質問の数（すべて可になって初めて通過） */
  requiredCount: number;
  /** 人が書き込んだ回答。空配列＝まだ何も返ってきていない。 */
  answers: GateAnswer[];
  /** 文案・チェックリストの置き場所 */
  docJa: string;
};

/**
 * 待ち行列（2026-08-26 時点）。
 * ★ answers はすべて空。回答が来ていないものを「来た」ことにしない。
 */
export const SUPPLIER_GATE_WAITING: SupplierGateWaiting[] = [
  {
    order: 1,
    supplierCode: 'NETSEA',
    labelJa: 'NETSEA（SynaBiz）',
    roleJa: '仕入先候補（FIRST_SUPPLIER_CANDIDATE）',
    way: 'MAIL_INQUIRY',
    waitingForJa: '必須8問（保存・加工・比較・分析結果の保存・終了時の扱い・Amazon個別確認・商品URL・AI利用）の回答待ち',
    requiredCount: 8,
    answers: [],
    docJa: '事業Vault/AI Commerce OS/32_問い合わせ文案_YahooとRakuten.md §3',
  },
  {
    order: 2,
    supplierCode: 'VALUECOMMERCE',
    labelJa: 'バリューコマース（商品API）',
    roleJa: '価格比較の情報源（仕入先ではない）',
    way: 'MAIL_INQUIRY',
    waitingForJa: '5問（社内利用・保存・比較分析・非公開画面・購入目的での参照）の回答待ち',
    requiredCount: 5,
    answers: [],
    docJa: '事業Vault/AI Commerce OS/32_問い合わせ文案_YahooとRakuten.md §4',
  },
  {
    order: 3,
    supplierCode: 'OROSY',
    labelJa: 'orosy',
    roleJa: '仕入先候補',
    way: 'HUMAN_READ_TERMS',
    waitingForJa: '人が規約を読んで13項目に可／不可／不明を入れるのを待っている（所要20分・費用0円）',
    requiredCount: 13,
    answers: [],
    docJa: '事業Vault/AI Commerce OS/35_orosy規約チェックリスト_人間確認用.md',
  },
  {
    order: 4,
    supplierCode: 'YAHOO_SHOPPING',
    labelJa: 'Yahoo!ショッピング（商品検索v3）',
    roleJa: '価格比較の情報源',
    way: 'MAIL_INQUIRY',
    waitingForJa: '4問（社内商用利用・保存・他市場比較・クレジット表示）の回答待ち',
    requiredCount: 4,
    answers: [],
    docJa: '事業Vault/AI Commerce OS/32_問い合わせ文案_YahooとRakuten.md §1',
  },
  {
    order: 5,
    supplierCode: 'RAKUTEN',
    labelJa: '楽天ウェブサービス',
    roleJa: '価格比較の情報源',
    way: 'MAIL_INQUIRY',
    waitingForJa: '個別許諾の可否（第10条(7)(9)・第8条4項との関係を含む6問）の回答待ち',
    requiredCount: 6,
    answers: [],
    docJa: '事業Vault/AI Commerce OS/32_問い合わせ文案_YahooとRakuten.md §2',
  },
];

/** 画面に出す5状態。BLOCKED を細かく分けて、次に誰が動くのかを分かるようにする。 */
export const GATE_DISPLAY_STATES = [
  'WAITING_ANSWER',
  'WAITING_HUMAN_CHECK',
  'CONDITIONAL',
  'BLOCKED',
  'PASSED',
] as const;
export type GateDisplayState = (typeof GATE_DISPLAY_STATES)[number];

export const GATE_DISPLAY_STATE_JA: Record<GateDisplayState, string> = {
  WAITING_ANSWER: '回答待ち',
  WAITING_HUMAN_CHECK: '人間確認待ち',
  CONDITIONAL: '条件付き',
  BLOCKED: '不可',
  PASSED: '通過',
};

export type SupplierGateStatus = {
  waiting: SupplierGateWaiting;
  answered: number;
  yes: number;
  conditional: number;
  no: number;
  unknown: number;
  /** ALLOWED になるのは、必要な質問がすべて可（条件付きなら条件を実装済み）になったときだけ。 */
  gate: LegalUsageGate;
  display: GateDisplayState;
  statusJa: string;
};

/**
 * 待ち状況を1件ぶん集計する。
 * 未回答は UNKNOWN として数える（無返信を許可の根拠にしない・ルール58）。
 *
 * ★「原則可能ですが事前承認が必要です」は YES ではなく CONDITIONAL。
 *   承認が終わるまで LEGAL_GATE = BLOCKED を保つ（ユーザー指示 2026-08-26）。
 */
export function supplierGateStatus(w: SupplierGateWaiting): SupplierGateStatus {
  const eff = w.answers.map(effectiveAnswer);
  const yes = eff.filter((v) => v === 'YES').length;
  const conditional = eff.filter((v) => v === 'CONDITIONAL').length;
  const no = eff.filter((v) => v === 'NO').length;
  const answeredUnknown = eff.filter((v) => v === 'UNKNOWN').length;
  const missing = Math.max(0, w.requiredCount - eff.length);
  const unknown = answeredUnknown + missing;

  let gate: LegalUsageGate = 'BLOCKED';
  let display: GateDisplayState;
  let statusJa: string;
  if (no > 0) {
    display = 'BLOCKED';
    statusJa = `不可の回答が${no}件。この相手では接続しない`;
  } else if (unknown > 0) {
    display = w.way === 'HUMAN_READ_TERMS' ? 'WAITING_HUMAN_CHECK' : 'WAITING_ANSWER';
    statusJa =
      w.way === 'HUMAN_READ_TERMS'
        ? `人間確認待ち（未確定 ${unknown}/${w.requiredCount}）`
        : `回答待ち（未回答 ${unknown}/${w.requiredCount}）`;
  } else if (conditional > 0) {
    display = 'CONDITIONAL';
    statusJa = `条件付きで可が${conditional}件。条件を満たしきるまでBLOCKEDのまま`;
  } else {
    gate = 'ALLOWED';
    display = 'PASSED';
    statusJa = `必要な${w.requiredCount}件すべて可。門を通過`;
  }

  return { waiting: w, answered: eff.length, yes, conditional, no, unknown, gate, display, statusJa };
}

export function supplierGateBoard(): SupplierGateStatus[] {
  return [...SUPPLIER_GATE_WAITING]
    .sort((a, b) => a.order - b.order)
    .map(supplierGateStatus);
}

/**
 * 最初に門を完全通過した仕入先。まだ誰も通っていなければ null。
 * ★ 順位や過去のスコアでは決めない。通過した順だけで決まる。
 * ★ 価格比較の情報源は仕入先ではないので、ここには入らない。
 */
export const PURCHASABLE_CANDIDATE_CODES = ['NETSEA', 'OROSY'] as const;

/**
 * FIRST_LIVE_SUPPLIER へ昇格するための最低条件（ユーザー指示 2026-08-26）。
 * ★ここが1つでも UNKNOWN なら昇格させない。
 * ★AMAZON_RESALE だけは「商品単位で機械確認できる」なら代替として認める。
 */
export const FIRST_LIVE_SUPPLIER_MIN_CONDITIONS = [
  'COMMERCIAL_USE',
  'INTERNAL_USE',
  'AUTOMATED_RETRIEVAL',
  'DATA_STORAGE',
  'PRICE_COMPARISON',
  'PURCHASABLE',
  'AMAZON_RESALE',
] as const;
export type FirstLiveSupplierCondition = (typeof FIRST_LIVE_SUPPLIER_MIN_CONDITIONS)[number];

export const FIRST_LIVE_SUPPLIER_CONDITION_JA: Record<FirstLiveSupplierCondition, string> = {
  COMMERCIAL_USE: '商用で使ってよい',
  INTERNAL_USE: '社内の業務分析に使ってよい',
  AUTOMATED_RETRIEVAL: 'プログラムで自動取得してよい',
  DATA_STORAGE: '取得データを社内に保存してよい',
  PRICE_COMPARISON: '他市場と価格を比較してよい',
  PURCHASABLE: 'そこから実際に仕入れられる',
  AMAZON_RESALE: 'Amazonで販売してよい（または商品単位で機械確認できる）',
};

/** AMAZON_RESALE の代替＝商品ごとに販売可否を機械で確認できるならYES扱いにできる。 */
export type PromotionInput = {
  supplierCode: string;
  conditions: Partial<Record<FirstLiveSupplierCondition, AnswerState>>;
  /** 商品単位で Amazon 販売可否を機械確認できるか */
  amazonResaleCheckablePerProduct: boolean;
};

export type PromotionResult = {
  supplierCode: string;
  ok: boolean;
  missingJa: string[];
};

/**
 * 昇格してよいかを判定する。
 * ★ CONDITIONAL は「条件を満たすまで未達」として扱う（YESにしない）。
 * ★ UNKNOWN は当然未達。無回答・未確認を通さない。
 */
export function canPromoteToFirstLiveSupplier(input: PromotionInput): PromotionResult {
  const missingJa: string[] = [];
  const purchasable = PURCHASABLE_CANDIDATE_CODES.includes(input.supplierCode as never);
  if (!purchasable) {
    missingJa.push('実際に仕入れられる相手ではない（価格比較の情報源は昇格させない）');
  }
  for (const key of FIRST_LIVE_SUPPLIER_MIN_CONDITIONS) {
    const v = input.conditions[key] ?? 'UNKNOWN';
    if (v === 'YES') continue;
    if (key === 'AMAZON_RESALE' && input.amazonResaleCheckablePerProduct) continue;
    const stateJa = ANSWER_STATE_JA[v];
    missingJa.push(`${FIRST_LIVE_SUPPLIER_CONDITION_JA[key]}：${stateJa}`);
  }
  return { supplierCode: input.supplierCode, ok: missingJa.length === 0, missingJa };
}

export function firstLiveSupplier(): { code: string; labelJa: string } | null {
  for (const s of supplierGateBoard()) {
    if (s.gate !== 'ALLOWED') continue;
    if (!PURCHASABLE_CANDIDATE_CODES.includes(s.waiting.supplierCode as never)) continue;
    return { code: s.waiting.supplierCode, labelJa: s.waiting.labelJa };
  }
  return null;
}

/** 通過しても、まず読むだけ。1件 → 5件 → 10件 → 47件の順で広げる。 */
export const FIRST_LIVE_SUPPLIER_READ_ONLY = true;
export const FIRST_LIVE_SUPPLIER_STAGES = [1, 5, 10, 47] as const;

/**
 * orosy のチェックリスト13項目（人がブラウザで読んで入れる）。
 * ★ 人が入れた値だけを取り込む。AIが規約を補完しない。
 * ★「書いていない」は UNKNOWN。可にはしない（ルール58）。
 */
export const OROSY_CHECKLIST_KEYS = [
  'BUSINESS_USE_ALLOWED',
  'RESALE_ALLOWED',
  'AMAZON_SALE_ALLOWED',
  'EXTERNAL_MALL_SALE_ALLOWED',
  'AUTOMATED_RETRIEVAL_ALLOWED',
  'API_CSV_FEED_AVAILABLE',
  'DATA_STORAGE_ALLOWED',
  'DATA_PROCESSING_ALLOWED',
  'PRICE_COMPARISON_ALLOWED',
  'STOCK_DATA_ALLOWED',
  'JAN_GTIN_AVAILABLE',
  'PRODUCT_URL_USE_ALLOWED',
  'IMAGE_USE_ALLOWED',
] as const;
export type OrosyChecklistKey = (typeof OROSY_CHECKLIST_KEYS)[number];

export const OROSY_CHECKLIST_JA: Record<OrosyChecklistKey, string> = {
  BUSINESS_USE_ALLOWED: '法人・事業利用',
  RESALE_ALLOWED: '転売（再販）',
  AMAZON_SALE_ALLOWED: 'Amazon販売',
  EXTERNAL_MALL_SALE_ALLOWED: '外部モール販売',
  AUTOMATED_RETRIEVAL_ALLOWED: '自動データ取得',
  API_CSV_FEED_AVAILABLE: 'API・CSV・Feed',
  DATA_STORAGE_ALLOWED: 'データ保存',
  DATA_PROCESSING_ALLOWED: '商品情報の加工',
  PRICE_COMPARISON_ALLOWED: '価格比較',
  STOCK_DATA_ALLOWED: '在庫データ',
  JAN_GTIN_AVAILABLE: 'JAN・GTIN',
  PRODUCT_URL_USE_ALLOWED: '商品URL利用',
  IMAGE_USE_ALLOWED: '画像利用',
};

/** 人が書いた文字を4分類へ正規化する。読めない書き方は UNKNOWN（推測しない）。 */
export function normalizeAnswerInput(raw: string): AnswerState {
  const s = raw.trim().toUpperCase();
  if (s === 'YES' || s === '可' || s === 'OK' || s === '○' || s === '◯') return 'YES';
  if (s === 'NO' || s === '不可' || s === 'NG' || s === '×') return 'NO';
  if (s === 'CONDITIONAL' || s === '条件付き' || s === '条件付きで可' || s === '△') return 'CONDITIONAL';
  return 'UNKNOWN';
}

/**
 * 回答待ちフェーズの固定（ユーザー指示 2026-08-26）。
 * 許可を取ることが最優先で、コードを書くことではない。
 */
export const LEGAL_GATE_WAITING_PHASE = true;
export const NEW_FEATURE_DEVELOPMENT_PAUSED = true;
