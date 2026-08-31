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

/**
 * 重複の判定は3段階。
 *
 *   EXACT_DUPLICATE  … はっきり同じ依頼。束ねて、こちらは進めない。
 *   LIKELY_DUPLICATE … たぶん同じ依頼。だが確信は無い。★束ねて捨てるのではなく、人が読む。
 *   UNIQUE           … 別の依頼。
 *
 * ★なぜ「たぶん同じ」を機械で束ねないか。
 *   束ねた案件は、この先の解析も応募文づくりも走らない。画面にもほぼ出ない。
 *   つまり「たぶん」で束ねると、本物の別案件が黙って消える。
 *   一方、人が読む扱い（HOLD）にしておけば、二重応募は起きないまま、案件は残る。
 *   ★「たぶん」で消すより、「たぶん」で残して人に見せるほうが、取り返しがつく。
 */
export type DupeLevel = 'EXACT_DUPLICATE' | 'LIKELY_DUPLICATE' | 'UNIQUE';

export const DUPE_LEVEL_JA: Record<DupeLevel, string> = {
  EXACT_DUPLICATE: 'はっきり同じ依頼',
  LIKELY_DUPLICATE: 'たぶん同じ依頼（人が確かめる）',
  UNIQUE: '別の依頼',
};

export type DupeVerdict = {
  /** 束ねる相手。★EXACT_DUPLICATE のときだけ入る。LIKELY では入れない（捨てないため）。 */
  duplicateOf: number | null;
  /** 似ていると判断した相手。LIKELY のときも入る。人が見比べるための番号。 */
  similarTo: number | null;
  level: DupeLevel;
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

  let best: DupeVerdict = { duplicateOf: null, similarTo: null, level: 'UNIQUE', reasonJa: '', titleSim: 0, bodySim: 0 };

  for (const c of candidates) {
    const cUrl = canonicalUrl(c.url);
    if (myUrl !== null && cUrl !== null && myUrl === cUrl) {
      return {
        duplicateOf: c.id,
        similarTo: c.id,
        level: 'EXACT_DUPLICATE',
        reasonJa: `案件ページのURLが同じ（${myUrl}）。同じページを2回取り込んだということなので、束ねる。`,
        titleSim: 1,
        bodySim: 1,
      };
    }

    const titleSim = similarity(myTitle, stripTitleDecor(c.title));
    const bodySim = similarity(myBody, stripBodyNoise(c.description));
    if (budgetConflicts(input, c)) continue;

    let level: DupeLevel = 'UNIQUE';
    let hit: string | null = null;

    if (titleSim >= TITLE_SAME && bodySim >= BODY_NEAR) {
      // 件名も本文もそろって同じ。ここまで揃えば、別サイトへの転載でも同じ依頼と言い切ってよい。
      level = 'EXACT_DUPLICATE';
      hit = `件名（${(titleSim * 100).toFixed(0)}%）も本文（${(bodySim * 100).toFixed(0)}%）もほぼ同じ。サイトは${c.siteCode}。同じ依頼として束ねる。`;
    } else if (titleSim >= TITLE_SAME) {
      // 件名だけ同じ。「LP制作」のようなありふれた件名だと、別の依頼でもここまで似る。
      level = 'LIKELY_DUPLICATE';
      hit = `件名はほぼ同じ（${(titleSim * 100).toFixed(0)}%）だが、本文は${(bodySim * 100).toFixed(0)}%しか似ていない。サイトは${c.siteCode}。同じ依頼かどうかは人が見比べる（勝手に捨てない）。`;
    } else if (titleSim >= TITLE_NEAR && bodySim >= BODY_NEAR) {
      level = 'LIKELY_DUPLICATE';
      hit = `件名（${(titleSim * 100).toFixed(0)}%）と本文（${(bodySim * 100).toFixed(0)}%）が似ている。サイトは${c.siteCode}。同じ依頼かどうかは人が見比べる（勝手に捨てない）。`;
    }

    if (hit === null) continue;

    // より確かなほう（EXACT優先）→ 似ている度合いの大きいほう、の順で残す。
    const better =
      best.level === 'UNIQUE' ||
      (level === 'EXACT_DUPLICATE' && best.level !== 'EXACT_DUPLICATE') ||
      (level === best.level && titleSim + bodySim > best.titleSim + best.bodySim);

    if (better) {
      best = {
        duplicateOf: level === 'EXACT_DUPLICATE' ? c.id : null,
        similarTo: c.id,
        level,
        reasonJa: hit,
        titleSim,
        bodySim,
      };
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
