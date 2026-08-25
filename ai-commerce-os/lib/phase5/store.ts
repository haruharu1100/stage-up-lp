/**
 * 【Demand First Research — すでに保存してあるデータだけで、需要の強い商品を選ぶ】
 * （Phase 5・2026-08-25）
 *
 * ★`lib/phase5/` のうち、DB とつながるのはこのファイルだけ。
 *   connector / queue / research / orchestrator / velocity / watch /
 *   effectiveness / scheduler は何も import しない純粋な計算で、
 *   画面へそのまま載せられる（ルール37）。ここは載せられない。
 *
 * ------------------------------------------------------------------
 * 【通信しない。枠も使わない。】
 *
 * ご本人の指示（原文・最初にやること）：
 *   「いきなり外部市場を勝手に検索しないでください。まず、
 *     AUTO RESEARCH ORCHESTRATOR の設計と、
 *     現在正式接続済みのデータだけでどこまで自動化できるかを確認してください。」
 *
 * だからここは **すでに保存してある keepa_products を読むだけ** である。
 * Keepa へ1回も接続しない。枠（Token）は1つも減らない。
 * 新しく取りに行くのは `npm run keepa:*` の仕事で、混ぜない。
 *
 * ------------------------------------------------------------------
 * 【この処理が正直に返す答え】
 *
 * 仕入側で自動取得してよい市場は0件である。
 * したがってここでできるのは
 *   「Amazonで売れていて競合が少ない商品を選び、
 *     仕入先探し待ち（SUPPLIER_SEARCH_PENDING）として貯める」
 * ところまでで、**利益の出る組み合わせは1件も作れない**。
 * それを0件と正直に返すことが、この処理のいちばん大事な仕事である。
 */

import { all, nowIso, one, run } from '../db/client';
import { SAMPLE_MARKERS } from '../realdata';
import { getResearchSettings, researchRuleVersion } from '../settings';
import {
  canAutoResearch,
  REGISTERED_CONNECTORS,
  type ConnectorDescriptor,
} from './connector';
import {
  buildEffectivenessFunnel,
  computeEfficiency,
  type EffectivenessCounts,
} from './effectiveness';
import {
  planRun,
  reachReport,
  type ConnectorView,
  type Direction,
  type VenueSide,
} from './orchestrator';
import { candidateKey } from './queue';
import { pickDemandFirst, type DemandFirstResult } from './research';
import { pendingNextStepJa, type PendingReason } from './watch';

/* ================================================================
 * 1. 登録済み Connector を Orchestrator の形へ変換する
 * ================================================================ */

/**
 * ★変換をここに置く理由。
 *   Orchestrator に `ConnectorDescriptor` をそのまま渡すと、
 *   Orchestrator が Connector の細かい形に依存してしまう。
 *   間に薄い変換を1つ置いておけば、Connector 側の項目が増えても
 *   判定の本体は書き換えずに済む（§42）。
 */
function toView(d: ConnectorDescriptor): ConnectorView {
  const sides: VenueSide[] =
    d.role === 'BOTH' ? ['BUY_SIDE', 'SELL_SIDE'] : [d.role as VenueSide];
  return {
    venueCode: d.venueCode,
    labelJa: d.labelJa,
    sides,
    autoReady: canAutoResearch(d).ok,
    canSearch: d.capabilities.productSearch === true,
    canPrice: d.capabilities.price === true,
    canIdentify: d.capabilities.identifiers === true,
    canProductUrl: d.capabilities.productUrl === true,
  };
}

export function connectorViews(): ConnectorView[] {
  return REGISTERED_CONNECTORS.map(toView);
}

/* ================================================================
 * 2. 保存済み Keepa データを読む（通信なし）
 * ================================================================ */

/** 販売側の市場コード。★ここは「保存済みデータの出どころ」の記録であって、判定には使わない。 */
export const SELL_SIDE_VENUE_CODE = 'KEEPA_API';

