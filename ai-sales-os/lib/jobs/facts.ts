import { all, nowIso, run, type Row } from '../db/client';

/**
 * 案件本文から「事実」だけを取り出し、どこから取ったかを必ず残す。
 *
 * ★なぜ出典を残すか。
 *   案件の判断は、報酬・納期・勤務時間・AI利用可否といった数項目でほぼ決まる。
 *   この数項目のどれか1つでも読み違えると、その先の利益も時給も順位も全部ずれる。
 *   ずれた結果だけを見ても、どこで間違えたのかは誰にも分からない。
 *   だから各項目について「本文のどの文字から取ったか」を残し、
 *   人が本文と1行ずつ突き合わせて確かめられるようにする。
 *
 * ★書いていないことを埋めない。
 *   本文に納期が書いていない案件で「たぶん1週間だろう」と入れると、
 *   その1週間はもう事実と見分けがつかなくなる。
 *   書いていなければ UNKNOWN。UNKNOWN は空欄ではなく「無いことを確かめた」という記録。
 *
 * ★UNKNOWN だからといって、その場で落とさない。
 *   情報が足りない案件は、危ない案件とは限らない。
 *   落とすのではなく「人が読む」に回す。落とすと、聞けば分かることまで捨てることになる。
 *
 * ★AIには聞かない。決まった規則だけで拾う。
 *   AIに読ませると同じ本文でも日によって答えが変わり、
 *   「なぜこの案件を上位に出したのか」を後から誰も再現できなくなる。
 */

/** 追跡する9項目。これ以上増やすときは、必ず出典も一緒に取れることを確かめてから増やす。 */
export const FACT_FIELDS = [
  'REWARD',
  'DEADLINE',
  'SKILLS',
  'WORK_HOURS',
  'WORK_PLACE',
  'AI_POLICY',
  'DELIVERABLE',
  'REVISION_COUNT',
  'REQUEST',
] as const;

export type FactField = (typeof FACT_FIELDS)[number];

export const FACT_FIELD_JA: Record<FactField, string> = {
  REWARD: '報酬',
  DEADLINE: '納期',
  SKILLS: '必要スキル',
  WORK_HOURS: '勤務時間',
  WORK_PLACE: '勤務場所',
  AI_POLICY: 'AI利用可否',
  DELIVERABLE: '成果物',
  REVISION_COUNT: '修正回数',
  REQUEST: '依頼内容',
};

/**
 * どれくらい確かか。
 *  HIGH   … 項目名と値がそろって書かれている（「報酬：30,000円」）
 *  MEDIUM … 値は書かれているが、項目名が無い、または言い回しから読み取った
 *  LOW    … その項目のことらしい記述はあるが、値として取り出せていない
 */
export type FactConfidence = 'HIGH' | 'MEDIUM' | 'LOW';

export const FACT_CONFIDENCE_JA: Record<FactConfidence, string> = {
  HIGH: '確か（項目名と値がそろって書いてある）',
  MEDIUM: 'たぶん（値はあるが項目名が無い／言い回しから読んだ）',
  LOW: '弱い（それらしい記述はあるが、値として取り出せていない）',
};

export type JobFact = {
  field: FactField;
  fieldJa: string;
  /** 読み取れた値。読み取れなければ null（0や空文字で埋めない）。 */
  value: string | null;
  /** 読み取れたか。UNKNOWN は「本文に書いていないことを確かめた」という意味。 */
  status: 'FOUND' | 'UNKNOWN';
  /** 本文のどの文字から取ったか。値そのままを切り出す。 */
  sourceText: string | null;
  /** 本文のどこか。人が本文を目で追えるように「◯行目の◯文字目〜」で持つ。 */
  sourceLocation: string | null;
  /** 行番号（1始まり）。画面で本文を並べて見せるときに使う。 */
  sourceLine: number | null;
  confidence: FactConfidence | null;
  /** なぜそう読んだか／なぜ読めなかったか。人がそのまま読める日本語。 */
  reasonJa: string;
};

// ---------------------------------------------------------------- 本文を行で持つ

type Located = { text: string; line: number; start: number; end: number };

