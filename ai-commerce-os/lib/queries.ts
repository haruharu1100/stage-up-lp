import { all, one, today } from './db/client';
import { ensureSuppliersAndChannels } from './connectors/registry';
import { ensureSettings } from './settings';
import { ensureVenues } from './venues';

export async function ensureReady(): Promise<void> {
  await ensureSettings();
  await ensureSuppliersAndChannels();
  await ensureVenues();
}

export type DashboardSummary = {
  imported: number;
  analyzed: number;
  strongBuy: number;
  buy: number;
  watch: number;
  lowPriority: number;
  skip: number;
  manualReview: number;
  requiredCapital: number;
  expectedProfit: number;
  averageRoi: number | null;
  aiCandidates: number;
  aiCandidateRate: number;
  duplicated: number;
  invalid: number;
  feesEstimated: boolean;
  todayImported: number;
  todayAnalyzed: number;
};

export async function getDashboard(): Promise<DashboardSummary> {
  await ensureReady();

  const totals = await one(`
    SELECT
      COUNT(*) AS imported,
      SUM(CASE WHEN analyzed_at IS NOT NULL THEN 1 ELSE 0 END) AS analyzed,
      SUM(CASE WHEN decision = 'STRONG_BUY' THEN 1 ELSE 0 END) AS strong_buy,
      SUM(CASE WHEN decision = 'BUY' THEN 1 ELSE 0 END) AS buy,
      SUM(CASE WHEN decision = 'WATCH' THEN 1 ELSE 0 END) AS watch,
      SUM(CASE WHEN decision = 'LOW_PRIORITY' THEN 1 ELSE 0 END) AS low_priority,
      SUM(CASE WHEN decision = 'SKIP' THEN 1 ELSE 0 END) AS skip,
      SUM(CASE WHEN pipeline_state = 'MANUAL_REVIEW' THEN 1 ELSE 0 END) AS manual_review,
      SUM(CASE WHEN skip_reason = 'DUPLICATE' THEN 1 ELSE 0 END) AS duplicated,
      SUM(CASE WHEN skip_reason = 'INVALID_DATA' THEN 1 ELSE 0 END) AS invalid,
      SUM(is_ai_candidate) AS ai_candidates
    FROM supplier_products
  `);

  const buyables = await one(`
    SELECT
      COALESCE(SUM(purchase_price), 0) AS capital,
      COALESCE(SUM(expected_net_profit), 0) AS profit,
      AVG(expected_roi) AS avg_roi
    FROM supplier_products
    WHERE decision IN ('STRONG_BUY','BUY')
  `);

  const est = await one(`SELECT COUNT(*) AS n FROM fee_rules WHERE is_estimated = 1`);
  const kpi = await one(`SELECT imported, analyzed FROM discovery_kpi WHERE day = ?`, [today()]);

  const imported = Number(totals?.imported ?? 0);
  const aiCandidates = Number(totals?.ai_candidates ?? 0);

  return {
    imported,
    analyzed: Number(totals?.analyzed ?? 0),
    strongBuy: Number(totals?.strong_buy ?? 0),
    buy: Number(totals?.buy ?? 0),
    watch: Number(totals?.watch ?? 0),
    lowPriority: Number(totals?.low_priority ?? 0),
    skip: Number(totals?.skip ?? 0),
    manualReview: Number(totals?.manual_review ?? 0),
    requiredCapital: Number(buyables?.capital ?? 0),
    expectedProfit: Number(buyables?.profit ?? 0),
    averageRoi: buyables?.avg_roi === null || buyables?.avg_roi === undefined ? null : Number(buyables.avg_roi),
    aiCandidates,
    aiCandidateRate: imported > 0 ? aiCandidates / imported : 0,
    duplicated: Number(totals?.duplicated ?? 0),
    invalid: Number(totals?.invalid ?? 0),
    feesEstimated: Number(est?.n ?? 0) > 0,
    todayImported: Number(kpi?.imported ?? 0),
    todayAnalyzed: Number(kpi?.analyzed ?? 0),
  };
}

export type ProductFilter = {
  decision?: string;
  supplier?: string;
  brand?: string;
  q?: string;
  minScore?: number;
  sort?: string;
  page?: number;
  perPage?: number;
};

export const SORTS: Record<string, string> = {
  score: 'buy_score DESC NULLS LAST, expected_net_profit DESC',
  profit: 'expected_net_profit DESC NULLS LAST',
  roi: 'expected_roi DESC NULLS LAST',
  discount: 'discount_needed ASC NULLS LAST',
  purchase: 'purchase_price ASC NULLS LAST',
  newest: 'id DESC',
};

