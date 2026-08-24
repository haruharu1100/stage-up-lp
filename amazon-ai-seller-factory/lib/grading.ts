import { config } from './env';
import { calcProfit } from './profit';
import { decideRoute, piggybackDifficulty } from './salesRoute';
import { checkImportRegulations } from './importRules';
import type {
  CandidateInput,
  FulfillmentMode,
  GradeResult,
  ProfitResult,
  SupplierQuote,
} from './types';

/**
 * A / B / C / D ランク分類。
 *
 * ★設計方針（コスト制御）
 *   ここはLLMを一切使わない純粋な計算。毎日1万商品を回すため、
 *   1件あたりのAPIコストをゼロにする。LLMを使うのはAランクの
 *   「なぜ推すか」の説明文だけ（発掘AI側でまとめて1回）。
 *
 *   A = 今すぐ仕入れ
 *   B = 値下がりしたら仕入れ（発動する仕入値／販売価格を算出して見張る）
 *   C = 競合が減ったら仕入れ（発動する競合数を算出して見張る）
 *   D = 販売しない（理由を残して毎日再評価しない）
 */

export interface GradeContext {
  input: CandidateInput;
  profit: ProfitResult;
  quote?: SupplierQuote | null;
  fulfillment?: FulfillmentMode;
  /** 需要スコア等を含む総合点（0-100） */
  scoreTotal?: number;
}

export function gradeCandidate(ctx: GradeContext): GradeResult {
  const { input, profit } = ctx;
  const { product, market } = input;
  const reasons: string[] = [];

  const route = decideRoute(product, market);
  const regs = checkImportRegulations(product, ctx.quote ?? null);
  const sellers = market.sellerCount ?? market.offerCount ?? 0;

  // ---- D判定：そもそも売ってはいけない／売っても意味がない ----------
  const blockingRegs = regs.filter((r) => !r.passed && r.severity === 'blocking');
  if (blockingRegs.length) {
    return {
      grade: 'D',
      route: 'not_sellable',
      routeReason: '規制により販売できません',
      reasons: blockingRegs.map((r) => `${r.category}：${r.detail}`),
      watch: false,
    };
  }

  if (product.temperatureControl === 'frozen' || product.temperatureControl === 'chilled') {
    reasons.push(
      ctx.fulfillment === 'fba'
        ? '★冷蔵・冷凍品はAmazon.co.jpのFBAで扱えません。自己発送に切り替えるか、対象外にしてください'
        : '冷蔵・冷凍品のためクール便（送料に加算済み）が必要です。将来FBAには切り替えられません',
    );
  }

  if (!market.priceJpy || market.priceJpy <= 0) {
    return {
      grade: 'D',
      route: route.route,
      routeReason: route.reason,
      reasons: ['Amazonでの販売価格が取得できませんでした'],
      watch: false,
    };
  }

  // ---- 相乗りの現実性 -----------------------------------------------
  const piggy = piggybackDifficulty(market);
  if (route.route === 'piggyback' && piggy.level === 'avoid') {
    return {
      grade: 'D',
      route: route.route,
      routeReason: route.reason,
      reasons: [piggy.reason],
      watch: false,
    };
  }

  // ---- 利益の基準 ----------------------------------------------------
  const meetsProfitRate = profit.profitRate >= config.minProfitRate;
  const meetsProfitJpy = profit.profitJpy >= config.minProfitJpy;
  const meetsRoi = profit.roi >= config.minRoi;
  const profitOk = meetsProfitRate && meetsProfitJpy && meetsRoi;

  const profitLine = `利益 ${Math.round(profit.profitJpy).toLocaleString()}円（利益率 ${(profit.profitRate * 100).toFixed(1)}% / ROI ${(profit.roi * 100).toFixed(0)}%）`;

  // ---- 競合の基準 ----------------------------------------------------
  const competitionOk = sellers <= config.maxSellerCount;

  // ============ A：利益も競合もOK ======================================
  if (profitOk && competitionOk) {
    reasons.push(profitLine);
    reasons.push(
      route.route === 'piggyback'
        ? `${piggy.reason}`
        : route.route === 'oem'
          ? '自社ブランド商品として新規ページを作成できます'
          : 'Amazonに同じ商品ページが無いため、新規ページを作れます',
    );
    if (ctx.quote) {
      reasons.push(`仕入先「${ctx.quote.supplier}」実仕入原価 ${ctx.quote.landedCostJpy.toLocaleString()}円`);
    } else {
      reasons.push('★仕入先が未確定です。仕入価格は仮置きのため、実際の見積で再判定してください');
    }
    const warnRegs = regs.filter((r) => !r.passed && r.severity === 'warning');
    for (const w of warnRegs) reasons.push(`要確認：${w.detail}`);
    return {
      grade: 'A',
      route: route.route,
      routeReason: route.reason,
      reasons,
      watch: false,
    };
  }

  // ============ C：利益は出るが競合が多すぎる ==========================
  if (profitOk && !competitionOk) {
    reasons.push(profitLine);
    reasons.push(`出品者が${sellers}人と多く、値下げ競争で利益が消えます（基準：${config.maxSellerCount}人以下）`);
    return {
      grade: 'C',
      route: route.route,
      routeReason: route.reason,
      reasons,
      triggerSellerCount: config.maxSellerCount,
      watch: true,
    };
  }

  // ============ B：あといくら動けばAになるか ============================
  // 「仕入値がいくらまで下がればAになるか」を逆算する
  const targetSupplier = solveSupplierPriceForGradeA(ctx);
  // 「販売価格がいくらまで上がればAになるか」を逆算する
  const targetSell = solveSellPriceForGradeA(ctx);

  const currentSupplier = profit.supplierPriceJpy;
  const supplierGapOk = targetSupplier != null && targetSupplier > 0 && targetSupplier >= currentSupplier * 0.6;
  const sellGapOk = targetSell != null && targetSell > 0 && targetSell <= market.priceJpy * 1.4;

  if (supplierGapOk || sellGapOk) {
    reasons.push(profitLine + ' ← 基準に届いていません');
    if (supplierGapOk) {
      reasons.push(
        `仕入値が ${targetSupplier!.toLocaleString()}円以下（今 ${currentSupplier.toLocaleString()}円）になれば基準を満たします`,
      );
    }
    if (sellGapOk) {
      reasons.push(
        `販売価格が ${targetSell!.toLocaleString()}円以上（今 ${Math.round(market.priceJpy).toLocaleString()}円）に戻れば基準を満たします`,
      );
    }
    if (!competitionOk) reasons.push(`ただし出品者${sellers}人と多いため、価格が動いても競合の減少もあわせて確認します`);
    return {
      grade: 'B',
      route: route.route,
      routeReason: route.reason,
      reasons,
      triggerSupplierPriceJpy: supplierGapOk ? targetSupplier : null,
      triggerSellPriceJpy: sellGapOk ? targetSell : null,
      triggerSellerCount: competitionOk ? null : config.maxSellerCount,
      watch: true,
    };
  }

  // ============ D：どう動いても基準に届かない ===========================
  reasons.push(profitLine);
  if (!meetsProfitJpy) reasons.push(`1個あたりの利益が ${config.minProfitJpy.toLocaleString()}円に届きません`);
  if (!meetsProfitRate) reasons.push(`利益率が ${(config.minProfitRate * 100).toFixed(0)}% に届きません`);
  if (!meetsRoi) reasons.push(`ROIが ${(config.minRoi * 100).toFixed(0)}% に届きません`);
  reasons.push('仕入値・販売価格が現実的な範囲で動いても基準を満たさないため対象外にします');

  return {
    grade: 'D',
    route: route.route,
    routeReason: route.reason,
    reasons,
    watch: false,
  };
}

