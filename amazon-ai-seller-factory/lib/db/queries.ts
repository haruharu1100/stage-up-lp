import { all, one, parseJson, type Row } from './client';
import type { AgentId, AgentStatus, ComplianceItem, ScoreBreakdown, Stage } from '../types';

export interface DashboardCandidate {
  candidateId: string;
  productId: string;
  rank: number;
  title: string;
  category: string | null;
  scoreTotal: number;
  scoreBreakdown: ScoreBreakdown | null;
  amazonPriceJpy: number | null;
  supplierPriceJpy: number | null;
  feeJpy: number | null;
  adCostJpy: number | null;
  profitJpy: number | null;
  profitRate: number | null;
  bsr: number | null;
  reviewCount: number | null;
  rating: number | null;
  sellerCount: number | null;
  risk: string;
  stage: string;
  reason: string | null;
}

export async function getLatestRun(): Promise<Row | null> {
  return one(`SELECT * FROM runs ORDER BY started_at DESC LIMIT 1`);
}

export async function getRun(runId: string): Promise<Row | null> {
  return one(`SELECT * FROM runs WHERE id = ?`, [runId]);
}

export async function getDashboardCandidates(runId?: string): Promise<DashboardCandidate[]> {
  const target = runId || (await getLatestRun())?.id;
  if (!target) return [];
  const rows = await all(
    `SELECT c.*, p.title, p.category, p.supplier_price_jpy, p.is_food, p.temperature_control, p.shelf_life_days
     FROM candidates c JOIN products p ON p.id = c.product_id
     WHERE c.run_id = ? ORDER BY c.rank ASC`,
    [target],
  );

  const out: DashboardCandidate[] = [];
  for (const r of rows) {
    const market = await one(
      `SELECT * FROM market_data WHERE product_id = ? ORDER BY fetched_at DESC LIMIT 1`,
      [String(r.product_id)],
    );
    const profit = await one(
      `SELECT * FROM profit_calculations WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`,
      [String(r.product_id)],
    );
    out.push({
      candidateId: String(r.id),
      productId: String(r.product_id),
      rank: Number(r.rank),
      title: String(r.title),
      category: r.category ? String(r.category) : null,
      scoreTotal: Number(r.score_total),
      scoreBreakdown: parseJson<ScoreBreakdown | null>(r.score_breakdown, null),
      amazonPriceJpy: profit ? Number(profit.sell_price_jpy) : market ? Number(market.price_jpy) : null,
      supplierPriceJpy: profit ? Number(profit.supplier_price_jpy) : r.supplier_price_jpy ? Number(r.supplier_price_jpy) : null,
      feeJpy: profit ? Number(profit.referral_fee_jpy) + Number(profit.fba_fee_jpy) + Number(profit.storage_fee_jpy) : null,
      adCostJpy: profit ? Number(profit.ad_cost_jpy) : null,
      profitJpy: profit ? Number(profit.profit_jpy) : null,
      profitRate: profit ? Number(profit.profit_rate) : null,
      bsr: market?.bsr != null ? Number(market.bsr) : null,
      reviewCount: market?.review_count != null ? Number(market.review_count) : null,
      rating: market?.rating != null ? Number(market.rating) : null,
      sellerCount: market?.seller_count != null ? Number(market.seller_count) : null,
      risk: riskLabel(r),
      stage: String(r.stage),
      reason: r.reason ? String(r.reason) : null,
    });
  }
  return out;
}

function riskLabel(r: Row): string {
  const notes: string[] = [];
  if (Number(r.is_food) === 1) notes.push('食品表示');
  if (r.temperature_control === 'frozen') notes.push('冷凍(FBA不可の可能性)');
  if (r.temperature_control === 'chilled') notes.push('冷蔵(FBA不可の可能性)');
  if (r.shelf_life_days != null && Number(r.shelf_life_days) > 0 && Number(r.shelf_life_days) < 120) notes.push('期限が短い');
  return notes.length ? notes.join('・') : '低';
}

export interface AgentStatusRow {
  agent: AgentId;
  status: AgentStatus;
  stage: Stage | null;
  note: string | null;
  updatedAt: string | null;
}

