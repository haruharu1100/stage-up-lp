import fs from 'node:fs';
import { all, insert, newId, nowIso, run } from '../db/client';
import { config, secret } from '../env';
import { checkImportRegulations } from '../importRules';
import { enrichAttributes } from '../matching/textMatch';
import { matchListingToAmazon } from '../matching/matchScore';
import {
  dataSourceOf,
  findAmazonCandidates,
  getAmazonSearchProvider,
  rejectMixedSources,
  takeKeepaCallCount,
  type DataSource,
} from '../providers/amazonSearch';
import { getSupplierProviders, supplierListingCsvExists, supplierListingCsvPath } from '../providers/supplier';
import { keepaTokensConsumed, resetKeepaTokenMeter } from '../providers/keepaTokens';
import { notify } from '../providers/notification';
import { calcFreshness } from './freshness';
import { calcConfidence } from './confidence';
import { clearedAnomalyAsins, detectAnomalies, previousMonthlySales } from './anomaly';
import { recommendPurchaseQuantity } from '../inventory/purchaseQuantity';
import { purchaseStageOf } from '../inventory/safetyFactor';
import { loadDemandMultipliers } from '../learning/categoryBias';
import { failureWarningsFor, markLateralExplored, nextLateralQueries } from '../learning/postmortem';
import { canSpend, recordUsage } from '../ops/apiUsage';
import type {
  AmazonCandidate,
  MatchResult,
  PurchaseQuantityAdvice,
  ResearchCandidate,
  ResearchSettings,
  ResearchSummary,
  SupplierListing,
  SupplierQuote,
} from '../types';
import { calcResearchCost, triggerSellPrice, triggerSupplierPrice } from './researchProfit';
import { estimateMonthlySales, salesLabel } from './salesEstimate';
import { hiddenGemTags, priceGapScore } from './priceGap';
import { calcResearchScore, gradeResearch } from './researchScore';
import { loadResearchSettings } from './settings';
import {
  runDiscovery,
  saveDiscoveryRejections,
  type DiscoveryRejectionRecord,
  type DiscoveryRunOptions,
} from './discoveryRun';
import { REJECT_REASON_LABEL, type DiscoveryRejectReason } from './discoveryFilter';
import { saveDiscoveryDirectionStats } from './discoveryCost';
import {
  discoveryLiveReady,
  takeSupplierApiCallCount,
  type DiscoveryDirection,
} from '../providers/supplierDiscovery';

/**
 * リサーチ・パイプライン本体。
 *
 * 流れ（★安い処理から順に。高いAIは最後の一部だけ）
 *   1. SupplierProvider から仕入先商品を大量取得（AI費用ゼロ）
 *   2. Amazon側の候補を探す（JAN → 型番 → 商品名。Keepa or サンプル）
 *   3. MATCH SCORE（型番/名前=ゼロ円 → pHash=ほぼゼロ円 → 属性=ゼロ円
 *                   → Embedding=極小 → Vision=最後の数件だけ）
 *   4. 推定月販・全費目の採算・PRICE GAP・RESEARCH SCORE（全部ただの計算）
 *   5. A/B/C/D 判定 → DB保存
 *   6. 有望なものだけ「類似商品」へ探索を広げる（深さ・件数の上限つき）
 *
 * ★仕入れは絶対に自動で行わない。AUTO_PURCHASE は既定 false。
 */

export interface RunResearchOptions {
  limit?: number;
  keyword?: string | null;
  trigger?: string;
  settings?: Partial<ResearchSettings>;
  /** true にすると保存せず結果だけ返す（動作確認用） */
  dryRun?: boolean;
  /**
   * ★自動探索モード。
   *   指定すると「仕入先の商品一覧を人が用意する」のではなく、
   *   システムが自分で仕入先APIから安い商品を探してくる。
   *   指定が無いときは、これまでどおり SupplierProvider（受け取り口）から読む。
   */
  discovery?: DiscoveryRunOptions | null;
}

export interface RunResearchResult {
  summary: ResearchSummary;
  candidates: ResearchCandidate[];
}

/**
 * 仕入先データを「いつ取ったか」。
 * ★CSVならファイルの更新日時をそのまま使う（今読んだから新しい、とは言わない）。
 *   分からない時は null を返し、鮮度は「不明＝古い扱い」になる。
 */
function supplierDataFetchedAt(): string | null {
  try {
    if (supplierListingCsvExists()) {
      return new Date(fs.statSync(supplierListingCsvPath()).mtimeMs).toISOString();
    }
  } catch {
    /* 読めなければ不明のまま */
  }
  return nowIso();
}

function toQuote(l: SupplierListing): SupplierQuote {
  return {
    supplier: l.supplier,
    channel: l.channel,
    unitPriceJpy: l.unitPriceJpy,
    moq: l.moq,
    shippingPerUnitJpy: l.intlShippingPerUnitJpy,
    dutyRate: l.dutyRate,
    leadTimeDays: l.leadTimeDays,
    url: l.url ?? null,
    note: l.note ?? null,
    landedCostJpy: l.unitPriceJpy + l.intlShippingPerUnitJpy,
  };
}

/** 規約・法令上の「そもそも扱えない」を先に潰す（AI費用ゼロ） */
/**
 * 「今日の強い推奨」の唯一の定義。
 * 画面（app/research/page.tsx）もこの関数を使うので、判定が食い違うことはない。
 * Aランクであることに加えて、需要も利益も基準の1.5倍を超えているものだけ。
 */
export function isStrongPickValues(
  v: { grade: string; score: number; riskCount: number; salesUnits: number; netProfitJpy: number },
  s: { minMonthlySales: number; minProfitJpy: number },
): boolean {
  return (
    v.grade === 'A' &&
    v.riskCount === 0 &&
    v.score >= 75 &&
    v.salesUnits >= s.minMonthlySales * 1.5 &&
    v.netProfitJpy >= s.minProfitJpy * 1.5
  );
}

function isStrongPick(c: ResearchCandidate, s: { minMonthlySales: number; minProfitJpy: number }): boolean {
  return isStrongPickValues(
    {
      grade: c.grade,
      score: c.score.total,
      riskCount: c.risks.length,
      salesUnits: c.sales.units,
      netProfitJpy: c.cost.netProfitJpy,
    },
    s,
  );
}

