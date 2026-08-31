/**
 * 人が貼った案件を読み取る（JOB_INBOX の ③MANUAL_URL / ④MANUAL_TEXT）。
 *
 * ★なぜこの道が要るのか。
 *   日本のクラウドソーシング（ランサーズ・クラウドワークス等）には、
 *   案件情報を機械で取り出せる公式APIが無い。規約でも二次利用を禁じている。
 *   そのため「本物の案件」をこのシステムに入れる道は、
 *   ①サイトから届く通知メール ②人が案件ページを貼る、の2つしかない。
 *   ①はGmailにつなぐ必要があるので、いちばん手数が少ないのが②になる。
 *
 * ★このファイルは推測をしない。
 *   予算も締切も、貼られた文章の中に「予算：」「納期：」と書いてあるときだけ読み取る。
 *   書いていなければ null のままにする。
 *   「たぶん5万円くらい」と埋めると、その数字がそのまま応募するかどうかの判断に使われ、
 *   赤字の案件を受けることになる。分からないものは分からないままにしておく。
 */

/** 貼られた文章から読み取った1件。読み取れなかった項目は null。 */
export type PastedJob = {
  /**
   * 規約台帳のサイトコード。
   * URLが無ければ 'MANUAL'。URLはあるが台帳に無いドメインなら null
   * （取り込み側で、そのドメインの行を台帳へ作る）。
   */
  siteCode: string | null;
  title: string;
  body: string;
  url: string | null;
  budgetMin: number | null;
  budgetMax: number | null;
  deadline: string | null;
  /** 何を根拠にその金額・締切を入れたか。人が後から確かめられるように残す。 */
  evidence: { field: string; matched: string }[];
  /** 読み取れなかった理由。空でなければ取り込まない。 */
  problems: string[];
};

/** URLのドメインから、規約台帳のサイトコードを決める。分からなければ null。 */
const HOST_TO_SITE: { host: string; code: string }[] = [
  { host: 'lancers.jp', code: 'LANCERS' },
  { host: 'crowdworks.jp', code: 'CROWDWORKS' },
  { host: 'coconala.com', code: 'COCONALA' },
  { host: 'shufti.jp', code: 'SHUFTI' },
  { host: 'app.shufti.jp', code: 'SHUFTI' },
  { host: 'craudia.com', code: 'CRAUDIA' },
];

export function siteCodeForUrl(url: string): string | null {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
  for (const h of HOST_TO_SITE) {
    if (host === h.host || host.endsWith(`.${h.host}`)) return h.code;
  }
  return null;
}

/** 「12,000円」「3万円」「50000」を数字にする。読めなければ null。 */
function yenOf(raw: string): number | null {
  const s = raw.replace(/[,，\s]/g, '');
  const man = /^([0-9]+(?:\.[0-9]+)?)万/.exec(s);
  if (man) return Math.round(Number(man[1]) * 10_000);
  const m = /^([0-9]+)/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * 予算を読み取る。
 * ★「予算」「報酬」「金額」といった見出しが実際に書かれている行だけを見る。
 *   文章のどこかにある数字を拾ってしまうと、「登録者5万人」の5万円が予算になる。
 */
export function readBudget(text: string): { min: number | null; max: number | null; matched: string | null } {
  const line = /^[^\n]*?(?:予算|報酬(?:額|金額)?|支払[いい]?金額|依頼金額|価格)[^\n]*$/m.exec(text);
  if (!line) return { min: null, max: null, matched: null };
  const t = line[0];
  // 範囲（〜でつなぐ書き方）が先。片方だけの書き方はそのあと。
  const range = /([0-9][0-9,，.]*\s*万?)\s*円?\s*(?:〜|~|-|ー|から)\s*([0-9][0-9,，.]*\s*万?)\s*円/.exec(t);
  if (range) {
    const min = yenOf(range[1]);
    const max = yenOf(range[2]);
    if (min !== null && max !== null) return { min, max, matched: t.trim() };
  }
  const single = /([0-9][0-9,，.]*\s*万?)\s*円/.exec(t);
  if (single) {
    const v = yenOf(single[1]);
    if (v !== null) return { min: v, max: v, matched: t.trim() };
  }
  // 見出しはあるが金額が書かれていない（「応相談」など）。埋めない。
  return { min: null, max: null, matched: null };
}

/**
 * 締切を読み取る。書かれている文字をそのまま持つ（日付に直さない）。
 * ★「2月中旬」を勝手に 2/15 にしない。相手が書いたとおりに残す。
 */
export function readDeadline(text: string): string | null {
  const line = /^[^\n]*?(?:納期|締切|締め切り|応募期限|希望納品日)[^\n]*$/m.exec(text);
  if (!line) return null;
  const t = line[0].replace(/^[\s・■□▼▲*＊-]+/, '').trim();
  return t.length > 0 && t.length <= 120 ? t : null;
}

/** 最初に出てくる http/https のURL。 */
export function firstUrl(text: string): string | null {
  const m = /https?:\/\/[^\s"'<>）)]+/.exec(text);
  return m ? m[0].replace(/[。、,.]+$/, '') : null;
}

/**
 * 貼られた1件分の文章を読み取る。
 *
 * 形式は決めない。案件ページをそのままコピーして貼れば読める。
 * ・どこかに案件ページのURLがあれば、そこからサイトを決める
 * ・URLが無ければ「サイトを経由しない案件（MANUAL）」として扱う
 * ・件名は、URLでない最初の1行
 */
export function parsePastedJob(text: string): PastedJob {
  const problems: string[] = [];
  const body = text.replace(/\r\n/g, '\n').trim();

  const lines = body.split('\n').map((l) => l.replace(/^[\s#>・■□▼▲*＊-]+/, '').trim());
  const url = firstUrl(body);
  const title = lines.find((l) => l.length > 0 && !/^https?:\/\//i.test(l)) ?? '';

  if (title.length === 0) problems.push('案件の件名にあたる行が見つかりません（1行目に件名を書いてください）。');
  if (body.replace(/https?:\/\/\S+/g, '').trim().length < 30) {
    problems.push('本文が短すぎます（30文字未満）。URLだけでは、受けるかどうかを判断できません。');
  }

  // ★URLがあるのに規約台帳に無いサイトでも、その1件を捨てない。
  //   以前はここで断っていたが、断ると外で見つけた本物の案件が貼った瞬間に消えていた。
  //   代わりにサイトコードを null にして返し、取り込み側（intake.ts）で
  //   台帳へドメインの行だけ作る。規約の判定は全部 UNKNOWN のまま入る。
  //   UNKNOWN は「安全」ではないので、そのサイトの案件は自動では応募へ進まない。
  let siteCode: string | null = 'MANUAL';
  if (url) siteCode = siteCodeForUrl(url);

  const b = readBudget(body);
  const deadline = readDeadline(body);
  const evidence: { field: string; matched: string }[] = [];
  if (b.matched) evidence.push({ field: '予算', matched: b.matched });
  if (deadline) evidence.push({ field: '締切', matched: deadline });

  return {
    siteCode,
    title: title.slice(0, 200),
    body,
    url,
    budgetMin: b.min,
    budgetMax: b.max,
    deadline,
    evidence,
    problems,
  };
}
