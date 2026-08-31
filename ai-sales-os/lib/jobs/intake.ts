/**
 * 案件を受け取る、ただ1つの入口（JOB_INBOX の実体）。
 *
 * ★なぜ1つにまとめるか。
 *   これまでは「メール通知」「人が貼った本文」「CSV」で取り込む処理がばらばらだった。
 *   ばらばらだと、片方だけに検査が入っていて、もう片方は素通り、という状態が必ずできる。
 *   実際に事故になるのはいつも素通りしている側なので、通る道を1本にして、
 *   その1本に全部の検査を置く。
 *
 * ★受け取る項目は6つの入口すべてで同じ形にする。
 *   source_site / message_id / sender / received_at / title / job_url / budget / deadline / body
 *   入口によって「必ず要るもの」が違うだけで、形は変えない。
 *
 * ★書いていない項目は null のまま。推測して埋めない。
 *   予算に「応相談」と書いてあれば、その文字をそのまま残し、金額は null にする。
 *   ここで「たぶん5万円」と埋めると、その数字がそのまま応募するかどうかの判断に使われ、
 *   赤字の案件を受けることになる。
 *
 * ★求人以外のメールは、中身を見る前に断る。
 *   差出人が求人サイトの一覧に無ければ、件名も本文も検査しない。見ないので記録にも残らない。
 */
import { nowIso } from '../db/client';
import { ORIGIN_JA, originForJobSource, type DataOrigin } from '../origin';
import { CollectionBlocked, ingestJob, guessBudgetType, type JobInput } from './ingest';
import { INBOX_SOURCE_JA, isJobAlertSender, jobAlertSiteFor, toInboxSource, type InboxSource } from './inbox';
import { parsePastedJob, siteCodeForUrl } from './paste';
import { sitePolicy } from './sites';

/** 6つの入口すべてで共通の受け取り形。入口によって「必須」が変わるだけ。 */
export type IntakeInput = {
  inboxSource: InboxSource;
  /** 規約台帳のサイトコード。サイトを経由しない案件は 'MANUAL'。 */
  source_site: string | null;
  /** メール1通を指すID。EMAIL_ALERT では必須。 */
  message_id: string | null;
  /** 差出人。EMAIL_ALERT では必須。 */
  sender: string | null;
  /** 受け取った日時（ISO8601）。 */
  received_at: string | null;
  title: string | null;
  job_url: string | null;
  /** 予算として書いてあった文字そのまま。数字に直せなければ金額は null のまま。 */
  budget: string | null;
  deadline: string | null;
  body: string | null;
  /** 紹介者。REFERRAL では必須。 */
  referral_from: string | null;
};

export type IntakeResult = {
  ok: boolean;
  jobId: number | null;
  isNew: boolean;
  /** 同じ依頼として既にあった案件のID。 */
  duplicateOf: number | null;
  duplicateReason: string | null;
  /** 当たった足切り（HARD_BLOCK）のコード。 */
  excluded: string[];
  /** 受け取れなかった理由。空でなければ1件も入っていない。 */
  problems: string[];
  dataOrigin: DataOrigin | null;
};

function s(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const t = String(v).trim();
  return t === '' ? null : t;
}

/**
 * 予算の文字から金額を読み取る。
 *
 * ★見出しのある行から読む paste.ts の readBudget とは役割が違う。
 *   こちらは「予算欄の中身」として渡された文字だけを見る。
 * ★「応相談」「スキルによる」「要相談」は金額ではない。null を返す。
 * ★0円・マイナスは金額として受け取らない（無償依頼を金額として通さない）。
 */
