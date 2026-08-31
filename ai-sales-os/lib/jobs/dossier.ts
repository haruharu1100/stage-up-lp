/**
 * 「最初に応募する5案件」の完成資料を、1件ぶんずつ組み立てる。
 *
 * ★このファイルが存在する理由。
 *   同じ5件の話が、案件検索・応募候補・承認待ち・DRY RUN記録に散らばっている。
 *   人が「この案件に、いくらで、どの道具を使って、なぜ応募するのか」を確かめるのに
 *   4画面を行き来していると、必ずどれか1つを見落とす。
 *   見落としたまま1件目を出すと、後から「誰も見ていなかった項目」が事故になる。
 *   だからここで19項目を1か所に集め、1画面で読み切れる形にする。
 *
 *   会社側の lib/sales/dossier.ts と対になっている。作りをわざと揃えてある。
 *   片方だけ別の形にすると、片方で直した見落としがもう片方に残る。
 *
 * ★分からないものは「不明」と書く。推測で埋めない。0で埋めない。
 *   報酬が「応相談」なら budget は null のまま返し、画面が理由つきで「不明」と出す。
 *   予想利益が出せなければ null を返し、なぜ出せないかの文を添える。
 *   ここを 0円 で埋めると「利益0円と計算した」のか「計算できなかった」のか
 *   後から誰にも区別できなくなる。
 *
 * ★このファイルは1件も外部へ出さない。保存済みの記録を読んで並べ直すだけ。
 */
import { all, one, parseJson } from '../db/client';
import { ORIGIN_JA, toOrigin, type DataOrigin } from '../origin';
import { READINESS_LABEL, type Readiness } from '../catalog/definitions';
import { sitePolicy, type SitePolicy } from './sites';

/** DRY RUN（実際には応募しない予行）の記録。 */
export type JobDossierDryRun = {
  mode: string;
  executed: boolean;
  destination: string | null;
  blockReasons: string[];
  needsApproval: boolean;
  runAt: string;
};

/** 使う自社の道具。仕上がり具合まで一緒に持つ（試作を実績として書かせないため）。 */
export type DossierCap = {
  code: string;
  name: string;
  readiness: Readiness;
  readinessJa: string;
  readinessReason: string;
  hits: string[];
};

export type JobDossier = {
  rank: number;
  jobId: number;

  /** ① 案件名 */
  title: string;
  dataOrigin: DataOrigin;
  dataOriginJa: string;
  inboxSourceJa: string | null;

  /** ② サイト */
  siteCode: string;
  siteName: string;
  jobUrl: string | null;
  postedAt: string | null;
  deadline: string | null;

  /** ③ 報酬 */
  budgetMin: number | null;
  budgetMax: number | null;
  budgetTextJa: string | null;
  budgetUnsetReasonJa: string | null;

  /** ④ 仕事内容 */
  description: string;
  tasks: string[];

  /** ⑤ 応募理由（なぜこの案件を上位にしたのか） */
  applyReasonJa: string | null;
  verdictReasonJa: string | null;

  /** ⑥ 使用AI（当たった自社の道具） ⑦ 能力成熟度 */
  caps: DossierCap[];
  capsUnsetReasonJa: string | null;
  readiness: Readiness | null;
  readinessJa: string | null;
  readinessDetailJa: string | null;

  /** ⑧ AI自動化率 */
  automationRate: number | null;
  automationUnsetReasonJa: string | null;

  /** ⑨ 予想時間 ⑩ 予想利益 ⑪ 時給換算 */
  expectedHours: number | null;
  expectedProfit: number | null;
  expectedHourlyProfit: number | null;
  expectedUnavailableReasonJa: string | null;
  estimateConfidenceJa: string | null;

  /** ⑫ 受注確率 */
  winProbability: number | null;
  winProbabilityUnsetReasonJa: string | null;

  /** ⑬ 依頼主リスク */
  clientRisk: number | null;
  clientRiskReasonJa: string | null;

  /** ⑭ 修正リスク */
  revisionRisk: number | null;
  revisionRiskReasonJa: string | null;

  /** ⑮ 応募文 */
  proposalBody: string | null;
  proposalPrice: number | null;
  proposalDeliveryDays: number | null;
  proposalEvidence: string[];
  proposalUnsetReasonJa: string | null;

  /** ⑯ 規約状態 */
  policy: SitePolicy;

  /** ⑰ 人間がする作業 */
  humanWork: string[];

  /** ⑱ 受注後フロー */
  afterOrderFlow: string[];

  /** ⑲ DRY RUN の結果 */
  dryRun: JobDossierDryRun | null;
  dryRunUnsetReasonJa: string | null;

  /** 参考：第二AI監査の結果（この5件に選ばれた理由そのもの） */
  auditVerdict: string | null;
  auditNoteJa: string | null;
  auditNg: { label: string; detail: string }[];
};

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

