import { all, nowIso, one, run } from '../db/client';
import { MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED, OUTBOUND_FLAGS } from '../env';
import {
  MAX_TEST_LOSS_OPTIONS,
  TEST_UNITS,
  channelSpec,
  sampleLabel,
  type ValidationChannelKey,
} from './channels';

/**
 * 実販売テストを始める前の人間承認。
 *
 * ここで記録するのは「人が承認したという事実」だけ。
 * 承認しても、このリポジトリからは何も送られない。
 * 実送信・実投稿・架電・課金のコードは存在せず、追加もしない。
 * （MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED = false ＋ AUTO_* が全て false の二重ロック）
 *
 * 承認画面に必ず出すもの：商品 / チャネル / 必要な件数（単位つき）/ 予算上限 /
 * 撤退条件 / 拡大条件 / 想定損失上限。
 * 「何をどこまでやったら止めるか」を先に決めずに始めると、後から都合よく緩めてしまう。
 */

export type ApprovalStatus = 'PENDING' | 'APPROVED' | 'REJECTED';

export const APPROVAL_STATUS_LABEL: Record<ApprovalStatus, string> = {
  PENDING: '未承認（人の確認待ち）',
  APPROVED: '承認済み（ただし送信処理は存在しない）',
  REJECTED: '却下',
};

export type TestApproval = {
  id: string;
  ideaId: string;
  ideaTitle: string;
  channel: ValidationChannelKey;
  productName: string;
  productPriceYen: number;
  testUnit: string;
  sampleTarget: number;
  budgetYen: number;
  maxTestLossYen: number;
  expectedLossYen: number;
  killCriteria: string;
  scaleCriteria: string;
  status: ApprovalStatus;
  requestedAt: string;
  decidedAt: string | null;
  decidedBy: string;
  note: string;
};

export type ApprovalRequest = {
  ideaId: string;
  ideaTitle: string;
  channel: ValidationChannelKey;
  productName: string;
  productPriceYen: number;
  sampleTarget: number;
  budgetYen: number;
  expectedLossYen: number;
  killCriteria: string;
  scaleCriteria: string;
  note?: string;
};

export type BudgetCheck = {
  ok: boolean;
  maxTestLossYen: number;
  budgetYen: number;
  expectedLossYen: number;
  reason: string;
};

/**
 * 上限を超えるテストは推薦しない。
 * 「今回だけ」を許すと上限が意味を失うため、超えた時点で不可にする。
 */
export function checkBudget(
  channel: ValidationChannelKey,
  budgetYen: number,
  expectedLossYen: number
): BudgetCheck {
  const max = channelSpec(channel).maxTestLossYen;
  const worst = Math.max(budgetYen, expectedLossYen);
  const ok = worst <= max;
  return {
    ok,
    maxTestLossYen: max,
    budgetYen,
    expectedLossYen,
    reason: ok
      ? `想定される最大の持ち出し ${worst.toLocaleString()}円は、上限 ${max.toLocaleString()}円の範囲内`
      : `想定される最大の持ち出し ${worst.toLocaleString()}円が、上限 ${max.toLocaleString()}円を超えている。` +
        `件数を減らすか、上限（${MAX_TEST_LOSS_OPTIONS.map((v) => `${v.toLocaleString()}円`).join(' / ')}）の見直しを人が決める`,
  };
}

function rowToApproval(r: Record<string, unknown>): TestApproval {
  return {
    id: String(r.id),
    ideaId: String(r.idea_id),
    ideaTitle: String(r.idea_title ?? ''),
    channel: String(r.channel) as ValidationChannelKey,
    productName: String(r.product_name ?? ''),
    productPriceYen: Number(r.product_price_yen ?? 0),
    testUnit: String(r.test_unit ?? ''),
    sampleTarget: Number(r.sample_target ?? 0),
    budgetYen: Number(r.budget_yen ?? 0),
    maxTestLossYen: Number(r.max_test_loss_yen ?? 0),
    expectedLossYen: Number(r.expected_loss_yen ?? 0),
    killCriteria: String(r.kill_criteria ?? ''),
    scaleCriteria: String(r.scale_criteria ?? ''),
    status: String(r.status ?? 'PENDING') as ApprovalStatus,
    requestedAt: String(r.requested_at),
    decidedAt: r.decided_at === null || r.decided_at === undefined ? null : String(r.decided_at),
    decidedBy: String(r.decided_by ?? ''),
    note: String(r.note ?? ''),
  };
}

