import { all, insert, newId, nowIso, parseJson, update } from '../db/client';
import { calcProfit } from '../profit';
import { scoreCandidate } from '../scoring';
import { getActiveWeights } from '../learning';
import { gradeCandidate, summarize, type DiscoverySummary } from '../grading';
import { buildPurchasePlan } from '../inventory';
import { bestQuoteFor, sourcingStatus } from '../sourcing';
import { checkImportRegulations, importSummary } from '../importRules';
import { getMarketProvider } from '../providers/market';
import type {
  CandidateInput,
  FulfillmentMode,
  GradeResult,
  ProfitResult,
  PurchasePlan,
  SupplierQuote,
} from '../types';

/**
 * 商品ハンター（毎朝のバッチ）。
 *
 * ★コスト設計
 *   ここは1件もLLMを呼ばない。仕入先突合 → 利益計算 → 輸入規制 → A/B/C/D判定まで
 *   すべて純粋な計算で終える。だから1万商品を回してもAPI料金は市場データ分だけ。
 *   LLM（説明文づくり）はAランクだけに後段で使う。
 *
 * ★安全設計
 *   ここは「調べて並べる」だけ。仕入れ発注も出品公開も絶対にしない。
 *   （事業Vault/Amazon AI Seller OS/02_権限ルール）
 */

export interface DiscoveryRowOut {
  id: string;
  asin: string | null;
  title: string;
  brand: string | null;
  category: string | null;
  grade: GradeResult['grade'];
  route: GradeResult['route'];
  routeReason: string;
  reasons: string[];
  sellPriceJpy: number;
  supplierPriceJpy: number;
  profitJpy: number;
  profitRate: number;
  roi: number;
  sellerCount: number;
  scoreTotal: number;
  supplierName: string | null;
  supplierChannel: string | null;
  landedCostJpy: number | null;
  triggerSupplierPriceJpy: number | null;
  triggerSellPriceJpy: number | null;
  triggerSellerCount: number | null;
  watch: boolean;
  importSummary: string;
  importFlags: { category: string; severity: string; detail: string }[];
  purchasePlan: PurchasePlan;
}

export interface DiscoveryResult {
  runId: string;
  source: string;
  summary: DiscoverySummary;
  rows: DiscoveryRowOut[];
  notes: string[];
}

/** 1商品を判定する（DBに触らない純粋関数。テストしやすいように分離） */
export function evaluateOne(
  input: CandidateInput,
  opts?: { fulfillment?: FulfillmentMode; weights?: any; weightVersion?: number },
): {
  quote: SupplierQuote | null;
  profit: ProfitResult;
  grade: GradeResult;
  plan: PurchasePlan;
  scoreTotal: number;
  importFlags: { category: string; severity: string; detail: string }[];
  importLine: string;
} {
  const { product, market } = input;
  const fulfillment: FulfillmentMode = opts?.fulfillment ?? 'fbm';

  // ① 仕入先を突合（Amazon内の出品者は sourcing 側で除外済み）
  const quote = bestQuoteFor(product);

  // ② 利益計算（仕入先が見つかれば実仕入原価・実送料で上書き）
  const profit = calcProfit(product, market, {
    fulfillment,
    supplierPriceJpy: quote ? quote.unitPriceJpy : undefined,
    inboundShippingJpy: quote ? quote.shippingPerUnitJpy + Math.round(quote.unitPriceJpy * quote.dutyRate) : undefined,
  });

  // ③ 採点
  const score = scoreCandidate(input, profit, {
    weights: opts?.weights,
    weightVersion: opts?.weightVersion,
  });

  // ④ A/B/C/D判定（販売ルート・輸入規制を内包）
  const grade = gradeCandidate({ input, profit, quote, fulfillment, scoreTotal: score.total });

  // ⑤ 仕入数量・FBA切替
  const plan = buildPurchasePlan({ product, market, profit, quote, fulfillment });

  // ⑥ 輸入規制（画面に赤字で出す用）
  const regs = checkImportRegulations(product, quote);
  const importFlags = regs
    .filter((r) => !r.passed)
    .map((r) => ({ category: r.category, severity: r.severity, detail: r.detail }));

  return { quote, profit, grade, plan, scoreTotal: score.total, importFlags, importLine: importSummary(regs) };
}

