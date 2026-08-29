import { extractCity, extractPrefecture, hostOf, isOwnSiteUrl, normalizeAddress, normalizeCompanyName, normalizePhone, normalizeText } from '../text';

/**
 * 「このホームページは、本当にこの会社のものか」を機械で確かめる。
 *
 * ★ここは事故が起きたときの被害が一番大きい場所。
 *   別会社のHPを掴んだまま営業文を書くと、
 *   「御社の○○事業を拝見しました」と、まったく関係のない会社の話を送ることになる。
 *   相手からすれば、調べもせずに送った営業と同じ。取り返しがつかない。
 *   なので「たぶん合っている」では通さない。
 *
 * ★通す条件は3つのどれか。
 *   ① ページの中にその会社の法人番号（13桁）が書いてある → それだけで確定
 *   ② 会社名・電話番号・住所・代表者名のうち、2種類以上が一致し、合計点が基準を超える
 *   ③ 国が法人番号にひも付けて公開しているHP（gBizINFO）である
 *   これ以外は「分からない」とし、HPとして採用しない。空欄のまま残す。
 *
 * ★「違う」と分かる材料が1つでもあれば、点数がいくら高くても不採用にする。
 *   例：ページに別の法人番号が載っている。
 *
 * ★ここは通信をしない。渡された文字列だけで判定する。
 *   そうしておくと、ネットにつながっていなくてもテストで判定の正しさを確かめられる。
 */

export type IdentityVerdict = 'MATCH' | 'MISMATCH' | 'UNKNOWN';

export type IdentityEvidenceKind = 'CORPORATE_NUMBER' | 'NAME' | 'NAME_TITLE' | 'PHONE' | 'ADDRESS' | 'REPRESENTATIVE';

export type IdentityEvidence = {
  kind: IdentityEvidenceKind;
  weight: number;
  detail: string;
};

/**
 * 「社名が書いてある」以外の決め手。
 * ★日本には同じ社名の別会社がいくつもある（「株式会社さくら建設」は全国にある）。
 *   社名が合っただけで採用すると、隣の県の同名会社のHPを掴む。
 *   だから、この4つのうち最低1つが一致していないと採用しない。
 */
const HARD_KINDS: IdentityEvidenceKind[] = ['CORPORATE_NUMBER', 'PHONE', 'ADDRESS', 'REPRESENTATIVE'];

const KIND_JA: Record<IdentityEvidenceKind, string> = {
  CORPORATE_NUMBER: '法人番号',
  NAME: '会社名',
  NAME_TITLE: 'ページの題名',
  PHONE: '電話番号',
  ADDRESS: '所在地',
  REPRESENTATIVE: '代表者名',
};

export type IdentityResult = {
  verdict: IdentityVerdict;
  score: number;
  /** 一致した材料。承認画面と記録にそのまま出す。 */
  evidence: IdentityEvidence[];
  /** 「違う」と分かった材料。1つでもあれば不採用。 */
  conflicts: string[];
  /** 人が読んで分かる一言。 */
  reason: string;
};

export type IdentityCompany = {
  name: string;
  corporateNumber?: string | null;
  address?: string | null;
  phone?: string | null;
  representative?: string | null;
};

export type IdentityPage = {
  url: string;
  title?: string | null;
  /** HTMLをただの文章にしたもの。 */
  text: string;
};

/** 採用するのに必要な合計点。会社名(50)だけでは届かないようにしてある。 */
export const IDENTITY_PASS_SCORE = 60;
/** 採用するのに必要な材料の種類数。1種類だけでは通さない。 */
export const IDENTITY_MIN_KINDS = 2;

/**
 * 文章の中の13桁の数字を法人番号の候補として拾う。
 * 前後に数字が続くもの（口座番号の一部など）は拾わない。
 */
export function corporateNumbersIn(text: string): string[] {
  const flat = String(text ?? '')
    .normalize('NFKC')
    .replace(/[\s\-‐-―−ー.]/g, '');
  const out = new Set<string>();
  for (const m of flat.matchAll(/(?<![0-9])[0-9]{13}(?![0-9])/g)) out.add(m[0]);
  return [...out];
}

/** 数字だけにした文章。電話番号の一致を見るのに使う。 */
function digitsOf(text: string): string {
  return String(text ?? '')
    .normalize('NFKC')
    .replace(/[^0-9]/g, '');
}