function hardBlockOf(listing: SupplierListing, cand: AmazonCandidate): string | null {
  // Amazon内の他出品者から仕入れる形は、ドロップシッピングポリシー違反
  if (/amazon|アマゾン/i.test(listing.supplier) || /amazon\.co\.jp\/(dp|gp)/i.test(listing.url ?? '')) {
    return 'Amazon内の他出品者からの仕入れはドロップシッピングポリシー違反のため対象外です';
  }
  const items = checkImportRegulations(cand.product, toQuote(listing));
  const blocking = items.filter((i) => !i.passed && i.severity === 'blocking');
  if (blocking.length) {
    return `輸入手続きが必要で今のままでは販売できません（${blocking.map((i) => i.category).join('・')}）`;
  }
  return null;
}

function risksOf(listing: SupplierListing, cand: AmazonCandidate, match: MatchResult): string[] {
  const risks: string[] = [];
  const items = checkImportRegulations(cand.product, toQuote(listing));
  for (const i of items) {
    if (!i.passed && i.severity === 'warning') risks.push(`${i.category}の確認が必要`);
  }
  if (cand.market.isAmazonSelling) risks.push('Amazon本体が販売中');
  if ((cand.market.sellerCount ?? 0) > config.maxSellerCount) {
    risks.push(`出品者が多い（${cand.market.sellerCount}人）`);
  }
  if (match.verdict === 'needs_human') risks.push('同一商品かの最終確認が未了');
  if ((cand.market.rating ?? 5) < 3.5) risks.push('既存商品の評価が低い（返品risk）');
  if (listing.leadTimeDays > 40) risks.push(`納期が長い（${listing.leadTimeDays}日）`);
  if (cand.product.isFood) risks.push('食品は表示・許可の確認が必須');
  return risks;
}

function recommendationOf(c: {
  grade: string;
  score: number;
  sales: string;
  profit: number;
  gap: number;
  tags: string[];
  match: MatchResult;
  purchase?: PurchaseQuantityAdvice | null;
  confidence?: number | null;
}): string {
  const bits: string[] = [];
  if (c.grade === 'A') bits.push('今すぐ仕入れを検討してよい候補です');
  else if (c.grade === 'B') bits.push('あと一歩。条件が動けばAになります');
  else if (c.grade === 'C') bits.push('今は見送り。値動きを監視します');
  else bits.push('対象外です');

  bits.push(`${c.sales}／1個あたり${c.profit.toLocaleString()}円の利益`);

  // ★「何個仕入れるべきか」「最悪ケース」「売り切るまでの日数」を必ず書く
  if (c.purchase && c.purchase.qty > 0) {
    bits.push(`まずは${c.purchase.qty}個（約${c.purchase.estSellDays}日で売り切る想定）`);
    bits.push(
      `最悪ケースは売れ行きが半分で${c.purchase.worstCase.sellDays}日・` +
        `${c.purchase.worstCase.tiedUpCashJpy.toLocaleString()}円が在庫として寝ます`,
    );
  } else if (c.purchase) {
    bits.push('仕入れ数量は出していません（売れている数の根拠が足りません）');
  }

  if (typeof c.confidence === 'number') bits.push(`この判断の信頼度は${c.confidence}%`);
  if (c.gap >= 60) bits.push('仕入価格が相場よりかなり安い');
  if (c.match.verdict === 'needs_human') bits.push('※画像と仕様を人の目で1度だけ確認してください');
  if (c.tags.length) bits.push(c.tags.slice(0, 3).join('・'));
  return bits.join('。') + '。';
}

/** 落とした理由を「理由ごとの件数」にまとめる（画面とレポート用） */
function summariseRejections(
  list: DiscoveryRejectionRecord[],
): { stage: string; reasonCode: string; label: string; count: number }[] {
  const map = new Map<string, { stage: string; reasonCode: string; label: string; count: number }>();
  for (const r of list) {
    const key = `${r.stage}/${r.reasonCode}`;
    const cur = map.get(key);
    if (cur) cur.count++;
    else
      map.set(key, {
        stage: r.stage,
        reasonCode: r.reasonCode,
        label: REJECT_REASON_LABEL[r.reasonCode] ?? r.reasonCode,
        count: 1,
      });
  }
  return [...map.values()].sort((a, b) => b.count - a.count);
}

