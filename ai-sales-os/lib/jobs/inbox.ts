/**
 * 案件の入口（JOB_INBOX）。
 *
 * ★このシステムは求人サイトを勝手に巡回しない。
 *   案件が入ってくる道は、ここに書いてある6本だけ。
 *   道が書けない案件は取り込まない（「たぶんどこかから来た」を作らない）。
 *
 * ★なぜ入口を種類で分けるか。
 *   同じ「案件1件」でも、公式APIで受け取ったものと、人がURLを貼っただけのものでは、
 *   信じてよい範囲がまるで違う。入口を残しておかないと、
 *   あとから「この案件の情報はどこまで確かなのか」が誰にも言えなくなる。
 *   また、練習用（TEST）と本物（REAL）の切り分けも入口で決まる。
 */

import type { DataOrigin } from '../origin';
import { originForJobSource } from '../origin';

export const INBOX_SOURCES = [
  'OFFICIAL_API',
  'EMAIL_ALERT',
  'MANUAL_URL',
  'MANUAL_TEXT',
  'CSV_IMPORT',
  'REFERRAL',
] as const;

export type InboxSource = (typeof INBOX_SOURCES)[number];

export const INBOX_SOURCE_JA: Record<InboxSource, string> = {
  OFFICIAL_API: '提供元の公式APIから受け取った',
  EMAIL_ALERT: '求人サイトからのメール通知を読み取った',
  MANUAL_URL: '人が案件ページのURLを貼った',
  MANUAL_TEXT: '人が案件の本文を貼った',
  CSV_IMPORT: '人がCSVで取り込んだ',
  REFERRAL: '知り合い・過去の取引先からの紹介',
};

/**
 * その入口が「機械による自動収集」にあたるか。
 *
 * ★規約の判断はここで分かれる。
 *   自動収集にあたるのは公式APIだけ。公式APIは提供元が明示的に許可した道なので通る。
 *   メール通知は、提供元が自分の意思でこちらへ送ってきたものを読むだけなので巡回ではない。
 *   残りは人の手による入力なので、そもそも収集ではない。
 */
export function isMachineCollection(source: InboxSource): boolean {
  return source === 'OFFICIAL_API';
}

/** 入口から、取り込み処理（ingestJob）の source へ変換する。 */
export function collectSourceFor(source: InboxSource): 'API' | 'CSV' | 'MANUAL' {
  if (source === 'OFFICIAL_API') return 'API';
  if (source === 'CSV_IMPORT') return 'CSV';
  return 'MANUAL';
}

/** 入口から、本物か練習用かを決める。推測はしない。 */
export function originForInbox(source: InboxSource): DataOrigin {
  return originForJobSource(source);
}

export function toInboxSource(v: unknown): InboxSource | null {
  const s = String(v ?? '').trim().toUpperCase();
  return (INBOX_SOURCES as readonly string[]).includes(s) ? (s as InboxSource) : null;
}

// ------------------------------------------------------------------ Gmail通知アダプタ

/**
 * GMAIL_JOB_ALERT_ADAPTER の入力の決まりごと。
 *
 * ★何のためのものか。
 *   クラウドソーシングのサイトは「新着案件のお知らせ」メールを送ってくる。
 *   これはサイトが自分の意思でこちらへ送ってきたものなので、
 *   サイトを巡回しなくても案件を受け取れる、規約上いちばん安全な道になる。
 *
 * ★いまは Gmail につないでいない。
 *   このファイルにあるのは「どんな形で渡せば受け取れるか」という決まりだけで、
 *   メールを読みにいく処理はこのシステムに存在しない。
 *   つないでいないものを「つないである」と書かないために、
 *   実装の有無は下の GMAIL_ADAPTER_CONNECTED で言い切る。
 *
 * ★埋まっていない項目を推測で埋めない。
 *   予算も締切も、メール本文に書いていなければ null のままにする。
 *   ここで「たぶん5万円くらい」と埋めると、そのまま応募可否の判断材料になってしまう。
 */
export const GMAIL_ADAPTER_CONNECTED = false as const;

/**
 * 読んでよい差出人の一覧（送信元フィルタ）。
 *
 * ★これが PHASE E の一番大事な仕組み。
 *   受信箱を全部読む作りにすると、家族からのメールも、銀行からの通知も、
 *   取引先との私信も、全部このシステムの中に入ってくる。
 *   案件を1件取るために、読む必要のないものまで読むのは割に合わない。
 *
 * ★だから「求人サイトからの通知だけ」を差出人で先に絞る。
 *   ここに載っていないドメインから来たメールは、件名も本文も見ない。
 *   見ないので、記録にも残らない。
 *
 * ★増やすときは、必ず job_sites の code と対にする。
 *   対にできない差出人を足すと、「どのサイトから来た案件か」が言えなくなる。
 */
export const JOB_ALERT_SENDERS: { domain: string; siteCode: string; note: string }[] = [
  { domain: 'lancers.jp', siteCode: 'LANCERS', note: 'ランサーズの新着案件メール' },
  { domain: 'crowdworks.jp', siteCode: 'CROWDWORKS', note: 'クラウドワークスの新着案件メール' },
  { domain: 'coconala.com', siteCode: 'COCONALA', note: 'ココナラの依頼通知メール' },
  { domain: 'shufti.jp', siteCode: 'SHUFTI', note: 'シュフティの新着案件メール' },
  { domain: 'craudia.com', siteCode: 'CRAUDIA', note: 'クラウディアの新着案件メール' },
];