/** 仕入値をいくらにすればAランク基準を満たすかを二分探索で逆算 */
function solveSupplierPriceForGradeA(ctx: GradeContext): number | null {
  const { input, profit } = ctx;
  let lo = 0;
  let hi = profit.supplierPriceJpy;
  if (hi <= 0) return null;
  if (meetsA(ctx, { supplierPriceJpy: hi })) return hi;
  if (!meetsA(ctx, { supplierPriceJpy: 1 })) return null;

  for (let i = 0; i < 30; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (meetsA(ctx, { supplierPriceJpy: mid })) lo = mid;
    else hi = mid;
    if (hi - lo <= 1) break;
  }
  return lo > 0 ? lo : null;
  function meetsA(c: GradeContext, o: { supplierPriceJpy: number }) {
    const p = calcProfit(input.product, input.market, {
      sellPriceJpy: profit.sellPriceJpy,
      supplierPriceJpy: o.supplierPriceJpy,
      fulfillment: c.fulfillment,
    });
    return p.profitRate >= config.minProfitRate && p.profitJpy >= config.minProfitJpy && p.roi >= config.minRoi;
  }
}

/** 販売価格をいくらにすればAランク基準を満たすかを二分探索で逆算 */
function solveSellPriceForGradeA(ctx: GradeContext): number | null {
  const { input, profit } = ctx;
  let lo = profit.sellPriceJpy;
  let hi = Math.round(profit.sellPriceJpy * 3 + 3000);
  if (!meetsA(hi)) return null;

  for (let i = 0; i < 30; i++) {
    const mid = Math.round((lo + hi) / 2);
    if (meetsA(mid)) hi = mid;
    else lo = mid;
    if (hi - lo <= 1) break;
  }
  return hi;
  function meetsA(sell: number) {
    const p = calcProfit(input.product, input.market, {
      sellPriceJpy: sell,
      supplierPriceJpy: profit.supplierPriceJpy,
      fulfillment: ctx.fulfillment,
    });
    return p.profitRate >= config.minProfitRate && p.profitJpy >= config.minProfitJpy && p.roi >= config.minRoi;
  }
}

/** 発掘結果の集計（毎朝ダッシュボードの4つの数字） */
export interface DiscoverySummary {
  analyzed: number;
  promising: number;      // A + B + C
  profitCleared: number;  // 利益基準を満たした数（A + C）
  strongBuy: number;      // A
  byGrade: Record<string, number>;
}

export function summarize(grades: { grade: string }[]): DiscoverySummary {
  const byGrade: Record<string, number> = { A: 0, B: 0, C: 0, D: 0 };
  for (const g of grades) byGrade[g.grade] = (byGrade[g.grade] || 0) + 1;
  return {
    analyzed: grades.length,
    promising: byGrade.A + byGrade.B + byGrade.C,
    profitCleared: byGrade.A + byGrade.C,
    strongBuy: byGrade.A,
    byGrade,
  };
}
