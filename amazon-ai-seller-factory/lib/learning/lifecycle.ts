import { all, insert, newId, nowIso, one, parseJson, run, update } from '../db/client';
import { config } from '../env';
import {
  FAILURE_REASONS,
  LIFECYCLE_LABEL,
  LIFECYCLE_STATUSES,
  type FailureReason,
  type LifecycleStatus,
} from '../types';

/**
 * 商品ライフサイクル ＝ 「見つけた → 承認 → 発注 → 入荷 → 出品 → 売れた → 分析」
 * を1本の線でつなぐ台帳。
 *
 * ★お金が動く行為は絶対に自動化しない。
 *   「仕入れ承認」を押しても、このシステムは外部へ1円も発注しない。
 *   承認＝「この条件で買うと決めた」という記録を残すだけ。
 *   実際の発注は人が仕入先サイトで行い、あとから「発注した」を押す。
 */

/** どの状態から、どの状態へ進んでよいか（逆流や飛び越しを防ぐ） */
const ALLOWED: Record<LifecycleStatus, LifecycleStatus[]> = {
  DISCOVERED: ['WATCHING', 'APPROVED', 'STOPPED', 'FAILED'],
  WATCHING: ['DISCOVERED', 'APPROVED', 'STOPPED', 'FAILED'],
  APPROVED: ['ORDERED', 'STOPPED', 'FAILED'],
  ORDERED: ['RECEIVED', 'STOPPED', 'FAILED'],
  RECEIVED: ['LISTED', 'STOPPED', 'FAILED'],
  LISTED: ['SELLING', 'STOPPED', 'FAILED'],
  SELLING: ['SOLD_OUT', 'STOPPED', 'FAILED'],
  SOLD_OUT: ['APPROVED', 'STOPPED'],
  STOPPED: ['APPROVED', 'FAILED'],
  FAILED: ['STOPPED'],
};

export function isLifecycleStatus(v: unknown): v is LifecycleStatus {
  return typeof v === 'string' && (LIFECYCLE_STATUSES as readonly string[]).includes(v);
}

export function canTransition(from: LifecycleStatus, to: LifecycleStatus): boolean {
  if (from === to) return true;
  return (ALLOWED[from] || []).includes(to);
}

// ---- 承認（仕入れ承認ボタン）-----------------------------------------

export interface ApproveInput {
  researchCandidateId: string;
  /** 何個仕入れると決めたか（未指定ならAIの推奨値を使う） */
  qty?: number | null;
  /** 誰が押したか */
  actor?: string;
  note?: string;
}

export interface ApproveResult {
  ok: boolean;
  lifecycleId?: string;
  message: string;
  snapshot?: Record<string, unknown>;
}

/**
 * 「仕入れ承認」。
 * ★押しただけで外部へ発注しない。ここでやるのは “予測の凍結” だけ。
 * あとで実績と突き合わせるため、この瞬間の数字を丸ごと保存する。
 */