export async function runResearch(opts: RunResearchOptions = {}): Promise<RunResearchResult> {
  const base = await loadResearchSettings();
  const settings: ResearchSettings = { ...base, ...(opts.settings || {}) };
  let limit = Math.max(1, Math.min(2000, opts.limit ?? 60));
  const runId = newId('rsr');
  const startedAt = nowIso();

  const notes: string[] = [];
  const sources: string[] = [];

  // ---- ★Discovery KPI の計測をゼロに戻す（この実行ぶんだけを数えるため）------
  //   前の実行の数字が混ざらないよう、始める前に必ずリセットする。
  //   ★Keepaのトークンは「数えられなかった＝null」を維持する。0にはしない。
  resetKeepaTokenMeter();
  takeSupplierApiCallCount();

  // ---- ★LIVE_TEST_MODE（第4段階・仕様1番）--------------------------
  //   本番の鍵が入っている時は、いきなり大量にAPIを叩かない。
  //   「20件 → 結果確認 → 50件 → 100件」と人が手で上げていく前提の安全弁。
  const liveKeyPresent = !!secret('KEEPA_API_KEY');
  const liveTestOn = config.liveTestMode && liveKeyPresent;
  const liveTestLimit = Math.max(1, Math.round(config.liveTestLimit));
  if (liveTestOn && limit > liveTestLimit) {
    notes.push(
      `★本番テストモードです。指定は${limit}件でしたが、安全のため${liveTestLimit}件だけ調べます` +
        `（増やす時は .env の LIVE_TEST_LIMIT を 20→50→100 と手で上げてください）`,
    );
    limit = liveTestLimit;
  } else if (liveTestOn) {
    notes.push(`★本番テストモードです（1回の上限${liveTestLimit}件）。今回は${limit}件を調べます`);
  }

  // ---- 1. 仕入先から取得 ------------------------------------------
  const providers = getSupplierProviders();
  const listings: SupplierListing[] = [];

  // ---- 1-A. ★自動探索モード（システムが自分で商品を探す）------------
  //   人が商品一覧を用意しなくても回るようにするための入口。
  //   ここで落とした商品は理由コードつきで全部残す（改善分析用）。
  const discoveryOn = !!opts.discovery;
  const discoveryRejections: DiscoveryRejectionRecord[] = [];
  let discoveryMode: string | null = null;
  let discoveryDirection: string | null = null;
  let discoveredCount = 0;
  let prefilterPassed = 0;
  const discDirectionOf = new Map<string, DiscoveryDirection>();
  let discBothWays = new Set<string>();

  if (discoveryOn) {
    // ★本番テストモード中は、自動探索でもAmazon照合の件数を上限内に抑える
    const disc = await runDiscovery({
      ...opts.discovery!,
      maxAmazonChecks: Math.min(opts.discovery!.maxAmazonChecks ?? limit, limit),
    });
    notes.push(...disc.notes);
    discoveryRejections.push(...disc.rejections);
    discoveryMode = disc.mode;
    discoveryDirection = disc.direction;
    discoveredCount = disc.counts.discovered;
    prefilterPassed = disc.counts.prefilterPassed;
    discBothWays = disc.bothWays;
    for (const [k, v] of disc.directionOf) discDirectionOf.set(k, v);
    if (disc.providersUsed.length) sources.push(...disc.providersUsed.map((n) => `${n}（自動探索）`));
    listings.push(...disc.selected);
  }

  // ---- 1-B. 受け取り口（スプレッドシート・CSV等）から読む -------------
  //   ★自動探索で足りていれば、ここは呼ばない（無駄にAPIを叩かない）。
  for (const p of providers) {
    if (listings.length >= limit) break;
    try {
      const got = await p.fetchListings({ limit: limit - listings.length, keyword: opts.keyword ?? null });
      if (got.length) sources.push(`${p.name}${p.isReal ? '' : '（サンプル）'}`);
      listings.push(...got);
    } catch (e: any) {
      notes.push(`仕入先「${p.name}」の取得に失敗: ${String(e?.message ?? e).slice(0, 120)}`);
    }
  }
  if (!listings.length) {
    notes.push(
      discoveryOn
        ? '★自動探索でも受け取り口でも、仕入先の商品が1件も取れませんでした。' +
            '（下の「落とした理由」を見てください。理由が空なら、そもそも探索できるProviderがありません）'
        : '仕入先の商品が1件も取れませんでした。data/supplier_listings.csv を置くか、仕入先APIの鍵を設定してください',
    );
  }

  // ---- 1b. 売れた商品の「周辺」を掘る（横展開の種を消化する）--------
  //   ★本番テストモード中は横展開しない（件数が上限を超えるため）
  if (!opts.keyword && !opts.dryRun && !liveTestOn) {
    const seeds = await nextLateralQueries(3);
    for (const seed of seeds) {
      let found = 0;
      for (const p of providers) {
        try {
          const got = await p.fetchListings({ limit: 20, keyword: seed.query });
          for (const g of got) {
            if (listings.some((x) => x.externalId === g.externalId)) continue;
            listings.push(g);
            found++;
          }
        } catch {
          /* 掘れなくても本流は止めない */
        }
      }
      await markLateralExplored(seed.id, found);
      if (found) notes.push(`${seed.reason} → ${found}件を追加で調べました`);
    }
  }

  // ★本番テストモードでは、何があっても上限件数を超えてAPIを叩かない
  if (liveTestOn && listings.length > limit) {
    notes.push(`★本番テストモードのため、取得できた${listings.length}件のうち先頭${limit}件だけを調べます`);
    listings.length = limit;
  }
  // 類似商品への横展開も止める（1件が数十件に膨らむのを防ぐ）
  const expandLimit = liveTestOn ? 0 : settings.expandLimit;

  const amazonProvider = getAmazonSearchProvider();
  if (!amazonProvider.isReal) {
    notes.push('Amazon側は' + amazonProvider.note);
  }

  // ---- 本データかサンプルかを最初に決める（★混在は禁止）--------------
  const expected: DataSource = amazonProvider.isReal ? 'live' : 'sample';
  const mixed = { count: 0 };
  notes.push(
    expected === 'live'
      ? `本番データ（LIVE DATA）で判定します：${amazonProvider.note}`
      : `★サンプルデータで判定しています。実在の商品・実在の価格ではありません（${amazonProvider.note}）`,
  );

  // ---- お金の見張り（上限に近ければ課金AIを止める）-------------------
  const spend = await canSpend({
    monthlyBudgetJpy: settings.monthlyBudgetJpy,
    budgetStopRatio: settings.budgetStopRatio,
  });
  if (!spend.allowed) notes.push(`★${spend.reason}`);

  // ---- カテゴリー別の需要補正（実績5件以上たまった分だけ）-------------
  const demand = settings.categoryBiasEnabled ? await loadDemandMultipliers() : new Map<string, number>();
  if (demand.size) notes.push(`過去の実績から、${demand.size}カテゴリーの推定月販を補正しています`);

  const ctx: EvaluateContext = {
    expected,
    mixed,
    demand,
    allowPaidAi: spend.allowed,
    supplierFetchedAt: supplierDataFetchedAt(),
    clearedAnomalies: await clearedAnomalyAsins(),
  };

  // ---- 2〜5. 1件ずつ評価 -------------------------------------------
  const budget = { vision: settings.maxVisionCalls, embedding: config.maxEmbeddingCalls };
  const candidates: ResearchCandidate[] = [];
  let paidAiCalls = 0;
  let surveyed = 0;
  let amazonMatched = 0;
  /** ★KPI④：MATCH_SCORE が90点以上だった件数（③の一致候補数とは別に数える） */
  let matchScore90 = 0;
  let salesPassed = 0;
  let profitPassed = 0;

  /**
   * ★DISCOVERY_COST_PER_WINNER の材料。
   *   「どちらの向きで見つけた商品が、いくらのAPI費用で利益商品になったか」を向きごとに数える。
   *   どちらを主軸にするかを、感覚ではなく実績で決めるため。
   */
  const dirStats = new Map<DiscoveryDirection, { amazonChecked: number; highMatch: number; winners: number }>();
  const bumpDir = (dir: DiscoveryDirection | null | undefined, key: 'amazonChecked' | 'highMatch' | 'winners') => {
    if (!dir) return;
    const cur = dirStats.get(dir) ?? { amazonChecked: 0, highMatch: 0, winners: 0 };
    cur[key]++;
    dirStats.set(dir, cur);
  };

  const queue: SupplierListing[] = [...listings];
  const seenListings = new Set<string>(queue.map((l) => l.externalId));
  let expanded = 0;

  // 落ちた理由をこの場で1件ずつ残す（自動探索のときだけ保存する）
  const dropped = (
    l: SupplierListing,
    stage: DiscoveryRejectionRecord['stage'],
    reasonCode: DiscoveryRejectReason,
    note: string,
  ) => {
    if (!discoveryOn) return;
    discoveryRejections.push({
      externalId: l.externalId ?? null,
      source: l.source ?? null,
      title: l.title ?? null,
      url: l.url ?? null,
      priceJpy: Number.isFinite(l.unitPriceJpy) ? l.unitPriceJpy : null,
      stage,
      reasonCode,
      reasonNote: note,
    });
  };

  while (queue.length) {
    const listing = queue.shift()!;
    surveyed++;

    const evaluated = await evaluateListing(listing, settings, budget, amazonProvider, ctx);
    paidAiCalls += evaluated.paidAiCalls;
    if (!evaluated.candidate) {
      dropped(listing, 'AMAZON_SEARCH', 'NO_AMAZON_MATCH', 'Amazonに同じ商品が見つかりませんでした');
    }
    if (evaluated.candidate) {
      const c = evaluated.candidate;
      // ★どちら向きに見つけた商品かを必ず持たせる（後から検証できるようにするため）
      if (discoveryOn) {
        c.discoveryMode = discoveryMode;
        c.discoveryDirection = discDirectionOf.get(listing.externalId) ?? null;
        c.discoveryConfirmedBothWays = discBothWays.has(listing.externalId);
      }
      candidates.push(c);
      const dir = c.discoveryDirection ?? null;
      bumpDir(dir, 'amazonChecked');
      // ★数字は必ず「絞り込みの順番」で減っていくように数える。
      //   （同一商品と認められていないのに「売れています」と数えると人が誤解する）
      const matched = c.match.verdict !== 'excluded';
      if (matched) amazonMatched++;
      if (matched) bumpDir(dir, 'highMatch');
      // ★KPI④は「MATCH_SCORE 90点以上」。
      //   「除外されなかった数（＝③一致候補数）」を90点以上として言い換えるのは嘘になるので、
      //   点数そのものを見て別に数える。
      if (Number(c.match.total) >= 90) matchScore90++;
      else dropped(listing, 'MATCH', 'LOW_MATCH_SCORE', `一致度${c.match.total}点。同一商品と言い切れませんでした`);

      if (c.anomaly?.isAnomaly) {
        dropped(listing, 'MATCH', 'DATA_ANOMALY', c.anomaly.summary || '明らかにおかしいデータとして隔離しました');
      }

      const salesOk = matched && c.sales.basis !== 'unknown' && c.sales.units >= settings.minMonthlySales;
      if (salesOk) salesPassed++;
      else if (matched) {
        dropped(
          listing,
          'SALES',
          'LOW_SALES',
          c.sales.basis === 'unknown'
            ? '推定月販が分かりませんでした（分からないものを「売れている」とは扱いません）'
            : `推定月販${c.sales.units}個。基準の${settings.minMonthlySales}個に届きません`,
        );
      }
      if (
        salesOk &&
        c.cost.netProfitJpy >= settings.minProfitJpy &&
        c.cost.profitRate >= settings.minProfitRate &&
        c.cost.roi >= settings.minRoi
      ) {
        profitPassed++;
        bumpDir(dir, 'winners');
      } else if (salesOk) {
        dropped(
          listing,
          'PROFIT',
          'NO_PROFIT',
          `1個あたり利益${c.cost.netProfitJpy}円／利益率${Math.round(c.cost.profitRate * 100)}%／ROI${Math.round(
            c.cost.roi * 100,
          )}%。基準に届きません`,
        );
      }

      // ---- 6. 有望なものだけ類似商品へ広げる（仕様書15番）----------
      const depth = listing.depth ?? 0;
      const worthExpanding = c.grade === 'A' || c.grade === 'B';
      if (worthExpanding && depth < settings.expandDepth && expanded < expandLimit) {
        for (const p of providers) {
          if (!p.findSimilar) continue;
          try {
            const similar = await p.findSimilar(listing, Math.min(10, expandLimit - expanded));
            for (const s of similar) {
              if (seenListings.has(s.externalId)) continue; // 無限ループ防止
              if (expanded >= expandLimit) break;
              seenListings.add(s.externalId);
              queue.push({ ...s, depth: depth + 1, parentExternalId: listing.externalId });
              expanded++;
            }
          } catch {
            /* 類似探索の失敗は本流を止めない */
          }
        }
      }
    }
  }

  if (expanded) notes.push(`有望候補から類似商品を${expanded}件たどりました（深さ上限${settings.expandDepth}）`);

  // ---- 集計 --------------------------------------------------------
  candidates.sort((a, b) => b.score.total - a.score.total);
  const gradeA = candidates.filter((c) => c.grade === 'A').length;
  const gradeB = candidates.filter((c) => c.grade === 'B').length;
  const gradeC = candidates.filter((c) => c.grade === 'C').length;
  const gradeD = candidates.filter((c) => c.grade === 'D').length;
  // 「今日の強い推奨」= Aランクの中でも、需要も利益も基準を大きく超えている本命だけ。
  //   （毎日ここだけ見れば判断できるように、条件は基準の1.5倍で固定する）
  const strongList = candidates.filter((c) => isStrongPick(c, settings));
  const strongPicks = strongList.length;

  // ★異常データとして隔離した件数（人が確認するまでAランクにしない）
  const anomalyCount = candidates.filter((c) => c.anomaly?.isAnomaly).length;
  if (anomalyCount) {
    notes.push(
      `★明らかにおかしいデータを${anomalyCount}件、仕入判断から外しました（DATA_ANOMALY）。` +
        `リサーチ画面の「異常データ」から中身を確認できます`,
    );
  }

  if (!paidAiCalls) notes.push('今回の判定でAIの課金APIは1回も使っていません（すべて計算とルールで判定）');
  else notes.push(`AIの課金APIを${paidAiCalls}回だけ使いました（判定が割れた候補のみ）`);

  if (mixed.count) {
    notes.push(
      `★出どころの違うデータを${mixed.count}件はじきました（本番データとサンプルを混ぜないため）`,
    );
  }

  // ---- 使ったAPI回数を記録する（お金の見張り）------------------------
  const keepaUsed = takeKeepaCallCount();
  // ★KPI⑦：Keepaが実際に消費したトークン数。
  //   Keepaの応答に入っていなければ null（＝まだ数えられていない）。呼び出し回数で代用しない。
  const keepaTokens = keepaTokensConsumed();
  // ★KPI⑧：仕入先API（AliExpress等）を実際に呼んだ回数
  const supplierCalls = takeSupplierApiCallCount();
  const estCostJpy =
    Math.round((keepaUsed * config.keepaCostPerCallJpy + paidAiCalls * config.visionCostPerCallJpy) * 10) / 10;
  if (!opts.dryRun) {
    if (keepaUsed) await recordUsage('keepa', keepaUsed, { operation: 'research' });
    if (paidAiCalls) await recordUsage('openai_vision', paidAiCalls, { operation: 'research_match' });
  }

  const summary: ResearchSummary = {
    runId,
    startedAt,
    finishedAt: nowIso(),
    status: 'done',
    surveyed,
    amazonMatched,
    salesPassed,
    profitPassed,
    gradeA,
    gradeB,
    gradeC,
    gradeD,
    strongPicks,
    notes,
    minMonthlySales: settings.minMonthlySales,
    fulfillment: settings.fulfillment,
    paidAiCalls,
    sources: sources.length ? sources : ['（仕入先データなし）'],
    dataSource: expected,
    providerName: amazonProvider.name,
    mixedDataBlocked: mixed.count,
    keepaCalls: keepaUsed,
    openaiCalls: paidAiCalls,
    estCostJpy,
    liveTestMode: liveTestOn,
    liveTestLimit: liveTestOn ? liveTestLimit : null,
    anomalyCount,
    // ---- 自動探索のファネル（どこで候補が消えたか）--------------------
    discoveryMode,
    discoveryDirection,
    discoveredCount: discoveryOn ? discoveredCount : 0,
    prefilterPassed: discoveryOn ? prefilterPassed : 0,
    // ★KPI①。自動探索かどうかに関係なく「Keepaで実際に照合しにいった件数」を入れる。
    //   （以前は自動探索の時しか入れておらず、手動実行の成績表が0件に見えてしまっていた）
    amazonChecked: surveyed,
    // ★KPI④：MATCH_SCORE 90点以上の件数（③の一致候補数の言い換えではない）
    highMatch: matchScore90,
    discoveryRejections: summariseRejections(discoveryRejections),
    // ★4段階（DOCUMENTED→AUTHORIZED→CONNECTED→VERIFIED）が揃った時だけ true になる
    discoveryLiveReady: await discoveryLiveReady(),
    // ---- ★Discovery KPI 10項目（ユーザー指示 2026-08-20）--------------
    //   数えていないものは 0 にせず null のままにする（0と「不明」を混ぜない）。
    supplierSearched: discoveryOn ? discoveredCount : listings.length,
    matchCandidates: amazonMatched,
    keepaTokensUsed: keepaTokens,
    supplierApiCalls: supplierCalls,
    // ⑩ 利益商品1件あたりの費用。利益商品が0件なら計算しない（0で割らない・目安も出さない）
    costPerWinnerJpy:
      profitPassed > 0 && estCostJpy > 0 ? Math.round((estCostJpy / profitPassed) * 100) / 100 : null,
  };

  if (!opts.dryRun) {
    await saveRun(summary, opts.trigger ?? 'manual');
    if (discoveryRejections.length) await saveDiscoveryRejections(runId, discoveryRejections);
    if (discoveryOn && dirStats.size) {
      // 向きごとの「調べた件数・当たった件数・API費用の見積り」を残す
      await saveDiscoveryDirectionStats(
        runId,
        Array.from(dirStats.entries()).map(([direction, v]) => ({
          direction,
          discovered: Array.from(discDirectionOf.values()).filter((d) => d === direction).length,
          prefilterPassed: 0, // 一次除外は向きを分けずに行うため、ここは0のまま（作らない）
          amazonChecked: v.amazonChecked,
          highMatch: v.highMatch,
          winners: v.winners,
        })),
      );
    }
    for (const c of candidates) await saveCandidate(runId, c);
    await saveOemCandidates(candidates, settings);
    await notify({
      kind: 'daily_summary',
      title: `今日のリサーチ結果（Aランク${gradeA}件）`,
      body: [
        `調査した商品：${surveyed}件`,
        `Amazonと一致した候補：${amazonMatched}件`,
        `月${settings.minMonthlySales}個以上売れている：${salesPassed}件`,
        `利益条件クリア：${profitPassed}件`,
        `Aランク：${gradeA}件／今日の強い推奨：${strongPicks}件`,
      ].join('\n'),
    });
  }

  return { summary, candidates };
}

