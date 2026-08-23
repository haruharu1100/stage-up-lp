import { getDb, nowIso, notify } from "./db.js";
import {
  CHARACTER_IDENTITY,
  DEFAULT_SURFACE,
  KNOWN_COLLISION_NAMES,
  SURFACE_LABEL,
  isSelfIntroductionAt,
  requiresFullName,
  type CharacterIdentity,
  type NameSurface,
} from "./identity.js";

export type CheckCode =
  | "FAKE_EXPERIENCE"
  | "UNSUBSTANTIATED_CLAIM"
  | "AFFILIATE_DISCLOSURE_MISSING"
  | "OUTDATED_SOURCE"
  | "ADULT"
  | "MINOR_LOOK"
  | "AI_DISCLOSURE"
  | "SHORT_URL"
  | "DUPLICATE"
  | "AUTOMATION"
  | "KEIHYO"
  | "REAL_PERSON"
  | "ASP_TERMS"
  | "EXP_GROUP_MISMATCH"
  | "NAME_SHORT_FORM"
  | "NAME_COLLISION"
  | "IDENTITY_LOCK";

export const CHECK_CODES: CheckCode[] = [
  "FAKE_EXPERIENCE",
  "UNSUBSTANTIATED_CLAIM",
  "AFFILIATE_DISCLOSURE_MISSING",
  "OUTDATED_SOURCE",
  "ADULT",
  "MINOR_LOOK",
  "AI_DISCLOSURE",
  "SHORT_URL",
  "DUPLICATE",
  "AUTOMATION",
  "KEIHYO",
  "REAL_PERSON",
  "ASP_TERMS",
  "EXP_GROUP_MISMATCH",
  "NAME_SHORT_FORM",
  "NAME_COLLISION",
  "IDENTITY_LOCK",
];

/**
 * 判定の結果。
 * - PASS: 問題なし
 * - WARN: 出しても違反ではないが、損をする書き方。承認画面には出す
 * - FAIL: 承認画面に出さない
 * - HALT: 根拠が無くて判定できない。推測で PASS にしない
 *
 * ★WARN を FAIL に混ぜない。混ぜると「規約違反」と「もっと良く書ける」が
 *   同じ扱いになり、本当に止めるべき違反が warning の山に埋もれる。
 */
export type CheckResult = {
  code: CheckCode;
  result: "PASS" | "WARN" | "FAIL" | "HALT";
  detail?: string;
};

export type PostInput = {
  subjectId: string | number;
  subjectType?: "post" | "lp_block";
  text: string;
  /**
   * この文章がどこに出るか。名前の判定はここで変わる。
   * 省略時は X投稿の本文（CONTENT_NATURAL）として扱う。
   */
  surface?: NameSurface;
  /**
   * キャラクターの正体。文字列ではなくオブジェクトで渡す。
   * 省略時は正式Identity（lib/identity.ts）。
   */
  identity?: CharacterIdentity;
  /**
   * 本番公開する直前の検査か。
   * true の時だけ、名前が LOCKED でないことを FAIL として止める。
   * 下書きを作る段階では PROVISIONAL でも作業自体は続けてよい。
   */
  publishIntent?: boolean;
  /** EXP-001 A群のリプライ本文。本文の後ろに続くものとして扱う */
  replyText?: string;
  expGroup?: "A" | "B" | "NONE";
  /** プロフィール側でAI生成である旨を開示済みか */
  profileHasAiDisclosure?: boolean;
  imagePrompt?: string;
  offerId?: string;
  /** offers.restrictions を使わず直接渡す場合 */
  aspRestrictions?: string[];
  realPersonNames?: string[];
  faceMatchesRealPerson?: boolean;
  keywordTriggeredReply?: boolean;
  /** DBの過去投稿に加えて比較したい本文 */
  recentTexts?: string[];
  /** 本文中のURLがアフィリエイトリンクだと分かっている場合 */
  linkIsAffiliate?: boolean;
  persist?: boolean;
};

export type ComplianceReport = {
  passed: boolean;
  /** 承認画面に出してよいか。passed の裏返しを明示的に持つ */
  blockedFromApproval: boolean;
  results: CheckResult[];
  failed: CheckCode[];
  halted: CheckCode[];
  /** 止めはしないが直した方がよい項目。passed には影響しない */
  warned: CheckCode[];
  reason: string;
};

// 法令台帳（00_SYSTEM/法令台帳.md）の再確認期限。規約・法令は90日
const LAW_FRESHNESS_DAYS = 90;

// 条文・日付はコードに書かない。laws テーブルのどの行を根拠にするかだけを持つ
export const LAW_FOR_CHECK: Partial<Record<CheckCode, string>> = {
  FAKE_EXPERIENCE: "FTC_ENDORSEMENT",
  UNSUBSTANTIATED_CLAIM: "FTC_ENDORSEMENT",
  AFFILIATE_DISCLOSURE_MISSING: "FTC_ENDORSEMENT",
  AI_DISCLOSURE: "EU_AI_ACT_50",
  ADULT: "X_ADULT_CONTENT",
  MINOR_LOOK: "X_ADULT_CONTENT",
  REAL_PERSON: "X_AUTHENTICITY",
  AUTOMATION: "X_AUTOMATED_ACCOUNT",
  KEIHYO: "JP_KEIHYO",
};

