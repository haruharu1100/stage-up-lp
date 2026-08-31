/**
 * 「これは、もう入っている案件と同じ依頼か」を見分ける。
 *
 * ★なぜURLだけでは足りないか。
 *   同じ依頼主が、同じ募集をランサーズとクラウドワークスの両方に出す。
 *   その2件はURLが違う。サイト内IDも違う。本文も、サイトごとの体裁で少し違う。
 *   URLだけで見分けると「別の依頼が2件ある」と数えてしまい、
 *   同じ相手に同じ内容の応募を2通出すことになる。相手からは連投にしか見えない。
 *
 * ★さらに、同じ案件が「新着通知メール」と「人が貼った本文」の両方から入ることがある。
 *   メール本文はサイトの本文を抜粋したものなので、文字数も体裁も違う。
 *   だから「文字列が完全に同じか」ではなく「どれくらい似ているか」で見る必要がある。
 *
 * ★判定はここに集める。AIは使わない。
 *   AIに「同じ依頼ですか」と聞くと、同じ2件でも日によって答えが変わる。
 *   応募するかどうかが日によって変わるのは、あとから原因を追えない。
 *   だから決まった計算だけで判定し、根拠の数字をそのまま残す。
 *
 * ★迷ったときは「同じではない」と言わない。
 *   同じ依頼を別物として2件応募するほうが、別の依頼を同じだと決めつけて
 *   1件を捨てるより取り返しがつかない……のではなく、逆である。
 *   応募を2通出すのは相手に届いてしまうが、1件を保留にしただけなら人が見て戻せる。
 *   だから「似ている」と判断したら重複側へ寄せ、根拠を必ず残して人が覆せるようにする。
 */
import { all } from '../db/client';
import { normalizeText, similarity } from '../text';

/** これ以上ならタイトルだけで同じ依頼とみなす。 */
export const TITLE_SAME = 0.85;
/** タイトルがここまで似ていて、かつ本文も似ていれば同じ依頼とみなす。 */
export const TITLE_NEAR = 0.55;
export const BODY_NEAR = 0.6;

export type DupeCandidate = {
  id: number;
  title: string;
  description: string;
  url: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  siteCode: string;
};

export type DupeInput = {
  title: string;
  description: string;
  url: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
};

export type DupeVerdict = {
  duplicateOf: number | null;
  /** 人がそのまま読める根拠。重複でないときは空文字。 */
  reasonJa: string;
  /** 参考に出す数字。判定を人が覆せるようにする。 */
  titleSim: number;
  bodySim: number;
};

/**
 * URLから「同じページを指しているか」を見るための形にする。
 * ★クエリと末尾スラッシュとwwwを落とす。
 *   同じ案件ページでも、メールに載るURLには必ず追跡用のクエリ（utm_source等）が付く。
 *   これを落とさないと、同じページが毎回ちがうURLに見える。
 */
export function canonicalUrl(url: string | null | undefined): string | null {
  const s = String(url ?? '').trim();
  if (s === '') return null;
  try {
    const u = new URL(s);
    const host = u.hostname.toLowerCase().replace(/^www\./, '');
    const path = u.pathname.replace(/\/+$/, '');
    return `${host}${path}`;
  } catch {
    return null;
  }
}

/**
 * 予算がぶつかっていないか。
 * ★どちらかが「書いていない」ときは、ぶつかったと言わない。
 *   書いていない予算を「0円」と読み替えて別案件だと決めつけると、
 *   金額欄が空のメール通知が、常に別案件として増え続ける。
 */
export function budgetConflicts(a: DupeInput, b: DupeCandidate): boolean {
  const aMin = a.budgetMin;
  const bMin = b.budgetMin;
  if (aMin === null || bMin === null) return false;
  if (aMin === bMin) return false;
  // 2倍以上ちがえば別の依頼と見る。1割程度の差は同じ依頼の書き方のちがいとして許す。
  const hi = Math.max(aMin, bMin);
  const lo = Math.min(aMin, bMin);
  return hi >= lo * 2;
}