/**
 * 発掘バッチ本体。
 * @param opts.limit 解析する件数
 */
export async function runDiscovery(opts?: {
  limit?: number;
  asins?: string[];
  fulfillment?: FulfillmentMode;
}): Promise<DiscoveryResult> {
  const limit = opts?.limit ?? 50;
  const fulfillment: FulfillmentMode = opts?.fulfillment ?? 'fbm';
  const provider = getMarketProvider();
  const runId = newId('dsc');
  const startedAt = nowIso();
  const notes: string[] = [];

  await insert('discovery_runs', {
    id: runId,
    started_at: startedAt,
    status: 'running',
    source: provider.name,
    analyzed: 0,
  });

  const src = sourcingStatus();
  if (!src.hasCsv) {
    notes.push(
      `仕入先データ（${src.path}）がまだありません。仕入価格は販売価格の45%で仮置きしています。samples/suppliers.csv をコピーして実際の仕入先を入れると精度が上がります`,
    );
  } else {
    notes.push(`仕入先データ ${src.usable}件を読み込みました${src.rejected ? `（規約違反で${src.rejected}件を除外）` : ''}`);
  }
  if (!provider.isReal) {
    notes.push('市場データがサンプルです。KeepaのAPIキーを設定すると本物のAmazonデータで判定します');
  }

  let candidates: CandidateInput[] = [];
  try {
    candidates = await provider.findCandidates({ limit, seed: Date.now() % 100000, asins: opts?.asins });
  } catch (e) {
    await update('discovery_runs', runId, {
      status: 'failed',
      finished_at: nowIso(),
      note: `市場データの取得に失敗：${(e as Error).message}`,
    });
    throw e;
  }

  const { weights, version } = await getActiveWeights();
  const rows: DiscoveryRowOut[] = [];
  const now = nowIso();

  for (const input of candidates) {
    const r = evaluateOne(input, { fulfillment, weights, weightVersion: version });
    const { product, market } = input;
    const id = newId('dis');

    const row: DiscoveryRowOut = {
      id,
      asin: product.asin ?? null,
      title: product.title,
      brand: product.brand ?? null,
      category: product.category ?? null,
      grade: r.grade.grade,
      route: r.grade.route,
      routeReason: r.grade.routeReason,
      reasons: r.grade.reasons,
      sellPriceJpy: r.profit.sellPriceJpy,
      supplierPriceJpy: r.profit.supplierPriceJpy,
      profitJpy: Math.round(r.profit.profitJpy),
      profitRate: r.profit.profitRate,
      roi: r.profit.roi,
      sellerCount: market.sellerCount ?? market.offerCount ?? 0,
      scoreTotal: r.scoreTotal,
      supplierName: r.quote?.supplier ?? null,
      supplierChannel: r.quote?.channel ?? null,
      landedCostJpy: r.quote?.landedCostJpy ?? null,
      triggerSupplierPriceJpy: r.grade.triggerSupplierPriceJpy ?? null,
      triggerSellPriceJpy: r.grade.triggerSellPriceJpy ?? null,
      triggerSellerCount: r.grade.triggerSellerCount ?? null,
      watch: r.grade.watch,
      importSummary: r.importLine,
      importFlags: r.importFlags,
      purchasePlan: r.plan,
    };
    rows.push(row);

    await insert('discoveries', {
      id,
      discovery_run_id: runId,
      product_id: product.id || null,
      asin: row.asin,
      gtin: product.gtin ?? null,
      title: row.title,
      brand: row.brand,
      category: row.category,
      grade: row.grade,
      route: row.route,
      route_reason: row.routeReason,
      fulfillment,
      score_total: row.scoreTotal,
      sell_price_jpy: row.sellPriceJpy,
      supplier_price_jpy: row.supplierPriceJpy,
      profit_jpy: row.profitJpy,
      profit_rate: row.profitRate,
      roi: row.roi,
      seller_count: row.sellerCount,
      supplier_name: row.supplierName,
      supplier_channel: row.supplierChannel,
      landed_cost_jpy: row.landedCostJpy,
      trigger_supplier_price_jpy: row.triggerSupplierPriceJpy,
      trigger_sell_price_jpy: row.triggerSellPriceJpy,
      trigger_seller_count: row.triggerSellerCount,
      watch: row.watch ? 1 : 0,
      reasons: JSON.stringify(row.reasons),
      import_flags: JSON.stringify(row.importFlags),
      purchase_plan: JSON.stringify(row.purchasePlan),
      profit_detail: JSON.stringify(r.profit),
      created_at: now,
    });
  }

  // 良い順に並べる：A>B>C>D、同ランク内は点数順
  const order: Record<string, number> = { A: 0, B: 1, C: 2, D: 3 };
  rows.sort((a, b) => order[a.grade] - order[b.grade] || b.scoreTotal - a.scoreTotal);

  const summary = summarize(rows);

  await update('discovery_runs', runId, {
    status: 'done',
    finished_at: nowIso(),
    analyzed: summary.analyzed,
    grade_a: summary.byGrade.A,
    grade_b: summary.byGrade.B,
    grade_c: summary.byGrade.C,
    grade_d: summary.byGrade.D,
    note: notes.join(' / '),
  });

  return { runId, source: provider.name, summary, rows, notes };
}