// 台帳側がこのIDを1つでも欠くと、そのチェックは永久に HALT する。
// IDの表記ゆれで全判定が止まった実例があるので、投入側から検査できるように公開する
export const REQUIRED_LAW_IDS: string[] = [...new Set(Object.values(LAW_FOR_CHECK))];

// claims の種別ごとの有効期間。台帳に無い種別は短い方へ寄せる（推測で緩めない）
const CLAIM_WINDOW_DAYS: Record<string, number> = {
  PRICE: 30,
  FEATURE: 30,
  TERMS: 90,
  LAW: 90,
};

const DUP_THRESHOLD = 0.9;

// 正規化レーベンシュタイン類似度（0〜1）。外部依存なし。aura/lib/guard.ts と同じ実装
export function similarity(a: string, b: string): number {
  const s = a.trim();
  const t = b.trim();
  if (!s && !t) return 1;
  const m = s.length;
  const n = t.length;
  if (m === 0 || n === 0) return 0;
  const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i]![0] = i;
  for (let j = 0; j <= n; j++) dp[0]![j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + cost);
    }
  }
  return 1 - dp[m]![n]! / Math.max(m, n);
}

// ---------------------------------------------------------------------------
// FAKE_EXPERIENCE
// ---------------------------------------------------------------------------

// 「I really loved using」のような副詞・助動詞・短縮形の挟み込みだけを許す。
// 任意の単語を許すと "I like this season." まで巻き込むため、語彙を固定する
const FILLER =
  "(?:really|truly|absolutely|honestly|personally|actually|just|finally|recently|once|already|also|always|never|totally|even|still|only|so|very|super|definitely|certainly|literally)";
const AUX = "(?:have|'ve|has|had|'d|am|'m|was|were|been|being|do|did|keep|kept|start|started|begin|began)";
const GAP = `(?:\\s+(?:${FILLER}|${AUX}))*`;

const FAKE_EXPERIENCE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "I used / I use", re: new RegExp(`\\bI${GAP}\\s+(?:use|used|uses|using)\\b`, "i") },
  { label: "I tried", re: new RegExp(`\\bI${GAP}\\s+(?:try|tried|tries|trying)\\b`, "i") },
  {
    label: "I bought",
    re: new RegExp(`\\bI${GAP}\\s+(?:buy|bought|buys|buying|purchase|purchased|order|ordered)\\b`, "i"),
  },
  {
    label: "I love using",
    re: new RegExp(
      `\\bI${GAP}\\s+(?:love|loved|loves|loving|like|liked|likes|enjoy|enjoyed|enjoys)${GAP}\\s+(?:using|used)\\b`,
      "i",
    ),
  },
  {
    label: "This worked for me",
    re: /\b(?:this|that|it|they|these)\b(?:\s+\w+){0,2}\s+(?:work|works|worked|working)\b(?:\s+\w+){0,2}\s+for me\b/i,
  },
  {
    label: "When I traveled",
    re: new RegExp(
      `\\bwhen(?:ever)?\\s+I${GAP}\\s+(?:travel|traveled|travelled|traveling|travelling|visit|visited|went|stayed|flew|arrived)\\b`,
      "i",
    ),
  },
  { label: "My experience was", re: /\bmy(?:\s+(?:own|personal|first|recent|honest|real))?\s+experience\b/i },
];

function checkFakeExperience(text: string, identity: CharacterIdentity): CheckResult {
  const hits = FAKE_EXPERIENCE_PATTERNS.filter((p) => p.re.test(text)).map((p) => p.label);
  if (hits.length === 0) return { code: "FAKE_EXPERIENCE", result: "PASS" };
  return {
    code: "FAKE_EXPERIENCE",
    result: "FAIL",
    detail: `${identity.full_name}は実使用経験を持たないため虚偽になる表現: ${hits.join(" / ")}`,
  };
}

// ---------------------------------------------------------------------------
// 名前まわり（NAME_SHORT_FORM / NAME_COLLISION / IDENTITY_LOCK）
// ---------------------------------------------------------------------------

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** フルネームの出現を消して、残った「下の名前だけ」の位置を返す */
function bareGivenNamePositions(text: string, identity: CharacterIdentity): number[] {
  // 置換で長さを変えると位置がずれるので、同じ文字数の空白で伏せる
  const masked = text.replace(new RegExp(esc(identity.full_name), "gi"), (m) => " ".repeat(m.length));
  const rx = new RegExp(`\\b${esc(identity.given_name)}\\b`, "gi");
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = rx.exec(masked)) !== null) {
    out.push(m.index);
    if (m.index === rx.lastIndex) rx.lastIndex++;
  }
  return out;
}

/**
 * NAME_SHORT_FORM — 下の名前だけの表記を、使用場所によって判定し分ける。
 *
 * 名称候補調査.md 第5波の結論:
 *   下の名前は単独では必ず先客がいる（20語すべてで確認）。
 *   固有性はフルネームの組み合わせでしか作れない。
 *
 * ただし固有性が要るのは「外から検索・照合される面」であって、本人が喋る本文ではない。
 * 通常のX投稿で毎回フルネームを名乗ると英文として不自然になり、反応が落ちる。
 *   BRAND_IDENTITY_STRICT（表示名・Bio・サイト・申請・法務など）: 下の名前だけ = FAIL
 *   CONTENT_NATURAL（X本文・リプライ・LP本文）:                     下の名前だけ = PASS
 * CONTENT_NATURAL でも、初出の自己紹介でフルネームが1度も出ていない時だけ WARN にする。
 * その文が外部サイトへ単体で転載されると、そこから本人へ辿れなくなるため。
 */