/** 正規表現で1か所だけ拾い、その場所（行・文字位置）も一緒に返す。 */
function findIn(lines: string[], re: RegExp): Located | null {
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (m && m.index !== undefined) {
      return { text: m[0], line: i + 1, start: m.index + 1, end: m.index + m[0].length };
    }
  }
  return null;
}

/** 「3行目の12〜28文字目」という、人がそのまま数えられる形にする。 */
function locationJa(l: Located): string {
  return `${l.line}行目の${l.start}〜${l.end}文字目`;
}

function found(
  field: FactField,
  value: string,
  at: Located,
  confidence: FactConfidence,
  reasonJa: string,
): JobFact {
  return {
    field,
    fieldJa: FACT_FIELD_JA[field],
    value,
    status: 'FOUND',
    sourceText: at.text,
    sourceLocation: locationJa(at),
    sourceLine: at.line,
    confidence,
    reasonJa,
  };
}

function unknown(field: FactField, reasonJa: string): JobFact {
  return {
    field,
    fieldJa: FACT_FIELD_JA[field],
    value: null,
    status: 'UNKNOWN',
    sourceText: null,
    sourceLocation: null,
    sourceLine: null,
    confidence: null,
    reasonJa,
  };
}

// ---------------------------------------------------------------- 項目ごとの読み取り

/**
 * 報酬。
 * ★「10万円以上稼げます」のような宣伝文句は報酬ではない。
 *   金額の前後に報酬の項目名があるものだけを HIGH にする。
 */
const REWARD_LABELED = /(報酬|予算|単価|支払[いい]?額|ギャラ|価格)[　\s]*[:：=＝]?[　\s]*[¥￥]?[0-9０-９,，]{3,}[　\s]*(円|万円|円\/[^\s]{1,6})?/;
const REWARD_BARE = /[¥￥]?[0-9０-９,，]{3,}[　\s]*(万円|円)/;

function readReward(lines: string[]): JobFact {
  const labeled = findIn(lines, REWARD_LABELED);
  if (labeled) return found('REWARD', labeled.text.trim(), labeled, 'HIGH', '報酬の項目名と金額がそろって書かれている。');

  const bare = findIn(lines, REWARD_BARE);
  if (bare) {
    return found(
      'REWARD',
      bare.text.trim(),
      bare,
      'MEDIUM',
      '金額は書かれているが、報酬の項目名が無い。別の金額（例：宣伝の文句や参考価格）の可能性があるので、人が本文で確かめること。',
    );
  }
  return unknown('REWARD', '本文に金額の記載が無い。報酬は不明のままにする（0円とはしない）。');
}

/** 納期。日付・「◯日以内」「◯週間」「締切」などを見る。 */
const DEADLINE_PATTERNS: { re: RegExp; conf: FactConfidence; why: string }[] = [
  { re: /(納期|締切|締め切り|期限|納品日)[　\s]*[:：=＝]?[　\s]*[^\n]{1,24}/, conf: 'HIGH', why: '納期の項目名と一緒に書かれている。' },
  { re: /[0-9０-９]{1,4}[年\/-][0-9０-９]{1,2}[月\/-][0-9０-９]{1,2}日?(まで)?/, conf: 'MEDIUM', why: '日付が書かれているが、納期の項目名が無い。掲載日や開始日の可能性があるので人が確かめること。' },
  { re: /[0-9０-９]{1,3}[　\s]*(日|週間|ヶ月|か月|カ月)[　\s]*(以内|程度|くらい|後)/, conf: 'MEDIUM', why: '期間の言い回しから読み取った。' },
];

function readDeadline(lines: string[]): JobFact {
  for (const p of DEADLINE_PATTERNS) {
    const at = findIn(lines, p.re);
    if (at) return found('DEADLINE', at.text.trim(), at, p.conf, p.why);
  }
  return unknown('DEADLINE', '本文に納期の記載が無い。応募前に依頼主へ確認する項目。勝手に「1週間」などと決めない。');
}