/** ページのどこかに法人格つきの社名が書いてあるか（別会社の名前が主役になっていないかを見る）。 */
export function legalNamesIn(text: string): string[] {
  const t = String(text ?? '').normalize('NFKC');
  const out = new Set<string>();
  const re = /(株式会社|有限会社|合同会社|合資会社|合名会社)\s*([^\s、。／/|｜:：\-–—【】\[\]（）()"'`]{1,20})|([^\s、。／/|｜:：\-–—【】\[\]（）()"'`]{1,20})\s*(株式会社|有限会社|合同会社|合資会社|合名会社)/g;
  for (const m of t.matchAll(re)) {
    const core = (m[2] ?? m[3] ?? '').trim();
    if (core.length >= 2) out.add(normalizeCompanyName(core));
  }
  return [...out].filter(Boolean);
}

/**
 * 会社と、あるページが同じ会社のものかを判定する。
 * 通信はしない。判定に使った材料はすべて返し、あとから人が確かめられるようにする。
 */
export function verifyWebsiteIdentity(company: IdentityCompany, page: IdentityPage): IdentityResult {
  const evidence: IdentityEvidence[] = [];
  const conflicts: string[] = [];

  // その会社が書いた文章ではないサイト（求人・プレスリリース・SNS・地図）は、そもそも見ない。
  if (!isOwnSiteUrl(page.url)) {
    return {
      verdict: 'MISMATCH',
      score: 0,
      evidence: [],
      conflicts: [`会社自身のサイトではない場所（${hostOf(page.url) ?? page.url}）`],
      reason: '求人サイトやプレスリリースは、その会社が書いた文章ではないのでHPとして扱わない。',
    };
  }

  const body = `${page.title ?? ''}\n${page.text ?? ''}`;
  if (normalizeText(body).replace(/\s/g, '').length < 30) {
    return {
      verdict: 'UNKNOWN',
      score: 0,
      evidence: [],
      conflicts: [],
      reason: 'ページの中身がほとんど読めなかったので、同じ会社かどうか判断できない。',
    };
  }

  // ── ① 法人番号。あれば一発で決まる。 ───────────────────────────
  const own = (company.corporateNumber ?? '').replace(/[^0-9]/g, '');
  const found = corporateNumbersIn(body);
  if (own.length === 13) {
    if (found.includes(own)) {
      evidence.push({ kind: 'CORPORATE_NUMBER', weight: 100, detail: `ページに法人番号（${own}）が書かれている` });
    } else if (found.length > 0) {
      conflicts.push(`ページに別の法人番号（${found[0]}）が書かれている`);
    }
  }

  // ── ② 会社名 ─────────────────────────────────────────
  const nName = normalizeCompanyName(company.name);
  const nBody = normalizeCompanyName(body);
  const nameHit = nName.length >= 2 && nBody.includes(nName);
  if (nameHit) {
    evidence.push({ kind: 'NAME', weight: nName.length >= 4 ? 50 : 35, detail: `ページに会社名（${company.name}）が書かれている` });
    // ページの題名で名乗っているかは、本文のどこかに出てくるのとは別の材料として数える。
    // 題名はそのサイトの持ち主の自己申告なので、他社を紹介しているだけの文中の言及より強い。
    if (nName.length >= 2 && normalizeCompanyName(page.title ?? '').includes(nName)) {
      evidence.push({ kind: 'NAME_TITLE', weight: 45, detail: `ページの題名が「${page.title}」で、その会社を名乗っている` });
    }
  } else {
    const others = legalNamesIn(body).filter((n) => n.length >= 2 && n !== nName);
    if (others.length > 0) {
      conflicts.push(`ページに載っている社名が違う（${others.slice(0, 2).join('／')}）`);
    }
  }

  // ── ③ 電話番号 ────────────────────────────────────────
  const phone = normalizePhone(company.phone).value;
  if (phone && digitsOf(body).includes(phone)) {
    evidence.push({ kind: 'PHONE', weight: 40, detail: `ページに同じ電話番号（${phone}）が書かれている` });
  }

  // ── ④ 住所 ──────────────────────────────────────────
  const addr = normalizeAddress(company.address ?? '');
  const nBodyAddr = normalizeAddress(body);
  if (addr.length >= 10 && nBodyAddr.includes(addr)) {
    evidence.push({ kind: 'ADDRESS', weight: 40, detail: '所在地がそのまま書かれている' });
  } else {
    const pref = extractPrefecture(company.address);
    const city = extractCity(company.address);
    if (pref && city && nBodyAddr.includes(normalizeAddress(`${pref}${city}`))) {
      evidence.push({ kind: 'ADDRESS', weight: 25, detail: `所在地の市区町村まで一致（${pref}${city}）` });
    }
  }

  // ── ⑤ 代表者名 ────────────────────────────────────────
  const rep = String(company.representative ?? '').replace(/[\s　]/g, '');
  if (rep.length >= 3 && normalizeText(body).replace(/\s/g, '').includes(normalizeText(rep))) {
    evidence.push({ kind: 'REPRESENTATIVE', weight: 25, detail: `代表者名（${company.representative}）が一致` });
  }

  const score = evidence.reduce((a, e) => a + e.weight, 0);
  const kinds = new Set(evidence.map((e) => e.kind)).size;

  if (conflicts.length > 0) {
    return { verdict: 'MISMATCH', score, evidence, conflicts, reason: `別の会社のページの可能性がある：${conflicts[0]}` };
  }
  if (evidence.some((e) => e.kind === 'CORPORATE_NUMBER')) {
    return { verdict: 'MATCH', score, evidence, conflicts, reason: '法人番号が一致したので、同じ会社と確認できた。' };
  }
  // ★社名以外の決め手が1つも無ければ、点数がいくら高くても採用しない。
  //   同じ社名の別会社を掴む事故は、これでしか止められない。
  const hasHard = evidence.some((e) => HARD_KINDS.includes(e.kind));
  if (score >= IDENTITY_PASS_SCORE && kinds >= IDENTITY_MIN_KINDS && hasHard) {
    return { verdict: 'MATCH', score, evidence, conflicts, reason: evidence.map((e) => e.detail).join('／') };
  }
  return {
    verdict: 'UNKNOWN',
    score,
    evidence,
    conflicts,
    reason:
      evidence.length === 0
        ? '会社名・電話・住所・法人番号のどれも一致しなかったので、同じ会社か判断できない。'
        : !hasHard
          ? '社名は合っているが、法人番号・電話番号・所在地・代表者名がどれも確かめられなかった。同じ社名の別会社かもしれないので採用しない。'
          : `一致したのは${evidence.map((e) => KIND_JA[e.kind]).join('と')}だけで、決め手が足りない。`,
  };
}

/**
 * 「国が法人番号にひも付けて公開しているHP」だけは、中身を読まなくても本人のものとして扱える。
 * それ以外の取得元（Google Places など）は必ず中身を読んで確かめる。
 */
export function trustedByRegistry(source: string, corporateNumber: string | null | undefined): boolean {
  return source === 'GBIZINFO' && String(corporateNumber ?? '').replace(/[^0-9]/g, '').length === 13;
}