/** 承認申請を作る（＝承認待ちとして記録するだけ。ここでは何も送らない） */
export async function requestApproval(req: ApprovalRequest): Promise<TestApproval> {
  const spec = channelSpec(req.channel);
  const budget = checkBudget(req.channel, req.budgetYen, req.expectedLossYen);
  const id = `${req.ideaId}:${req.channel}:${Date.now()}`;
  const at = nowIso();
  await run(
    `INSERT INTO test_approvals
      (id, idea_id, idea_title, channel, product_name, product_price_yen, test_unit,
       sample_target, budget_yen, max_test_loss_yen, expected_loss_yen,
       kill_criteria, scale_criteria, status, requested_at, decided_at, decided_by, note)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NULL,'',?)`,
    [
      id,
      req.ideaId,
      req.ideaTitle,
      req.channel,
      req.productName,
      Math.round(req.productPriceYen),
      spec.testUnit,
      Math.round(req.sampleTarget),
      Math.round(req.budgetYen),
      spec.maxTestLossYen,
      Math.round(req.expectedLossYen),
      req.killCriteria,
      req.scaleCriteria,
      'PENDING',
      at,
      budget.ok ? (req.note ?? '') : `${req.note ?? ''}（上限超過：${budget.reason}）`.trim(),
    ]
  );
  const created = await getApproval(id);
  if (!created) throw new Error('承認申請の保存に失敗した');
  return created;
}

export async function getApproval(id: string): Promise<TestApproval | null> {
  const r = await one<Record<string, unknown>>(`SELECT * FROM test_approvals WHERE id = ?`, [id]);
  return r ? rowToApproval(r) : null;
}

/** 案件×チャネルの最新の承認状態。無ければ null（＝未申請） */
export async function latestApproval(
  ideaId: string,
  channel: ValidationChannelKey
): Promise<TestApproval | null> {
  const r = await one<Record<string, unknown>>(
    `SELECT * FROM test_approvals WHERE idea_id = ? AND channel = ? ORDER BY requested_at DESC LIMIT 1`,
    [ideaId, channel]
  );
  return r ? rowToApproval(r) : null;
}

export async function listApprovals(limit = 50): Promise<TestApproval[]> {
  const rows = await all<Record<string, unknown>>(
    `SELECT * FROM test_approvals ORDER BY requested_at DESC LIMIT ?`,
    [limit]
  );
  return rows.map(rowToApproval);
}

/**
 * 承認・却下を記録する。
 * 予算上限を超えた申請は承認できない（画面から押せてしまっても、ここで止める）。
 */
export async function decideApproval(
  id: string,
  status: 'APPROVED' | 'REJECTED',
  decidedBy: string,
  note = ''
): Promise<TestApproval> {
  const current = await getApproval(id);
  if (!current) throw new Error(`承認申請が見つからない: ${id}`);
  if (status === 'APPROVED') {
    const budget = checkBudget(current.channel, current.budgetYen, current.expectedLossYen);
    if (!budget.ok) throw new Error(`上限を超えるテストは承認できない。${budget.reason}`);
    if (!decidedBy.trim()) throw new Error('誰が承認したかを空にできない');
  }
  await run(
    `UPDATE test_approvals SET status = ?, decided_at = ?, decided_by = ?, note = ? WHERE id = ?`,
    [status, nowIso(), decidedBy, note || current.note, id]
  );
  const updated = await getApproval(id);
  if (!updated) throw new Error('承認状態の更新に失敗した');
  return updated;
}

export type StartGate = {
  /** 人の承認が下りているか */
  approved: boolean;
  /** 実際に送信・投稿できるか。常に false */
  canExecute: false;
  status: ApprovalStatus | 'NOT_REQUESTED';
  message: string;
};

/**
 * 「始めてよいか」の判定。
 * 承認が下りていても canExecute は必ず false。
 * このシステムに送信処理が無いことを、判定結果としても明示する。
 */
export function startGate(approval: TestApproval | null): StartGate {
  const locked = Object.entries(OUTBOUND_FLAGS)
    .filter(([, v]) => v === false)
    .map(([k]) => k)
    .join(' / ');
  const base = `実送信・実投稿・架電・課金の処理はこのシステムに存在しない（${locked} は false、実装フラグも ${MONEY_AND_OUTBOUND_ACTIONS_IMPLEMENTED}）。実際の連絡は人が行う`;
  if (!approval) {
    return {
      approved: false,
      canExecute: false,
      status: 'NOT_REQUESTED',
      message: `承認申請がまだ無い。${base}`,
    };
  }
  return {
    approved: approval.status === 'APPROVED',
    canExecute: false,
    status: approval.status,
    message: `${APPROVAL_STATUS_LABEL[approval.status]}。${base}`,
  };
}

/** 承認画面にそのまま出す確認事項 */
export function approvalSheet(a: ApprovalRequest & { maxTestLossYen?: number }): string[] {
  const spec = channelSpec(a.channel);
  const unit = TEST_UNITS[spec.testUnit];
  const budget = checkBudget(a.channel, a.budgetYen, a.expectedLossYen);
  return [
    `商品：${a.productName}（${a.productPriceYen.toLocaleString()}円）`,
    `売り方：${spec.label}`,
    `必要な件数：${sampleLabel(a.channel, a.sampleTarget)}（${unit.ja}／${unit.whatCounts}）`,
    `予算上限：${a.budgetYen.toLocaleString()}円`,
    `想定損失上限：${Math.max(a.budgetYen, a.expectedLossYen).toLocaleString()}円（上限 ${budget.maxTestLossYen.toLocaleString()}円）`,
    `撤退条件：${a.killCriteria}`,
    `拡大条件：${a.scaleCriteria}`,
    budget.ok ? '上限判定：範囲内' : `上限判定：超過のため承認できない（${budget.reason}）`,
  ];
}