function checkNameShortForm(
  text: string,
  identity: CharacterIdentity,
  surface: NameSurface,
): CheckResult {
  if (!identity.family_name) return { code: "NAME_SHORT_FORM", result: "PASS" };

  const positions = bareGivenNamePositions(text, identity);
  if (positions.length === 0) return { code: "NAME_SHORT_FORM", result: "PASS" };

  const where = SURFACE_LABEL[surface];

  if (requiresFullName(surface)) {
    return {
      code: "NAME_SHORT_FORM",
      result: "FAIL",
      detail:
        `${where}に下の名前だけの表記が${positions.length}件あります（"${identity.given_name}"）。` +
        `ここは外から検索・照合されるブランドIdentityの面なので、` +
        `必ず "${identity.full_name}" と書いてください。`,
    };
  }

  const hasFullName = new RegExp(esc(identity.full_name), "i").test(text);
  const intro = positions.some((i) => isSelfIntroductionAt(text, i));
  if (intro && !hasFullName) {
    return {
      code: "NAME_SHORT_FORM",
      result: "WARN",
      detail:
        `${where}での自己紹介が下の名前だけになっています（"${identity.given_name}"）。` +
        `違反ではないので出せますが、この文が外部サイトへ単体で転載されると本人へ辿れません。` +
        `初めて名乗る文だけは "${identity.full_name}" を推奨します。`,
    };
  }

  return {
    code: "NAME_SHORT_FORM",
    result: "PASS",
    detail: `${where}のため下の名前だけの表記を許可（${positions.length}件）`,
  };
}

/**
 * NAME_COLLISION — 別姓・別名への変化を、場所を問わず止める。
 *
 * ★NAME_SHORT_FORM とは目的が違う。
 *   短縮形は「固有性を捨てている」だけで、指している人物は同じ。
 *   こちらは「別人になっている」。
 *   Suzuho Tanaka / Suzuho Miyabi / Suzuho Japan は Suzuho Awano ではないので、
 *   どの使用場所であっても常に BLOCK する。
 */
function checkNameCollision(text: string, identity: CharacterIdentity): CheckResult {
  if (!identity.family_name) return { code: "NAME_COLLISION", result: "PASS" };

  const problems: string[] = [];
  const seen = new Set<string>();

  // 1. 下の名前の直後に、姓ではない大文字始まりの語が続く
  const after = new RegExp(`\\b${esc(identity.given_name)}\\s+([A-Z][A-Za-z'’-]+)`, "g");
  let m: RegExpExecArray | null;
  while ((m = after.exec(text)) !== null) {
    const word = m[1]!;
    if (word.toLowerCase() === identity.family_name.toLowerCase()) continue;
    if (seen.has(`a:${word.toLowerCase()}`)) continue;
    seen.add(`a:${word.toLowerCase()}`);
    problems.push(`"${identity.given_name} ${word}"`);
  }

  // 2. 姓の直前が、下の名前ではない大文字始まりの語
  const before = new RegExp(`\\b([A-Z][A-Za-z'’-]+)\\s+${esc(identity.family_name)}\\b`, "g");
  while ((m = before.exec(text)) !== null) {
    const word = m[1]!;
    if (word.toLowerCase() === identity.given_name.toLowerCase()) continue;
    if (seen.has(`b:${word.toLowerCase()}`)) continue;
    seen.add(`b:${word.toLowerCase()}`);
    problems.push(`"${word} ${identity.family_name}"`);
  }

  // 3. 商標調査などで衝突が確認済みの既存の人物・ブランド名
  for (const name of KNOWN_COLLISION_NAMES) {
    if (name && new RegExp(`\\b${esc(name)}\\b`, "i").test(text)) {
      problems.push(`衝突が確認済みの名称「${name}」`);
    }
  }

  return problems.length
    ? {
        code: "NAME_COLLISION",
        result: "FAIL",
        detail:
          `正式Identity以外の名前になっています: ${problems.join(" / ")}。` +
          `正式Identityは "${identity.full_name}" だけです。`,
      }
    : { code: "NAME_COLLISION", result: "PASS" };
}

/**
 * IDENTITY_LOCK — 名前が確定していない状態で本番公開しないための門。
 *
 * 下書きを作る段階では止めない（WARN）。
 * 公開直前の検査（publishIntent=true）でだけ FAIL にする。
 * 仮の名前のまま世に出すと、後で名前を変えた時に、
 * 付いた言及・被リンク・アカウント名が全部無駄になる。
 */
export function checkIdentityLock(
  identity: CharacterIdentity,
  publishIntent: boolean,
): CheckResult {
  if (identity.identity_status === "LOCKED") {
    return { code: "IDENTITY_LOCK", result: "PASS", detail: `${identity.full_name}（LOCKED）` };
  }
  const detail =
    identity.identity_status === "REJECTED"
      ? `名前が REJECTED です（${identity.identity_status_reason}）。名前候補フェーズへ戻してください`
      : `名前がまだ ${identity.identity_status} です（${identity.identity_status_reason}）`;
  return {
    code: "IDENTITY_LOCK",
    result: publishIntent ? "FAIL" : "WARN",
    detail: publishIntent
      ? `${detail}。本番公開はできません`
      : `${detail}。下書きの作成は続けてよいですが、この状態では公開しません`,
  };
}