export async function approveCandidate(input: ApproveInput): Promise<ApproveResult> {
  const row = await one(`SELECT * FROM research_candidates WHERE id = ?`, [input.researchCandidateId]);
  if (!row) return { ok: false, message: '対象の候補が見つかりませんでした' };

  // ★安全確認：自動承認は絶対にさせない
  if (config.researchAutoApprove) {
    return {
      ok: false,
      message:
        '★RESEARCH_AUTO_APPROVE が true になっています。仕入れ承認は人が押すものなので、false に戻してください',
    };
  }

  // ★安全確認：異常データ（DATA_ANOMALY）は、人が中身を確認するまで承認させない
  if (Number(row.anomaly ?? 0) === 1 && !row.anomaly_cleared_at) {
    return {
      ok: false,
      message:
        `★この商品のデータは異常として隔離されています（${row.anomaly_summary ?? 'DATA_ANOMALY'}）。` +
        'リサーチ画面の「異常データ」で中身を確認し、「確認済みにする」を押してから承認してください',
    };
  }

  const existing = await one(`SELECT id, status FROM product_lifecycle WHERE research_candidate_id = ?`, [
    input.researchCandidateId,
  ]);
  if (existing && String(existing.status) !== 'DISCOVERED' && String(existing.status) !== 'WATCHING') {
    return {
      ok: false,
      lifecycleId: String(existing.id),
      message: `この商品はすでに「${LIFECYCLE_LABEL[String(existing.status) as LifecycleStatus]}」の状態です`,
    };
  }

  const qty = Math.max(1, Math.round(Number(input.qty ?? row.recommended_qty ?? 0)));
  if (!qty) {
    return { ok: false, message: '仕入れ数量が決まっていません（推奨数量が計算できていません）' };
  }

  const unitCost = Number(row.landed_cost_jpy ?? 0) || Number(row.supplier_price_jpy ?? 0);
  const cost = parseJson<any>(row.cost_detail, {});
  const snapshot = {
    planned_qty: qty,
    planned_unit_cost_jpy: unitCost,
    planned_total_cost_jpy: Math.round(unitCost * qty),
    forecast_sell_price_jpy: Math.round(Number(cost.sellPriceJpy ?? row.amazon_price_jpy ?? 0)),
    forecast_monthly_sales: Number(row.monthly_sales_est ?? 0) || null,
    forecast_profit_jpy: Math.round(Number(row.net_profit_jpy ?? 0) * qty),
    forecast_roi: Number(row.roi ?? 0) || null,
    forecast_selldays: Number(row.est_selldays ?? 0) || null,
    forecast_research_score: Number(row.research_score ?? 0) || null,
    forecast_grade: row.grade ?? null,
    forecast_confidence: Number(row.confidence ?? 0) || null,
  };

  const now = nowIso();
  let lifecycleId: string;

  if (existing) {
    lifecycleId = String(existing.id);
    await update('product_lifecycle', lifecycleId, {
      status: 'APPROVED',
      approved_at: now,
      approved_by: input.actor ?? 'human',
      status_note: input.note ?? null,
      ...snapshot,
      updated_at: now,
    });
  } else {
    lifecycleId = newId('plc');
    await insert('product_lifecycle', {
      id: lifecycleId,
      research_candidate_id: input.researchCandidateId,
      asin: row.asin ?? null,
      listing_external_id: row.listing_external_id ?? null,
      listing_source: row.listing_source ?? null,
      title: row.amazon_title ?? row.supplier_title ?? null,
      category: row.category ?? null,
      supplier: row.supplier ?? null,
      status: 'APPROVED',
      status_note: input.note ?? null,
      data_source: row.data_source ?? null,
      approved_at: now,
      approved_by: input.actor ?? 'human',
      ...snapshot,
      created_at: now,
      updated_at: now,
    });
  }

  await logEvent(lifecycleId, existing ? (String(existing.status) as LifecycleStatus) : null, 'APPROVED', {
    actor: input.actor ?? 'human',
    note: input.note ?? '仕入れ承認（この操作では外部へ発注していません）',
    payload: snapshot,
  });

  await run(`UPDATE research_candidates SET approval_status = ?, lifecycle_id = ? WHERE id = ?`, [
    'approved',
    lifecycleId,
    input.researchCandidateId,
  ]);

  return {
    ok: true,
    lifecycleId,
    snapshot,
    message:
      `${qty}個で仕入れ承認を記録しました。` +
      `★このシステムからは発注していません。実際の注文は仕入先サイトでご自身で行ってください`,
  };
}

// ---- 状態を進める -----------------------------------------------------

export interface AdvanceInput {
  lifecycleId: string;
  to: LifecycleStatus;
  actor?: string;
  note?: string;
  /** 状態に応じた追加データ（発注数・入荷数・実績など） */
  data?: Record<string, unknown>;
}

export async function advanceLifecycle(input: AdvanceInput): Promise<{ ok: boolean; message: string }> {
  const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [input.lifecycleId]);
  if (!row) return { ok: false, message: '対象の商品が見つかりませんでした' };

  const from = String(row.status) as LifecycleStatus;
  if (!isLifecycleStatus(input.to)) return { ok: false, message: '知らない状態が指定されました' };
  if (!canTransition(from, input.to)) {
    return {
      ok: false,
      message: `「${LIFECYCLE_LABEL[from]}」から「${LIFECYCLE_LABEL[input.to]}」へは進められません`,
    };
  }

  const now = nowIso();
  const patch: Record<string, unknown> = {
    status: input.to,
    status_note: input.note ?? null,
    updated_at: now,
    ...(input.data || {}),
  };

  // 状態ごとの日時を自動で埋める（人が入力する手間を減らす）
  if (input.to === 'ORDERED') patch.ordered_at = patch.ordered_at ?? now;
  if (input.to === 'RECEIVED') patch.received_at = patch.received_at ?? now;
  if (input.to === 'LISTED') patch.listed_at = patch.listed_at ?? now;
  if (input.to === 'SELLING') patch.first_sold_at = patch.first_sold_at ?? now;
  if (input.to === 'SOLD_OUT' || input.to === 'STOPPED' || input.to === 'FAILED') {
    patch.closed_at = patch.closed_at ?? now;
  }

  await update('product_lifecycle', input.lifecycleId, patch);
  await logEvent(input.lifecycleId, from, input.to, {
    actor: input.actor ?? 'human',
    note: input.note ?? null,
    payload: input.data ?? null,
  });

  return { ok: true, message: `「${LIFECYCLE_LABEL[input.to]}」に変更しました` };
}

// ---- 実績を記録する ---------------------------------------------------

export interface RecordActualsInput {
  lifecycleId: string;
  unitsSold: number;
  avgPriceJpy: number;
  adCostJpy: number;
  profitJpy: number;
  returns?: number;
  /** 販売開始から今日までの日数（未指定なら listed_at から自動計算） */
  sellDays?: number | null;
  actor?: string;
  note?: string;
}

