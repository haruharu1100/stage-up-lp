/**
 * 申請学習（Affiliate Approval Learning）
 *
 * 仕様:
 *   事業Vault/AI YAMATO NADESHIKO/02_AFFILIATE/申請学習.md
 *   事業Vault/AI YAMATO NADESHIKO/00_SYSTEM/MASTER_RULES.md 4-2
 *   docs/05_アーキテクチャとDB設計.md「申請学習まわり」
 *
 * ★この実装が守っている前提（ここを崩すと Phase 1 のKPIが壊れる）
 *   1. Phase 1 の最優先KPIは「Surfsharkを通すこと」ではなく
 *      「承認される媒体・プロフィール・申請方法の勝ちパターンを1つ作ること」。
 *      よって申請は実験であり、入力・結果・理由を必ず保存する。
 *   2. 13項目が1つでも欠けたら申請文を出力しない（NOT_READY）
 *   3. 申請は1社ずつ。一括申請は拒否する（通った理由も落ちた理由も分からなくなる）
 *   4. NO_RESPONSE を REJECT と混ぜない（原因が違う）
 *   5. affiliate_applications は上書きしない。修正したら版を上げて新しい行を積む
 *   6. 申請3件未満で「この書き方が正解」と書かない（最低サンプル）
 *   7. 拒否理由が取れなかったら「取れなかった」と書く。推測を書かない
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, nowIso, notify } from "./db.js";
import { checkPost } from "./compliance.js";

// ===========================================================================
// 型と定数
// ===========================================================================

export type ApplicationResult =
  | "PENDING"
  | "PASS"
  | "REJECT"
  | "MORE_INFORMATION_REQUIRED"
  | "NO_RESPONSE";

/** 申請学習.md「結果の4分類」。PENDING は未確定であって分類ではない */
export const RESULT_CLASSES = [
  "PASS",
  "REJECT",
  "MORE_INFORMATION_REQUIRED",
  "NO_RESPONSE",
] as const;

export type CheckVerdict = "PASS" | "FAIL" | "UNKNOWN";

export type PreCheckCode =
  | "PROFILE_IMAGE"
  | "HEADER_IMAGE"
  | "BIO_COMPLETE"
  | "AI_DISCLOSURE_IN_BIO"
  | "JAPAN_THEME_CLEAR"
  | "POST_HISTORY"
  | "NOT_AFFILIATE_SPAM"
  | "NO_ADULT_CONTENT"
  | "NO_GAMBLING_CONTENT"
  | "NO_FAKE_TESTIMONIAL"
  | "NO_PURCHASED_FOLLOWERS"
  | "NO_AUTO_FOLLOW_LIKE"
  | "NO_INDISCRIMINATE_REPLY";

export const PRE_CHECK_CODES: PreCheckCode[] = [
  "PROFILE_IMAGE",
  "HEADER_IMAGE",
  "BIO_COMPLETE",
  "AI_DISCLOSURE_IN_BIO",
  "JAPAN_THEME_CLEAR",
  "POST_HISTORY",
  "NOT_AFFILIATE_SPAM",
  "NO_ADULT_CONTENT",
  "NO_GAMBLING_CONTENT",
  "NO_FAKE_TESTIMONIAL",
  "NO_PURCHASED_FOLLOWERS",
  "NO_AUTO_FOLLOW_LIKE",
  "NO_INDISCRIMINATE_REPLY",
];

export const PRE_CHECK_LABEL: Record<PreCheckCode, string> = {
  PROFILE_IMAGE: "Profile image あり",
  HEADER_IMAGE: "Header あり",
  BIO_COMPLETE: "Bio 完成（空でない・テンプレのままでない）",
  AI_DISCLOSURE_IN_BIO: "AI開示あり（Bioに AI-generated）",
  JAPAN_THEME_CLEAR: "Japan / Japanese culture のテーマが明確",
  POST_HISTORY: "投稿実績がある（通常投稿10件以上・7日以上）",
  NOT_AFFILIATE_SPAM: "Affiliate目的のSpamアカウントに見えない",
  NO_ADULT_CONTENT: "成人向けコンテンツなし",
  NO_GAMBLING_CONTENT: "ギャンブルコンテンツなし",
  NO_FAKE_TESTIMONIAL: "虚偽体験談なし",
  NO_PURCHASED_FOLLOWERS: "フォロワー購入なし",
  NO_AUTO_FOLLOW_LIKE: "自動Follow / 自動Likeなし",
  NO_INDISCRIMINATE_REPLY: "無差別Replyなし",
};

/**
 * ★チェックリストの条文は post_count >= 1 だが、申請学習.md の★注記どおり
 *   実運用の下限は「通常投稿10件以上・7日以上」。
 *   1件でも形式的には満たすが、申請直前に作ったアカウントに見えると落ちるため厳しい方を採る。
 */
export const MIN_POST_COUNT = 10;
export const MIN_ACCOUNT_AGE_DAYS = 7;

/** アフィリリンク付き投稿が全体の 1/3 を超えたらSpamアカウントに見える */
export const MAX_AFFILIATE_POST_RATIO = 1 / 3;

/** 「日本テーマ語が一定割合」の閾値。直近投稿の半分以上が日本テーマであること */
export const MIN_JAPAN_THEME_POST_RATIO = 0.5;
export const JAPAN_THEME_POST_WINDOW = 20;

/** テンプレのままでないと言える最低長。X の Bio は160字なのでこの程度は必ず埋まる */
export const MIN_BIO_LENGTH = 20;

/** 申請3件未満で「この書き方が正解」と書かない */
export const MIN_APPLICATIONS_FOR_VERDICT = 3;

/** 拒否理由が取れなかったときに保存する文言。推測を書かないための固定値 */
export const REASON_UNAVAILABLE = "理由は取得できなかった（相手から回答が得られなかった）";

export function isReasonUnavailable(reason: string | null): boolean {
  return (reason ?? "").trim() === REASON_UNAVAILABLE;
}

// ===========================================================================
// アカウント実態の入力
// ===========================================================================

export type AccountPost = {
  text: string;
  /** アフィリエイトリンクを含むか。判断できないなら未指定にする（勝手にfalseにしない） */
  hasAffiliateLink?: boolean;
  postedAt?: string;
  imagePrompt?: string;
};