/** メールアドレスからドメインだけを取り出す。「名前 <a@b.jp>」の形にも対応する。 */
export function senderDomainOf(sender: string): string | null {
  const m = /<([^>]+)>/.exec(sender);
  const addr = (m ? m[1] : sender).trim().toLowerCase();
  const at = addr.lastIndexOf('@');
  if (at < 0 || at === addr.length - 1) return null;
  const d = addr.slice(at + 1).replace(/[>\s]/g, '');
  return d.length > 0 ? d : null;
}

/**
 * その差出人は求人通知として読んでよい相手か。
 * ★子ドメイン（例 mail.lancers.jp）は同じ会社なので通す。
 *   ただし「lancers.jp.example.com」のような、後ろに別のドメインを足した偽装は通さない。
 */
export function jobAlertSiteFor(sender: string): string | null {
  const d = senderDomainOf(sender);
  if (!d) return null;
  for (const s of JOB_ALERT_SENDERS) {
    if (d === s.domain || d.endsWith(`.${s.domain}`)) return s.siteCode;
  }
  return null;
}

export function isJobAlertSender(sender: string): boolean {
  return jobAlertSiteFor(sender) !== null;
}

/**
 * Gmail 側で使う検索条件。
 *
 * ★「全部取ってきてから捨てる」ではなく、「最初から求人通知しか取らない」ための文字列。
 *   実際につなぐときは、この条件を必ず付けて読む。付けなければ受信箱を全部読むことになる。
 */
export function gmailQuery(): string {
  return JOB_ALERT_SENDERS.map((s) => `from:${s.domain}`).join(' OR ');
}

export type GmailJobAlertInput = {
  /** どのサイトからの通知か。job_sites の code と一致していること。 */
  source_site: string;
  /** そのメール1通を指すGmail側のID。同じ通知を二重に取り込まないために使う。 */
  message_id: string;
  /** 差出人。読んでよい相手かをここで確かめる。 */
  sender: string;
  /** 案件の件名。メールに書いてあるものをそのまま。 */
  title: string;
  /** 案件ページのURL。無ければ null（推測で組み立てない）。 */
  job_url: string | null;
  /** 予算。メールに書いてある文字列のまま。書いていなければ null。 */
  budget: string | null;
  /** 締切。メールに書いてある文字列のまま。書いていなければ null。 */
  deadline: string | null;
  /** 案件の説明本文。メールに載っている範囲だけ。 */
  body: string;
  /** そのメールを受け取った日時（ISO8601）。 */
  received_at: string;
};

export type GmailAdapterCheck = {
  ok: boolean;
  /** 受け取れない理由。日本語でそのまま画面に出す。 */
  problems: string[];
  /** 受け取れる形なら、取り込みに渡せる形に整えたもの。 */
  normalized: GmailJobAlertInput | null;
};

/**
 * 渡された1通分が、決まりどおりの形かを確かめる。
 * ★足りない項目を埋めるのではなく、足りないと言って止める。
 * ★差出人が求人サイトでなければ、中身を見る前に断る。
 */
export function checkGmailJobAlert(input: Partial<GmailJobAlertInput>): GmailAdapterCheck {
  const problems: string[] = [];
  const str = (v: unknown): string => String(v ?? '').trim();

  const sender = str(input.sender);
  const messageId = str(input.message_id);

  // ★ここが最初の関門。求人サイト以外からのメールは、件名も本文も検査しない。
  if (!sender) {
    problems.push('差出人（sender）が空です。誰から来たか分からないメールは読みません。');
  } else if (!isJobAlertSender(sender)) {
    problems.push(
      `差出人「${sender}」は求人サイトの一覧に入っていません。`
      + '求人通知以外のメールは読まない決まりなので、この1通は受け取りません。',
    );
  }
  if (!messageId) problems.push('メールのID（message_id）が空です。同じ通知を二重に取り込まないために必要です。');

  // ★差出人で断ったときは、本文の中身にはこれ以上触れない。
  if (problems.length > 0) return { ok: false, problems, normalized: null };

  const siteFromSender = jobAlertSiteFor(sender);
  const sourceSite = str(input.source_site) || String(siteFromSender);
  const title = str(input.title);
  const body = str(input.body);
  const receivedAt = str(input.received_at);

  if (!title) problems.push('案件の件名（title）が空です。');
  if (!body) problems.push('案件の本文（body）が空です。件名だけでは受けるかどうか判断できません。');
  if (!receivedAt) problems.push('メールを受け取った日時（received_at）が空です。');
  else if (Number.isNaN(Date.parse(receivedAt))) problems.push('メールを受け取った日時（received_at）が日付として読めません。');

  // ★自己申告のサイト名と、差出人から分かるサイト名が食い違うときは通さない。
  //   食い違ったまま入れると、別のサイトの規約でその案件を判断してしまう。
  if (siteFromSender && str(input.source_site) && str(input.source_site).toUpperCase() !== siteFromSender) {
    problems.push(`書かれているサイト名（${str(input.source_site)}）と、差出人から分かるサイト（${siteFromSender}）が食い違っています。`);
  }

  const jobUrl = str(input.job_url);
  if (jobUrl && !/^https?:\/\//i.test(jobUrl)) problems.push('案件ページのURL（job_url）が http/https で始まっていません。');

  if (problems.length > 0) return { ok: false, problems, normalized: null };

  return {
    ok: true,
    problems: [],
    normalized: {
      source_site: sourceSite.toUpperCase(),
      message_id: messageId,
      sender,
      title,
      job_url: jobUrl || null,
      // ★書いていないものは null。ここで0や「応相談」に置き換えない。
      budget: str(input.budget) || null,
      deadline: str(input.deadline) || null,
      body,
      received_at: receivedAt,
    },
  };
}