// ---- 1件の評価 -----------------------------------------------------

/** 1件を評価するときの共通の前提（データ源・統計補正・お金の残り） */
export interface EvaluateContext {
  /** 本データだけを見るのか、サンプルだけを見るのか（混在は禁止） */
  expected: DataSource;
  /** 混在で弾いた件数（呼び出し側で数える） */
  mixed: { count: number };
  /** カテゴリー別の需要補正（実績から作った統計） */
  demand: Map<string, number>;
  /** 課金AIを使ってよいか（月額上限に近いと false になる） */
  allowPaidAi: boolean;
  /** 仕入先データをいつ取ったか（鮮度の判定に使う） */
  supplierFetchedAt: string | null;
  /** 人が「データは正しい」と確認済みのASIN（30日以内） */
  clearedAnomalies?: Set<string>;
}

async function evaluateListing(
  listingRaw: SupplierListing,
  settings: ResearchSettings,
  budget: { vision: number; embedding: number },
  amazonProvider = getAmazonSearchProvider(),
  ctx?: EvaluateContext,
): Promise<{ candidate: ResearchCandidate | null; paidAiCalls: number }> {
  const listing: SupplierListing = {
    ...listingRaw,
    attributes: enrichAttributes(listingRaw.attributes, listingRaw.title),
  };
  let paidAiCalls = 0;

  const { candidates: found } = await findAmazonCandidates(
    listing,
    config.amazonCandidatesPerListing,
    amazonProvider,
  );

  // ★Mockと本番の混在は禁止。想定と違う出どころのものは、ここで捨てる。
  let amazonCands = found;
  if (ctx) {
    const { kept, rejected } = rejectMixedSources(ctx.expected, found);
    ctx.mixed.count += rejected.length;
    amazonCands = kept;
  }
  if (!amazonCands.length) return { candidate: null, paidAiCalls };

  // 一番よく一致する候補だけを残す
  let best: { cand: AmazonCandidate; match: MatchResult } | null = null;
  for (const cand of amazonCands) {
    const enriched: AmazonCandidate = {
      ...cand,
      attributes: enrichAttributes(cand.attributes, cand.product.title),
    };
    const outcome = await matchListingToAmazon(listing, enriched, {
      autoScore: settings.matchAutoScore,
      reviewScore: settings.matchReviewScore,
      // ★月額上限に近づいたら、課金AIは0回に絞る（止まるだけで壊れない）
      visionBudget: ctx && !ctx.allowPaidAi ? 0 : budget.vision,
      embeddingBudget: ctx && !ctx.allowPaidAi ? 0 : budget.embedding,
    });
    budget.vision -= outcome.visionUsed;
    budget.embedding -= outcome.embeddingUsed;
    paidAiCalls += outcome.visionUsed + outcome.embeddingUsed;
    if (!best || outcome.result.total > best.match.total) best = { cand: enriched, match: outcome.result };
  }
  if (!best) return { candidate: null, paidAiCalls };

  const { cand, match } = best;
  const cost = calcResearchCost(listing, cand, { fulfillment: settings.fulfillment });
  const sales = estimateMonthlySales(cand);
  const gap = priceGapScore(cost, sales);
  const tags = hiddenGemTags(listing, cand, cost, sales, gap);
  const hardBlock = hardBlockOf(listing, cand);
  const risks = risksOf(listing, cand, match);
  const score = calcResearchScore({ listing, cand, match, sales, cost, priceGap: gap, settings, risks });

  // ---- DATA_FRESHNESS（古すぎるデータはAランクにしない）--------------
  const freshness = calcFreshness({
    priceFetchedAt: cand.market.fetchedAt ?? null,
    bsrFetchedAt: cand.market.fetchedAt ?? null,
    supplierFetchedAt: ctx?.supplierFetchedAt ?? null,
    maxAgeHours: settings.maxDataAgeHours,
  });

  // ---- CONFIDENCE SCORE（同じAでも96%と72%は違う）-------------------
  const regItems = checkImportRegulations(cand.product, toQuote(listing));
  const confidence = calcConfidence({
    listing,
    cand,
    match,
    sales,
    cost,
    freshness,
    regulationWarnings: regItems.filter((i) => !i.passed && i.severity === 'warning').length,
    regulationBlocked: !!hardBlock,
  });

  // ---- DATA_ANOMALY（★異常データは仕入判断に使わない）----------------
  //   本番データの時だけ判定する（サンプルを「異常」とは呼ばない）。
  const isLive = dataSourceOf(cand) === 'live';
  const anomaly = detectAnomalies({
    listing,
    cand,
    sales,
    cost,
    prevMonthlySales: isLive ? await previousMonthlySales(cand.asin) : null,
    live: isLive,
    humanCleared: ctx?.clearedAnomalies?.has(cand.asin) ?? false,
  });

  const { grade, reasons: gradeReasons } = gradeResearch({
    score,
    match,
    sales,
    cost,
    settings,
    risks,
    hardBlock,
    freshness,
    confidence: confidence.total,
    anomaly: anomaly.isAnomaly ? { summary: anomaly.summary } : null,
    // ★仕入先側の状態もAランクの関門に渡す（URLなし・サンプル・項目欠けはAにしない）
    supplier: {
      dataQuality: listing.dataQuality ?? 'UNKNOWN',
      hasUrl: !!listing.url,
      hasImage: (listing.imageUrls?.length ?? 0) > 0,
      qualityNote: listing.dataQualityNote ?? null,
    },
  });

  // ---- 何個仕入れるか（★数式と統計だけ。AIは使わない）----------------
  const categoryKey = (cand.product.category ?? listing.categoryHint ?? '').trim();
  // ★NEW_PRODUCT_SAFETY_FACTOR：初回は推奨数をそのまま買わせない
  const stage = await purchaseStageOf(cand.asin);
  const purchase = recommendPurchaseQuantity({
    listing,
    cand,
    sales,
    cost,
    safetyStockDays: settings.safetyStockDays,
    maxFirstOrderQty: settings.maxFirstOrderQty,
    maxSellerCount: settings.maxSellerCount,
    demandMultiplier: categoryKey ? (ctx?.demand.get(categoryKey) ?? null) : null,
    stage,
  });

  // ---- 過去の失敗から見た注意点（A・Bだけ調べる。無駄な問い合わせを避ける）
  const failureWarnings =
    grade === 'A' || grade === 'B'
      ? await failureWarningsFor({
          category: categoryKey || null,
          sellerCount: cand.market.sellerCount ?? null,
          rating: cand.market.rating ?? null,
          isFood: cand.product.isFood,
          moq: listing.moq,
        })
      : [];

  // ---- B/C の監視用トリガー（仕様書14番）----------------------------
  const target = {
    minProfitJpy: settings.minProfitJpy,
    minProfitRate: settings.minProfitRate,
    minRoi: settings.minRoi,
  };
  let triggerSupplier: number | undefined;
  let triggerSell: number | undefined;
  let triggerSellers: number | undefined;
  const watch = grade === 'B' || grade === 'C';
  if (watch) {
    triggerSupplier = triggerSupplierPrice(listing, cand, target, settings.fulfillment) ?? undefined;
    triggerSell = triggerSellPrice(listing, cand, target, settings.fulfillment) ?? undefined;
    if ((cand.market.sellerCount ?? 0) > settings.maxSellerCount) triggerSellers = settings.maxSellerCount;
  }

  // ---- OEM候補（仕様書16番）----------------------------------------
  const oemCandidate =
    sales.basis !== 'unknown' &&
    sales.units >= settings.oemMinMonthlySales &&
    (cand.market.rating ?? 5) < 4.2 &&
    (cand.market.reviewCount ?? 0) >= 20;
  const oemReason = oemCandidate
    ? `${salesLabel(sales)}あるのに評価が${cand.market.rating}で不満が多い＝自社品で置き換える余地があります`
    : null;

  const candidate: ResearchCandidate = {
    id: newId('rc'),
    depth: listing.depth ?? 0,
    listing,
    amazon: cand,
    match,
    sales,
    cost,
    priceGapScore: gap,
    score,
    grade,
    gradeReasons,
    triggerSupplierPriceJpy: triggerSupplier,
    triggerSellPriceJpy: triggerSell,
    triggerSellerCount: triggerSellers,
    watch,
    risks,
    recommendation: recommendationOf({
      grade,
      score: score.total,
      sales: salesLabel(sales),
      profit: cost.netProfitJpy,
      gap,
      tags,
      match,
      purchase,
      confidence: confidence.total,
    }),
    hiddenGemTags: tags,
    oemCandidate,
    oemReason,
    freshness,
    confidence,
    purchase,
    failureWarnings,
    dataSource: dataSourceOf(cand),
    anomaly,
  };

  return { candidate, paidAiCalls };
}