export async function listProducts(f: ProductFilter) {
  await ensureReady();
  const where: string[] = [];
  const args: unknown[] = [];

  if (f.decision) {
    where.push('decision = ?');
    args.push(f.decision);
  }
  if (f.supplier) {
    where.push('supplier_code = ?');
    args.push(f.supplier);
  }
  if (f.brand) {
    where.push('brand = ?');
    args.push(f.brand);
  }
  if (f.q) {
    where.push('(name LIKE ? OR brand LIKE ? OR model_number LIKE ? OR jan LIKE ?)');
    const like = `%${f.q}%`;
    args.push(like, like, like, like);
  }
  if (f.minScore !== undefined && !Number.isNaN(f.minScore)) {
    where.push('buy_score >= ?');
    args.push(f.minScore);
  }

  const sql = where.length > 0 ? `WHERE ${where.join(' AND ')}` : '';
  const order = SORTS[f.sort ?? 'score'] ?? SORTS.score;
  const perPage = f.perPage ?? 50;
  const page = Math.max(1, f.page ?? 1);

  const rows = await all(
    `SELECT id, supplier_code, name, brand, category_key, model_number, jan, size, color, condition_rank,
            purchase_price, market_price, required_sell_price, expected_net_profit, expected_roi,
            buy_score, decision, skip_reason, pipeline_state, discount_needed, buyable_purchase_price,
            uplift_needed, required_market_price, market_premium_ratio, stock, is_ai_candidate,
            fees_estimated, pricing_mode, product_url
       FROM supplier_products ${sql}
      ORDER BY ${order}
      LIMIT ? OFFSET ?`,
    [...args, perPage, (page - 1) * perPage],
  );

  const count = await one(`SELECT COUNT(*) AS n FROM supplier_products ${sql}`, args);
  return { rows, total: Number(count?.n ?? 0), page, perPage };
}

export async function getProduct(id: number) {
  await ensureReady();
  const product = await one('SELECT * FROM supplier_products WHERE id = ?', [id]);
  if (!product) return null;
  const analysis = await one(
    'SELECT * FROM analyses WHERE supplier_product_id = ? ORDER BY created_at DESC LIMIT 1',
    [id],
  );
  const plan = await one('SELECT * FROM price_plans WHERE supplier_product_id = ?', [id]);
  const shadowTrade = await one('SELECT * FROM shadow_trades WHERE supplier_product_id = ? ORDER BY decided_at DESC LIMIT 1', [id]);
  const supplier = await one('SELECT * FROM suppliers WHERE code = ?', [String(product.supplier_code)]);
  const fee = analysis?.fee_rule_id ? await one('SELECT * FROM fee_rules WHERE id = ?', [Number(analysis.fee_rule_id)]) : null;
  const siblings = product.product_id
    ? await all(
        `SELECT id, supplier_code, purchase_price, buy_score, decision FROM supplier_products
          WHERE product_id = ? AND id != ? ORDER BY purchase_price ASC LIMIT 10`,
        [Number(product.product_id), id],
      )
    : [];
  return { product, analysis, plan, shadowTrade, supplier, fee, siblings };
}

export async function listFilterOptions() {
  await ensureReady();
  const suppliers = await all('SELECT DISTINCT supplier_code FROM supplier_products ORDER BY supplier_code');
  const brands = await all(
    `SELECT brand, COUNT(*) AS n FROM supplier_products WHERE brand != '' GROUP BY brand ORDER BY n DESC LIMIT 40`,
  );
  return {
    suppliers: suppliers.map((r) => String(r.supplier_code)),
    brands: brands.map((r) => String(r.brand)),
  };
}

export async function skipReasonBreakdown() {
  return all(
    `SELECT skip_reason, COUNT(*) AS n FROM supplier_products
      WHERE skip_reason IS NOT NULL GROUP BY skip_reason ORDER BY n DESC`,
  );
}

export async function supplierBreakdown() {
  return all(`
    SELECT supplier_code,
           COUNT(*) AS total,
           SUM(CASE WHEN decision IN ('STRONG_BUY','BUY') THEN 1 ELSE 0 END) AS buyable,
           COALESCE(SUM(CASE WHEN decision IN ('STRONG_BUY','BUY') THEN expected_net_profit ELSE 0 END), 0) AS profit,
           AVG(CASE WHEN decision IN ('STRONG_BUY','BUY') THEN expected_roi END) AS avg_roi
      FROM supplier_products
     GROUP BY supplier_code
     ORDER BY buyable DESC, total DESC
  `);
}

export async function recentRuns() {
  return all('SELECT * FROM pipeline_runs ORDER BY id DESC LIMIT 10');
}

export async function recentImports() {
  return all('SELECT * FROM imports ORDER BY id DESC LIMIT 10');
}

export async function shadowSummary() {
  const row = await one(`
    SELECT COUNT(*) AS n,
           COALESCE(SUM(expected_net_profit), 0) AS profit,
           AVG(expected_roi) AS avg_roi,
           SUM(CASE WHEN status = 'VERIFIED' THEN 1 ELSE 0 END) AS verified
      FROM shadow_trades
  `);
  return {
    count: Number(row?.n ?? 0),
    profit: Number(row?.profit ?? 0),
    avgRoi: row?.avg_roi === null || row?.avg_roi === undefined ? null : Number(row.avg_roi),
    verified: Number(row?.verified ?? 0),
  };
}

export async function manualReviewQueue() {
  return all(
    `SELECT id, supplier_code, name, brand, raw_condition, needs_review_reason, skip_reason,
            purchase_price, market_price
       FROM supplier_products WHERE pipeline_state = 'MANUAL_REVIEW' ORDER BY id DESC LIMIT 200`,
  );
}
