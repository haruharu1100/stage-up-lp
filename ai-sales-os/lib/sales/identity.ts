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

/**
 * 会社ごとの「HPの状態」。判定結果（MATCH/MISMATCH/UNKNOWN）とは別に、
 * 「そもそもHPが無い」「たぶん本人だが決め手が足りない」を分けて持つ。
 *
 *  VERIFIED    … その会社のHPだと確認できた。営業文の事実根拠に使ってよい。
 *  PROBABLE    … たぶん本人。ただし決め手が足りない。人が見て決める。
 *  UNVERIFIED  … 候補はあるが、本人かどうか何も確かめられていない。
 *  CONFLICT    … 別の会社のHPである材料が出た。完全に使わない。
 *  NO_WEBSITE  … HPの候補すら見つからなかった。
 *
 * ★VERIFIED以外のHPから取った話を、営業文の事実として書かない。
 * ★社名が一致しただけでは絶対にVERIFIEDにしない（同名の別会社が全国にいる）。
 */
export const WEBSITE_VERDICTS = ['VERIFIED', 'PROBABLE', 'UNVERIFIED', 'CONFLICT', 'NO_WEBSITE'] as const;
export type WebsiteVerdict = (typeof WEBSITE_VERDICTS)[number];

export const WEBSITE_VERDICT_JA: Record<WebsiteVerdict, string> = {
  VERIFIED: '本人と確認できた',
  PROBABLE: 'たぶん本人（人の確認待ち）',
  UNVERIFIED: '確かめていない',
  CONFLICT: '別会社の可能性あり（使わない）',
  NO_WEBSITE: 'HPが見つからない',
};

/** PROBABLE と言ってよい下限。ここに届かないものは UNVERIFIED のまま。 */
export const IDENTITY_PROBABLE_SCORE = 45;

/**
 * 判定結果を5段階へ落とす。
 *
 * ★VERIFIED になるのは次のどちらかだけ。
 *   ① ページにその会社の法人番号が書いてある
 *   ② 法人番号・電話・住所・代表者名のうち1つ以上を含む2種類以上が一致し、合計60点以上
 *   これは verifyWebsiteIdentity が MATCH を返す条件と同じ。
 *
 * ★PROBABLE は「社名は合っているが決め手が無い」状態。ここは人が見る。
 *   自動で営業文の根拠にはしない。
 */
export function toWebsiteVerdict(result: IdentityResult | null, hasCandidate: boolean): WebsiteVerdict {
  if (!hasCandidate) return 'NO_WEBSITE';
  if (!result) return 'UNVERIFIED';
  if (result.verdict === 'MISMATCH' || result.conflicts.length > 0) return 'CONFLICT';
  if (result.verdict === 'MATCH') return 'VERIFIED';
  // 社名だけ当たっている、住所の市区町村までしか当たっていない、などはここ。
  if (result.evidence.length > 0 && result.score >= IDENTITY_PROBABLE_SCORE) return 'PROBABLE';
  return 'UNVERIFIED';
}

/** その判定のHPを、営業文の「事実」として使ってよいか。 */
export function canUseAsFact(verdict: WebsiteVerdict): boolean {
  return verdict === 'VERIFIED';
}

/** そのHPと同じドメインの連絡先（メール・フォーム）を使ってよいか。 */
export function canUseSameDomainContact(verdict: WebsiteVerdict): { ok: boolean; reason: string } {
  if (verdict === 'CONFLICT') {
    return { ok: false, reason: 'HPが別会社の可能性ありと判定されたので、同じドメインのメール・フォームも使わない。' };
  }
  if (verdict === 'VERIFIED') return { ok: true, reason: '' };
  return { ok: false, reason: `HPが「${WEBSITE_VERDICT_JA[verdict]}」なので、そこから取った連絡先は自動では使わない。` };
}

/** 人が見て決める必要があるか。 */
export function needsHumanCheck(verdict: WebsiteVerdict): boolean {
  return verdict === 'PROBABLE';
}

/**
 * その会社を「自動で営業してよい相手」に上げてよいか。
 *
 * ★連絡先が正しいことと、相手が本人であることは別の話。
 *   電話番号は人が台帳から書き写した正しい番号かもしれない。
 *   だが、その番号が「こちらが調べたつもりの会社」のものだと確かめられていなければ、
 *   別の会社に営業電話をかけている可能性が残る。
 *   番号の正しさは、相手が誰かを保証しない。
 *
 * ★だから VERIFIED（本人と確認できた）だけを通す。
 *   PROBABLE も UNVERIFIED も NO_WEBSITE も通さない。
 *   「たぶん本人」で電話をかけて別会社だった場合、謝って済む話ではないし、
 *   何件それをやったかも後から数えられない。
 *
 * ★通らなかった会社を消すわけではない。人が確認すれば通る。
 *   だから理由には「何をすれば通るか」を必ず書く。
 */
