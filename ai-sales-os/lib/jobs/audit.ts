import { all, nowIso, one, upsert, type Row } from '../db/client';
import { checkExpression, similarity } from '../text';
import { num } from '../settings';
import { isReal, ORIGIN_JA, toOrigin } from '../origin';
import { EXTERNAL_ACTIONS_IMPLEMENTED } from '../env';
import { READINESS_LABEL, type Readiness } from '../catalog/definitions';
import { findExclusions } from './exclude';
import { sitePolicy, TOS_RECHECK_DAYS, type SitePolicy } from './sites';

/**
 * 応募候補の案件を、点をつけた仕組みとは別の目で検査する（PHASE 16）。
 *
 * ★なぜ別に作るのか。
 *   案件を読み取ったのは analyze.ts、点をつけたのは score.ts と opportunity.ts、
 *   応募文を書いたのは proposal.ts。この3つは同じ読み取り結果を土台にしている。
 *   つまり読み取りが間違っていたとき（例：拘束条件を見落とした、予算を取り違えた）は、
 *   3つそろって「問題なし」と答える。営業側で実際にその事故が起きた。
 *
 *   だからここは、保存されている案件本文・応募文の文字列と、規約台帳だけを入口にする。
 *   誰がどう読み取ったかは見ない。足切りは自分でもう一度かけ直す。
 *   応募文の引用は、本当に案件本文にあるかを1件ずつ照合し直す。
 *
 * ★判定は4つ。営業側（lib/sales/audit-copy.ts）と同じ言葉を使う。
 *   PASS         … 人が見て、応募してよい
 *   REWRITE      … 機械で直せる。直してもう一度かける
 *   HUMAN_REVIEW … 機械では判断できない。人が読む
 *   BLOCK        … 候補から外す
 *
 * ★合格を増やすために検査をゆるめない。
 *   BLOCKが多いのは検査が厳しすぎるのではなく、案件か応募文に問題があるということ。
 *
 * ★ここでも応募はしない。外部へ応募する処理コードはこのシステムに存在しない。
 */

export const JOB_AUDITOR_VERSION = 'job-auditor-v1';

export type AuditVerdict = 'PASS' | 'REWRITE' | 'HUMAN_REVIEW' | 'BLOCK';

/** 悪いほうから順。いちばん重いものが、その案件の判定になる。 */
const SEVERITY_ORDER: AuditVerdict[] = ['PASS', 'REWRITE', 'HUMAN_REVIEW', 'BLOCK'];
function worst(a: AuditVerdict, b: AuditVerdict): AuditVerdict {
  return SEVERITY_ORDER.indexOf(a) >= SEVERITY_ORDER.indexOf(b) ? a : b;
}

export const VERDICT_JA: Record<AuditVerdict, string> = {
  PASS: '合格',
  REWRITE: '書き直し',
  HUMAN_REVIEW: '人が読む',
  BLOCK: '候補から外す',
};

export type AuditCheck = {
  code: string;
  /** 人がそのまま読める検査項目名。 */
  label: string;
  ok: boolean;
  /** ok=false のときの重さ。ok=true なら 'PASS'。 */
  severity: AuditVerdict;
  /** なぜそう判定したか。合格でも根拠を残す。 */
  detail: string;
};

export type JobAudit = {
  jobId: number;
  jobTitle: string;
  siteCode: string;
  proposalId: number | null;
  verdict: AuditVerdict;
  checks: AuditCheck[];
  ngCount: number;
  /** 書き直しで直せる見込みがあるか（落ちた項目が全部 REWRITE のときだけ true）。 */
  fixable: boolean;
};

export type JobAuditInput = {
  /** jobs の行そのもの。読み取った側の内部状態は受け取らない。 */
  job: Row;
  /** job_scores の行。 */
  score: Row | null;
  /** proposals の行。無ければ null。 */
  proposal: Row | null;
  /** applications の行。実行済みフラグが立っていないかを確かめる。 */
  application: Row | null;
};

const flat = (s: string): string => s.replace(/\s+/g, '').toLowerCase();