// ---------------------------------------------------------------------------
// 事実主張の抽出
// ---------------------------------------------------------------------------

type Assertion = { kind: string; snippet: string; sentence: string };

const ASSERTION_PATTERNS: { kind: string; re: RegExp }[] = [
  { kind: "価格", re: /[$¥€£]\s?\d[\d,.]*/g },
  { kind: "価格", re: /\b\d[\d,.]*\s*(?:usd|jpy|eur|dollars|yen)\b/gi },
  { kind: "価格", re: /\b\d+\s*%\s*(?:off|discount)\b/gi },
  { kind: "速度", re: /\b\d[\d,.]*\s*(?:mbps|gbps|kbps|ms)\b/gi },
  { kind: "速度", re: /\b(?:faster than|speeds? of|download speed)\b/gi },
  { kind: "対応範囲", re: /\b\d[\d,]*\+?\s*(?:countries|servers|locations|cities|devices|users)\b/gi },
  { kind: "対応範囲", re: /\bavailable in\b/gi },
  { kind: "機能", re: /\b(?:offers?|includes?|supports?|provides?|comes with|works with|allows you to)\b/gi },
  {
    kind: "最上級",
    re: /\b(?:the best|best[- ]in[- ]class|#\s?1|no\.?\s?1|number one|cheapest|fastest|top[- ]rated|most popular|world'?s (?:best|fastest|cheapest))\b/gi,
  },
];

function sentenceOf(text: string, index: number): string {
  const start = Math.max(text.lastIndexOf(".", index - 1), text.lastIndexOf("\n", index - 1), -1) + 1;
  let end = text.length;
  for (const mark of [".", "\n"]) {
    const i = text.indexOf(mark, index);
    if (i >= 0 && i < end) end = i;
  }
  return text.slice(start, end).trim();
}

function extractAssertions(text: string): Assertion[] {
  const out: Assertion[] = [];
  const seen = new Set<string>();
  for (const { kind, re } of ASSERTION_PATTERNS) {
    const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
    let m: RegExpExecArray | null;
    while ((m = rx.exec(text)) !== null) {
      const snippet = m[0];
      if (!snippet) break;
      const key = `${kind}:${snippet.toLowerCase()}:${m.index}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ kind, snippet, sentence: sentenceOf(text, m.index) });
    }
  }
  return out;
}

type ClaimRow = {
  id: number;
  statement: string;
  source_url: string;
  checked_at: string;
  expires_at: string;
  kind: string;
};

function matchClaim(rows: ClaimRow[], a: Assertion): ClaimRow | undefined {
  const sentence = a.sentence.toLowerCase();
  const snippet = a.snippet.toLowerCase();
  return rows.find((r) => {
    const st = (r.statement || "").toLowerCase().trim();
    if (!st) return false;
    if (sentence.includes(st) || st.includes(sentence)) return true;
    if (st.includes(snippet)) return true;
    return similarity(st, sentence) >= 0.6;
  });
}

// ---------------------------------------------------------------------------
// リンク
// ---------------------------------------------------------------------------

const URL_RE = /https?:\/\/[^\s<>()"'\]]+/gi;

const SHORTENERS = [
  "bit.ly",
  "tinyurl.com",
  "goo.gl",
  "ow.ly",
  "buff.ly",
  "is.gd",
  "cutt.ly",
  "rebrand.ly",
  "t.ly",
  "shorturl.at",
  "lnkd.in",
  "amzn.to",
  "rb.gy",
  "v.gd",
  "s.id",
  "tiny.cc",
  "trib.al",
  "shorturl.com",
];

const AFFILIATE_MARKERS = [
  /[?&](?:ref|aff|aff_id|affiliate|aff_c|irclickid|clickid|subid|sub_id|partner|tag|utm_medium=affiliate)[=_]/i,
  /\/(?:go|aff|aff_c|recommends|track|click)\//i,
  /(?:sjv\.io|prf\.hn|awin1\.com|shareasale\.com|tkqlhce\.com|anrdoezrs\.net|linksynergy|partnerize|impact\.com|go\.[a-z0-9-]+\.net)/i,
];

type Link = { url: string; index: number; isCitation: boolean; isAffiliate: boolean };

function extractLinks(text: string, linkIsAffiliate: boolean): Link[] {
  const out: Link[] = [];
  const rx = new RegExp(URL_RE.source, "gi");
  let m: RegExpExecArray | null;
  while ((m = rx.exec(text)) !== null) {
    const url = m[0];
    if (!url) break;
    // 出典URL（source: ... / checked ...）は誘導リンクではないので配置ルールの対象外
    const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const isCitation = /(?:source|src|出典|checked)\s*[:：]?\s*$/.test(before);
    const isAffiliate = !isCitation && (linkIsAffiliate || AFFILIATE_MARKERS.some((r) => r.test(url)));
    out.push({ url, index: m.index, isCitation, isAffiliate });
  }
  return out;
}

const DISCLOSURE_RE =
  /(#ad\b|\bad:|#affiliate|\baffiliate link|\baffiliate disclosure|\bpaid link|\bsponsored\b|\bi may earn\b|\bwe may earn\b|\bcommission\b|\bpr\b)/i;

// ---------------------------------------------------------------------------
// 語彙リスト
// ---------------------------------------------------------------------------

const ADULT_WORDS = [
  "nude",
  "naked",
  "nsfw",
  "lingerie",
  "bikini",
  "cleavage",
  "sexy",
  "seductive",
  "erotic",
  "sensual",
  "panties",
  "underwear",
  "topless",
  "boobs",
  "breasts",
  "thigh gap",
  "wet t-shirt",
  "bedroom eyes",
  "エロ",
  "下着",
  "露出",
  "官能",
];

const MINOR_WORDS = [
  "schoolgirl",
  "school girl",
  "high school",
  "middle school",
  "elementary",
  "teenager",
  "teenage",
  "underage",
  "loli",
  "child",
  "childlike",
  "kid",
  "jk",
  "女子高生",
  "未成年",
  "ロリ",
];

const AI_DISCLOSURE_RE =
  /(ai[- ]generated|ai generated|generated by ai|virtual (?:creator|character|influencer|model)|ai character|ai influencer|synthetic (?:performer|character)|created with ai|AI生成)/i;

const KEIHYO_ABSOLUTE = [
  "必ず儲かる",
  "必ず稼げる",
  "必ず",
  "絶対",
  "保証します",
  "元本保証",
  "確実に稼げる",
  "誰でも稼げる",
  "100%",
  "guaranteed",
  "guarantee earnings",
  "risk-free",
  "risk free",
  "you will earn",
  "you will make money",
  "never fails",
];

const KEIHYO_URGENCY = [
  "hurry",
  "only today",
  "limited time",
  "act now",
  "last chance",
  "don't miss out",
  "今すぐ",
  "今だけ",
  "残りわずか",
  "本日限り",
];

const KEIHYO_DOUBLE_PRICE = [
  /~~\s*[$¥€£]?\s*\d/,
  /\bwas\s*[$¥€£]\s?\d/i,
  /\bnormally\s*[$¥€£]\s?\d/i,
  /通常価格/,
  /定価/,
];

const REAL_PERSON_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "実在人物の職業＋実名", re: /\b(?:actress|actor|idol|singer|celebrity|model|youtuber)\s+[A-Z][\w'’-]+(?:\s+[A-Z][\w'’-]+)?/ },
  { label: "実在人物の写真だと主張", re: /\b(?:real\s+)?(?:photo|picture|image|footage|face)\s+of\s+[A-Z][\w'’-]+\s+[A-Z][\w'’-]+/ },
  { label: "実在の人間だと偽装", re: /\bI(?:'m| am)\s+(?:a\s+)?real\s+(?:person|human|girl|woman|model)\b/i },
  { label: "AIでないと否定", re: /\b(?:not|isn'?t|is not|am not)\s+(?:an?\s+)?ai\b/i },
];

// ---------------------------------------------------------------------------
// 法令台帳ゲート
// ---------------------------------------------------------------------------

type LawRow = { id: string; name: string; checked_at: string };

function daysSince(iso: string): number {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return Number.POSITIVE_INFINITY;
  return (Date.now() - t) / 86400000;
}

async function loadLaws(): Promise<Map<string, LawRow>> {
  const rs = await getDb().execute(`SELECT id, name, checked_at FROM laws`);
  const map = new Map<string, LawRow>();
  for (const r of rs.rows) {
    const id = String(r["id"] ?? "");
    map.set(id.toUpperCase(), {
      id,
      name: String(r["name"] ?? ""),
      checked_at: String(r["checked_at"] ?? ""),
    });
  }
  return map;
}

function lawGate(code: CheckCode, laws: Map<string, LawRow>): CheckResult | null {
  const lawId = LAW_FOR_CHECK[code];
  if (!lawId) return null;
  const row = laws.get(lawId.toUpperCase());
  if (!row) {
    return {
      code,
      result: "HALT",
      detail: `法令台帳に ${lawId} の行が無いため判定できない（推測しない）`,
    };
  }
  const age = daysSince(row.checked_at);
  if (age > LAW_FRESHNESS_DAYS) {
    return {
      code,
      result: "HALT",
      detail: `${lawId} の checked_at が${Math.floor(age)}日前で期限切れ（上限${LAW_FRESHNESS_DAYS}日）。再確認するまで判定しない`,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// 本体
// ---------------------------------------------------------------------------

export async function checkPost(input: PostInput): Promise<ComplianceReport> {
  const db = getDb();
  const subjectType = input.subjectType ?? "post";
  const subjectId = String(input.subjectId);
  const body = input.text ?? "";
  const reply = input.replyText ?? "";
  // A群は本文→リプライの順で読まれるため、開示位置の判定は連結した並び順で見る
  const full = reply ? `${body}\n${reply}` : body;
  const visual = `${body}\n${input.imagePrompt ?? ""}`;
  const laws = await loadLaws();

  // 名前は文字列ではなく Character Identity Object として受け取る
  const identity = input.identity ?? CHARACTER_IDENTITY;
  const surface = input.surface ?? DEFAULT_SURFACE;

  const results: CheckResult[] = [];
  const push = (r: CheckResult) => results.push(r);
  const gated = (code: CheckCode, run: () => CheckResult | Promise<CheckResult>) => {
    const halt = lawGate(code, laws);
    if (halt) {
      push(halt);
      return null;
    }
    return run();
  };

  const bodyLinks = extractLinks(body, input.linkIsAffiliate === true);
  const replyLinks = extractLinks(reply, input.linkIsAffiliate === true);
  const fullLinks = extractLinks(full, input.linkIsAffiliate === true);

  const claimRows = await loadClaims(db, subjectType, subjectId);
  const assertions = extractAssertions(full);

  // 1. FAKE_EXPERIENCE
  {
    const r = gated("FAKE_EXPERIENCE", () => checkFakeExperience(full, identity));
    if (r) push(await r);
  }

  // 1b. NAME_SHORT_FORM（下の名前だけの表記。使用場所によって判定が変わる）
  {
    const r = gated("NAME_SHORT_FORM", () => checkNameShortForm(full, identity, surface));
    if (r) push(await r);
  }

  // 1c. NAME_COLLISION（別姓・別名への変化。場所を問わず常にBLOCK）
  {
    const r = gated("NAME_COLLISION", () => checkNameCollision(full, identity));
    if (r) push(await r);
  }

  // 1d. IDENTITY_LOCK（名前が確定していない状態で本番公開しない）
  push(checkIdentityLock(identity, input.publishIntent === true));

  // 2. UNSUBSTANTIATED_CLAIM
  {
    const r = gated("UNSUBSTANTIATED_CLAIM", () => {
      const problems: string[] = [];
      for (const a of assertions) {
        const claim = matchClaim(claimRows, a);
        if (!claim) {
          problems.push(`${a.kind}「${a.snippet}」に対応する claims 行が無い`);
          continue;
        }
        if (!claim.source_url.trim()) problems.push(`claims#${claim.id} の source_url が空`);
        if (!claim.checked_at.trim()) problems.push(`claims#${claim.id} の checked_at が空`);
      }
      return problems.length
        ? { code: "UNSUBSTANTIATED_CLAIM" as const, result: "FAIL" as const, detail: problems.join(" / ") }
        : { code: "UNSUBSTANTIATED_CLAIM" as const, result: "PASS" as const };
    });
    if (r) push(await r);
  }

  // 3. AFFILIATE_DISCLOSURE_MISSING
  {
    const r = gated("AFFILIATE_DISCLOSURE_MISSING", () => {
      const affiliate = fullLinks.filter((l) => l.isAffiliate);
      if (affiliate.length === 0) return { code: "AFFILIATE_DISCLOSURE_MISSING" as const, result: "PASS" as const };
      const m = DISCLOSURE_RE.exec(full);
      if (!m) {
        return {
          code: "AFFILIATE_DISCLOSURE_MISSING" as const,
          result: "FAIL" as const,
          detail: "アフィリエイトリンクがあるのに開示文が無い",
        };
      }
      const firstLink = Math.min(...affiliate.map((l) => l.index));
      if (m.index > firstLink) {
        return {
          code: "AFFILIATE_DISCLOSURE_MISSING" as const,
          result: "FAIL" as const,
          detail: `開示文がリンクより後ろにある（開示=${m.index}文字目 / リンク=${firstLink}文字目）`,
        };
      }
      return { code: "AFFILIATE_DISCLOSURE_MISSING" as const, result: "PASS" as const };
    });
    if (r) push(await r);
  }

  // 4. OUTDATED_SOURCE
  {
    const referenced = new Map<number, ClaimRow>();
    for (const a of assertions) {
      const c = matchClaim(claimRows, a);
      if (c) referenced.set(c.id, c);
    }
    const expired: string[] = [];
    for (const c of referenced.values()) {
      const limit = effectiveExpiry(c);
      if (limit && Date.now() > limit) {
        expired.push(`claims#${c.id}（kind=${c.kind} / checked_at=${c.checked_at}）`);
      }
    }
    push(
      expired.length
        ? {
            code: "OUTDATED_SOURCE",
            result: "FAIL",
            detail: `根拠の有効期限切れ: ${expired.join(", ")}。再確認するまで出さない`,
          }
        : { code: "OUTDATED_SOURCE", result: "PASS" },
    );
  }

  // 5. ADULT
  {
    const r = gated("ADULT", () => {
      const hits = ADULT_WORDS.filter((w) => visual.toLowerCase().includes(w.toLowerCase()));
      return hits.length
        ? { code: "ADULT" as const, result: "FAIL" as const, detail: `成人向け・性的示唆: ${hits.join(", ")}` }
        : { code: "ADULT" as const, result: "PASS" as const };
    });
    if (r) push(await r);
  }

  // 6. MINOR_LOOK
  {
    const r = gated("MINOR_LOOK", () => {
      const lower = visual.toLowerCase();
      const hits = MINOR_WORDS.filter((w) => lower.includes(w));
      const age = /\b(\d{1,2})[\s-]*(?:year[- ]old|yo|歳|才)\b/i.exec(visual);
      const ageNum = age?.[1] ? Number(age[1]) : NaN;
      if (!Number.isNaN(ageNum) && ageNum < 18) hits.push(`${ageNum}歳の表記`);
      return hits.length
        ? { code: "MINOR_LOOK" as const, result: "FAIL" as const, detail: `未成年に見える要素: ${hits.join(", ")}` }
        : { code: "MINOR_LOOK" as const, result: "PASS" as const };
    });
    if (r) push(await r);
  }

  // 7. AI_DISCLOSURE
  {
    const r = gated("AI_DISCLOSURE", () => {
      if (input.profileHasAiDisclosure === true || AI_DISCLOSURE_RE.test(full)) {
        return { code: "AI_DISCLOSURE" as const, result: "PASS" as const };
      }
      return {
        code: "AI_DISCLOSURE" as const,
        result: "FAIL" as const,
        detail: "投稿にもプロフィールにもAI生成である旨の開示が無い",
      };
    });
    if (r) push(await r);
  }

  // 8. SHORT_URL
  {
    const hits = fullLinks.filter((l) => SHORTENERS.some((s) => l.url.toLowerCase().includes(`//${s}/`) || l.url.toLowerCase().includes(`.${s}/`) || l.url.toLowerCase().includes(`//${s}`)));
    push(
      hits.length
        ? { code: "SHORT_URL", result: "FAIL", detail: `短縮URL: ${hits.map((h) => h.url).join(", ")}` }
        : { code: "SHORT_URL", result: "PASS" },
    );
  }

  // 9. DUPLICATE
  {
    const past = await loadRecentTexts(db, subjectType, subjectId);
    const candidates = [...past, ...(input.recentTexts ?? [])];
    let worst = 0;
    for (const p of candidates) worst = Math.max(worst, similarity(p, body));
    push(
      worst >= DUP_THRESHOLD
        ? {
            code: "DUPLICATE",
            result: "FAIL",
            detail: `過去投稿との類似度 ${worst.toFixed(3)}（上限 ${DUP_THRESHOLD}）`,
          }
        : { code: "DUPLICATE", result: "PASS", detail: `最大類似度 ${worst.toFixed(3)}` },
    );
  }

  // 10. AUTOMATION
  {
    const r = gated("AUTOMATION", () => {
      const mentions = full.match(/(^|[^\w@])@([A-Za-z0-9_]{2,15})\b/g) ?? [];
      const problems: string[] = [];
      if (mentions.length) problems.push(`特定ユーザーへのメンション: ${mentions.map((m) => m.trim()).join(", ")}`);
      if (input.keywordTriggeredReply === true) problems.push("キーワード起点の自動返信");
      return problems.length
        ? { code: "AUTOMATION" as const, result: "FAIL" as const, detail: problems.join(" / ") }
        : { code: "AUTOMATION" as const, result: "PASS" as const };
    });
    if (r) push(await r);
  }

  // 11. KEIHYO
  {
    const r = gated("KEIHYO", () => {
      const lower = full.toLowerCase();
      const problems: string[] = [];
      for (const w of KEIHYO_ABSOLUTE) if (lower.includes(w.toLowerCase())) problems.push(`断定・誇大「${w}」`);
      for (const w of KEIHYO_URGENCY) if (lower.includes(w.toLowerCase())) problems.push(`購入を急がせる表現「${w}」`);
      for (const re of KEIHYO_DOUBLE_PRICE) if (re.test(full)) problems.push("二重価格表示");
      for (const a of assertions) {
        if (a.kind !== "最上級") continue;
        if (!matchClaim(claimRows, a)) problems.push(`根拠の無い最上級「${a.snippet}」`);
      }
      return problems.length
        ? { code: "KEIHYO" as const, result: "FAIL" as const, detail: problems.join(" / ") }
        : { code: "KEIHYO" as const, result: "PASS" as const };
    });
    if (r) push(await r);
  }

  // 12. REAL_PERSON
  {
    const r = gated("REAL_PERSON", () => {
      const problems: string[] = [];
      for (const p of REAL_PERSON_PATTERNS) if (p.re.test(full)) problems.push(p.label);
      for (const name of input.realPersonNames ?? []) {
        if (name && full.toLowerCase().includes(name.toLowerCase())) problems.push(`実在人物名「${name}」`);
      }
      if (input.faceMatchesRealPerson === true) problems.push("生成画像が実在人物に酷似");
      return problems.length
        ? { code: "REAL_PERSON" as const, result: "FAIL" as const, detail: problems.join(" / ") }
        : { code: "REAL_PERSON" as const, result: "PASS" as const };
    });
    if (r) push(await r);
  }

  // 13. ASP_TERMS
  push(await checkAspTerms(input, full, fullLinks));

  // 14. EXP_GROUP_MISMATCH
  {
    const group = input.expGroup ?? "NONE";
    const bodyPromo = bodyLinks.filter((l) => !l.isCitation);
    const replyPromo = replyLinks.filter((l) => !l.isCitation);
    const problems: string[] = [];
    if (group === "A") {
      if (bodyPromo.length) problems.push("A群なのに本文へリンクがある");
      if (replyPromo.length === 0) problems.push("A群なのにリプライにリンクが無い");
    } else if (group === "B") {
      if (bodyPromo.length === 0) problems.push("B群なのに本文にリンクが無い");
      if (replyPromo.length) problems.push("B群なのにリプライにもリンクがある");
    } else {
      if (bodyPromo.length || replyPromo.length) problems.push("NONE群なのに誘導リンクがある");
    }
    push(
      problems.length
        ? { code: "EXP_GROUP_MISMATCH", result: "FAIL", detail: `EXP-001の割当(${group})と食い違い: ${problems.join(" / ")}` }
        : { code: "EXP_GROUP_MISMATCH", result: "PASS" },
    );
  }

  const failed = results.filter((r) => r.result === "FAIL").map((r) => r.code);
  const halted = results.filter((r) => r.result === "HALT").map((r) => r.code);
  // WARN は承認を止めない。止めるべき違反と「もっと良く書ける」を混ぜない
  const warned = results.filter((r) => r.result === "WARN").map((r) => r.code);
  const passed = failed.length === 0 && halted.length === 0;

  if (input.persist !== false) {
    const checkedAt = nowIso();
    for (const r of results) {
      await db.execute({
        sql: `INSERT INTO compliance_checks (subject_type, subject_id, check_code, result, detail, checked_at)
              VALUES (?,?,?,?,?,?)`,
        args: [subjectType, subjectId, r.code, r.result, r.detail ?? null, checkedAt],
      });
    }
  }

  for (const r of results) {
    if (r.result !== "HALT") continue;
    await notify(
      "CRITICAL",
      "COMPLIANCE_HALT",
      `[${subjectType}:${subjectId}] ${r.code} の判定を停止しました: ${r.detail ?? ""}`,
    );
  }

  const warnNote = warned.length ? `（注意: ${warned.join(", ")}）` : "";
  const reason = passed
    ? `承認画面に出してよい${warnNote}`
    : `承認画面に出さない（FAIL: ${failed.join(", ") || "なし"} / HALT: ${halted.join(", ") || "なし"}）${warnNote}`;

  return { passed, blockedFromApproval: !passed, results, failed, halted, warned, reason };
}