export async function getAgentStatuses(runId?: string): Promise<AgentStatusRow[]> {
  const target = runId || (await getLatestRun())?.id;
  if (!target) return [];
  const rows = await all(`SELECT * FROM run_steps WHERE run_id = ? ORDER BY started_at ASC`, [target]);
  const byAgent = new Map<string, AgentStatusRow>();
  for (const r of rows) {
    const prev = byAgent.get(String(r.agent));
    const next: AgentStatusRow = {
      agent: String(r.agent) as AgentId,
      status: String(r.status) as AgentStatus,
      stage: String(r.stage) as Stage,
      note: r.note ? String(r.note) : null,
      updatedAt: r.finished_at ? String(r.finished_at) : String(r.started_at || ''),
    };
    // error / needs_review は上書きさせない（見落とし防止）
    if (prev && (prev.status === 'error' || prev.status === 'needs_review') && next.status === 'done') {
      byAgent.set(String(r.agent), { ...prev, stage: next.stage });
    } else {
      byAgent.set(String(r.agent), next);
    }
  }
  return [...byAgent.values()];
}

export async function getRecentLogs(runId?: string, limit = 40) {
  const target = runId || (await getLatestRun())?.id;
  if (!target) return [];
  return all(`SELECT * FROM ai_agent_logs WHERE run_id = ? ORDER BY created_at DESC LIMIT ?`, [target, limit]);
}

/** 管理画面のポーリング用。実行状況・AI社員・ログをまとめて1回で返す */
export async function getRunStatus() {
  const run = await getLatestRun();
  if (!run) return { run: null, agents: [], logs: [] };
  const [agents, logs] = await Promise.all([getAgentStatuses(String(run.id)), getRecentLogs(String(run.id), 60)]);
  return {
    run: {
      id: String(run.id),
      stage: run.stage ? String(run.stage) : null,
      status: String(run.status),
      trigger: run.trigger ? String(run.trigger) : null,
      error: run.error ? String(run.error) : null,
      startedAt: run.started_at ? String(run.started_at) : null,
      finishedAt: run.finished_at ? String(run.finished_at) : null,
    },
    agents,
    logs: logs.map((l) => ({
      at: String(l.created_at),
      agent: String(l.agent),
      level: String(l.level),
      message: String(l.message ?? ''),
    })),
  };
}

export interface ProductDetail {
  product: Row;
  market: Row | null;
  profit: Row | null;
  candidate: Row | null;
  competitors: Row[];
  reviewAnalysis: Row | null;
  reviews: Row[];
  images: Row[];
  video: Row | null;
  listing: Row | null;
  compliance: Row[];
  publishJobs: Row[];
  masterImages: Row[];
  priceHistory: Row[];
  salesResults: Row[];
  complianceItems: ComplianceItem[];
}

export async function getProductDetail(productId: string): Promise<ProductDetail | null> {
  const product = await one(`SELECT * FROM products WHERE id = ?`, [productId]);
  if (!product) return null;
  const compliance = await all(`SELECT * FROM compliance_checks WHERE product_id = ? ORDER BY checked_at DESC`, [productId]);
  return {
    product,
    market: await one(`SELECT * FROM market_data WHERE product_id = ? ORDER BY fetched_at DESC LIMIT 1`, [productId]),
    profit: await one(`SELECT * FROM profit_calculations WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`, [productId]),
    candidate: await one(`SELECT * FROM candidates WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`, [productId]),
    competitors: await all(`SELECT * FROM competitors WHERE product_id = ?`, [productId]),
    reviewAnalysis: await one(`SELECT * FROM review_analysis WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`, [productId]),
    reviews: await all(`SELECT * FROM reviews WHERE product_id = ? ORDER BY created_at DESC LIMIT 20`, [productId]),
    images: await all(`SELECT * FROM generated_images WHERE product_id = ? ORDER BY slot ASC`, [productId]),
    video: await one(`SELECT * FROM generated_videos WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`, [productId]),
    listing: await one(`SELECT * FROM listing_drafts WHERE product_id = ? ORDER BY created_at DESC LIMIT 1`, [productId]),
    compliance,
    publishJobs: await all(`SELECT * FROM publish_jobs WHERE product_id = ? ORDER BY created_at DESC`, [productId]),
    masterImages: await all(`SELECT * FROM master_images WHERE product_id = ? ORDER BY created_at ASC`, [productId]),
    priceHistory: await all(`SELECT * FROM pricing_history WHERE product_id = ? ORDER BY observed_on ASC`, [productId]),
    salesResults: await all(`SELECT * FROM sales_results WHERE product_id = ? ORDER BY created_at DESC`, [productId]),
    complianceItems: compliance.length ? parseJson<ComplianceItem[]>(compliance[0].items, []) : [],
  };
}