/** 直近の発掘結果を読む（毎朝ダッシュボード用） */
export async function latestDiscovery(): Promise<DiscoveryResult | null> {
  const runs = await all('SELECT * FROM discovery_runs ORDER BY started_at DESC LIMIT 1');
  const run = runs[0];
  if (!run) return null;
  const rows = await all(
    'SELECT * FROM discoveries WHERE discovery_run_id = ? ORDER BY CASE grade WHEN \'A\' THEN 0 WHEN \'B\' THEN 1 WHEN \'C\' THEN 2 ELSE 3 END, score_total DESC',
    [String(run.id)],
  );

  const out: DiscoveryRowOut[] = rows.map((d) => ({
    id: String(d.id),
    asin: d.asin ? String(d.asin) : null,
    title: String(d.title),
    brand: d.brand ? String(d.brand) : null,
    category: d.category ? String(d.category) : null,
    grade: String(d.grade) as GradeResult['grade'],
    route: String(d.route) as GradeResult['route'],
    routeReason: String(d.route_reason || ''),
    reasons: parseJson<string[]>(d.reasons, []),
    sellPriceJpy: Number(d.sell_price_jpy || 0),
    supplierPriceJpy: Number(d.supplier_price_jpy || 0),
    profitJpy: Number(d.profit_jpy || 0),
    profitRate: Number(d.profit_rate || 0),
    roi: Number(d.roi || 0),
    sellerCount: Number(d.seller_count || 0),
    scoreTotal: Number(d.score_total || 0),
    supplierName: d.supplier_name ? String(d.supplier_name) : null,
    supplierChannel: d.supplier_channel ? String(d.supplier_channel) : null,
    landedCostJpy: d.landed_cost_jpy != null ? Number(d.landed_cost_jpy) : null,
    triggerSupplierPriceJpy: d.trigger_supplier_price_jpy != null ? Number(d.trigger_supplier_price_jpy) : null,
    triggerSellPriceJpy: d.trigger_sell_price_jpy != null ? Number(d.trigger_sell_price_jpy) : null,
    triggerSellerCount: d.trigger_seller_count != null ? Number(d.trigger_seller_count) : null,
    watch: !!d.watch,
    importSummary: '',
    importFlags: parseJson(d.import_flags, []),
    purchasePlan: parseJson(d.purchase_plan, {} as PurchasePlan),
  }));

  return {
    runId: String(run.id),
    source: String(run.source || ''),
    summary: summarize(out),
    rows: out,
    notes: run.note ? String(run.note).split(' / ') : [],
  };
}

/** 見張り対象（B・C）だけを取り出す */
export async function watchList(limit = 100): Promise<DiscoveryRowOut[]> {
  const latest = await latestDiscovery();
  if (!latest) return [];
  return latest.rows.filter((r) => r.watch).slice(0, limit);
}