export function parseBudgetText(raw: string | null): { min: number | null; max: number | null } {
  const t = s(raw);
  if (t === null) return { min: null, max: null };
  const norm = t.normalize('NFKC').replace(/[,，\s]/g, '');
  const yen = (v: string): number | null => {
    const man = /^([0-9]+(?:\.[0-9]+)?)万/.exec(v);
    if (man) return Math.round(Number(man[1]) * 10_000);
    const m = /^([0-9]+)/.exec(v);
    if (!m) return null;
    const n = Number(m[1]);
    return Number.isFinite(n) && n > 0 ? n : null;
  };
  const range = /([0-9][0-9.]*万?)円?(?:〜|~|-|ー|から)([0-9][0-9.]*万?)円/.exec(norm);
  if (range) {
    const min = yen(range[1]);
    const max = yen(range[2]);
    if (min !== null && max !== null) return { min, max };
  }
  const single = /([0-9][0-9.]*万?)円/.exec(norm);
  if (single) {
    const v = yen(single[1]);
    if (v !== null) return { min: v, max: v };
  }
  // 「50000」のように単位が無い数字だけのときも受け取る（予算欄としてそう書かれているため）。
  const bare = /^([0-9]+)$/.exec(norm);
  if (bare) {
    const v = Number(bare[1]);
    if (Number.isFinite(v) && v > 0) return { min: v, max: v };
  }
  return { min: null, max: null };
}

/** 入口ごとに「必ず要るもの」を確かめる。足りないものは埋めずに断る。 */
export function checkIntake(input: Partial<IntakeInput>): { problems: string[]; source: InboxSource | null } {
  const problems: string[] = [];
  const source = toInboxSource(input.inboxSource);
  if (source === null) {
    problems.push('案件の入口（inboxSource）が決まっていません。どこから来た案件か言えないものは取り込みません。');
    return { problems, source: null };
  }

  // ★求人サイト以外からのメールは、ここで断る。件名も本文もこの先へ渡さない。
  if (source === 'EMAIL_ALERT') {
    const sender = s(input.sender);
    if (sender === null) {
      problems.push('差出人（sender）が空です。誰から来たか分からないメールは読みません。');
    } else if (!isJobAlertSender(sender)) {
      problems.push(
        `差出人「${sender}」は求人サイトの一覧に入っていません。求人通知以外のメールは案件にしません。`,
      );
    }
    if (s(input.message_id) === null) {
      problems.push('メールのID（message_id）が空です。同じ通知を二重に取り込まないために必要です。');
    }
    // 差出人で断ったときは、本文の中身にこれ以上触れない。
    if (problems.length > 0) return { problems, source };
  }

  if (source === 'REFERRAL' && s(input.referral_from) === null) {
    problems.push('紹介者（referral_from）が空です。誰からの紹介か言えない案件は取り込みません。');
  }

  if (s(input.title) === null) problems.push('案件の件名（title）が空です。');
  const body = s(input.body);
  if (body === null) problems.push('案件の本文（body）が空です。件名だけでは受けるかどうか判断できません。');
  else if (body.replace(/https?:\/\/\S+/g, '').trim().length < 30) {
    problems.push('本文が短すぎます（URLを除いて30文字未満）。これだけでは受けるかどうか判断できません。');
  }

  const url = s(input.job_url);
  if (url !== null && !/^https?:\/\//i.test(url)) {
    problems.push('案件ページのURL（job_url）が http/https で始まっていません。');
  }
  if (source === 'MANUAL_URL' && url === null) {
    problems.push('MANUAL_URL では案件ページのURL（job_url）が必須です。');
  }

  const at = s(input.received_at);
  if (at !== null && Number.isNaN(Date.parse(at))) {
    problems.push('受け取った日時（received_at）が日付として読めません。');
  }

  // ★自己申告のサイト名と、差出人から分かるサイト名が食い違うときは通さない。
  //   食い違ったまま入れると、別のサイトの規約でこの案件を判断してしまう。
  const declared = s(input.source_site);
  if (source === 'EMAIL_ALERT') {
    const fromSender = jobAlertSiteFor(String(input.sender ?? ''));
    if (fromSender && declared && declared.toUpperCase() !== fromSender) {
      problems.push(`書かれているサイト名（${declared}）と、差出人から分かるサイト（${fromSender}）が食い違っています。`);
    }
  }
  return { problems, source };
}

/**
 * 1件を受け取る。
 * ★ここを通らずに jobs 表へ行を足す道は作らない。
 */