function n(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

// ── 検査1: 本物の案件か ────────────────────────────────────────

function checkRealOrigin(job: Row): AuditCheck {
  const label = '本物の案件である';
  const origin = toOrigin(job.data_origin);
  if (!isReal(job.data_origin)) {
    return {
      code: 'REAL_ORIGIN',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: '練習用（TEST）の案件。実在しない依頼なので、応募候補にはしない。',
    };
  }
  const inbox = job.inbox_source ? String(job.inbox_source) : '';
  if (inbox === '') {
    return {
      code: 'REAL_ORIGIN',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: '本物として記録されているのに、どこから入ってきたかが残っていない。素性の分からない案件には応募しない。',
    };
  }
  return { code: 'REAL_ORIGIN', label, ok: true, severity: 'PASS', detail: `${ORIGIN_JA[origin]}（入口＝${inbox}）。` };
}

// ── 検査2: 同じ依頼に二重で応募しない ──────────────────────────

async function checkNotDuplicate(job: Row): Promise<AuditCheck> {
  const label = '同じ依頼に二重で応募しない';
  const dup = n(job.duplicate_of);
  if (dup !== null) {
    const orig = await one('SELECT id, site_code FROM jobs WHERE id = ?', [dup]);
    return {
      code: 'NOT_DUPLICATE',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `同じ依頼が既にある（案件#${dup}${orig ? `／${orig.site_code}` : ''}）。${job.duplicate_reason ?? '根拠は残っていない'}`,
    };
  }
  // 逆向きも見る。この案件を「同じ依頼」として指している案件があるなら、こちらが本体。
  const children = await all('SELECT id FROM jobs WHERE duplicate_of = ?', [Number(job.id)]);
  return {
    code: 'NOT_DUPLICATE',
    label,
    ok: true,
    severity: 'PASS',
    detail: children.length === 0 ? '同じ依頼は他に無い。' : `この案件が本体で、同じ依頼が他に${children.length}件ある（そちらへは応募しない）。`,
  };
}

// ── 検査3: 足切りに当たっていない（自分でかけ直す） ────────────

async function checkHardBlock(job: Row): Promise<AuditCheck> {
  const label = '足切りに当たっていない';

  // 保存されている足切り記録
  const saved = await all('SELECT rule_code, matched_text FROM job_exclusions WHERE job_id = ?', [Number(job.id)]);
  if (saved.length > 0) {
    return {
      code: 'HARD_BLOCK',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `受けない条件に当たっている（${saved.map((r) => `${r.rule_code}＝「${String(r.matched_text).slice(0, 24)}」`).join('／')}）。`,
    };
  }

  // ★ここが「別の目」の要。保存された記録を信じず、本文にもう一度かけ直す。
  //   取り込んだ時点の足切り規則が古かった案件は、記録が0件のまま残っている。
  //
  // ★かけ直しには findExclusions（ただ読むだけの関数）を使う。
  //   evaluateExclusions は job_exclusions を消して書き直すので、ここでは呼べない。
  //   監査が対象を書き換えてしまうと、
  //   「監査したから判定が変わった」のか「元から問題があった」のかが区別できなくなる。
  //   実際にそれで、1件目を監査した副作用が2件目以降の判定に混ざる事故を起こした。
  const text = [job.title, job.description, job.work_style, job.category].filter(Boolean).map(String).join('\n');
  const again = findExclusions(text);
  if (again.length > 0) {
    return {
      code: 'HARD_BLOCK',
      label,
      ok: false,
      severity: 'BLOCK',
      detail:
        `取り込んだ時には足切りに掛からなかったが、いま本文を読み直すと当たっている（`
        + `${again.map((h) => `${h.label}＝「${h.matched.slice(0, 24)}」`).join('／')}）。取り込み後に足切りの規則が増えたため。`,
    };
  }
  return { code: 'HARD_BLOCK', label, ok: true, severity: 'PASS', detail: '本文を読み直しても、受けない条件（拘束時間・常駐・AI利用禁止など）には当たらない。' };
}

// ── 検査4: そのサイトの規約 ────────────────────────────────────

function checkSiteTos(policy: SitePolicy): AuditCheck {
  const label = 'サイトの規約を確かめてある';
  if (policy.effectivePolicy === 'PROHIBITED') {
    return { code: 'SITE_TOS', label, ok: false, severity: 'BLOCK', detail: `${policy.name}は自動での応募を禁止している。${policy.reasonJa}` };
  }
  if (policy.effectivePolicy === 'UNKNOWN') {
    return {
      code: 'SITE_TOS',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `${policy.name}の規約を確かめられていない。${policy.reasonJa} 応募の前に人が規約を読む必要がある。`,
    };
  }
  if (policy.staleDays !== null && policy.staleDays > TOS_RECHECK_DAYS) {
    return {
      code: 'SITE_TOS',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `${policy.name}の規約を最後に確かめたのが${policy.staleDays}日前（${TOS_RECHECK_DAYS}日を超えた）。読み直しが要る。`,
    };
  }
  const via = policy.effectivePolicy === 'APPROVAL_REQUIRED' ? '人が承認してから出す前提' : '自動で出してよい';
  return {
    code: 'SITE_TOS',
    label,
    ok: true,
    severity: 'PASS',
    detail: `${policy.name}＝${via}。${policy.checkedAt ? `${policy.checkedAt.slice(0, 10)}に規約を確認済み。` : ''}`,
  };
}

// ── 検査5: 応募文がある ────────────────────────────────────────

function checkProposalExists(p: Row | null): AuditCheck {
  const label = '応募文ができている';
  if (!p) {
    return { code: 'PROPOSAL_EXISTS', label, ok: false, severity: 'REWRITE', detail: '応募文がまだ作られていない。' };
  }
  const status = String(p.status ?? '');
  if (status !== 'READY') {
    return {
      code: 'PROPOSAL_EXISTS',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `応募文が止まっている（${status}）。理由：${p.blocked_reason ?? '記録なし'}`,
    };
  }
  const body = String(p.body ?? '');
  if (flat(body).length < 80) {
    return { code: 'PROPOSAL_EXISTS', label, ok: false, severity: 'REWRITE', detail: `応募文が短すぎる（${flat(body).length}文字）。中身が無い。` };
  }
  return { code: 'PROPOSAL_EXISTS', label, ok: true, severity: 'PASS', detail: `応募文あり（${flat(body).length}文字）。` };
}

// ── 検査6: 応募文の引用が案件本文にある ────────────────────────

/** 応募文の中の「」の中身。自社の道具の名前は引用ではないので外す。 */
function quotesOf(body: string, capNames: string[]): string[] {
  const skip = new Set(capNames.map(flat));
  const out: string[] = [];
  for (const m of body.matchAll(/「([^「」]{1,200})」/g)) {
    const q = m[1].trim();
    if (q.length === 0) continue;
    if (skip.has(flat(q))) continue;
    if (!out.includes(q)) out.push(q);
  }
  return out;
}

function checkProposalGrounded(job: Row, p: Row | null, capNames: string[]): AuditCheck {
  const label = '応募文が案件本文に基づいている';
  if (!p || String(p.status ?? '') !== 'READY') {
    return { code: 'PROPOSAL_GROUNDED', label, ok: true, severity: 'PASS', detail: '応募文が無いので、照合するものも無い。' };
  }
  const body = String(p.body ?? '');
  const source = flat(`${String(job.title ?? '')} ${String(job.description ?? '')}`);
  const quotes = quotesOf(body, capNames);
  const missing = quotes.filter((q) => {
    const k = flat(q);
    if (k.length === 0) return false;
    return !source.includes(k);
  });
  if (missing.length > 0) {
    return {
      code: 'PROPOSAL_GROUNDED',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `案件本文に無い言葉を、本文にあるかのように引用している（${missing.map((q) => `「${q.slice(0, 30)}」`).join('・')}）。作り話の引用。`,
    };
  }
  if (quotes.length === 0) {
    return {
      code: 'PROPOSAL_GROUNDED',
      label,
      ok: false,
      severity: 'REWRITE',
      detail: '案件本文から引いた言葉が1つも無い。どの案件にも出せるテンプレ文になっている。',
    };
  }
  return { code: 'PROPOSAL_GROUNDED', label, ok: true, severity: 'PASS', detail: `引用${quotes.length}件すべてが案件本文の中にある。` };
}

// ── 検査7: 使えない表現・誇張がない ────────────────────────────

/** 景表法で即NGではないが、根拠なく書けば優良誤認に寄る言い回し。 */
const PUFFERY_RE = /(圧倒的|劇的に|確実に|必ず|完全自動|すべて自動|誰でも簡単に|業界最|どこよりも|最速で)/;
/** 数字を出した効果の主張。根拠が要るので機械では合否を決めない。 */
const NUMERIC_CLAIM_RE = /\d+\s*(%|％|割|倍)\s*(削減|改善|向上|アップ|増|減)/;

function checkExaggeration(p: Row | null): AuditCheck {
  const label = '誇張・使えない表現がない';
  if (!p) return { code: 'EXAGGERATION', label, ok: true, severity: 'PASS', detail: '応募文が無いので対象なし。' };
  const body = String(p.body ?? '');
  const legal = checkExpression(body);
  if (legal.length > 0) {
    return {
      code: 'EXAGGERATION',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `景表法などで使えない表現（${legal.map((e) => `「${e.matched}」＝${e.why}`).join('／')}）。`,
    };
  }
  const numeric = NUMERIC_CLAIM_RE.exec(body);
  if (numeric) {
    return {
      code: 'EXAGGERATION',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `数字で効果を書いている（「${numeric[0]}」）。その数字の根拠を人が確かめないと優良誤認になる。`,
    };
  }
  // 相手（依頼主）の文章を引用した部分は、こちらの誇張ではないので外してから調べる。
  const ours = body.replace(/「[^「」]{0,200}」/g, '');
  const puff = PUFFERY_RE.exec(ours);
  if (puff) {
    return { code: 'EXAGGERATION', label, ok: false, severity: 'REWRITE', detail: `根拠のない強調表現（「${puff[0]}」）。` };
  }
  return { code: 'EXAGGERATION', label, ok: true, severity: 'PASS', detail: '断定・最上級・数字での効果の主張はいずれも無い。' };
}

// ── 検査8: 応募文が文章として成立している ──────────────────────

const TEMPLATE_LEAK_RE = /(\$\{|undefined|\bnull\b|NaN|\[object Object\]|不明円|NaN円)/;

function checkNaturalness(p: Row | null): AuditCheck {
  const label = '応募文が文章として成立している';
  if (!p) return { code: 'NATURALNESS', label, ok: true, severity: 'PASS', detail: '応募文が無いので対象なし。' };
  const body = String(p.body ?? '');
  const ng: string[] = [];

  const leak = TEMPLATE_LEAK_RE.exec(body);
  if (leak) ng.push(`穴埋めの記号がそのまま残っている（「${leak[0]}」）`);
  const opens = (body.match(/「/g) ?? []).length;
  const closes = (body.match(/」/g) ?? []).length;
  if (opens !== closes) ng.push(`かぎかっこの数が合わない（開き${opens}・閉じ${closes}）`);
  if (/[、。]{2,}/.test(body)) ng.push('句読点が続いている');

  const sentences = body
    .split(/[\n。]/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
  const dupes = new Set<string>();
  const seen = new Set<string>();
  for (const s of sentences) {
    const k = flat(s);
    if (seen.has(k)) dupes.add(k);
    seen.add(k);
  }
  if (dupes.size > 0) ng.push(`同じ文の繰り返し${dupes.size}件`);
  if (!/(お願い|よろしく)/.test(body)) ng.push('締めの挨拶が無い');

  if (ng.length > 0) return { code: 'NATURALNESS', label, ok: false, severity: 'REWRITE', detail: ng.join('／') };
  return { code: 'NATURALNESS', label, ok: true, severity: 'PASS', detail: `${sentences.length}文。穴埋めの残り・繰り返しは無い。` };
}

// ── 検査9: 見積りと納期が書いてある ────────────────────────────

function checkOfferTerms(p: Row | null): AuditCheck {
  const label = '見積りと納期が書いてある';
  if (!p) return { code: 'OFFER_TERMS', label, ok: false, severity: 'REWRITE', detail: '応募文が無い。' };
  const body = String(p.body ?? '');
  const price = n(p.price);
  const days = n(p.delivery_days);
  const ng: string[] = [];
  if (price === null) ng.push('出す金額が決まっていない');
  else if (price <= 0) ng.push(`出す金額が${price}円になっている（0円や負の金額は出せない）`);
  else if (!body.includes(price.toLocaleString())) ng.push('決めた金額が応募文に書かれていない');
  if (days === null || days <= 0) ng.push('納期が決まっていない');
  else if (!body.includes(`${days}日`)) ng.push('決めた納期が応募文に書かれていない');
  if (ng.length > 0) return { code: 'OFFER_TERMS', label, ok: false, severity: 'REWRITE', detail: ng.join('／') };
  return { code: 'OFFER_TERMS', label, ok: true, severity: 'PASS', detail: `見積り${Number(price).toLocaleString()}円／納期${days}日が、本文にそのまま書かれている。` };
}

// ── 検査10: 使い回しの応募文になっていない ─────────────────────

async function checkNotBoilerplate(job: Row, p: Row | null): Promise<AuditCheck> {
  const label = '使い回しの応募文ではない';
  if (!p) return { code: 'NOT_BOILERPLATE', label, ok: true, severity: 'PASS', detail: '応募文が無いので対象なし。' };
  const personal = String(p.personal_text ?? '');
  const limit = await num('draft.max_similarity');
  // ★ここでも保存済みの similarity_max を信じない。いま在るREADYの応募文と比べ直す。
  const rows = await all("SELECT job_id, personal_text FROM proposals WHERE job_id <> ? AND status = 'READY' ORDER BY id DESC LIMIT 200", [Number(job.id)]);
  let max = 0;
  let against: number | null = null;
  for (const r of rows) {
    const s = similarity(personal, String(r.personal_text ?? ''));
    if (s > max) {
      max = s;
      against = Number(r.job_id);
    }
  }
  const score = Number(max.toFixed(3));
  if (score > limit) {
    return {
      code: 'NOT_BOILERPLATE',
      label,
      ok: false,
      severity: 'REWRITE',
      detail: `他の応募文と似すぎている（案件#${against}と一致度${score}／上限${limit}）。`,
    };
  }
  return {
    code: 'NOT_BOILERPLATE',
    label,
    ok: true,
    severity: 'PASS',
    detail: rows.length === 0 ? '比べる応募文がまだ無い。' : `他の応募文${rows.length}件と比べて、いちばん似ているものでも一致度${score}（上限${limit}）。`,
  };
}

// ── 検査11: できないことをできると書いていない ─────────────────

const PROVEN_CLAIM_RE = /(実際に(運用|納品|制作)|実績(が|は)?あります|運用しています|納品しています|多数の実績)/;

function checkCapabilityHonesty(score: Row | null, p: Row | null): AuditCheck {
  const label = 'できないことをできると書いていない';
  const readiness = (score?.capability_readiness ? String(score.capability_readiness) : 'NONE') as Readiness | 'NONE';
  const body = p ? String(p.body ?? '') : '';

  if (readiness === 'NONE' || readiness === 'NOT_SELLABLE') {
    return {
      code: 'CAPABILITY_HONESTY',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `この案件に当てられる自社の道具が無い（${score?.capability_readiness_detail ?? '内訳なし'}）。作れないものを受けることになる。`,
    };
  }
  if (readiness === 'PROTOTYPE') {
    return {
      code: 'CAPABILITY_HONESTY',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `当てられる道具が試作の段階（${READINESS_LABEL[readiness]}）。納期どおり出せるかを人が確かめる。`,
    };
  }
  // 仕上がりが「レビュー付きで使える」段階なのに、実績として言い切っていないか
  const claim = PROVEN_CLAIM_RE.exec(body);
  if (claim && readiness !== 'PRODUCTION_READY') {
    return {
      code: 'CAPABILITY_HONESTY',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `応募文が「${claim[0]}」と実績を言い切っているが、道具の仕上がりは${READINESS_LABEL[readiness]}。優良誤認になる。`,
    };
  }
  return { code: 'CAPABILITY_HONESTY', label, ok: true, severity: 'PASS', detail: `道具の仕上がり＝${READINESS_LABEL[readiness]}。書いてある内容と食い違わない。` };
}

// ── 検査12: 数字を推測で埋めていない ───────────────────────────

async function checkMoneyHonesty(job: Row, score: Row | null): Promise<AuditCheck> {
  const label = '数字を推測で埋めていない';
  if (!score) return { code: 'MONEY_HONESTY', label, ok: false, severity: 'BLOCK', detail: '点がついていない案件。順番を決める根拠が無い。' };

  const bMin = n(job.budget_min);
  const bMax = n(job.budget_max);
  const profit = n(score.expected_profit);
  const hours = n(score.expected_hours);
  const hourly = n(score.expected_hourly_profit);

  // ★UNKNOWNを0で埋めていないか。0円・0時間は「不明」を数字にすり替えた跡。
  const zeros: string[] = [];
  if (bMin === 0) zeros.push('予算の下限が0円');
  if (bMax === 0) zeros.push('予算の上限が0円');
  if (hours === 0) zeros.push('予想作業時間が0時間');
  if (zeros.length > 0) {
    return { code: 'MONEY_HONESTY', label, ok: false, severity: 'BLOCK', detail: `不明な数字が0で埋まっている（${zeros.join('・')}）。不明は不明のまま持つ決まり。` };
  }

  // 予算がどこにも書かれていないのに利益を出しているのは、推測で埋めた跡。
  if (bMin === null && bMax === null && profit !== null) {
    return {
      code: 'MONEY_HONESTY',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `案件に予算が書かれていない（本文の表記＝${job.budget_text ?? 'なし'}）のに、予想利益${profit.toLocaleString()}円が出ている。何を根拠にした金額か人が確かめる。`,
    };
  }
  if (profit === null || hours === null || hourly === null) {
    return {
      code: 'MONEY_HONESTY',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `利益・時間・時給のどれかが出せていない（${score.ev_unavailable_reason ?? '理由の記録なし'}）。数字が無いまま順番だけ付けても比べられない。`,
    };
  }

  const minHourly = await num('job.min_hourly');
  const targetHourly = await num('job.target_hourly');
  if (hourly < minHourly) {
    return {
      code: 'MONEY_HONESTY',
      label,
      ok: false,
      severity: 'BLOCK',
      detail: `時間あたりの利益が${hourly.toLocaleString()}円で、最低ライン${minHourly.toLocaleString()}円を下回る。`,
    };
  }
  if (String(score.estimate_confidence ?? '') === 'LOW') {
    return {
      code: 'MONEY_HONESTY',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `見積りの確からしさが低い。予想${hours}時間が短すぎる可能性がある。応募前に人が時間を見直す。`,
    };
  }
  if (hourly > targetHourly * 5) {
    return {
      code: 'MONEY_HONESTY',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `時間あたりの利益が${hourly.toLocaleString()}円と、目標${targetHourly.toLocaleString()}円の5倍を超えている。見積り時間が短すぎるか、予算の読み違いを疑う。`,
    };
  }
  return {
    code: 'MONEY_HONESTY',
    label,
    ok: true,
    severity: 'PASS',
    detail: `予想利益${profit.toLocaleString()}円／${hours}時間／時給${hourly.toLocaleString()}円。0で埋めた欄は無い。`,
  };
}

// ── 検査13: 依頼主・手直しの危なさ ─────────────────────────────

/** これ以上は人が読む。点の付け方は lib/jobs/opportunity.ts 側。 */
export const CLIENT_RISK_REVIEW = 40;
export const REVISION_RISK_REVIEW = 60;

function checkRisk(score: Row | null): AuditCheck {
  const label = '依頼主と手直しの危なさが許容内';
  if (!score) return { code: 'RISK', label, ok: false, severity: 'BLOCK', detail: '点がついていない案件。' };
  const client = n(score.client_risk);
  const revision = n(score.revision_risk);
  if (client === null || revision === null) {
    return { code: 'RISK', label, ok: false, severity: 'HUMAN_REVIEW', detail: '依頼主の危なさ・手直しの起きやすさが出ていない。' };
  }
  if (client >= CLIENT_RISK_REVIEW) {
    return {
      code: 'RISK',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `依頼主の危なさが${client}点（${CLIENT_RISK_REVIEW}点以上）。理由：${score.client_risk_reason ?? '記録なし'}`,
    };
  }
  if (revision >= REVISION_RISK_REVIEW) {
    return {
      code: 'RISK',
      label,
      ok: false,
      severity: 'HUMAN_REVIEW',
      detail: `手直しの起きやすさが${revision}点（${REVISION_RISK_REVIEW}点以上）。理由：${score.revision_risk_reason ?? '記録なし'}`,
    };
  }
  return { code: 'RISK', label, ok: true, severity: 'PASS', detail: `依頼主の危なさ${client}点／手直しの起きやすさ${revision}点。どちらも人が止めるほどではない。` };
}

// ── 検査14: まだ1件も外へ出していない ──────────────────────────

function checkNoExternalAction(app: Row | null): AuditCheck {
  const label = 'まだ1件も外へ出していない';
  if (EXTERNAL_ACTIONS_IMPLEMENTED) {
    return { code: 'NO_EXTERNAL_ACTION', label, ok: false, severity: 'BLOCK', detail: '外部へ応募する処理が有効になっている。この監査は応募前提で作られていない。' };
  }
  if (app && Number(app.executed ?? 0) !== 0) {
    return { code: 'NO_EXTERNAL_ACTION', label, ok: false, severity: 'BLOCK', detail: 'この案件に「応募済み」の印が付いている。実際には応募していないはずなので、記録が壊れている。' };
  }
  const route = app ? String(app.route ?? '') : '未記録';
  return { code: 'NO_EXTERNAL_ACTION', label, ok: true, severity: 'PASS', detail: `応募は0件（外部へ応募する処理コードがそもそも無い）。想定の出し方＝${route}。` };
}

// ── 監査の本体 ─────────────────────────────────────────────────

function capNamesOf(matchedCaps: unknown): string[] {
  try {
    const ms = JSON.parse(String(matchedCaps ?? '[]')) as { name?: string }[];
    return ms.map((m) => String(m.name ?? '')).filter((s) => s.length > 0);
  } catch {
    return [];
  }
}

export async function auditJob(input: JobAuditInput): Promise<JobAudit> {
  const job = input.job;
  const analysis = await one('SELECT matched_caps FROM job_analyses WHERE job_id = ?', [Number(job.id)]);
  const capNames = capNamesOf(analysis?.matched_caps);
  const policy = await sitePolicy(String(job.site_code ?? ''));

  const checks: AuditCheck[] = [
    checkRealOrigin(job),
    await checkNotDuplicate(job),
    await checkHardBlock(job),
    checkSiteTos(policy),
    checkProposalExists(input.proposal),
    checkProposalGrounded(job, input.proposal, capNames),
    checkExaggeration(input.proposal),
    checkNaturalness(input.proposal),
    checkOfferTerms(input.proposal),
    await checkNotBoilerplate(job, input.proposal),
    checkCapabilityHonesty(input.score, input.proposal),
    await checkMoneyHonesty(job, input.score),
    checkRisk(input.score),
    checkNoExternalAction(input.application),
  ];

  let verdict: AuditVerdict = 'PASS';
  for (const k of checks) if (!k.ok) verdict = worst(verdict, k.severity);

  const failed = checks.filter((k) => !k.ok);
  // 直せるのは、落ちた項目が全部 REWRITE のときだけ。
  // BLOCK・HUMAN_REVIEW が1つでもあれば、応募文を書き直しても同じところで落ちる。
  const fixable = failed.length > 0 && failed.every((k) => k.severity === 'REWRITE');

  return {
    jobId: Number(job.id),
    jobTitle: String(job.title ?? ''),
    siteCode: String(job.site_code ?? ''),
    proposalId: input.proposal?.id === undefined || input.proposal?.id === null ? null : Number(input.proposal.id),
    verdict,
    checks,
    ngCount: failed.length,
    fixable,
  };
}

export async function saveJobAudit(a: JobAudit, verdictFirst: AuditVerdict, rewritten: boolean, rewriteNote: string | null): Promise<void> {
  await upsert(
    'job_audits',
    {
      job_id: a.jobId,
      job_title: a.jobTitle,
      site_code: a.siteCode,
      proposal_id: a.proposalId,
      verdict: a.verdict,
      verdict_first: verdictFirst,
      rewritten: rewritten ? 1 : 0,
      rewrite_note: rewriteNote,
      checks: JSON.stringify(a.checks),
      ng_count: a.ngCount,
      auditor_version: JOB_AUDITOR_VERSION,
      audited_at: nowIso(),
    },
    ['job_id'],
  );
}