// ---- 保存 -----------------------------------------------------------

async function saveRun(s: ResearchSummary, trigger: string) {
  await insert('research_runs', {
    id: s.runId,
    started_at: s.startedAt,
    finished_at: s.finishedAt ?? null,
    status: s.status,
    trigger,
    sources: JSON.stringify(s.sources),
    surveyed: s.surveyed,
    amazon_matched: s.amazonMatched,
    sales_passed: s.salesPassed,
    profit_passed: s.profitPassed,
    grade_a: s.gradeA,
    grade_b: s.gradeB,
    grade_c: s.gradeC,
    grade_d: s.gradeD,
    strong_picks: s.strongPicks,
    paid_ai_calls: s.paidAiCalls,
    min_monthly_sales: s.minMonthlySales,
    fulfillment: s.fulfillment,
    notes: JSON.stringify(s.notes),
    data_source: s.dataSource ?? null,
    provider_name: s.providerName ?? null,
    live_data: s.dataSource === 'live' ? 1 : 0,
    mixed_data_blocked: s.mixedDataBlocked ?? 0,
    keepa_calls: s.keepaCalls ?? 0,
    openai_calls: s.openaiCalls ?? 0,
    est_cost_jpy: s.estCostJpy ?? 0,
    live_test_mode: s.liveTestMode ? 1 : 0,
    live_test_limit: s.liveTestLimit ?? null,
    anomaly_count: s.anomalyCount ?? 0,
    discovery_mode: s.discoveryMode ?? null,
    discovery_direction: s.discoveryDirection ?? null,
    discovered_count: s.discoveredCount ?? 0,
    prefilter_passed: s.prefilterPassed ?? 0,
    amazon_checked: s.amazonChecked ?? 0,
    high_match: s.highMatch ?? 0,
    // --- Discovery KPI 10項目 ---
    //     ★数えていない項目は 0 で埋めず null にする（0件と「未計測」を混ぜない）。
    supplier_searched: s.supplierSearched ?? s.discoveredCount ?? 0,
    match_candidates: s.matchCandidates ?? s.amazonMatched ?? 0,
    keepa_tokens_used: s.keepaTokensUsed ?? null,
    supplier_api_calls: s.supplierApiCalls ?? 0,
    // ★利益商品が0件のときは「1件あたり◯円」を出さない
    cost_per_winner_jpy:
      s.costPerWinnerJpy ??
      (s.profitPassed > 0 && (s.estCostJpy ?? 0) > 0
        ? Math.round(((s.estCostJpy ?? 0) / s.profitPassed) * 100) / 100
        : null),
  });
}