export async function intakeJob(input: Partial<IntakeInput>): Promise<IntakeResult> {
  const none: IntakeResult = {
    ok: false, jobId: null, isNew: false, duplicateOf: null, duplicateReason: null, excluded: [], problems: [], dataOrigin: null,
  };

  const { problems, source } = checkIntake(input);
  if (problems.length > 0 || source === null) return { ...none, problems };

  const title = String(s(input.title));
  const body = String(s(input.body));
  const url = s(input.job_url);

  // ── どのサイトの規約でこの案件を判断するかを決める。
  //    ①メール通知なら差出人から ②URLがあればURLのドメインから ③どちらも無ければ MANUAL。
  let siteCode: string;
  if (source === 'EMAIL_ALERT') {
    siteCode = String(jobAlertSiteFor(String(input.sender ?? '')));
  } else if (url !== null) {
    const fromUrl = siteCodeForUrl(url);
    if (fromUrl === null) {
      return {
        ...none,
        problems: [`URL「${url}」のサイトが規約台帳にありません。台帳に足すまで取り込みません（どのサイトの規約で判断すればよいか言えないため）。`],
      };
    }
    siteCode = fromUrl;
  } else {
    siteCode = (s(input.source_site) ?? 'MANUAL').toUpperCase();
  }

  const policy = await sitePolicy(siteCode);
  if (policy.name === siteCode && policy.reasonJa.includes('台帳に無い')) {
    return { ...none, problems: [`サイト「${siteCode}」が規約台帳にありません。台帳に足すまで取り込みません。`] };
  }

  // ── 予算。数字に直せたときだけ数字にする。直せなければ文字だけ残す。
  const budgetText = s(input.budget);
  const budget = parseBudgetText(budgetText);

  const j: JobInput = {
    siteCode,
    // メール通知はメールIDを、それ以外はURLを、案件のIDとして使う。どちらも無ければ件名＋本文から作る。
    externalId: source === 'EMAIL_ALERT' ? s(input.message_id) : url,
    title,
    description: body,
    budgetType: guessBudgetType(`${title}\n${body}\n${budgetText ?? ''}`),
    budgetMin: budget.min,
    budgetMax: budget.max,
    deadline: s(input.deadline),
    url,
    source: source === 'OFFICIAL_API' ? 'API' : source === 'CSV_IMPORT' ? 'CSV' : 'MANUAL',
    inboxSource: source,
    inboxReceivedAt: s(input.received_at) ?? nowIso(),
    inboxMessageId: s(input.message_id),
    inboxSender: s(input.sender),
    budgetText,
    referralFrom: s(input.referral_from),
  };

  try {
    const r = await ingestJob(j);
    return {
      ok: true,
      jobId: r.jobId,
      isNew: r.isNew,
      duplicateOf: r.duplicateOf,
      duplicateReason: r.duplicateReason,
      excluded: r.excluded,
      problems: [],
      dataOrigin: originForJobSource(source),
    };
  } catch (e) {
    if (e instanceof CollectionBlocked) return { ...none, problems: [e.message] };
    throw e;
  }
}

/**
 * 人が貼った本文から、まとめて受け取る（MANUAL_TEXT）。
 * ★案件と案件のあいだは、空行3つ以上か「----」の行で区切る。
 *   区切りが無ければ1件として扱う。勝手に段落で割ると、1件が複数件に化ける。
 */
export function splitPastedJobs(text: string): string[] {
  return text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*(?:-{4,}|={4,}|─{4,}|\n\n)\s*\n/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
}

/** 貼られた1件を IntakeInput の形にする。読み取れなければ problems が入る。 */
export function pastedToIntake(text: string, receivedAt: string): { input: Partial<IntakeInput>; problems: string[] } {
  const p = parsePastedJob(text);
  return {
    input: {
      inboxSource: p.url ? 'MANUAL_URL' : 'MANUAL_TEXT',
      source_site: p.siteCode,
      message_id: null,
      sender: null,
      received_at: receivedAt,
      title: p.title || null,
      job_url: p.url,
      // ★paste.ts が読み取れた金額だけを文字に戻して渡す。読み取れなければ null。
      budget: p.budgetMin === null ? null : p.budgetMin === p.budgetMax ? `${p.budgetMin}円` : `${p.budgetMin}円〜${p.budgetMax}円`,
      deadline: p.deadline,
      body: p.body || null,
      referral_from: null,
    },
    problems: p.problems,
  };
}

/** 画面と記録で使う、入口の説明。 */
export function intakeRouteJa(source: InboxSource): { label: string; origin: string } {
  return { label: INBOX_SOURCE_JA[source], origin: ORIGIN_JA[originForJobSource(source)] };
}