function num(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/** 案件がどこから入ってきたかを、人がそのまま読める言い方にする。 */
const INBOX_JA: Record<string, string> = {
  EMAIL_ALERT: '求人サイトから届いた通知メール',
  MANUAL_TEXT: '人が本文を貼り付けた',
  MANUAL_URL: '人がURLを入れた',
  CSV_IMPORT: '人がCSVで取り込んだ',
  REFERRAL: '知り合い・過去の取引先からの紹介',
};

const CONFIDENCE_JA: Record<string, string> = {
  NORMAL: '見積りの確からしさ：ふつう',
  LOW: '見積りの確からしさ：低い（作業時間を短く読み違えている可能性がある）',
  HIGH: '見積りの確からしさ：高い',
};

/**
 * ⑰ 人間がする作業。
 *
 * ★「AIが全部やります」と書かないためにある欄。
 *   自動化率が9割でも、残りの1割を誰がいつやるのかを書いていなければ、
 *   受けた後に必ずその1割で詰まる。
 * ★応募そのものが人の手作業であることを、必ず先頭に書く。
 *   この仕組みには応募を送る処理コードが無いので、出すのは常に人。
 */
function humanWorkOf(
  policy: SitePolicy,
  caps: DossierCap[],
  automationRate: number | null,
  missing: string[],
): string[] {
  const out: string[] = [];

  out.push(
    policy.effectivePolicy === 'PROHIBITED'
      ? `${policy.name}は自動応募が禁止。応募するなら人が手で出す（このシステムからは出せない）。`
      : `応募は人が手で出す。${policy.name}への応募を送る処理コードがこのシステムに無いため。`,
  );

  // 仕上がりが「人の確認を必ず入れる」道具は、その確認が人の作業。
  for (const c of caps) {
    if (c.readiness === 'USABLE_WITH_REVIEW') out.push(`${c.name}の出力を、渡す前に人が1件ずつ確認して直す。`);
    if (c.readiness === 'PROTOTYPE') out.push(`${c.name}はまだ試作。実際にはほぼ手作業になる前提で見る。`);
  }

  for (const m of missing) out.push(`当たる道具が無い部分を人がやる：${m}`);

  if (automationRate !== null && automationRate < 1) {
    out.push(`自動でできない残り${Math.round((1 - automationRate) * 100)}%ぶんの作業と、依頼主とのやりとり。`);
  }

  out.push('納品も人が手で行う。納品する処理コードがこのシステムに無いため。');
  return out;
}

/**
 * ⑱ 受注後フロー。
 *
 * ★決まっていない部分を「〜する予定」と書かない。
 *   実際に走るコードがあるのは分析と応募文づくりまで。その先は全部人の手なので、そう書く。
 */
function afterOrderFlowOf(tasks: string[], deliveryDays: number | null, caps: DossierCap[]): string[] {
  const out: string[] = [];
  out.push('① 受注の連絡を受けたら、この画面の内容（報酬・納期・やること）と依頼主の言い分が同じか、人が突き合わせる。');
  out.push(
    `② 作業に入る。やること：${tasks.length > 0 ? tasks.join('・') : '（読み取れていない。着手前に人が決める）'}`
    + `${caps.length > 0 ? `／使う道具：${caps.map((c) => c.name).join('・')}` : '／当たる道具は無い（手作業）'}`,
  );
  out.push('③ 出来上がったものを人が全部読んで確認する。AIの出力をそのまま渡さない。');
  out.push(
    deliveryDays === null
      ? '④ 納品する。納期は応募文に書いていないので、受注時に依頼主と決める。'
      : `④ 納品する。応募文に書いた納期は${deliveryDays}日。`,
  );
  out.push('⑤ 受注表（orders）に金額・原価・実際にかかった時間を人が入れる。ここを入れないと、次の見積りが当たらないままになる。');
  out.push('※ ①〜⑤に自動で走る処理は1つも無い。全部、人が手で行う。');
  return out;
}

/**
 * 「最初に応募する5案件」の完成資料。
 *
 * ★final_rank が入っている案件だけを出す。
 *   final_rank は第二AIの監査に合格した案件にだけ付く番号なので、
 *   ここで点数順（opportunity_score）に取り直すと、監査で落ちた案件が資料に載る。
 * ★5件に届かなくても、数を揃えるために基準を下げない。出せる件数だけ出す。
 */
export async function jobDossiers(): Promise<JobDossier[]> {
  // ★ j.* と s.* を並べて書かない。どちらにも id があるので、
  //   後から書いたほうで静かに上書きされ、案件IDのつもりで点数の行IDを掴む事故になる。
  //   使う列だけを名指しで取る。
  const rows = await all(`
    SELECT j.id AS job_id, j.title, j.description, j.site_code, j.url, j.posted_at, j.deadline,
           j.budget_min, j.budget_max, j.budget_text, j.data_origin, j.inbox_source,
           s.expected_profit, s.expected_hours, s.expected_hourly_profit, s.ev_unavailable_reason,
           s.estimate_confidence, s.win_probability, s.client_risk, s.client_risk_reason,
           s.revision_risk, s.revision_risk_reason,
           s.capability_readiness, s.capability_readiness_detail,
           s.opportunity_reason, s.verdict_reason,
           s.audit_verdict, s.audit_note, s.final_rank
      FROM jobs j
      JOIN job_scores s ON s.job_id = j.id
     WHERE s.final_rank IS NOT NULL
     ORDER BY s.final_rank`);
  if (rows.length === 0) return [];

  const out: JobDossier[] = [];
  for (const r of rows) {
    const jobId = Number(r.job_id);

    const analysis = await one('SELECT * FROM job_analyses WHERE job_id = ?', [jobId]);
    const proposal = await one('SELECT * FROM proposals WHERE job_id = ?', [jobId]);
    const audit = await one('SELECT * FROM job_audits WHERE job_id = ?', [jobId]);
    const dry = await one("SELECT * FROM dry_runs WHERE action = 'APPLY' AND ref_table = 'jobs' AND ref_id = ?", [jobId]);
    const policy = await sitePolicy(String(r.site_code));

    const rawCaps = parseJson<{ code: string; name: string; readiness: Readiness; readinessReason?: string; hits?: string[] }[]>(
      analysis?.matched_caps,
      [],
    );
    const caps: DossierCap[] = rawCaps.map((c) => ({
      code: String(c.code),
      name: String(c.name),
      readiness: c.readiness,
      readinessJa: READINESS_LABEL[c.readiness] ?? String(c.readiness),
      readinessReason: String(c.readinessReason ?? ''),
      hits: Array.isArray(c.hits) ? c.hits.map(String) : [],
    }));
    const missing = parseJson<string[]>(analysis?.missing_caps, []);
    const tasks = parseJson<string[]>(analysis?.tasks, []);

    const budgetMin = num(r.budget_min);
    const budgetMax = num(r.budget_max);
    // 自動化の割合は分析の記録にしかない。点数表には無いので、無ければ null のままにする。
    const automationRate = num(analysis?.automation_rate);

    const readinessRaw = str(r.capability_readiness);
    const readiness = (readinessRaw && readinessRaw in READINESS_LABEL ? readinessRaw : null) as Readiness | null;

    const auditChecks = parseJson<{ label: string; detail: string; ok: boolean }[]>(audit?.checks, []);

    out.push({
      rank: Number(r.final_rank),
      jobId,

      title: String(r.title),
      dataOrigin: toOrigin(r.data_origin),
      dataOriginJa: ORIGIN_JA[toOrigin(r.data_origin)],
      inboxSourceJa: str(r.inbox_source) ? (INBOX_JA[String(r.inbox_source)] ?? String(r.inbox_source)) : null,

      siteCode: String(r.site_code),
      siteName: policy.name,
      jobUrl: str(r.url),
      postedAt: str(r.posted_at),
      deadline: str(r.deadline),

      budgetMin,
      budgetMax,
      budgetTextJa: str(r.budget_text),
      budgetUnsetReasonJa:
        budgetMin === null && budgetMax === null
          ? `案件本文に金額が書かれていない${str(r.budget_text) ? `（本文の表記は「${String(r.budget_text)}」）` : ''}。推測で数字を入れない。`
          : null,

      description: String(r.description ?? ''),
      tasks,

      applyReasonJa: str(r.opportunity_reason),
      verdictReasonJa: str(r.verdict_reason),

      caps,
      capsUnsetReasonJa: caps.length > 0 ? null : 'この案件に当たる自社の道具が1つも無い（＝ほぼ手作業になる）。',
      readiness,
      readinessJa: readiness ? READINESS_LABEL[readiness] : null,
      readinessDetailJa: str(r.capability_readiness_detail),

      automationRate,
      automationUnsetReasonJa: automationRate === null ? '自動化の割合を計算できていない（0%として扱わない）。' : null,

      expectedHours: num(r.expected_hours),
      expectedProfit: num(r.expected_profit),
      expectedHourlyProfit: num(r.expected_hourly_profit),
      expectedUnavailableReasonJa: str(r.ev_unavailable_reason),
      estimateConfidenceJa: str(r.estimate_confidence) ? (CONFIDENCE_JA[String(r.estimate_confidence)] ?? String(r.estimate_confidence)) : null,

      winProbability: num(r.win_probability),
      winProbabilityUnsetReasonJa: num(r.win_probability) === null ? '受注確率を計算できていない（0%として扱わない）。' : null,

      clientRisk: num(r.client_risk),
      clientRiskReasonJa: str(r.client_risk_reason),

      revisionRisk: num(r.revision_risk),
      revisionRiskReasonJa: str(r.revision_risk_reason),

      proposalBody: str(proposal?.body),
      proposalPrice: num(proposal?.price),
      proposalDeliveryDays: num(proposal?.delivery_days),
      proposalEvidence: parseJson<string[]>(proposal?.evidence_used, []),
      proposalUnsetReasonJa: proposal
        ? String(proposal.status) === 'READY'
          ? null
          : `応募文が使える状態ではない（${String(proposal.blocked_reason ?? proposal.status)}）。`
        : '応募文がまだ作られていない。',

      policy,

      humanWork: humanWorkOf(policy, caps, automationRate, missing),
      afterOrderFlow: afterOrderFlowOf(tasks, num(proposal?.delivery_days), caps),

      dryRun: dry
        ? {
            mode: 'DRY_RUN',
            executed: Number(dry.executed) === 1,
            destination: str(dry.channel_target),
            blockReasons: parseJson<string[]>(dry.block_reasons, []),
            needsApproval: Number(dry.needs_approval) === 1,
            runAt: String(dry.run_at),
          }
        : null,
      dryRunUnsetReasonJa: dry ? null : 'この案件ではまだ予行（DRY RUN）を1度も走らせていない。',

      auditVerdict: str(r.audit_verdict),
      auditNoteJa: str(r.audit_note),
      auditNg: auditChecks.filter((k) => !k.ok).map((k) => ({ label: String(k.label), detail: String(k.detail) })),
    });
  }
  return out;
}