async function saveCandidate(runId: string, c: ResearchCandidate) {
  const l = c.listing;
  const a = c.amazon;
  await insert('research_candidates', {
    id: c.id,
    research_run_id: runId,
    depth: c.depth,
    listing_external_id: l.externalId,
    listing_source: l.source,
    supplier: l.supplier,
    supplier_url: l.url ?? null,
    supplier_image: l.imageUrls[0] ?? null,
    supplier_title: l.title,
    supplier_price_jpy: l.unitPriceJpy,
    landed_cost_jpy: c.cost.landedCostJpy,
    moq: l.moq,
    lead_time_days: l.leadTimeDays,
    asin: a.asin,
    amazon_url: a.url,
    amazon_image: a.imageUrls[0] ?? null,
    amazon_title: a.product.title,
    amazon_price_jpy: a.market.priceJpy,
    bsr: a.market.bsr ?? null,
    review_count: a.market.reviewCount ?? null,
    rating: a.market.rating ?? null,
    seller_count: a.market.sellerCount ?? null,
    amazon_selling: a.market.isAmazonSelling ? 1 : 0,
    match_score: c.match.total,
    match_verdict: c.match.verdict,
    match_breakdown: JSON.stringify(c.match.breakdown),
    match_stages: JSON.stringify(c.match.stages),
    match_reasons: JSON.stringify(c.match.reasons),
    vision_checked: c.match.visionChecked ? 1 : 0,
    monthly_sales_est: c.sales.units,
    monthly_sales_basis: c.sales.basis,
    monthly_sales_confidence: c.sales.confidence,
    monthly_revenue_jpy: Math.round(c.sales.units * c.cost.sellPriceJpy),
    net_profit_jpy: c.cost.netProfitJpy,
    profit_rate: c.cost.profitRate,
    roi: c.cost.roi,
    cost_detail: JSON.stringify(c.cost),
    price_gap_score: c.priceGapScore,
    research_score: c.score.total,
    score_breakdown: JSON.stringify(c.score.breakdown),
    score_reasons: JSON.stringify(c.score.reasons),
    grade: c.grade,
    grade_reasons: JSON.stringify(c.gradeReasons),
    trigger_supplier_price_jpy: c.triggerSupplierPriceJpy ?? null,
    trigger_sell_price_jpy: c.triggerSellPriceJpy ?? null,
    trigger_seller_count: c.triggerSellerCount ?? null,
    watch: c.watch ? 1 : 0,
    promoted_at: null,
    risks: JSON.stringify(c.risks),
    hidden_gem_tags: JSON.stringify(c.hiddenGemTags),
    recommendation: c.recommendation,
    oem_candidate: c.oemCandidate ? 1 : 0,
    approval_status: 'pending',
    created_at: nowIso(),

    // ---- 第3段階：本データ判定・Keepaの中身・鮮度・信頼度・仕入数量 ----
    data_source: c.dataSource ?? null,
    live_data: c.dataSource === 'live' ? 1 : 0,
    category: a.product.category ?? l.categoryHint ?? null,

    // ---- 仕入先データの品質（Amazon側の live_data とは別物）----
    //      ★ここを保存しておかないと、後から見た時に「本物の仕入値だったのか
    //        サンプルの架空値だったのか」が分からなくなる。
    supplier_data_quality: l.dataQuality ?? 'UNKNOWN',
    supplier_quality_note: l.dataQualityNote ?? null,
    supplier_unknown_fields: JSON.stringify(l.unknownFields ?? []),
    supplier_stock: l.stock ?? null,
    supplier_updated_at: l.updatedAt ?? null,
    // ★どちら向きに見つけた商品か（自動探索の検証に使う）
    discovery_direction: c.discoveryDirection ?? null,
    discovery_mode: c.discoveryMode ?? null,
    discovery_confirmed_both_ways: c.discoveryConfirmedBothWays ? 1 : 0,
    avg_price_30d_jpy: a.market.avgPrice30dJpy ?? null,
    avg_price_90d_jpy: a.market.avgPrice90dJpy ?? null,
    bsr_avg_30d: a.market.bsrAvg30d ?? null,
    bsr_avg_90d: a.market.bsrAvg90d ?? null,
    bsr_history: a.market.bsrHistory ? JSON.stringify(a.market.bsrHistory) : null,
    buybox_price_jpy: a.market.buyBox?.priceJpy ?? null,
    buybox_seller_id: a.market.buyBox?.sellerId ?? null,
    buybox_is_amazon: a.market.buyBox ? (a.market.buyBox.isAmazon ? 1 : 0) : null,
    buybox_is_fba: a.market.buyBox ? (a.market.buyBox.isFba ? 1 : 0) : null,
    unknown_fields: JSON.stringify(a.market.unknownFields ?? []),
    market_fetched_at: a.market.fetchedAt ?? null,
    supplier_fetched_at: c.freshness?.parts.find((p) => p.field === '仕入価格')?.fetchedAt ?? null,
    freshness: c.freshness?.label ?? null,
    freshness_parts: c.freshness ? JSON.stringify(c.freshness.parts) : null,
    freshness_hours: c.freshness?.worstHours ?? null,
    stale: c.freshness?.stale ? 1 : 0,
    failure_warnings: JSON.stringify(c.failureWarnings ?? []),
    confidence: c.confidence?.total ?? null,
    confidence_breakdown: c.confidence ? JSON.stringify(c.confidence.breakdown) : null,
    confidence_reasons: c.confidence ? JSON.stringify(c.confidence.reasons) : null,
    recommended_qty: c.purchase?.qty ?? null,
    qty_reasons: c.purchase ? JSON.stringify(c.purchase.reasons) : null,
    qty_worst_case: c.purchase ? JSON.stringify(c.purchase.worstCase) : null,
    est_selldays: c.purchase?.estSellDays ?? null,

    // ---- 第4段階：DATA_ANOMALY（人の確認が済むまでAランク禁止）----
    anomaly: c.anomaly?.isAnomaly ? 1 : 0,
    anomaly_level: c.anomaly?.level ?? 'none',
    anomaly_items: c.anomaly ? JSON.stringify(c.anomaly.items) : null,
    anomaly_summary: c.anomaly?.summary ?? null,
    anomaly_cleared_at: null,
    anomaly_cleared_by: null,
    anomaly_cleared_note: null,
  });

  // 仕入先商品そのものも残す（次回の価格比較に使う）
  // ★同じ商品を二重に増やさない（取込側 supplierImport.ts と同じ鍵で見る）
  const already = await all(`SELECT id FROM supplier_listings WHERE source = ? AND external_id = ? LIMIT 1`, [
    l.source,
    l.externalId,
  ]);
  if (already.length) {
    await run(`UPDATE supplier_listings SET last_seen_at = ?, updated_at = ? WHERE source = ? AND external_id = ?`, [
      nowIso(),
      nowIso(),
      l.source,
      l.externalId,
    ]);
    return;
  }
  await run(
    `INSERT INTO supplier_listings
      (id, external_id, source, channel, supplier, title, brand, model_number, gtin, currency,
       unit_price_original, unit_price_jpy, moq, domestic_shipping_jpy, intl_shipping_jpy, duty_rate,
       inspection_fee_jpy, other_import_fee_jpy, lead_time_days, image_urls, image_hash, attributes,
       url, note, category_hint, supplier_rating, supplier_order_count, parent_external_id, depth,
       first_seen_at, updated_at)
     VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      newId('sl'),
      l.externalId,
      l.source,
      l.channel,
      l.supplier,
      l.title,
      l.brand ?? null,
      l.modelNumber ?? null,
      l.gtin ?? null,
      l.currency,
      l.unitPriceOriginal,
      l.unitPriceJpy,
      l.moq,
      l.domesticShippingJpy,
      l.intlShippingPerUnitJpy,
      l.dutyRate,
      l.inspectionFeeJpy,
      l.otherImportFeeJpy,
      l.leadTimeDays,
      JSON.stringify(l.imageUrls),
      l.imageHash ?? null,
      JSON.stringify(l.attributes),
      l.url ?? null,
      l.note ?? null,
      l.categoryHint ?? null,
      l.supplierRating ?? null,
      l.supplierOrderCount ?? null,
      l.parentExternalId ?? null,
      l.depth ?? 0,
      nowIso(),
      nowIso(),
    ],
  );
}

async function saveOemCandidates(candidates: ResearchCandidate[], settings: ResearchSettings) {
  for (const c of candidates.filter((x) => x.oemCandidate)) {
    const existing = await all(`SELECT id FROM oem_candidates WHERE asin = ?`, [c.amazon.asin]);
    const data = {
      asin: c.amazon.asin,
      title: c.amazon.product.title,
      category: c.amazon.product.category ?? null,
      monthly_sales_est: c.sales.units,
      amazon_price_jpy: c.amazon.market.priceJpy,
      rating: c.amazon.market.rating ?? null,
      review_count: c.amazon.market.reviewCount ?? null,
      top_complaints: JSON.stringify([]),
      complaint_hits: 0,
      supplier_hint: c.listing.supplier,
      supplier_price_jpy: c.listing.unitPriceJpy,
      reason: c.oemReason ?? '',
      priority: c.sales.units >= settings.oemMinMonthlySales * 2 ? 'high' : 'normal',
      updated_at: nowIso(),
    };
    if (existing.length) {
      await run(
        `UPDATE oem_candidates SET monthly_sales_est=?, amazon_price_jpy=?, rating=?, review_count=?,
           supplier_hint=?, supplier_price_jpy=?, reason=?, priority=?, updated_at=? WHERE id=?`,
        [
          data.monthly_sales_est,
          data.amazon_price_jpy,
          data.rating,
          data.review_count,
          data.supplier_hint,
          data.supplier_price_jpy,
          data.reason,
          data.priority,
          data.updated_at,
          existing[0].id,
        ],
      );
    } else {
      await insert('oem_candidates', { id: newId('oemc'), ...data, first_seen_at: nowIso() });
    }
  }
}

// ---- 読み出し（画面用）---------------------------------------------

export async function latestResearchRun() {
  const rows = await all(`SELECT * FROM research_runs ORDER BY started_at DESC LIMIT 1`);
  return rows[0] ?? null;
}

export async function researchCandidatesOf(
  runId: string,
  opts?: { grade?: string; limit?: number },
) {
  const args: any[] = [runId];
  let sql = `SELECT * FROM research_candidates WHERE research_run_id = ?`;
  if (opts?.grade) {
    sql += ` AND grade = ?`;
    args.push(opts.grade);
  }
  sql += ` ORDER BY research_score DESC LIMIT ?`;
  args.push(opts?.limit ?? 200);
  return all(sql, args);
}

export async function watchListCandidates(limit = 100) {
  return all(
    `SELECT * FROM research_candidates WHERE watch = 1 ORDER BY research_score DESC LIMIT ?`,
    [limit],
  );
}

export async function oemCandidateList(limit = 50) {
  return all(`SELECT * FROM oem_candidates ORDER BY monthly_sales_est DESC LIMIT ?`, [limit]);
}