function effectiveExpiry(c: ClaimRow): number | null {
  const window = CLAIM_WINDOW_DAYS[c.kind.toUpperCase()] ?? 30;
  const checked = Date.parse(c.checked_at);
  const declared = Date.parse(c.expires_at);
  const limits: number[] = [];
  if (!Number.isNaN(checked)) limits.push(checked + window * 86400000);
  if (!Number.isNaN(declared)) limits.push(declared);
  if (limits.length === 0) return null;
  // 台帳の期限と行の expires_at が食い違ったら短い方を採る（緩い方に寄せない）
  return Math.min(...limits);
}

async function loadClaims(
  db: ReturnType<typeof getDb>,
  subjectType: string,
  subjectId: string,
): Promise<ClaimRow[]> {
  const rs = await db.execute({
    sql: `SELECT id, statement, source_url, checked_at, expires_at, kind
          FROM claims WHERE subject_type = ? AND subject_id = ?`,
    args: [subjectType, subjectId],
  });
  return rs.rows.map((r) => ({
    id: Number(r["id"] ?? 0),
    statement: String(r["statement"] ?? ""),
    source_url: String(r["source_url"] ?? ""),
    checked_at: String(r["checked_at"] ?? ""),
    expires_at: String(r["expires_at"] ?? ""),
    kind: String(r["kind"] ?? "PRICE"),
  }));
}