/** 必要スキル。 */
const SKILL_PATTERNS: { re: RegExp; conf: FactConfidence; why: string }[] = [
  { re: /(必要(な)?(スキル|経験|条件)|応募条件|求めるスキル|歓迎スキル|必須(条件|スキル))[　\s]*[:：=＝]?[　\s]*[^\n]{1,60}/, conf: 'HIGH', why: 'スキルの項目名と一緒に書かれている。' },
  { re: /[^\n]{0,20}(が使える|の経験|ができる方|に慣れている)[^\n]{0,20}/, conf: 'MEDIUM', why: '本文中の言い回しから読み取った。項目としてまとまっていない。' },
];

function readSkills(lines: string[]): JobFact {
  for (const p of SKILL_PATTERNS) {
    const at = findIn(lines, p.re);
    if (at) return found('SKILLS', at.text.trim(), at, p.conf, p.why);
  }
  return unknown('SKILLS', '本文に必要スキルの記載が無い。当てはめられる自社の道具があるかは、依頼内容のほうから判断する。');
}

/** 勤務時間。★ここは足切り（1日8時間・週5固定など）に直結するので、読み違えると危ない。 */
const WORK_HOURS_PATTERNS: { re: RegExp; conf: FactConfidence; why: string }[] = [
  { re: /(勤務時間|稼働時間|稼働|就業時間|実働)[　\s]*[:：=＝]?[　\s]*[^\n]{1,30}/, conf: 'HIGH', why: '勤務時間の項目名と一緒に書かれている。' },
  { re: /(1日|一日|週)[　\s]*[0-9０-９]{1,2}[　\s]*(時間|日)/, conf: 'MEDIUM', why: '本文中の時間の言い回しから読み取った。' },
  { re: /(フルタイム|常時対応|即レス|固定シフト)/, conf: 'MEDIUM', why: '拘束を表す言葉から読み取った。' },
];

function readWorkHours(lines: string[]): JobFact {
  for (const p of WORK_HOURS_PATTERNS) {
    const at = findIn(lines, p.re);
    if (at) return found('WORK_HOURS', at.text.trim(), at, p.conf, p.why);
  }
  return unknown(
    'WORK_HOURS',
    '本文に勤務時間の記載が無い。書いていないことを「拘束なし」とは読まない。応募前に確認する項目。',
  );
}

/** 勤務場所。 */
const WORK_PLACE_PATTERNS: { re: RegExp; conf: FactConfidence; why: string }[] = [
  { re: /(勤務地|勤務場所|作業場所|就業場所)[　\s]*[:：=＝]?[　\s]*[^\n]{1,30}/, conf: 'HIGH', why: '勤務場所の項目名と一緒に書かれている。' },
  { re: /(完全リモート|フルリモート|在宅(勤務|ワーク)?|リモート(可|OK|勤務)?)/i, conf: 'MEDIUM', why: '本文中の言い回しから「離れた場所で作業する」と読み取った。' },
  { re: /(常駐|出社|来社|現地(作業|対応)|オフィス勤務)/, conf: 'MEDIUM', why: '本文中の言い回しから「場所を拘束される」と読み取った。' },
];

function readWorkPlace(lines: string[]): JobFact {
  for (const p of WORK_PLACE_PATTERNS) {
    const at = findIn(lines, p.re);
    if (at) return found('WORK_PLACE', at.text.trim(), at, p.conf, p.why);
  }
  return unknown('WORK_PLACE', '本文に勤務場所の記載が無い。書いていないことを「在宅でよい」とは読まない。');
}

// ---------------------------------------------------------------- AI利用可否

/**
 * AIを使ってよいか。
 *
 * ★ここが今回いちばん間違えやすい。
 *   本文にAIの話が出てこないことを「AIを使ってよい」と読んではいけない。
 *   AIで作った成果物を、AI不可の依頼へ出すと、納品後に取り消しになるどころか
 *   アカウントごと失う。だから「書いていない」は AI_POLICY_UNKNOWN という別の状態にする。
 *
 *   AI_POLICY_UNKNOWN ≠ AI_ALLOWED
 */
export type AiPolicy = 'AI_ALLOWED' | 'AI_PROHIBITED' | 'AI_POLICY_UNKNOWN';