export function canAutoOutreachByIdentity(verdict: WebsiteVerdict): { ok: boolean; reasonJa: string } {
  if (verdict === 'VERIFIED') {
    return { ok: true, reasonJa: 'その会社本人のHPだと確認できている（連絡先と会社が一致している）。' };
  }
  if (verdict === 'CONFLICT') {
    return {
      ok: false,
      reasonJa:
        '別会社のHPである材料が出ている。連絡先が正しく見えても、別の会社へ営業する危険があるので自動営業候補には上げない。',
    };
  }
  if (verdict === 'PROBABLE') {
    return {
      ok: false,
      reasonJa:
        'HPは「たぶん本人」止まりで、本人だと決められていない。電話番号が正しくても相手が誰かは保証されないので、人がHPを確認するまで自動営業候補には上げない。',
    };
  }
  if (verdict === 'NO_WEBSITE') {
    return {
      ok: false,
      reasonJa:
        'HPが見つかっておらず、連絡先とこの会社が同じ相手だと確かめる材料が1つも無い。人が公式HPを登録するまで自動営業候補には上げない。',
    };
  }
  return {
    ok: false,
    reasonJa:
      'HPが本人のものか確かめていない。電話番号が正しくても、それがこの会社の番号だという確認にはならないので自動営業候補には上げない。',
  };
}

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
 * そのページは「企業紹介サイト（名鑑・ポータル）の1ページ」ではないか。
 *
 * ★これを見ないと、実際に事故が起きる。
 *   例：新泉工業株式会社に対して kensetumap.com/company/373596/profile.php を
 *   「公式HP」として採用してしまった。そのページには社名も電話も住所も正しく載っているので、
 *   社名・電話・住所の照合はすべて通ってしまう。だが、そこはその会社が書いたページではない。
 *   ここを公式HPとして扱うと、
 *     ・「御社の公式サイトを拝見しました」が嘘になる
 *     ・そのページにある問い合わせフォームは紹介サイト宛てで、その会社には届かない
 *   という2つの事故が同時に起きる。
 *
 * ★禁止ホストを並べるだけでは足りない。名鑑サイトは無数にあり、数え上げられない。
 *   なので「形」で見る。名鑑サイトは、1社ごとに連番のページを持ち、
 *   1ページの中に他社の名前や「掲載」「登録」「一覧」といった言葉が並ぶ。
 */
export function looksLikeDirectoryPage(page: IdentityPage, companyName: string): string | null {
  let path = '';
  try {
    path = new URL(page.url).pathname;
  } catch {
    return null;
  }

  // ① 1社ごとに連番が振られたURL。自社のHPが自分を番号で呼ぶことはまずない。
  //
  // ★これは「必須の条件」にしてある。言葉づかいだけで判断すると誤って弾く。
  //   実際、株式会社サン・エフ・アクセスの自社サイト（/company.html）を
  //   「他社名が10社ぶん並ぶ／掲載という語がある」だけで名鑑と誤判定してしまった。
  //   取引先一覧を載せている会社のHPは、どれもこの形になる。
  //   会社のHPを1件失うのも事故なので、連番URLという動かない証拠がある時だけ疑う。
  const numbered = /\/(company|companies|corp|corporate|kigyo|kaisha|shop|store|detail|profile|list)\/\d{3,}(\/|$)/i.test(path);
  if (!numbered) return null;

  const body = `${page.title ?? ''}\n${page.text ?? ''}`.normalize('NFKC');

  // ② 自分以外の会社名がページの中に何社ぶん並んでいるか。
  const self = normalizeCompanyName(companyName);
  const others = legalNamesIn(body).filter((n) => n !== self && !self.includes(n) && !n.includes(self));

  // ③ 名鑑サイトに特有の言い回し。
  const directoryWords = [
    /掲載(企業|会社|件数|数|依頼|停止)/,
    /(企業|会社|建設会社|工務店)(を)?(検索|探す|一覧)/,
    /この(企業|会社)(に|へ)(お問い合わせ|問い合わせ)/,
    /無料(で)?(掲載|登録)/,
    /(運営会社|情報提供)：/,
    /会員登録(は)?(無料|こちら)/,
  ].filter((re) => re.test(body)).length;

  const hits: string[] = [];
  if (numbered) hits.push('URLが1社ごとの連番になっている');
  if (others.length >= 3) hits.push(`同じページに他社の名前が${others.length}社ぶん並んでいる`);
  if (directoryWords >= 1) hits.push('「掲載」「企業を検索」など名鑑サイトの言い回しがある');

  // 決め手は1つでは弱い。2つ以上そろったときだけ名鑑と判断する。
  if (hits.length >= 2) return hits.join('／');
  return null;
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

  // 企業名鑑・ポータルの1ページは、社名も電話も住所も正しく載っているので照合を通ってしまう。
  // だが「その会社が書いたページ」ではないので、公式HPとしては採用しない。
  // ★別会社ではないので MISMATCH（別会社）とは言わない。UNKNOWN（本人のページか確認できない）に留める。
  const directory = looksLikeDirectoryPage(page, company.name);
  if (directory) {
    return {
      verdict: 'UNKNOWN',
      score: 0,
      evidence: [],
      conflicts: [],
      reason: `企業紹介サイトの1ページに見えるので、その会社が書いたHPとしては使わない（${directory}）。`,
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
