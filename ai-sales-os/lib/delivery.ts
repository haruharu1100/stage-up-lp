import { all, insert, nowIso, one, parseJson, run, type Row } from './db/client';
import { checkExpression } from './text';
import { checkExternalAction } from './gate';
import { enqueueApproval, EMPTY_DETAIL, type ApprovalDetail } from './approval';

/**
 * 受注してから納品までの流れ。
 *
 *   タスク分解 → 制作 → 自分で見直す → 別の目で見直す → 直す → 人間の確認 → 納品
 *
 * ★人間の確認（human_confirmed）を飛ばして納品状態にはできない。
 *   ここは自動化しない。作ったものをそのまま客に出さない。
 * ★納品そのものの処理コードはこのシステムに無い（gate.ts で止まる）。
 */

export type ReviewFinding = { code: string; detailJa: string; severity: 'BLOCK' | 'WARN' };
export type Review = { passed: boolean; findings: ReviewFinding[]; checkedAt: string };

/** 自分で作ったものを、自分で見直す。機械で分かることだけを見る。 */
export function selfReview(content: string, task: string): Review {
  const findings: ReviewFinding[] = [];
  const ng = checkExpression(content);
  for (const e of ng) findings.push({ code: 'EXPRESSION', detailJa: `使えない表現「${e.matched}」（${e.why}）`, severity: 'BLOCK' });
  if (content.trim().length < 100) findings.push({ code: 'TOO_SHORT', detailJa: '中身が短すぎる（100文字未満）', severity: 'BLOCK' });
  if (/(ここに[^。]{0,10}を書く|TODO|未記入|xxx|サンプルテキスト|ダミー)/i.test(content)) findings.push({ code: 'PLACEHOLDER', detailJa: '書きかけの印（TODO・サンプルテキストなど）が残っている', severity: 'BLOCK' });
  if (!content.includes('\n')) findings.push({ code: 'NO_STRUCTURE', detailJa: '改行が無く、読みにくい', severity: 'WARN' });
  if (!new RegExp(task.slice(0, 6)).test(content)) findings.push({ code: 'OFF_TOPIC', detailJa: `依頼された作業「${task}」の言葉が本文に出てこない`, severity: 'WARN' });
  return { passed: findings.every((f) => f.severity !== 'BLOCK'), findings, checkedAt: nowIso() };
}

/**
 * 別の目で見直す。
 * 自分の書いたものを自分で採点すると甘くなるので、観点を変えて数える。
 */
export function peerReview(content: string, jobDescription: string): Review {
  const findings: ReviewFinding[] = [];
  // 依頼文の中の名詞が、成果物に反映されているか
  const keywords = Array.from(new Set((jobDescription.match(/[一-龥ァ-ヶA-Za-z]{3,}/g) ?? []).slice(0, 40)));
  const covered = keywords.filter((k) => content.includes(k));
  const rate = keywords.length === 0 ? 0 : covered.length / keywords.length;
  if (keywords.length === 0) findings.push({ code: 'NO_SPEC', detailJa: '依頼文から確認すべき言葉を拾えない', severity: 'WARN' });
  else if (rate < 0.15) findings.push({ code: 'LOW_COVERAGE', detailJa: `依頼文の内容が成果物にほとんど反映されていない（${Math.round(rate * 100)}%）`, severity: 'BLOCK' });
  if (/私は|弊社は/.test(content) && !/です|ます/.test(content)) findings.push({ code: 'TONE', detailJa: '文体が揃っていない', severity: 'WARN' });
  return { passed: findings.every((f) => f.severity !== 'BLOCK'), findings, checkedAt: nowIso() };
}

export function qualityScore(self: Review, peer: Review): number {
  const blocks = [...self.findings, ...peer.findings].filter((f) => f.severity === 'BLOCK').length;
  const warns = [...self.findings, ...peer.findings].filter((f) => f.severity === 'WARN').length;
  return Math.max(0, 100 - blocks * 40 - warns * 10);
}

export async function addDeliverable(args: { orderId: number; taskName: string; content: string; jobDescription: string }): Promise<{ id: number; quality: number; passed: boolean; self: Review; peer: Review }> {
  const self = selfReview(args.content, args.taskName);
  const peer = peerReview(args.content, args.jobDescription);
  const quality = qualityScore(self, peer);
  const id = await insert('deliverables', {
    order_id: args.orderId,
    task_name: args.taskName,
    content: args.content,
    self_review: JSON.stringify(self),
    peer_review: JSON.stringify(peer),
    quality_score: quality,
    human_confirmed: 0,
    created_at: nowIso(),
  });
  return { id: Number(id ?? 0), quality, passed: self.passed && peer.passed, self, peer };
}