export const AI_POLICY_JA: Record<AiPolicy, string> = {
  AI_ALLOWED: 'AIを使ってよい（本文に明記あり）',
  AI_PROHIBITED: 'AI利用が禁止されている',
  AI_POLICY_UNKNOWN: '本文に記載が無い（「使ってよい」という意味ではない）',
};

export const AI_PROHIBITED_RE =
  /((生成)?AI|ChatGPT|Claude|Gemini|チャットGPT)[^\n]{0,10}(禁止|不可|使用しないで|使わないで|お断り|NG)|(手作業|人力)(のみ|で)/i;
const AI_ALLOWED_RE =
  /((生成)?AI|ChatGPT|Claude|Gemini)[^\n]{0,10}(利用可|使用可|OK|歓迎|活用歓迎|可能です|構いません|問題ありません)/i;

export function readAiPolicy(lines: string[]): { policy: AiPolicy; fact: JobFact } {
  const no = findIn(lines, AI_PROHIBITED_RE);
  if (no) {
    return {
      policy: 'AI_PROHIBITED',
      fact: found('AI_POLICY', 'AI利用禁止', no, 'HIGH', 'AIを使わないでほしいと本文に明記されている。この案件は受けない。'),
    };
  }
  const yes = findIn(lines, AI_ALLOWED_RE);
  if (yes) {
    return {
      policy: 'AI_ALLOWED',
      fact: found('AI_POLICY', 'AI利用可', yes, 'HIGH', 'AIを使ってよいと本文に明記されている。'),
    };
  }
  return {
    policy: 'AI_POLICY_UNKNOWN',
    fact: unknown(
      'AI_POLICY',
      '本文にAIの可否が書かれていない。★「書いていない」は「使ってよい」ではない。'
      + 'この案件でAIを使うなら、応募の前に依頼主へ確認する。',
    ),
  };
}

// ---------------------------------------------------------------- 成果物・修正回数・依頼内容

const DELIVERABLE_PATTERNS: { re: RegExp; conf: FactConfidence; why: string }[] = [
  { re: /(成果物|納品(物|形式|データ)|提出(物|形式))[　\s]*[:：=＝]?[　\s]*[^\n]{1,40}/, conf: 'HIGH', why: '成果物の項目名と一緒に書かれている。' },
  { re: /[^\n]{0,20}(で納品|を納品|でご提出|形式でお渡し)[^\n]{0,10}/, conf: 'MEDIUM', why: '本文中の言い回しから読み取った。' },
];

function readDeliverable(lines: string[]): JobFact {
  for (const p of DELIVERABLE_PATTERNS) {
    const at = findIn(lines, p.re);
    if (at) return found('DELIVERABLE', at.text.trim(), at, p.conf, p.why);
  }
  return unknown('DELIVERABLE', '本文に成果物の形が書かれていない。何をどの形で渡すかは応募前に確認する項目。');
}

/**
 * 修正回数。
 * ★ここが不明のまま応募すると、無制限の手直しを引き受けたことになりやすい。
 *   不明を「0回」と読み替えない。
 */
const REVISION_PATTERNS: { re: RegExp; conf: FactConfidence; why: string }[] = [
  { re: /(修正|手直し|リテイク)[^\n]{0,6}[0-9０-９]{1,2}[　\s]*回(まで|以内)?/, conf: 'HIGH', why: '修正回数が数字で書かれている。' },
  { re: /(修正|手直し)[^\n]{0,8}(無制限|納得(いく|できる)まで|何度でも)/, conf: 'HIGH', why: '修正回数に上限が無いと本文に書かれている。手直しが読めないので、時間の見積りが立たない。' },
  { re: /(修正|手直し|リテイク)[^\n]{0,20}/, conf: 'LOW', why: '修正の話は出ているが、何回までかは書かれていない。' },
];

function readRevisionCount(lines: string[]): JobFact {
  for (const p of REVISION_PATTERNS) {
    const at = findIn(lines, p.re);
    if (at) return found('REVISION_COUNT', at.text.trim(), at, p.conf, p.why);
  }
  return unknown(
    'REVISION_COUNT',
    '本文に修正回数の記載が無い。★0回とは読まない。上限を決めずに受けると手直しが無制限になるので、応募前に決める項目。',
  );
}