/** タイトルから、サイトが付ける飾りを落とす。「【新着】」「[急募]」など。 */
export function stripTitleDecor(title: string): string {
  return normalizeText(title)
    .replace(/[【\[［(（][^】\]］)）]{0,12}[】\]］)）]/g, ' ')
    .replace(/(新着|急募|募集中|再募集|継続|大募集|至急|pr|募集)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** 本文から、比較の邪魔になるものを落とす（URL・記号・メールの定型文）。 */
export function stripBodyNoise(body: string): string {
  return normalizeText(body)
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/(このメールは|配信停止|登録内容の変更|お問い合わせは|自動配信|返信いただいてもお答えできません)[^\n]*/g, ' ')
    .replace(/[■□▼▲◆◇★☆・\-=_*＊|｜]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * 1件が、既にある案件のどれかと同じ依頼かを判定する。
 *
 * ★見る順番。
 *   ① 案件ページのURLが同じ            → 同じ依頼（いちばん確か）
 *   ② 件名がほぼ同じ                   → 同じ依頼
 *   ③ 件名がそこそこ似ていて本文も似ている → 同じ依頼
 *   どれにも当たらなければ別の依頼。
 * ★②③でも、予算が2倍以上ちがえば同じ依頼とは言わない。
 *   「LP制作」という同じ件名で、3万円の案件と30万円の案件は別の依頼。
 */
export function judgeDuplicate(input: DupeInput, candidates: DupeCandidate[]): DupeVerdict {
  const myUrl = canonicalUrl(input.url);
  const myTitle = stripTitleDecor(input.title);
  const myBody = stripBodyNoise(input.description);

  let best: DupeVerdict = { duplicateOf: null, reasonJa: '', titleSim: 0, bodySim: 0 };

  for (const c of candidates) {
    const cUrl = canonicalUrl(c.url);
    if (myUrl !== null && cUrl !== null && myUrl === cUrl) {
      return { duplicateOf: c.id, reasonJa: `案件ページのURLが同じ（${myUrl}）。`, titleSim: 1, bodySim: 1 };
    }

    const titleSim = similarity(myTitle, stripTitleDecor(c.title));
    const bodySim = similarity(myBody, stripBodyNoise(c.description));
    if (budgetConflicts(input, c)) continue;

    let hit: string | null = null;
    if (titleSim >= TITLE_SAME) {
      hit = `件名がほぼ同じ（一致度 ${(titleSim * 100).toFixed(0)}%）。サイトは${c.siteCode}。`;
    } else if (titleSim >= TITLE_NEAR && bodySim >= BODY_NEAR) {
      hit = `件名（${(titleSim * 100).toFixed(0)}%）と本文（${(bodySim * 100).toFixed(0)}%）が似ている。サイトは${c.siteCode}。`;
    }
    if (hit && (best.duplicateOf === null || titleSim + bodySim > best.titleSim + best.bodySim)) {
      best = { duplicateOf: c.id, reasonJa: hit, titleSim, bodySim };
    }
  }
  return best;
}

/**
 * DBに入っている案件と突き合わせる。
 *
 * ★突き合わせる相手は「本家（duplicate_of が空）の案件」だけにする。
 *   重複と判定済みの行まで相手にすると、重複の重複ができて連鎖が伸び、
 *   どれが本家なのか誰にも分からなくなる。
 * ★自分自身は相手にしない（取り込み直しのときに自分と重複扱いになるため）。
 */
export async function findDuplicate(input: DupeInput, selfId: number | null): Promise<DupeVerdict> {
  const rows = await all(
    `SELECT id, title, description, url, budget_min, budget_max, site_code
       FROM jobs
      WHERE duplicate_of IS NULL ${selfId === null ? '' : 'AND id <> ?'}
      ORDER BY id`,
    selfId === null ? [] : [selfId],
  );
  const candidates: DupeCandidate[] = rows.map((r) => ({
    id: Number(r.id),
    title: String(r.title),
    description: String(r.description),
    url: r.url === null || r.url === undefined ? null : String(r.url),
    budgetMin: r.budget_min === null || r.budget_min === undefined ? null : Number(r.budget_min),
    budgetMax: r.budget_max === null || r.budget_max === undefined ? null : Number(r.budget_max),
    siteCode: String(r.site_code),
  }));
  return judgeDuplicate(input, candidates);
}