async function loadRecentTexts(
  db: ReturnType<typeof getDb>,
  subjectType: string,
  subjectId: string,
): Promise<string[]> {
  if (subjectType !== "post") return [];
  const selfId = Number(subjectId);
  const rs = Number.isFinite(selfId)
    ? await db.execute({
        sql: `SELECT text FROM posts WHERE id <> ? AND status <> 'failed' ORDER BY id DESC LIMIT 200`,
        args: [selfId],
      })
    : await db.execute(`SELECT text FROM posts WHERE status <> 'failed' ORDER BY id DESC LIMIT 200`);
  return rs.rows.map((r) => String(r["text"] ?? ""));
}

async function checkAspTerms(input: PostInput, full: string, links: Link[]): Promise<CheckResult> {
  const problems: string[] = [];
  const lower = full.toLowerCase();
  const restrictions = [...(input.aspRestrictions ?? [])];

  if (input.offerId) {
    const rs = await getDb().execute({
      sql: `SELECT o.restrictions, o.allowed_traffic, o.approval_status, o.adult_flag,
                   n.allows_social_traffic, n.name AS network_name
            FROM offers o LEFT JOIN networks n ON n.id = o.network_id
            WHERE o.id = ?`,
      args: [input.offerId],
    });
    const row = rs.rows[0];
    if (!row) {
      problems.push(`offers に ${input.offerId} が無い（条件を確認できない）`);
    } else {
      restrictions.push(...parsePhrases(String(row["restrictions"] ?? "")));
      const status = String(row["approval_status"] ?? "");
      const hasAffiliateLink = links.some((l) => l.isAffiliate);
      if (hasAffiliateLink && status !== "APPROVED") {
        problems.push(`案件が未承認（approval_status=${status}）なのにアフィリリンクを貼っている`);
      }
      if (String(row["allows_social_traffic"] ?? "UNKNOWN") === "NO") {
        problems.push(`${String(row["network_name"] ?? "ASP")} はソーシャルトラフィック禁止`);
      }
      if (Number(row["adult_flag"] ?? 0) === 1) problems.push("アダルト案件は扱わない");
    }
  }

  for (const phrase of restrictions) {
    const p = phrase.trim().toLowerCase();
    if (p && lower.includes(p)) problems.push(`ASPの禁止事項「${phrase.trim()}」に該当`);
  }

  return problems.length
    ? { code: "ASP_TERMS", result: "FAIL", detail: problems.join(" / ") }
    : { code: "ASP_TERMS", result: "PASS" };
}

function parsePhrases(raw: string): string[] {
  const s = raw.trim();
  if (!s) return [];
  if (s.startsWith("[")) {
    try {
      const arr: unknown = JSON.parse(s);
      if (Array.isArray(arr)) return arr.map((x) => String(x));
    } catch {
      // JSONで無ければ区切り文字として扱う
    }
  }
  return s.split(/[\n;,、]/).map((x) => x.trim()).filter(Boolean);
}