export type StoredProduct = {
  asin: string;
  title: string | null;
  brand: string | null;
  model: string | null;
  partNumber: string | null;
  eanList: string | null;
  rankDrops30: number | null;
  offerCountNew: number | null;
  amazonRetailPresent: boolean | null;
  currentNewPrice: number | null;
  avgNewPrice30: number | null;
  avgNewPrice90: number | null;
  keepaLastUpdate: string | null;
  isSampleLike: boolean;
};

function num(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function str(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  return s === '' ? null : s;
}

/**
 * `amazon_retail_present` は 'YES' / 'NO' / 'UNKNOWN' の3値で保存されている。
 * ★'UNKNOWN' を false（いない）に寄せない。いないことにすると、
 *   Amazon本体がいる商品が「競合の少ない商品」として上に来る。
 */
function tri(v: unknown): boolean | null {
  const s = String(v ?? '').toUpperCase();
  if (s === 'YES' || s === 'TRUE' || s === '1') return true;
  if (s === 'NO' || s === 'FALSE' || s === '0') return false;
  return null;
}

/** 記入見本・テスト用の行が混ざっていないか（ルール33）。 */
function looksSample(row: Record<string, any>): boolean {
  const hay = [row.title, row.brand, row.model, row.part_number, row.asin]
    .map((x) => String(x ?? '').toUpperCase())
    .join(' ');
  return SAMPLE_MARKERS.some((m) => hay.includes(m.toUpperCase()));
}

export async function loadStoredProducts(limit = 1000): Promise<StoredProduct[]> {
  const rows = await all(
    `SELECT asin, title, brand, model, part_number, ean_list,
            sales_rank_drops_30, offer_count_new, amazon_retail_present,
            current_new_price, avg_new_price_30, avg_new_price_90, keepa_last_update
       FROM keepa_products
      ORDER BY id DESC LIMIT ?`,
    [limit],
  );
  return rows.map((r) => ({
    asin: String(r.asin),
    title: str(r.title),
    brand: str(r.brand),
    model: str(r.model),
    partNumber: str(r.part_number),
    eanList: str(r.ean_list),
    rankDrops30: num(r.sales_rank_drops_30),
    offerCountNew: num(r.offer_count_new),
    amazonRetailPresent: tri(r.amazon_retail_present),
    currentNewPrice: num(r.current_new_price),
    avgNewPrice30: num(r.avg_new_price_30),
    avgNewPrice90: num(r.avg_new_price_90),
    keepaLastUpdate: str(r.keepa_last_update),
    isSampleLike: looksSample(r),
  }));
}

/** データの古さ（時間）。分からなければ null（0にしない）。 */
export function dataAgeHours(keepaLastUpdate: string | null, nowMs: number): number | null {
  if (keepaLastUpdate === null) return null;
  const t = Date.parse(keepaLastUpdate);
  if (!Number.isFinite(t)) return null;
  return (nowMs - t) / 3_600_000;
}

/**
 * 価格の振れ幅（0〜1）。30日平均と90日平均のズレから見る。
 * ★材料が無ければ null。ここを0（＝安定）で埋めると、
 *   価格の分からない商品が「安定した商品」として選ばれる。
 */
export function priceVolatility(avg30: number | null, avg90: number | null): number | null {
  if (avg30 === null || avg90 === null || avg90 <= 0) return null;
  return Math.abs(avg30 - avg90) / avg90;
}

/** 仕入先を探す手がかりを取り出す。★無いものを作らない（推測禁止）。 */
export function identifiersOf(p: StoredProduct): { jan: string | null; model: string | null } {
  const jan = p.eanList === null ? null : (p.eanList.split(/[,\s]+/).find((x) => /^\d{8,14}$/.test(x)) ?? null);
  const model = p.model ?? p.partNumber;
  return { jan, model };
}

/* ================================================================
 * 3. Demand First Research（1回ぶん）
 * ================================================================ */

export type ResearchRunReport = {
  runId: number | null;
  direction: Direction;
  /** どこまで進めたか。 */
  reachedStage: string | null;
  stoppedStage: string | null;
  /** 通信したか。★この処理は必ず false。 */
  networkUsed: boolean;
  tokensUsed: number;

  counts: EffectivenessCounts;
  selected: DemandFirstResult[];
  parkedCount: number;
  skippedSampleCount: number;

  linesJa: string[];
  warningsJa: string[];
};

/**
 * すでに保存してある商品から、需要の強いものを選び、
 * 仕入先探し待ちとして貯める。
 *
 * ★1件も通信しない。★1枠も使わない。★1円もかからない。
 *   だから毎日回しても費用は増えないが、**新しい情報も増えない**。
 *   増やすには仕入側の口を正式につなぐ必要がある。それは人の作業である。
 */
export async function runDemandFirstResearch(options?: {
  limit?: number;
  dryRun?: boolean;
}): Promise<ResearchRunReport> {
  const limit = options?.limit ?? 1000;
  const dryRun = options?.dryRun ?? false;

  const direction: Direction = 'DEMAND_FIRST';
  const views = connectorViews();
  const plan = planRun(direction, views);
  const settings = await getResearchSettings();
  const ruleVersion = await researchRuleVersion();
  const startedAt = nowIso();
  const nowMs = Date.now();

  const products = await loadStoredProducts(limit);
  const usable = products.filter((p) => !p.isSampleLike);
  const skippedSampleCount = products.length - usable.length;

  const selected: DemandFirstResult[] = [];
  const warningsJa: string[] = [];

  for (const p of usable) {
    const ids = identifiersOf(p);
    const r = pickDemandFirst(
      {
        asin: p.asin,
        rankDrops30: p.rankDrops30,
        offerCountNew: p.offerCountNew,
        amazonRetailPresent: p.amazonRetailPresent,
        priceVolatility: priceVolatility(p.avgNewPrice30, p.avgNewPrice90),
        dataAgeHours: dataAgeHours(p.keepaLastUpdate, nowMs),
        hasIdentifier: ids.jan !== null || ids.model !== null,
      },
      {
        minRankDrops30: settings.minRankDrops30,
        maxOfferCount: settings.maxOfferCount,
        maxDataAgeHours: settings.maxDataAgeHours,
      },
    );
    if (r.selected) selected.push(r);
  }

  // 需要の強い順。★これは「買ってよい順」ではない（ルール124）。
  selected.sort((a, b) => (b.demandRank ?? 0) - (a.demandRank ?? 0));

  /*
   * ★ここから先へ進めない理由を、候補ごとに1つだけ決める。
   *   複数当てはまるときは「先に解決しないと次が無い方」を採る。
   *   仕入先の口が無いのに「JANが無い」と書くと、
   *   JANを足せば進むように読めてしまう。
   */
  const byAsin = new Map(usable.map((p) => [p.asin, p]));
  let parkedCount = 0;
  const buySideAvailable = views.some((v) => v.autoReady && v.sides.includes('BUY_SIDE') && v.canSearch);

  let runId: number | null = null;
  if (!dryRun) {
    const res = await run(
      `INSERT INTO research_runs
         (direction, reached_stage, stopped_stage, stopped_reason_ja,
          researched_products, matched_products, profitable_routes, buy_opportunities,
          tokens_used, api_cost_jpy, human_minutes, network_used,
          rule_version, started_at, finished_at, note_ja)
       VALUES (?,?,?,?, ?,?,?,?, ?,?,?,?, ?,?,?,?)`,
      [
        direction,
        plan.reachableUpTo,
        plan.stages.find((s) => !s.runnable)?.key ?? null,
        plan.summaryJa,
        usable.length,
        // ★同一商品の照合は、反対側の市場が無いので1件も行えていない。
        //   0 は「調べたが0件だった」ではなく「そもそも段まで到達していない」。
        //   到達していないことは stopped_stage が持つ。
        0,
        0,
        0,
        0,
        0,
        0,
        0,
        ruleVersion,
        startedAt,
        nowIso(),
        'すでに保存してあるデータだけで実行。外部への通信は0件、Keepaの枠も0。',
      ],
    );
    runId = Number(res?.lastInsertRowid ?? 0) || null;

    for (const s of selected) {
      const p = byAsin.get(s.asin);
      if (!p) continue;
      const ids = identifiersOf(p);
      const reason: PendingReason = !buySideAvailable
        ? 'NO_BUY_SIDE_CONNECTOR'
        : ids.jan === null && ids.model === null
          ? 'NO_IDENTIFIER'
          : 'PRICE_UNKNOWN';

      await run(
        `INSERT INTO supplier_search_pending
           (run_id, sell_side_venue, sell_side_id, title, jan, model_number, brand,
            reason, next_step_ja, demand_rank, sell_side_price,
            source_data_at, rule_version, created_at, updated_at)
         VALUES (?,?,?,?,?,?,?, ?,?,?,?, ?,?,?,?)
         ON CONFLICT(sell_side_venue, sell_side_id) DO UPDATE SET
           run_id = excluded.run_id,
           reason = excluded.reason,
           next_step_ja = excluded.next_step_ja,
           demand_rank = excluded.demand_rank,
           sell_side_price = excluded.sell_side_price,
           source_data_at = excluded.source_data_at,
           rule_version = excluded.rule_version,
           updated_at = excluded.updated_at`,
        [
          runId,
          SELL_SIDE_VENUE_CODE,
          p.asin,
          p.title,
          ids.jan,
          ids.model,
          p.brand,
          reason,
          pendingNextStepJa(reason),
          s.demandRank,
          p.currentNewPrice,
          p.keepaLastUpdate,
          ruleVersion,
          nowIso(),
          nowIso(),
        ],
      );

      // 候補としても記録しておく（重複は candidate_key で防ぐ）。
      const key = candidateKey(SELL_SIDE_VENUE_CODE, p.asin);
      await run(
        `INSERT INTO research_candidates
           (run_id, venue_code, external_id, candidate_key, title, state, state_reason_ja,
            last_price, last_analyzed_at, last_rule_version, created_at, updated_at)
         VALUES (?,?,?,?,?, ?,?, ?,?,?, ?,?)
         ON CONFLICT(candidate_key) DO UPDATE SET
           run_id = excluded.run_id,
           state = excluded.state,
           state_reason_ja = excluded.state_reason_ja,
           last_price = excluded.last_price,
           last_analyzed_at = excluded.last_analyzed_at,
           last_rule_version = excluded.last_rule_version,
           updated_at = excluded.updated_at`,
        [
          runId,
          SELL_SIDE_VENUE_CODE,
          p.asin,
          key,
          p.title,
          'FILTERED',
          '需要の条件を満たしました。次は仕入先を探す段ですが、その口がまだありません。',
          p.currentNewPrice,
          nowIso(),
          ruleVersion,
          nowIso(),
          nowIso(),
        ],
      );
      parkedCount += 1;
    }
  }

  const counts: EffectivenessCounts = {
    RESEARCHED_PRODUCTS: usable.length,
    MATCHED_PRODUCTS: 0,
    PROFITABLE_ROUTES: 0,
    BUY_OPPORTUNITIES: 0,
  };
  const funnel = buildEffectivenessFunnel(counts);
  warningsJa.push(...funnel.warningsJa);

  const eff = computeEfficiency({
    researchedProducts: usable.length,
    buyOpportunities: 0,
    expectedProfitJpy: null,
    apiCostJpy: 0,
    humanMinutes: 0,
  });

  const reach = reachReport(direction, views);

  const linesJa: string[] = [
    ...reach.linesJa,
    `保存済みの商品${products.length}件を見ました（うち記入見本らしき${skippedSampleCount}件は除いています）。`,
    `需要の条件を満たしたのは${selected.length}件です。`,
    dryRun
      ? '※ 下見の実行なので、何も保存していません。'
      : `${parkedCount}件を「仕入先探し待ち」として貯めました。`,
    '同じ商品かの照合・利益計算・購入候補は、仕入側の市場が無いため0件です。'
    + 'これは調べて0件だったのではなく、その段まで進んでいないという意味です。',
    ...eff.linesJa,
    '外部への通信は0件、Keepaの枠の消費も0でした。',
  ];

  if (skippedSampleCount > 0) {
    warningsJa.push(
      `記入見本らしき行が${skippedSampleCount}件ありました。`
      + '判定からは外しましたが、**こちらで勝手に消していません**（ルール52）。中身をご確認ください。',
    );
  }

  return {
    runId,
    direction,
    reachedStage: plan.reachableUpTo,
    stoppedStage: plan.stages.find((s) => !s.runnable)?.key ?? null,
    networkUsed: false,
    tokensUsed: 0,
    counts,
    selected,
    parkedCount,
    skippedSampleCount,
    linesJa,
    warningsJa,
  };
}

/* ================================================================
 * 4. 画面用の読み出し
 * ================================================================ */

export async function listPendingSuppliers(limit = 100): Promise<Record<string, any>[]> {
  return all(
    `SELECT * FROM supplier_search_pending
      ORDER BY (demand_rank IS NULL), demand_rank DESC, id DESC LIMIT ?`,
    [limit],
  );
}

export async function countPendingByReason(): Promise<{ reason: string; count: number }[]> {
  const rows = await all(
    `SELECT reason, COUNT(*) AS c FROM supplier_search_pending GROUP BY reason ORDER BY c DESC`,
  );
  return rows.map((r) => ({ reason: String(r.reason), count: Number(r.c) }));
}

export async function listResearchRuns(limit = 30): Promise<Record<string, any>[]> {
  return all(`SELECT * FROM research_runs ORDER BY id DESC LIMIT ?`, [limit]);
}

export async function listResearchCandidates(limit = 100): Promise<Record<string, any>[]> {
  return all(`SELECT * FROM research_candidates ORDER BY id DESC LIMIT ?`, [limit]);
}

export async function latestRunSummary(): Promise<{
  runAt: string | null;
  researched: number | null;
  pending: number;
  buyOpportunities: number | null;
  messageJa: string;
}> {
  const runRow = await one(`SELECT * FROM research_runs ORDER BY id DESC LIMIT 1`);
  const pendingRow = await one(`SELECT COUNT(*) AS c FROM supplier_search_pending`);
  const pending = Number(pendingRow?.c ?? 0);

  if (!runRow) {
    return {
      runAt: null,
      researched: null,
      pending,
      buyOpportunities: null,
      messageJa: 'まだ一度も自動リサーチを回していません。',
    };
  }

  const researched = runRow.researched_products === null ? null : Number(runRow.researched_products);
  const buys = runRow.buy_opportunities === null ? null : Number(runRow.buy_opportunities);

  return {
    runAt: str(runRow.started_at),
    researched,
    pending,
    buyOpportunities: buys,
    messageJa:
      `最後に回したのは${str(runRow.started_at) ?? '不明'}です。`
      + `${researched === null ? '調べた件数は記録がありません。' : `${researched}件を見ました。`}`
      + `いま「仕入先探し待ち」に${pending}件たまっています。`,
  };
}

/** ★受け入れテスト用。テスト専用の印が付いた行だけを消す（ルール54）。 */
export async function clearPhase5TestRows(marker: string): Promise<number> {
  const res = await run(`DELETE FROM supplier_search_pending WHERE sell_side_id LIKE ?`, [`${marker}%`]);
  await run(`DELETE FROM research_candidates WHERE external_id LIKE ?`, [`${marker}%`]);
  return Number(res?.rowsAffected ?? 0);
}