export type HumanDeclaration = {
  value: boolean;
  declaredBy: string;
  declaredAt: string;
};

export type AccountSnapshot = {
  handle?: string;
  profileImageUrl?: string;
  headerImageUrl?: string;
  bio?: string;
  /** アカウント開設日（YYYY-MM-DD）。account_age はここから出す */
  createdAt?: string;
  followers?: number;
  impressions?: number;
  posts?: AccountPost[];
  websiteAvailable?: boolean;
  domain?: string;
  aiDisclosure?: string;
  trafficDescription?: string;
  audienceDescription?: string;
  declarations?: {
    /** 11番はテキストから測れない。人間が「購入していない」と宣言した記録でのみ担保する */
    noPurchasedFollowers?: HumanDeclaration;
  };
};

export function loadAccountSnapshot(path: string): AccountSnapshot {
  const raw = readFileSync(path, "utf8");
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`アカウント実態ファイルの中身がオブジェクトではない: ${path}`);
  }
  return parsed as AccountSnapshot;
}

export function accountAgeDays(createdAt: string | undefined, at = Date.now()): number | null {
  if (!createdAt) return null;
  const t = Date.parse(createdAt);
  if (Number.isNaN(t)) return null;
  return Math.floor((at - t) / 86400000);
}

// ===========================================================================
// 語彙
// ===========================================================================

const JAPAN_THEME_WORDS = [
  "japan",
  "japanese",
  "tokyo",
  "kyoto",
  "osaka",
  "hokkaido",
  "okinawa",
  "nara",
  "sakura",
  "cherry blossom",
  "kimono",
  "yukata",
  "onsen",
  "matsuri",
  "shrine",
  "temple",
  "torii",
  "ramen",
  "sushi",
  "washoku",
  "izakaya",
  "shinkansen",
  "tatami",
  "wagashi",
  "matcha",
  "hanami",
  "ryokan",
  "bento",
  "yen",
  "jr pass",
  "日本",
];

/**
 * ギャンブル語彙は compliance.ts に該当する check_code が無いため、ここに持つ。
 * 8番(ADULT)・10番(FAKE_EXPERIENCE)は compliance.ts の判定結果をそのまま使う。
 */
const GAMBLING_WORDS = [
  "casino",
  "online casino",
  "sportsbook",
  "betting",
  "bet now",
  "place a bet",
  "gambling",
  "gamble",
  "poker",
  "roulette",
  "blackjack",
  "baccarat",
  "slot machine",
  "jackpot",
  "lottery",
  "bookmaker",
  "free spins",
  "カジノ",
  "ギャンブル",
  "賭博",
  "パチンコ",
  "競馬",
  "宝くじ",
];

/** Bioがテンプレ・書きかけのまま残っていることを示す痕跡 */
const BIO_PLACEHOLDER_MARKERS = [
  "todo",
  "tbd",
  "xxx",
  "lorem ipsum",
  "your bio",
  "bio here",
  "coming soon",
  "under construction",
  "placeholder",
  "{{",
  "<your",
  "ここに",
  "未設定",
  "サンプル",
];

const AI_DISCLOSURE_IN_BIO_RE = /ai[-\s]?generated/i;

const AFFILIATE_URL_MARKERS = [
  /[?&](?:ref|aff|aff_id|affiliate|aff_c|irclickid|clickid|subid|sub_id|partner|tag)[=_]/i,
  /\/(?:go|aff|aff_c|recommends|track|click)\//i,
  /(?:sjv\.io|prf\.hn|awin1\.com|shareasale\.com|tkqlhce\.com|anrdoezrs\.net|linksynergy|partnerize|impact\.com)/i,
];

// ===========================================================================
// 12番・13番: 実装として存在しないことの確認
// ===========================================================================

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SCANNED_DIRS = ["lib", "scripts"];
const SCANNED_EXT = [".ts", ".mjs", ".js"];