/**
 * 依頼内容。
 * ★これだけは、本文そのものが答えになる。
 *   件名か、本文の最初のまとまった1行を、そのまま出典として持つ。
 */
function readRequest(lines: string[], title: string): JobFact {
  const body = lines.findIndex((l) => l.trim().length >= 12);
  if (body >= 0) {
    const l = lines[body];
    const at: Located = { text: l.trim().slice(0, 120), line: body + 1, start: 1, end: Math.min(l.trim().length, 120) };
    return found('REQUEST', at.text, at, 'HIGH', '本文のうち、最初にまとまった説明になっている行をそのまま取った。');
  }
  if (title.trim().length > 0) {
    const at: Located = { text: title.trim(), line: 0, start: 1, end: title.trim().length };
    return {
      ...found('REQUEST', title.trim(), at, 'MEDIUM', '本文に説明が無いので、件名だけを依頼内容として扱っている。'),
      sourceLocation: '件名',
    };
  }
  return unknown('REQUEST', '件名も本文も空で、何を頼まれているのか読み取れない。');
}

// ---------------------------------------------------------------- まとめ

export type JobFactSheet = {
  jobId: number;
  facts: JobFact[];
  aiPolicy: AiPolicy;
  /** 読み取れなかった項目の数。多いほど「人が読む」に回る理由が強くなる。 */
  unknownCount: number;
  /** 読み取れなかった項目の名前（日本語）。 */
  unknownFieldsJa: string[];
  /** 出典つきで読み取れた項目の数。 */
  foundCount: number;
};

/**
 * 案件1件から9項目を読み取る。DBには書かない（保存は saveJobFacts）。
 * ★読む対象は、実際に依頼主が書いた文字だけ。こちらが後から足した欄は入れない。
 */
export function extractJobFacts(job: Row): JobFactSheet {
  const title = String(job.title ?? '');
  const description = String(job.description ?? '');
  const lines = description.split('\n');

  const ai = readAiPolicy([title, ...lines]);

  const facts: JobFact[] = [
    readReward(lines),
    readDeadline(lines),
    readSkills(lines),
    readWorkHours(lines),
    readWorkPlace(lines),
    ai.fact,
    readDeliverable(lines),
    readRevisionCount(lines),
    readRequest(lines, title),
  ];

  const unknownFacts = facts.filter((f) => f.status === 'UNKNOWN');
  return {
    jobId: Number(job.id),
    facts,
    aiPolicy: ai.policy,
    unknownCount: unknownFacts.length,
    unknownFieldsJa: unknownFacts.map((f) => f.fieldJa),
    foundCount: facts.length - unknownFacts.length,
  };
}

export async function saveJobFacts(sheet: JobFactSheet): Promise<void> {
  await run('DELETE FROM job_facts WHERE job_id = ?', [sheet.jobId]);
  const at = nowIso();
  for (const f of sheet.facts) {
    await run(
      `INSERT INTO job_facts
         (job_id, field, value, status, source_text, source_location, source_line, confidence, reason_ja, extracted_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [sheet.jobId, f.field, f.value, f.status, f.sourceText, f.sourceLocation, f.sourceLine, f.confidence, f.reasonJa, at],
    );
  }
}

export async function loadJobFacts(jobId: number): Promise<JobFact[]> {
  const rows = await all('SELECT * FROM job_facts WHERE job_id = ? ORDER BY id', [jobId]);
  return rows.map((r) => ({
    field: String(r.field) as FactField,
    fieldJa: FACT_FIELD_JA[String(r.field) as FactField] ?? String(r.field),
    value: r.value === null || r.value === undefined ? null : String(r.value),
    status: String(r.status) === 'FOUND' ? 'FOUND' : 'UNKNOWN',
    sourceText: r.source_text === null || r.source_text === undefined ? null : String(r.source_text),
    sourceLocation: r.source_location === null || r.source_location === undefined ? null : String(r.source_location),
    sourceLine: r.source_line === null || r.source_line === undefined ? null : Number(r.source_line),
    confidence: r.confidence === null || r.confidence === undefined ? null : (String(r.confidence) as FactConfidence),
    reasonJa: String(r.reason_ja ?? ''),
  }));
}