/**
 * 実績を保存する。ここが学習ループの入口。
 * ★実績を入れた瞬間に「予測と実績の差」も一緒に計算して残す。
 */
export async function recordActuals(input: RecordActualsInput): Promise<{ ok: boolean; message: string }> {
  const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [input.lifecycleId]);
  if (!row) return { ok: false, message: '対象の商品が見つかりませんでした' };

  const cost = Number(row.planned_total_cost_jpy ?? 0);
  const roi = cost > 0 ? input.profitJpy / cost : null;

  let sellDays = input.sellDays ?? null;
  if (sellDays === null && row.listed_at) {
    const t = Date.parse(String(row.listed_at));
    if (Number.isFinite(t)) sellDays = Math.max(1, Math.round((Date.now() - t) / 86400_000));
  }

  await update('product_lifecycle', input.lifecycleId, {
    actual_units_sold: Math.max(0, Math.round(input.unitsSold)),
    actual_avg_price_jpy: Math.round(input.avgPriceJpy),
    actual_ad_cost_jpy: Math.round(input.adCostJpy),
    actual_profit_jpy: Math.round(input.profitJpy),
    actual_roi: roi,
    actual_selldays: sellDays,
    actual_returns: Math.max(0, Math.round(input.returns ?? 0)),
    updated_at: nowIso(),
  });

  await logEvent(input.lifecycleId, String(row.status) as LifecycleStatus, String(row.status) as LifecycleStatus, {
    actor: input.actor ?? 'human',
    note: input.note ?? '実績を記録しました',
    payload: { unitsSold: input.unitsSold, profitJpy: input.profitJpy },
  });

  return { ok: true, message: '実績を記録しました。次のリサーチの精度に反映されます' };
}

// ---- 失敗の記録（分類して学習させる）----------------------------------

export async function markFailed(
  lifecycleId: string,
  reasons: FailureReason[],
  note?: string,
  actor?: string,
): Promise<{ ok: boolean; message: string }> {
  const valid = reasons.filter((r) => (FAILURE_REASONS as readonly string[]).includes(r));
  if (!valid.length) return { ok: false, message: '失敗の理由を1つ以上選んでください' };

  const row = await one(`SELECT status FROM product_lifecycle WHERE id = ?`, [lifecycleId]);
  if (!row) return { ok: false, message: '対象の商品が見つかりませんでした' };

  await update('product_lifecycle', lifecycleId, {
    status: 'FAILED',
    failure_reasons: JSON.stringify(valid),
    failure_note: note ?? null,
    closed_at: nowIso(),
    updated_at: nowIso(),
  });
  await logEvent(lifecycleId, String(row.status) as LifecycleStatus, 'FAILED', {
    actor: actor ?? 'human',
    note: note ?? null,
    payload: { reasons: valid },
  });
  return { ok: true, message: '失敗として記録しました。同じ失敗を繰り返さないよう学習に使います' };
}

// ---- 履歴 -------------------------------------------------------------

async function logEvent(
  lifecycleId: string,
  from: LifecycleStatus | null,
  to: LifecycleStatus,
  opts: { actor?: string; note?: string | null; payload?: unknown },
) {
  await insert('lifecycle_events', {
    id: newId('lce'),
    lifecycle_id: lifecycleId,
    from_status: from,
    to_status: to,
    actor: opts.actor ?? 'system',
    note: opts.note ?? null,
    payload: opts.payload ? JSON.stringify(opts.payload) : null,
    created_at: nowIso(),
  });
}

// ---- 読み出し（画面用）------------------------------------------------

export async function lifecycleList(opts?: { status?: string; limit?: number }) {
  const args: any[] = [];
  let sql = `SELECT * FROM product_lifecycle`;
  if (opts?.status) {
    sql += ` WHERE status = ?`;
    args.push(opts.status);
  }
  sql += ` ORDER BY updated_at DESC LIMIT ?`;
  args.push(opts?.limit ?? 200);
  return all(sql, args);
}

export async function lifecycleWithEvents(id: string) {
  const row = await one(`SELECT * FROM product_lifecycle WHERE id = ?`, [id]);
  if (!row) return null;
  const events = await all(`SELECT * FROM lifecycle_events WHERE lifecycle_id = ? ORDER BY created_at ASC`, [id]);
  return { row, events };
}

/** ステータスごとの件数（画面の見出しに出す） */
export async function lifecycleCounts(): Promise<Record<string, number>> {
  const rows = await all(`SELECT status, COUNT(*) AS n FROM product_lifecycle GROUP BY status`);
  const out: Record<string, number> = {};
  for (const s of LIFECYCLE_STATUSES) out[s] = 0;
  for (const r of rows) out[String(r.status)] = Number(r.n) || 0;
  return out;
}