/** 人間が中身を見て確認した、という記録。ここだけは自動でつけない。 */
export async function confirmDeliverable(id: number): Promise<{ ok: boolean; reasonJa: string }> {
  const d = await one('SELECT * FROM deliverables WHERE id = ?', [id]);
  if (!d) return { ok: false, reasonJa: '対象が見つからない' };
  const self = parseJson<Review>(d.self_review, { passed: false, findings: [], checkedAt: '' });
  const peer = parseJson<Review>(d.peer_review, { passed: false, findings: [], checkedAt: '' });
  if (!self.passed || !peer.passed) {
    return { ok: false, reasonJa: '直すべき点が残っているので確認済みにできない（先に修正する）' };
  }
  await run('UPDATE deliverables SET human_confirmed = 1 WHERE id = ?', [id]);
  return { ok: true, reasonJa: '人間の確認を記録した' };
}

export type DeliveryCheck = { orderId: number; ready: boolean; reasonJa: string; total: number; confirmed: number };

/** 納品してよい状態か。1つでも人間未確認が残っていれば納品候補にしない。 */
export async function deliveryReadiness(orderId: number): Promise<DeliveryCheck> {
  const rows = await all('SELECT human_confirmed, quality_score FROM deliverables WHERE order_id = ?', [orderId]);
  const total = rows.length;
  const confirmed = rows.filter((r) => Number(r.human_confirmed) === 1).length;
  if (total === 0) return { orderId, ready: false, reasonJa: '成果物がまだ1つも無い', total, confirmed };
  if (confirmed < total) return { orderId, ready: false, reasonJa: `人間の確認が済んでいない成果物が${total - confirmed}件ある`, total, confirmed };
  const gate = checkExternalAction('DELIVER');
  return { orderId, ready: false, reasonJa: `全て確認済み。ただし${gate.reasonJa}`, total, confirmed };
}

/**
 * 承認画面に出す中身（納品）。
 * 何を作ったのか・自分と別の目で見て何が引っかかったのかを、その画面だけで読めるようにする。
 */
async function buildDeliverDetail(order: Row, check: DeliveryCheck): Promise<ApprovalDetail> {
  const rows = await all('SELECT * FROM deliverables WHERE order_id = ? ORDER BY id', [Number(order.id)]);
  const risks: string[] = [];
  const bodies: string[] = [];
  for (const d of rows) {
    const self = parseJson<Review>(d.self_review, { passed: false, findings: [], checkedAt: '' });
    const peer = parseJson<Review>(d.peer_review, { passed: false, findings: [], checkedAt: '' });
    for (const f of [...self.findings, ...peer.findings]) {
      risks.push(`${String(d.task_name)}：${f.detailJa}（${f.severity === 'BLOCK' ? '直すべき' : '気になる程度'}）`);
    }
    bodies.push(`── ${String(d.task_name)} ──\n${String(d.content)}`);
  }
  risks.push('承認を押しても納品は起きない。納品を送る処理コードがこのシステムに無いため。');

  const amount = order.amount === null ? null : Number(order.amount);
  const cost = Number(order.cost ?? 0);
  const hours = order.actual_hours !== null && order.actual_hours !== undefined ? Number(order.actual_hours) : order.planned_hours !== null && order.planned_hours !== undefined ? Number(order.planned_hours) : null;
  const profit = amount === null ? null : amount - cost;

  return {
    ...EMPTY_DETAIL,
    subtitle: `${order.site_code ? String(order.site_code) : '取得元不明'} ／ 成果物${check.total}件（人間確認済み${check.confirmed}件）`,
    offer: `受注金額 ${amount === null ? '—' : `${amount.toLocaleString()}円`} の納品物`,
    whyChosen: ['成果物がすべて人間の確認を通っているので、納品候補として並べている。'],
    scores: rows.map((d) => ({ label: `品質点：${String(d.task_name)}`, value: d.quality_score === null ? '—' : String(Number(d.quality_score)) })),
    expectedProfit: profit,
    expectedProfitNote: amount === null ? '受注金額が入っていないので利益を出せない' : null,
    expectedHours: hours,
    expectedHourlyProfit: profit !== null && hours !== null && hours > 0 ? Math.round(profit / hours) : null,
    capabilities: [],
    policy: { label: '納品は自動で送らない', kind: 'warn', reason: '納品の送信処理はこのシステムに存在しない。実際の受け渡しは人が行う。', checkedAt: null },
    body: bodies.join('\n\n'),
    risks,
    sources: [],
    excludeKind: null,
    textRef: null,
  };
}

/** 納品候補として、人の最終確認キューに載せる。ここでも送信はしない。 */
export async function queueDelivery(order: Row): Promise<DeliveryCheck> {
  const orderId = Number(order.id);
  const check = await deliveryReadiness(orderId);
  if (check.confirmed > 0 && check.confirmed === check.total) {
    await enqueueApproval({
      kind: 'DELIVER',
      refTable: 'orders',
      refId: orderId,
      title: String(order.title),
      summary: `成果物${check.total}件（すべて人間確認済み）`,
      riskNote: '納品の送信処理はこのシステムに存在しない。実際の受け渡しは人が行う。',
      detail: await buildDeliverDetail(order, check),
    });
  }
  return check;
}