const AUTO_FOLLOW_LIKE_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "自動フォロー(API v2)", re: /\/2\/users\/[^\s"'`]*\/following\b/ },
  { label: "自動フォロー(API v1.1)", re: /friendships\/(?:create|destroy)/ },
  { label: "自動フォロー関数", re: /\bfollow(?:User|Back|All|Many|Bulk)\s*\(/i },
  { label: "自動いいね(API v2)", re: /\/2\/users\/[^\s"'`]*\/likes\b/ },
  { label: "自動いいね(API v1.1)", re: /favorites\/create/ },
  { label: "自動いいね関数", re: /\blike(?:Tweet|Post|All|Many|Bulk)\s*\(/i },
];

const REPLY_CAPABILITY_PATTERNS: { label: string; re: RegExp }[] = [
  { label: "リプライ送信", re: /in_reply_to_(?:tweet_)?id/ },
  { label: "リプライ関数", re: /\breply(?:To|All|Many)\w*\s*\(/i },
  { label: "メンション監視", re: /\/2\/users\/[^\s"'`]*\/mentions\b/ },
  { label: "検索起点の返信", re: /\/2\/tweets\/search\/(?:recent|all)\b/ },
];

type SourceHit = { label: string; file: string; line: number };

function listSourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (e === "node_modules" || e.startsWith(".")) continue;
      const p = join(dir, e);
      const st = statSync(p);
      if (st.isDirectory()) walk(p);
      else if (SCANNED_EXT.some((x) => p.endsWith(x))) out.push(p);
    }
  };
  for (const d of SCANNED_DIRS) walk(join(PROJECT_ROOT, d));
  return out.sort();
}

// コメント行に書かれた「自動いいね」等の説明文を実装と誤認しないため、コメントを落としてから探す
function stripComments(src: string): string {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

function scanSources(patterns: { label: string; re: RegExp }[]): {
  hits: SourceHit[];
  files: number;
} {
  const files = listSourceFiles();
  const hits: SourceHit[] = [];
  for (const f of files) {
    const lines = stripComments(readFileSync(f, "utf8")).split("\n");
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? "";
      for (const p of patterns) {
        if (p.re.test(line)) {
          hits.push({ label: p.label, file: f.slice(PROJECT_ROOT.length + 1), line: i + 1 });
        }
      }
    }
  }
  return { hits, files: files.length };
}

// ===========================================================================
// 13項目チェック
// ===========================================================================

export type PreCheckItem = {
  no: number;
  code: PreCheckCode;
  label: string;
  result: CheckVerdict;
  detail: string;
};

export type PreCheckReport = {
  verdict: "READY" | "NOT_READY";
  ready: boolean;
  items: PreCheckItem[];
  blocking: PreCheckItem[];
  postsSource: string;
  postCount: number;
  reason: string;
};

type ComplianceAggregate = { verdict: CheckVerdict; detail: string };

async function aggregateCompliance(
  texts: { id: string; text: string; imagePrompt?: string }[],
  code: "ADULT" | "FAKE_EXPERIENCE",
): Promise<ComplianceAggregate> {
  if (texts.length === 0) {
    return { verdict: "UNKNOWN", detail: "判定対象の本文が1件も無いため判定不能" };
  }
  const fails: string[] = [];
  const halts: string[] = [];
  for (const t of texts) {
    const report = await checkPost({
      subjectId: t.id,
      subjectType: "post",
      text: t.text,
      imagePrompt: t.imagePrompt ?? "",
      // 申請前チェックは compliance_checks に積まない。積むのは application_checks の方
      persist: false,
      profileHasAiDisclosure: true,
    });
    const r = report.results.find((x) => x.code === code);
    if (!r) continue;
    if (r.result === "FAIL") fails.push(`${t.id}: ${r.detail ?? ""}`);
    if (r.result === "HALT") halts.push(`${t.id}: ${r.detail ?? ""}`);
  }
  const base = `compliance.ts の ${code} を ${texts.length}件へ適用`;
  if (fails.length) {
    return { verdict: "FAIL", detail: `${base} → ${fails.length}件がFAIL / ${fails.join(" | ")}` };
  }
  if (halts.length) {
    return {
      verdict: "UNKNOWN",
      detail: `${base} → ${halts.length}件が判定停止（HALT）。${halts[0] ?? ""}`,
    };
  }
  return { verdict: "PASS", detail: `${base} → 全件PASS` };
}

async function loadPostsFromDb(): Promise<{ posts: AccountPost[]; source: string }> {
  const rs = await getDb().execute(
    `SELECT p.text, p.offer_id, p.image_prompt, p.published_at, s.has_link
       FROM posts p LEFT JOIN post_slots s ON s.post_id = p.id
      WHERE p.status = 'published'
      ORDER BY p.id DESC LIMIT 200`,
  );
  const posts: AccountPost[] = rs.rows.map((r) => {
    const text = String(r["text"] ?? "");
    const hasOffer = r["offer_id"] !== null && r["offer_id"] !== undefined;
    const hasLinkFlag = Number(r["has_link"] ?? 0) === 1;
    return {
      text,
      hasAffiliateLink: hasOffer || hasLinkFlag || AFFILIATE_URL_MARKERS.some((re) => re.test(text)),
      postedAt: r["published_at"] === null ? undefined : String(r["published_at"]),
      imagePrompt: r["image_prompt"] === null ? undefined : String(r["image_prompt"]),
    };
  });
  return { posts, source: `DBの posts（status='published'）から${posts.length}件` };
}

function hasAffiliateLink(p: AccountPost): boolean {
  if (typeof p.hasAffiliateLink === "boolean") return p.hasAffiliateLink;
  return AFFILIATE_URL_MARKERS.some((re) => re.test(p.text));
}

function containsJapanTheme(s: string): boolean {
  const lower = s.toLowerCase();
  return JAPAN_THEME_WORDS.some((w) => lower.includes(w));
}

export async function runPreCheck(snapshot: AccountSnapshot): Promise<PreCheckReport> {
  const items: PreCheckItem[] = [];
  const add = (no: number, code: PreCheckCode, result: CheckVerdict, detail: string) =>
    items.push({ no, code, label: PRE_CHECK_LABEL[code], result, detail });

  let posts = snapshot.posts;
  let postsSource: string;
  if (posts && posts.length > 0) {
    postsSource = `アカウント実態ファイルの posts から${posts.length}件`;
  } else {
    const fromDb = await loadPostsFromDb();
    posts = fromDb.posts;
    postsSource = fromDb.source;
  }

  const bio = (snapshot.bio ?? "").trim();

  // 1 / 2
  add(
    1,
    "PROFILE_IMAGE",
    snapshot.profileImageUrl === undefined
      ? "UNKNOWN"
      : snapshot.profileImageUrl.trim()
        ? "PASS"
        : "FAIL",
    snapshot.profileImageUrl === undefined
      ? "profileImageUrl が未指定。取得できていないので判定不能（PASSにしない）"
      : snapshot.profileImageUrl.trim()
        ? `設定あり: ${snapshot.profileImageUrl.trim()}`
        : "profileImageUrl が空",
  );
  add(
    2,
    "HEADER_IMAGE",
    snapshot.headerImageUrl === undefined
      ? "UNKNOWN"
      : snapshot.headerImageUrl.trim()
        ? "PASS"
        : "FAIL",
    snapshot.headerImageUrl === undefined
      ? "headerImageUrl が未指定。取得できていないので判定不能（PASSにしない）"
      : snapshot.headerImageUrl.trim()
        ? `設定あり: ${snapshot.headerImageUrl.trim()}`
        : "headerImageUrl が空",
  );

  // 3
  {
    if (snapshot.bio === undefined) {
      add(3, "BIO_COMPLETE", "UNKNOWN", "bio が未指定。取得できていないので判定不能");
    } else {
      const lower = bio.toLowerCase();
      const markers = BIO_PLACEHOLDER_MARKERS.filter((m) => lower.includes(m));
      if (!bio) add(3, "BIO_COMPLETE", "FAIL", "Bioが空");
      else if (bio.length < MIN_BIO_LENGTH)
        add(3, "BIO_COMPLETE", "FAIL", `Bioが${bio.length}字。下限${MIN_BIO_LENGTH}字に満たない`);
      else if (markers.length)
        add(3, "BIO_COMPLETE", "FAIL", `テンプレ・書きかけの痕跡: ${markers.join(", ")}`);
      else add(3, "BIO_COMPLETE", "PASS", `${bio.length}字・プレースホルダ痕跡なし`);
    }
  }

  // 4
  {
    if (snapshot.bio === undefined) {
      add(4, "AI_DISCLOSURE_IN_BIO", "UNKNOWN", "bio が未指定のため判定不能");
    } else {
      const m = AI_DISCLOSURE_IN_BIO_RE.exec(bio);
      add(
        4,
        "AI_DISCLOSURE_IN_BIO",
        m ? "PASS" : "FAIL",
        m
          ? `Bioに「${m[0]}」を含む`
          : "Bioに AI-generated の表記が無い（EU AI Act 第50条・申請学習.md 4番）",
      );
    }
  }

  // 5
  {
    const window = posts.slice(0, JAPAN_THEME_POST_WINDOW);
    const bioOk = snapshot.bio === undefined ? null : containsJapanTheme(bio);
    const themed = window.filter((p) => containsJapanTheme(p.text)).length;
    const ratio = window.length ? themed / window.length : 0;
    const detail =
      `Bio=${bioOk === null ? "判定不能" : bioOk ? "日本テーマ語あり" : "日本テーマ語なし"} / ` +
      `直近${window.length}投稿のうち${themed}件が日本テーマ（${(ratio * 100).toFixed(0)}%・下限${(MIN_JAPAN_THEME_POST_RATIO * 100).toFixed(0)}%）`;
    if (bioOk === null || window.length === 0) {
      add(5, "JAPAN_THEME_CLEAR", "UNKNOWN", `${detail} → 材料不足で判定不能`);
    } else if (bioOk && ratio >= MIN_JAPAN_THEME_POST_RATIO) {
      add(5, "JAPAN_THEME_CLEAR", "PASS", detail);
    } else {
      add(5, "JAPAN_THEME_CLEAR", "FAIL", detail);
    }
  }

  // 6
  {
    const age = accountAgeDays(snapshot.createdAt);
    const normal = posts.length;
    const problems: string[] = [];
    if (normal < MIN_POST_COUNT)
      problems.push(`投稿${normal}件（下限${MIN_POST_COUNT}件）`);
    if (age === null) problems.push("createdAt が無く運用日数を確認できない");
    else if (age < MIN_ACCOUNT_AGE_DAYS)
      problems.push(`運用${age}日（下限${MIN_ACCOUNT_AGE_DAYS}日）`);
    const base = `投稿${normal}件 / 運用${age === null ? "不明" : `${age}日`}（出所: ${postsSource}）`;
    if (problems.length === 0) {
      add(6, "POST_HISTORY", "PASS", base);
    } else if (age === null) {
      add(
        6,
        "POST_HISTORY",
        "UNKNOWN",
        `${base} → ${problems.join(" / ")}。判定不能なのでPASSにしない`,
      );
    } else {
      add(
        6,
        "POST_HISTORY",
        "FAIL",
        `${base} → ${problems.join(" / ")}。` +
          `チェックリストの条文は post_count>=1 だが、申請直前に作ったアカウントに見えると` +
          `13項目を形式的に満たしても落ちるため、実運用の下限（通常投稿${MIN_POST_COUNT}件以上・${MIN_ACCOUNT_AGE_DAYS}日以上）を適用している`,
      );
    }
  }

  // 7
  {
    const total = posts.length;
    const aff = posts.filter(hasAffiliateLink).length;
    const unknownLink = posts.filter((p) => typeof p.hasAffiliateLink !== "boolean").length;
    if (total === 0) {
      add(7, "NOT_AFFILIATE_SPAM", "UNKNOWN", "投稿が0件なので比率を出せない");
    } else {
      const ratio = aff / total;
      const detail =
        `アフィリリンク付き ${aff}/${total}件 = ${(ratio * 100).toFixed(1)}%` +
        `（上限 ${(MAX_AFFILIATE_POST_RATIO * 100).toFixed(1)}%）` +
        (unknownLink
          ? ` / うち${unknownLink}件は hasAffiliateLink 未指定のため本文のリンク形からのみ判定`
          : "");
      add(7, "NOT_AFFILIATE_SPAM", ratio <= MAX_AFFILIATE_POST_RATIO ? "PASS" : "FAIL", detail);
    }
  }

  // 8 / 10 は compliance.ts の判定をそのまま使う（同じ本文を二重に実装しない）
  const complianceTargets = [
    ...(bio ? [{ id: "bio", text: bio }] : []),
    ...posts.map((p, i) => ({
      id: `post-${i + 1}`,
      text: p.text,
      imagePrompt: p.imagePrompt ?? "",
    })),
  ];
  {
    const adult = await aggregateCompliance(complianceTargets, "ADULT");
    add(8, "NO_ADULT_CONTENT", adult.verdict, adult.detail);
  }

  // 9
  {
    if (complianceTargets.length === 0) {
      add(9, "NO_GAMBLING_CONTENT", "UNKNOWN", "判定対象の本文が1件も無いため判定不能");
    } else {
      const hits: string[] = [];
      for (const t of complianceTargets) {
        const lower = t.text.toLowerCase();
        const found = GAMBLING_WORDS.filter((w) => lower.includes(w.toLowerCase()));
        if (found.length) hits.push(`${t.id}: ${found.join(", ")}`);
      }
      add(
        9,
        "NO_GAMBLING_CONTENT",
        hits.length ? "FAIL" : "PASS",
        hits.length
          ? `ギャンブル語彙を検出: ${hits.join(" | ")}`
          : `ギャンブル語彙${GAMBLING_WORDS.length}語を${complianceTargets.length}件へ照合し一致なし` +
            "（compliance.ts に GAMBLING の check_code が無いため、この語彙だけはここで持っている）",
      );
    }
  }

  // 10
  {
    const fake = await aggregateCompliance(complianceTargets, "FAKE_EXPERIENCE");
    add(10, "NO_FAKE_TESTIMONIAL", fake.verdict, fake.detail);
  }

  // 11
  {
    const d = snapshot.declarations?.noPurchasedFollowers;
    if (!d) {
      add(
        11,
        "NO_PURCHASED_FOLLOWERS",
        "UNKNOWN",
        "テキストからは測れない項目。declarations.noPurchasedFollowers に人間の宣言が無いので判定不能（PASSにしない）",
      );
    } else if (d.value !== true || !d.declaredBy?.trim() || !d.declaredAt?.trim()) {
      add(
        11,
        "NO_PURCHASED_FOLLOWERS",
        "FAIL",
        `宣言が不完全: value=${String(d.value)} / declaredBy=${d.declaredBy ?? "空"} / declaredAt=${d.declaredAt ?? "空"}`,
      );
    } else {
      add(
        11,
        "NO_PURCHASED_FOLLOWERS",
        "PASS",
        `機械では検証していない。${d.declaredAt} に ${d.declaredBy} が「フォロワーを購入していない」と宣言した記録のみを根拠とする`,
      );
    }
  }

  // 12
  {
    const { hits, files } = scanSources(AUTO_FOLLOW_LIKE_PATTERNS);
    add(
      12,
      "NO_AUTO_FOLLOW_LIKE",
      hits.length ? "FAIL" : "PASS",
      hits.length
        ? `自動Follow/Likeの実装が見つかった: ${hits.map((h) => `${h.label}(${h.file}:${h.line})`).join(" | ")}`
        : `実運用ではなくコードで担保。lib/・scripts/ の${files}ファイルからコメントを除去し` +
          `${AUTO_FOLLOW_LIKE_PATTERNS.length}種の呼び出しを探索して一致0件（＝機能が存在しない）`,
    );
  }

  // 13
  {
    const { hits, files } = scanSources(REPLY_CAPABILITY_PATTERNS);
    add(
      13,
      "NO_INDISCRIMINATE_REPLY",
      hits.length ? "UNKNOWN" : "PASS",
      hits.length
        ? `リプライ関連の実装が見つかった: ${hits.map((h) => `${h.label}(${h.file}:${h.line})`).join(" | ")}。` +
          "無差別かどうかはコードからは決められないので人が判定する（自動でPASSにしない）"
        : `実運用ではなくコードで担保。lib/・scripts/ の${files}ファイルからコメントを除去し` +
          `${REPLY_CAPABILITY_PATTERNS.length}種のリプライ送信・メンション取得を探索して一致0件（＝機能が存在しない）`,
    );
  }

  const blocking = items.filter((i) => i.result !== "PASS");
  const ready = blocking.length === 0;
  return {
    verdict: ready ? "READY" : "NOT_READY",
    ready,
    items,
    blocking,
    postsSource,
    postCount: posts.length,
    reason: ready
      ? "13項目すべてPASS。申請文を出力してよい"
      : `${blocking.length}項目が未達（FAIL ${blocking.filter((b) => b.result === "FAIL").length} / 判定不能 ${blocking.filter((b) => b.result === "UNKNOWN").length}）。申請文は出力しない`,
  };
}

export async function persistPreCheck(
  items: PreCheckItem[],
  applicationId: number | null,
): Promise<number> {
  const db = getDb();
  const checkedAt = nowIso();
  for (const i of items) {
    await db.execute({
      sql: `INSERT INTO application_checks (application_id, check_code, result, detail, checked_at)
            VALUES (?,?,?,?,?)`,
      args: [applicationId, i.code, i.result, i.detail, checkedAt],
    });
  }
  return items.length;
}

// ===========================================================================
// 申請文
// ===========================================================================

/** 申請学習.md「5. 申請文のひな形」。文面そのものを application_text として保存し版を上げる */
export const APPLICATION_TEXT_TEMPLATE = `This account is operated as a disclosed AI-generated virtual character
focused on Japanese culture and travel information for an international audience.

The AI disclosure is shown in the account profile and on the landing page.

All content is objective information, comparison and explanation.
We do not publish personal testimonials or claims of personal product use.
All factual statements are sourced and dated.

Affiliate relationships are disclosed above the link.
We use organic posting only. We do not run paid social campaigns.`;

export function buildApplicationText(snapshot: AccountSnapshot): string {
  const extra: string[] = [];
  if (snapshot.websiteAvailable && snapshot.domain?.trim()) {
    extra.push(`Website: https://${snapshot.domain.trim().replace(/^https?:\/\//, "")}`);
  }
  if (snapshot.handle?.trim()) extra.push(`X account: ${snapshot.handle.trim()}`);
  if (snapshot.trafficDescription?.trim()) extra.push(`Traffic: ${snapshot.trafficDescription.trim()}`);
  if (snapshot.audienceDescription?.trim()) extra.push(`Audience: ${snapshot.audienceDescription.trim()}`);
  return extra.length ? `${APPLICATION_TEXT_TEMPLATE}\n\n${extra.join("\n")}` : APPLICATION_TEXT_TEMPLATE;
}

// ===========================================================================
// 申請行
// ===========================================================================

export type ApplicationRow = {
  id: number;
  affiliate_name: string;
  application_date: string;
  profile_version: string;
  x_followers: number | null;
  x_impressions: number | null;
  account_age: number | null;
  post_count: number | null;
  website_available: number;
  domain: string | null;
  ai_disclosure: string | null;
  application_text: string | null;
  traffic_description: string | null;
  audience_description: string | null;
  result: ApplicationResult;
  rejection_reason: string | null;
  followup: string | null;
  approved_at: string | null;
  created_at: string;
};

const APP_COLUMNS = `id, affiliate_name, application_date, profile_version,
  x_followers, x_impressions, account_age, post_count, website_available, domain,
  ai_disclosure, application_text, traffic_description, audience_description,
  result, rejection_reason, followup, approved_at, created_at`;

function toRow(r: Record<string, unknown>): ApplicationRow {
  const num = (k: string): number | null => (r[k] === null || r[k] === undefined ? null : Number(r[k]));
  const str = (k: string): string | null => (r[k] === null || r[k] === undefined ? null : String(r[k]));
  return {
    id: Number(r["id"] ?? 0),
    affiliate_name: String(r["affiliate_name"] ?? ""),
    application_date: String(r["application_date"] ?? ""),
    profile_version: String(r["profile_version"] ?? ""),
    x_followers: num("x_followers"),
    x_impressions: num("x_impressions"),
    account_age: num("account_age"),
    post_count: num("post_count"),
    website_available: Number(r["website_available"] ?? 0),
    domain: str("domain"),
    ai_disclosure: str("ai_disclosure"),
    application_text: str("application_text"),
    traffic_description: str("traffic_description"),
    audience_description: str("audience_description"),
    result: (str("result") ?? "PENDING") as ApplicationResult,
    rejection_reason: str("rejection_reason"),
    followup: str("followup"),
    approved_at: str("approved_at"),
    created_at: String(r["created_at"] ?? ""),
  };
}

export async function loadApplications(): Promise<ApplicationRow[]> {
  const rs = await getDb().execute(
    `SELECT ${APP_COLUMNS} FROM affiliate_applications ORDER BY application_date ASC, id ASC`,
  );
  return rs.rows.map((r) => toRow(r as unknown as Record<string, unknown>));
}

export async function loadApplication(id: number): Promise<ApplicationRow | null> {
  const rs = await getDb().execute({
    sql: `SELECT ${APP_COLUMNS} FROM affiliate_applications WHERE id = ?`,
    args: [id],
  });
  const r = rs.rows[0];
  return r ? toRow(r as unknown as Record<string, unknown>) : null;
}

// ===========================================================================
// 申請順のゲート（★数で突破しない）
// ===========================================================================

export type OrderGate = {
  allowed: boolean;
  code:
    | "OK"
    | "BLANKET_APPLICATION"
    | "PENDING_EXISTS"
    | "REJECTION_REASON_MISSING"
    | "SAME_DAY_APPLICATION";
  message: string;
};

export async function checkApplicationOrder(
  affiliateNames: string[],
  applicationDate: string,
): Promise<OrderGate> {
  const names = affiliateNames.map((n) => n.trim()).filter(Boolean);
  if (names.length > 1) {
    return {
      allowed: false,
      code: "BLANKET_APPLICATION",
      message:
        `一括申請は拒否する（同時指定: ${names.join(" / ")}）。` +
        "同時に出すと、通った理由も落ちた理由も永久に分からなくなる。" +
        "「片っ端から申請して数で突破する」運用は禁止（MASTER_RULES 4-2）。1社ずつ申請すること",
    };
  }
  const target = names[0] ?? "";
  const rows = await loadApplications();

  const pending = rows.filter((r) => r.result === "PENDING");
  const firstPending = pending[0];
  if (firstPending) {
    const same = firstPending.affiliate_name === target;
    return {
      allowed: false,
      code: "PENDING_EXISTS",
      message:
        `#${firstPending.id} ${firstPending.affiliate_name}（${firstPending.application_date} 申請・${firstPending.profile_version}）が` +
        `まだ PENDING のため、${same ? "同じプログラムへの再申請" : `2社目（${target}）への申請`}を止める。` +
        "結果が出て4分類が確定するまで次へ進まない（申請学習.md 2章）",
    };
  }

  const resolved = rows.filter((r) => r.result !== "PENDING");
  const last = resolved[resolved.length - 1];
  if (last && last.result === "REJECT" && !(last.rejection_reason ?? "").trim()) {
    return {
      allowed: false,
      code: "REJECTION_REASON_MISSING",
      message:
        `#${last.id} ${last.affiliate_name} が REJECT だが rejection_reason が未記録。` +
        "拒否理由を保存してからプロフィール・媒体・申請文を直し、その後2社目へ進む。" +
        `理由を相手から取れなかった場合は、その事実を「${REASON_UNAVAILABLE}」として記録すること（推測を書かない）`,
    };
  }

  const sameDayOther = rows.find(
    (r) => r.application_date === applicationDate && r.affiliate_name !== target,
  );
  if (sameDayOther) {
    return {
      allowed: false,
      code: "SAME_DAY_APPLICATION",
      message:
        `同日（${applicationDate}）に ${sameDayOther.affiliate_name} を申請済み。` +
        "同日に複数ASPへ一括申請しない（申請学習.md 2章）",
    };
  }

  return { allowed: true, code: "OK", message: "申請順のルールを満たしている" };
}

// ===========================================================================
// 申請の記録（append-only）
// ===========================================================================

export function parseVersion(v: string): number | null {
  const m = /^v(\d+)$/i.exec(v.trim());
  return m?.[1] ? Number(m[1]) : null;
}

export function nextProfileVersion(rows: ApplicationRow[]): string {
  const max = rows.reduce((acc, r) => Math.max(acc, parseVersion(r.profile_version) ?? 0), 0);
  return `v${max + 1}`;
}

export type RecordApplicationInput = {
  affiliateName: string;
  profileVersion: string;
  applicationDate: string;
  snapshot: AccountSnapshot;
  applicationText: string;
  /** 13項目チェックの結果。READY 以外は受け付けない */
  preCheck: PreCheckReport;
};

export type RecordApplicationOutput = { id: number; row: ApplicationRow };

export async function recordApplication(
  input: RecordApplicationInput,
): Promise<RecordApplicationOutput> {
  if (!input.preCheck.ready) {
    throw new Error(
      `13項目チェックが NOT_READY のため申請を記録しない（未達: ${input.preCheck.blocking.map((b) => `${b.no}.${b.code}`).join(", ")}）`,
    );
  }
  const rows = await loadApplications();

  const n = parseVersion(input.profileVersion);
  if (n === null) {
    throw new Error(
      `profile_version は v1 / v2 の形式で指定する（受け取った値: ${input.profileVersion}）。学習の軸なので自由文字列にしない`,
    );
  }
  const maxAll = rows.reduce((acc, r) => Math.max(acc, parseVersion(r.profile_version) ?? 0), 0);
  if (n < maxAll) {
    throw new Error(
      `profile_version が過去へ戻っている（指定 v${n} / 既存の最大 v${maxAll}）。版は積み上げる`,
    );
  }
  const sameAffiliate = rows.filter((r) => r.affiliate_name === input.affiliateName);
  const prev = sameAffiliate[sameAffiliate.length - 1];
  if (prev) {
    const prevN = parseVersion(prev.profile_version) ?? 0;
    if (n <= prevN) {
      throw new Error(
        `${input.affiliateName} へは #${prev.id}（${prev.profile_version}）で申請済み。` +
          `修正して出し直すなら版を上げて新しい行を積む（v${prevN + 1} 以上を指定する）。既存行は上書きしない`,
      );
    }
  }

  const s = input.snapshot;
  const db = getDb();
  const createdAt = nowIso();
  const rs = await db.execute({
    sql: `INSERT INTO affiliate_applications
            (affiliate_name, application_date, profile_version,
             x_followers, x_impressions, account_age, post_count,
             website_available, domain, ai_disclosure, application_text,
             traffic_description, audience_description,
             result, rejection_reason, followup, approved_at, created_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,'PENDING',NULL,NULL,NULL,?)`,
    args: [
      input.affiliateName,
      input.applicationDate,
      input.profileVersion,
      s.followers ?? null,
      s.impressions ?? null,
      accountAgeDays(s.createdAt),
      input.preCheck.postCount,
      s.websiteAvailable ? 1 : 0,
      s.domain ?? null,
      s.aiDisclosure ?? null,
      input.applicationText,
      s.trafficDescription ?? null,
      s.audienceDescription ?? null,
      createdAt,
    ],
  });

  const id = Number(rs.lastInsertRowid ?? 0);
  await persistPreCheck(input.preCheck.items, id);
  await db.execute({
    sql: `INSERT INTO decisions (actor, input_json, output_json, reason, created_at) VALUES (?,?,?,?,?)`,
    args: [
      "applications.recordApplication",
      JSON.stringify({
        affiliate: input.affiliateName,
        version: input.profileVersion,
        date: input.applicationDate,
      }),
      JSON.stringify({ application_id: id, result: "PENDING" }),
      "13項目チェック全PASS・申請順ルール通過のため申請を記録した",
      createdAt,
    ],
  });
  await notify(
    "INFO",
    "APPLICATION_RECORDED",
    `申請#${id} ${input.affiliateName}（${input.profileVersion}）を記録。結果が出るまで次の1社へ進まない`,
  );

  const row = await loadApplication(id);
  if (!row) throw new Error("申請を記録したが読み戻せなかった");
  return { id, row };
}

// ===========================================================================
// 結果の記録（4分類）
// ===========================================================================

export type RecordOutcomeInput = {
  id: number;
  result: (typeof RESULT_CLASSES)[number];
  /** 相手の原文。取れなかった場合は reasonUnavailable を立てる */
  rejectionReason?: string;
  reasonUnavailable?: boolean;
  followup?: string;
  approvedAt?: string;
};

/** 一度確定した結果は塗り替えない。ただし返事が来なかった状態からの遷移だけは認める */
const OUTCOME_TRANSITIONS: Record<ApplicationResult, ApplicationResult[]> = {
  PENDING: ["PASS", "REJECT", "MORE_INFORMATION_REQUIRED", "NO_RESPONSE"],
  MORE_INFORMATION_REQUIRED: ["PASS", "REJECT", "NO_RESPONSE"],
  NO_RESPONSE: ["PASS", "REJECT", "MORE_INFORMATION_REQUIRED"],
  PASS: [],
  REJECT: [],
};

export async function recordOutcome(input: RecordOutcomeInput): Promise<ApplicationRow> {
  const row = await loadApplication(input.id);
  if (!row) throw new Error(`申請#${input.id} が無い`);

  const allowed = OUTCOME_TRANSITIONS[row.result] ?? [];
  if (!allowed.includes(input.result)) {
    throw new Error(
      `#${row.id} は既に ${row.result} で確定している。${input.result} へ塗り替えない。` +
        "条件を変えて出し直すなら、版を上げて新しい行を積むこと（affiliate_applications は上書き禁止）",
    );
  }

  let reason: string | null = row.rejection_reason;
  if (input.result === "REJECT") {
    const given = (input.rejectionReason ?? "").trim();
    if (given) reason = given;
    else if (input.reasonUnavailable) reason = REASON_UNAVAILABLE;
    else {
      throw new Error(
        "REJECT を記録するには相手の原文（--reason）が要る。" +
          `問い合わせても取れなかった場合は --reason-unavailable を付けて「${REASON_UNAVAILABLE}」と記録する。推測した理由は書かない`,
      );
    }
  } else if (input.reasonUnavailable || (input.rejectionReason ?? "").trim()) {
    throw new Error("rejection_reason は REJECT のときだけ記録する（NO_RESPONSE と混ぜない）");
  }

  const followup = (input.followup ?? "").trim() || row.followup;
  if (input.result === "MORE_INFORMATION_REQUIRED" && !followup) {
    throw new Error(
      "MORE_INFORMATION_REQUIRED は「求められた項目」を --followup で記録する。" +
        "審査の実際の関心事＝最も価値が高い情報なので、空のまま確定させない",
    );
  }

  const approvedAt =
    input.result === "PASS" ? (input.approvedAt ?? new Date().toISOString().slice(0, 10)) : row.approved_at;

  const db = getDb();
  await db.execute({
    sql: `UPDATE affiliate_applications
             SET result = ?, rejection_reason = ?, followup = ?, approved_at = ?
           WHERE id = ?`,
    args: [input.result, reason, followup, approvedAt, input.id],
  });
  await db.execute({
    sql: `INSERT INTO decisions (actor, input_json, output_json, reason, created_at) VALUES (?,?,?,?,?)`,
    args: [
      "applications.recordOutcome",
      JSON.stringify({ id: input.id, from: row.result }),
      JSON.stringify({ to: input.result, rejection_reason: reason, followup, approved_at: approvedAt }),
      "審査結果を4分類で記録した",
      nowIso(),
    ],
  });

  if (input.result === "REJECT" && isReasonUnavailable(reason)) {
    await notify(
      "WARN",
      "REJECTION_REASON_UNAVAILABLE",
      `申請#${input.id} ${row.affiliate_name} は拒否理由を取得できなかった。次の修正点を1つに絞れないので、変更は1箇所だけにする`,
    );
  }
  if (input.result === "NO_RESPONSE") {
    await notify(
      "WARN",
      "APPLICATION_NO_RESPONSE",
      `申請#${input.id} ${row.affiliate_name} は無反応。REJECT と混ぜない（届いていない/保留中/黙殺のどれか）。followup を1回だけ送って記録する`,
    );
  }

  const updated = await loadApplication(input.id);
  if (!updated) throw new Error("結果を記録したが読み戻せなかった");
  return updated;
}

// ===========================================================================
// 学習分析（何を変えたら承認率が上がったか）
// ===========================================================================

/** こちらが意図して変える項目。ここが1申請で2つ以上動くと何が効いたか分からなくなる */
export const CONTROLLED_FIELDS = [
  "website_available",
  "domain",
  "ai_disclosure",
  "application_text",
  "traffic_description",
  "audience_description",
] as const;

/** 放っておいても動く項目。変更点として数えないが、交絡としては記録する */
export const CONTEXT_FIELDS = [
  "x_followers",
  "x_impressions",
  "account_age",
  "post_count",
] as const;

export const FIELD_LABEL: Record<string, string> = {
  website_available: "自社サイト提示",
  domain: "ドメイン",
  ai_disclosure: "AI開示の文面",
  application_text: "申請文",
  traffic_description: "集客経路の説明",
  audience_description: "読者層の説明",
  x_followers: "フォロワー数",
  x_impressions: "累計インプレッション",
  account_age: "運用日数",
  post_count: "投稿数",
};

export type FieldChange = { field: string; label: string; before: string; after: string };

export type Transition = {
  from: ApplicationRow;
  to: ApplicationRow;
  versionChanged: boolean;
  changed: FieldChange[];
  contextDrift: FieldChange[];
  attributable: boolean;
  note: string;
};

export type LearningReport = {
  rows: ApplicationRow[];
  totals: Record<ApplicationResult, number>;
  judged: number;
  approvalRate: number | null;
  transitions: Transition[];
  requestedItems: string[];
  decision: "CONTINUE" | "WINNING_PATTERN";
  reason: string;
  warnings: string[];
};

function fieldValue(row: ApplicationRow, field: string): string {
  const v = (row as unknown as Record<string, unknown>)[field];
  if (v === null || v === undefined) return "（未記録）";
  if (field === "website_available") return Number(v) === 1 ? "あり" : "なし";
  return String(v);
}

export async function analyzeApprovalLearning(): Promise<LearningReport> {
  const rows = await loadApplications();

  const totals: Record<ApplicationResult, number> = {
    PENDING: 0,
    PASS: 0,
    REJECT: 0,
    MORE_INFORMATION_REQUIRED: 0,
    NO_RESPONSE: 0,
  };
  for (const r of rows) totals[r.result] += 1;

  // NO_RESPONSE は審査されたのかどうかすら分からない。承認率の分母に入れない
  const judged = totals.PASS + totals.REJECT;
  const approvalRate = judged > 0 ? totals.PASS / judged : null;

  const transitions: Transition[] = [];
  for (let i = 1; i < rows.length; i++) {
    const from = rows[i - 1];
    const to = rows[i];
    if (!from || !to) continue;
    const changed: FieldChange[] = [];
    for (const f of CONTROLLED_FIELDS) {
      const b = fieldValue(from, f);
      const a = fieldValue(to, f);
      if (b !== a) changed.push({ field: f, label: FIELD_LABEL[f] ?? f, before: b, after: a });
    }
    const contextDrift: FieldChange[] = [];
    for (const f of CONTEXT_FIELDS) {
      const b = fieldValue(from, f);
      const a = fieldValue(to, f);
      if (b !== a) contextDrift.push({ field: f, label: FIELD_LABEL[f] ?? f, before: b, after: a });
    }
    const versionChanged = from.profile_version !== to.profile_version;
    const attributable = changed.length <= 1;
    const note =
      changed.length === 0
        ? "変更なし（同じ条件で別プログラムへ申請）"
        : changed.length === 1
          ? "変更1箇所。効いたかどうかを問える"
          : `変更${changed.length}箇所。どれが効いたか分けられない`;
    transitions.push({ from, to, versionChanged, changed, contextDrift, attributable, note });
  }

  const requestedItems = rows
    .filter((r) => r.result === "MORE_INFORMATION_REQUIRED" && (r.followup ?? "").trim())
    .map((r) => `#${r.id} ${r.affiliate_name}: ${r.followup}`);

  const warnings: string[] = [];
  for (const t of transitions) {
    if (!t.attributable) {
      warnings.push(
        `#${t.from.id}(${t.from.profile_version}) → #${t.to.id}(${t.to.profile_version}) で` +
          `${t.changed.length}箇所を同時に変えている（${t.changed.map((c) => c.label).join(" / ")}）。` +
          "どれが効いたかを機械では分けられない。1回の申請で変えるのは1箇所",
      );
    }
    if (t.changed.length > 0 && !t.versionChanged) {
      warnings.push(
        `#${t.to.id} は内容を変えているのに profile_version が ${t.to.profile_version} のまま。版を上げないと学習の軸が壊れる`,
      );
    }
  }
  for (const r of rows) {
    if (r.result === "REJECT" && isReasonUnavailable(r.rejection_reason)) {
      warnings.push(`#${r.id} ${r.affiliate_name} は拒否理由が取得できていない（推測は書かない）`);
    }
  }
  if (totals.NO_RESPONSE > 0) {
    warnings.push(
      `NO_RESPONSE が${totals.NO_RESPONSE}件ある。REJECT と混ぜない（届いていない/保留中/黙殺のどれかで原因が違う）`,
    );
  }

  let decision: "CONTINUE" | "WINNING_PATTERN" = "CONTINUE";
  let reason: string;
  if (rows.length < MIN_APPLICATIONS_FOR_VERDICT) {
    reason =
      `申請${rows.length}件。最低サンプル${MIN_APPLICATIONS_FOR_VERDICT}件に満たないので` +
      "「この書き方が正解」とは書かない（申請学習.md 3章）";
  } else if (totals.PASS === 0) {
    reason = `申請${rows.length}件だが PASS が0件。勝ちパターンを名指しできない`;
  } else if (warnings.some((w) => w.includes("同時に変えている"))) {
    reason =
      `申請${rows.length}件・PASS ${totals.PASS}件だが、1回の申請で複数箇所を変えた区間がある。` +
      "承認の原因を1つに帰属できないので勝ちパターンとして確定しない";
  } else {
    decision = "WINNING_PATTERN";
    const passed = rows.filter((r) => r.result === "PASS");
    reason =
      `申請${rows.length}件・PASS ${totals.PASS}件（承認率 ${(approvalRate! * 100).toFixed(0)}%・分母は PASS+REJECT の${judged}件）。` +
      `版ごとの変更が1箇所ずつなので、${passed.map((p) => `${p.profile_version}(${p.affiliate_name})`).join(" / ")} を勝ちパターンの候補として扱える`;
  }

  return {
    rows,
    totals,
    judged,
    approvalRate,
    transitions,
    requestedItems,
    decision,
    reason,
    warnings,
  };
}
