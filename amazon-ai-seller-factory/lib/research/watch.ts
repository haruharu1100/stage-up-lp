import { all, nowIso, run } from '../db/client';
import { notify } from '../providers/notification';
import { getAmazonSearchProvider } from '../providers/amazonSearch';
import { getSupplierProviders } from '../providers/supplier';
import { calcResearchCost, triggerSellPrice, triggerSupplierPrice } from './researchProfit';
import { estimateMonthlySales, salesLabel } from './salesEstimate';
import { loadResearchSettings } from './settings';
import { parseJson } from '../db/client';
import type { AmazonCandidate, SupplierAttributes, SupplierListing } from '../types';

/**
 * B/Cランク商品の再評価（仕様書14番）。
 *
 * 仕入価格・Amazon販売価格・競合数・ランキングを取り直し、
 * 条件を満たしたらAランクへ昇格させて通知する。
 *
 * ★ここでもAIは一切使わない（価格と数字を見るだけ）。
 * ★昇格しても自動で仕入れはしない。あくまで「教えるだけ」。
 */

export interface WatchResult {
  checked: number;
  promoted: number;
  promotedTitles: string[];
  /** Aだったのに条件を割った商品（お金を出す前に気づけるように） */
  demoted: number;
  demotedTitles: string[];
  notes: string[];
}

/**
 * @param opts.grade 指定するとそのランクだけを見張る（A=高頻度／B=中頻度／C=低頻度）
 */
export async function reevaluateWatchList(opts?: { limit?: number; grade?: 'A' | 'B' | 'C' | 'D' }): Promise<WatchResult> {
  const settings = await loadResearchSettings();
  const limit = opts?.limit ?? 100;
  const rows = opts?.grade
    ? await all(`SELECT * FROM research_candidates WHERE grade = ? ORDER BY research_score DESC LIMIT ?`, [
        opts.grade,
        limit,
      ])
    : await all(
        `SELECT * FROM research_candidates WHERE watch = 1 AND promoted_at IS NULL
         ORDER BY research_score DESC LIMIT ?`,
        [limit],
      );

  const notes: string[] = [];
  const promotedTitles: string[] = [];
  const demotedTitles: string[] = [];
  let promoted = 0;
  let demoted = 0;

  if (!rows.length) {
    return {
      checked: 0,
      promoted: 0,
      promotedTitles: [],
      demoted: 0,
      demotedTitles: [],
      notes: [opts?.grade ? `${opts.grade}ランクの商品はまだありません` : '監視中の商品はありません'],
    };
  }

  const amazonProvider = getAmazonSearchProvider();
  if (!amazonProvider.isReal) {
    notes.push('Amazon側が' + amazonProvider.note + '。価格の再取得は本データになってから意味を持ちます');
  }

  // 最新のAmazon価格をまとめて取り直す（ASINは1回のAPI呼び出しにまとめる）
  const asins = [...new Set(rows.map((r) => String(r.asin)).filter(Boolean))];
  const fresh = new Map<string, AmazonCandidate>();
  for (let i = 0; i < asins.length; i += 50) {
    try {
      const got = await amazonProvider.getByAsin(asins.slice(i, i + 50));
      for (const c of got) fresh.set(c.asin, c);
    } catch (e: any) {
      notes.push(`Amazon価格の再取得に失敗: ${String(e?.message ?? e).slice(0, 100)}`);
    }
  }

  // 仕入先の最新価格（CSV/APIを読み直す）
  const supplierPrices = new Map<string, number>();
  for (const p of getSupplierProviders()) {
    try {
      const listings = await p.fetchListings({ limit: 500 });
      for (const l of listings) supplierPrices.set(l.externalId, l.unitPriceJpy);
    } catch {
      /* 取れなくても前回値で判定を続ける */
    }
  }

  for (const r of rows) {
    const asin = String(r.asin);
    const cand = fresh.get(asin);
    const listing = listingFromRow(r, supplierPrices.get(String(r.listing_external_id)));

    const target = {
      minProfitJpy: settings.minProfitJpy,
      minProfitRate: settings.minProfitRate,
      minRoi: settings.minRoi,
    };

    if (!cand) {
      // Amazon側が取り直せない時は、仕入価格の変化だけで再計算する
      const stub = stubCandidate(r);
      const newCost = calcResearchCost(listing, stub, { fulfillment: settings.fulfillment });
      await updateTriggers(String(r.id), listing, stub, target, settings.fulfillment, newCost);
      continue;
    }

    const newCost = calcResearchCost(listing, cand, { fulfillment: settings.fulfillment });
    const sales = estimateMonthlySales(cand);
    const salesOk = sales.basis !== 'unknown' && sales.units >= settings.minMonthlySales;
    const profitOk =
      newCost.netProfitJpy >= settings.minProfitJpy &&
      newCost.profitRate >= settings.minProfitRate &&
      newCost.roi >= settings.minRoi;
    const sellersOk = (cand.market.sellerCount ?? 0) <= settings.maxSellerCount;
    const matchOk = String(r.match_verdict) === 'high';

    await updateTriggers(String(r.id), listing, cand, target, settings.fulfillment, newCost);

    const allOk = salesOk && profitOk && sellersOk && matchOk;

    // ★Aランクだったのに条件を割ったら、すぐBへ下げて知らせる（買う前に気づくため）
    if (String(r.grade) === 'A' && !allOk) {
      const why: string[] = [];
      if (!salesOk) why.push('売れ行きが基準を下回った');
      if (!profitOk) why.push('利益が基準を下回った');
      if (!sellersOk) why.push('出品者が増えた');
      if (!matchOk) why.push('同一商品と言い切れない');
      demoted++;
      demotedTitles.push(String(r.amazon_title).slice(0, 40));
      await run(
        `UPDATE research_candidates
            SET grade = 'B', watch = 1, promotion_reason = ?, prev_grade = 'A',
                amazon_price_jpy = ?, seller_count = ?, bsr = ?, net_profit_jpy = ?, profit_rate = ?, roi = ?
          WHERE id = ?`,
        [
          `★${why.join('・')}ためBへ下げました（${new Date().toLocaleDateString('ja-JP')}時点）`,
          cand.market.priceJpy,
          cand.market.sellerCount ?? null,
          cand.market.bsr ?? null,
          newCost.netProfitJpy,
          newCost.profitRate,
          newCost.roi,
          String(r.id),
        ],
      );
      continue;
    }

    if (allOk && String(r.grade) !== 'A') {
      promoted++;
      promotedTitles.push(String(r.amazon_title).slice(0, 40));
      await run(
        `UPDATE research_candidates
           SET grade = 'A', watch = 0, promoted_at = ?, net_profit_jpy = ?, profit_rate = ?, roi = ?,
               amazon_price_jpy = ?, seller_count = ?, bsr = ?, supplier_price_jpy = ?,
               cost_detail = ?, recommendation = ?
         WHERE id = ?`,
        [
          nowIso(),
          newCost.netProfitJpy,
          newCost.profitRate,
          newCost.roi,
          cand.market.priceJpy,
          cand.market.sellerCount ?? null,
          cand.market.bsr ?? null,
          listing.unitPriceJpy,
          JSON.stringify(newCost),
          `条件を満たしたためAランクへ上がりました。${salesLabel(sales)}／1個あたり${newCost.netProfitJpy.toLocaleString()}円の利益です。仕入れるかどうかはご自身でご判断ください。`,
          String(r.id),
        ],
      );
    }
  }

  if (promoted) {
    await notify({
      kind: 'grade_promoted',
      title: `${promoted}件がAランクに上がりました`,
      body: promotedTitles.join('\n') + '\n\n※自動で仕入れはしていません。管理画面で確認してください。',
    });
  }
  if (demoted) {
    await notify({
      kind: 'grade_promoted',
      title: `★${demoted}件がAランクの条件を割りました`,
      body: demotedTitles.join('\n') + '\n\n仕入れる前にもう一度ご確認ください。',
    });
  }

  return { checked: rows.length, promoted, promotedTitles, demoted, demotedTitles, notes };
}

async function updateTriggers(
  id: string,
  listing: SupplierListing,
  cand: AmazonCandidate,
  target: { minProfitJpy: number; minProfitRate: number; minRoi: number },
  fulfillment: 'fba' | 'fbm',
  cost: ReturnType<typeof calcResearchCost>,
) {
  const ts = triggerSupplierPrice(listing, cand, target, fulfillment);
  const tp = triggerSellPrice(listing, cand, target, fulfillment);
  await run(
    `UPDATE research_candidates
       SET trigger_supplier_price_jpy = ?, trigger_sell_price_jpy = ?,
           net_profit_jpy = ?, profit_rate = ?, roi = ?, cost_detail = ?
     WHERE id = ?`,
    [ts ?? null, tp ?? null, cost.netProfitJpy, cost.profitRate, cost.roi, JSON.stringify(cost), id],
  );
}

/**
 * 保存済みの候補（research_candidates の1行）から仕入先商品を復元する。
 * ★仕入先CSVの取込側（supplierImport.ts）でも同じ復元が必要なので共通化している。
 * @param priceOverrideJpy 新しい仕入価格が分かっている時に差し替える
 */
export function listingFromRow(r: Record<string, any>, priceOverrideJpy?: number | null): SupplierListing {
  const cost = parseJson<Record<string, any>>(r.cost_detail, {});
  const moq = Number(r.moq) || 1;
  return {
    externalId: String(r.listing_external_id),
    source: String(r.listing_source),
    channel: 'alibaba',
    supplier: String(r.supplier),
    title: String(r.supplier_title),
    currency: 'JPY',
    unitPriceOriginal: Number(r.supplier_price_jpy),
    unitPriceJpy: priceOverrideJpy ?? Number(r.supplier_price_jpy),
    moq,
    domesticShippingJpy: Number(cost.domesticShippingJpy ?? 0) * moq,
    intlShippingPerUnitJpy: Number(cost.intlShippingJpy ?? 0),
    dutyRate: 0,
    inspectionFeeJpy: Number(cost.inspectionJpy ?? 0) * moq,
    otherImportFeeJpy: Number(cost.importOtherJpy ?? 0) * moq,
    leadTimeDays: Number(r.lead_time_days) || 0,
    imageUrls: r.supplier_image ? [String(r.supplier_image)] : [],
    attributes: {} as SupplierAttributes,
    url: r.supplier_url ? String(r.supplier_url) : null,
    stock: r.supplier_stock === null || r.supplier_stock === undefined ? null : Number(r.supplier_stock),
    updatedAt: r.supplier_updated_at ? String(r.supplier_updated_at) : null,
    // ★保存時に確定した品質をそのまま復元する。ここで作り直して LIVE に格上げしない。
    dataQuality: (r.supplier_data_quality as SupplierListing['dataQuality']) || 'UNKNOWN',
    dataQualityNote: r.supplier_quality_note ? String(r.supplier_quality_note) : null,
    unknownFields: parseJson<string[]>(r.supplier_unknown_fields, []),
  };
}

/** Amazon側を取り直せない時の代用（保存済みの値をそのまま使う） */
export function stubCandidate(r: Record<string, any>): AmazonCandidate {
  return {
    asin: String(r.asin),
    url: String(r.amazon_url),
    product: {
      id: '',
      asin: String(r.asin),
      gtin: null,
      title: String(r.amazon_title),
      brand: null,
      category: null,
      subcategory: null,
      isFood: false,
      temperatureControl: 'ambient',
      packageSizeCm: null,
      weightG: null,
      shelfLifeDays: null,
      storageMethod: null,
      supplierName: null,
      supplierPriceJpy: null,
      sourceType: null,
    },
    market: {
      source: 'db',
      fetchedAt: nowIso(),
      priceJpy: Number(r.amazon_price_jpy) || 0,
      bsr: r.bsr != null ? Number(r.bsr) : null,
      reviewCount: r.review_count != null ? Number(r.review_count) : null,
      rating: r.rating != null ? Number(r.rating) : null,
      sellerCount: r.seller_count != null ? Number(r.seller_count) : null,
      isAmazonSelling: !!r.amazon_selling,
      monthlySalesEst: Number(r.monthly_sales_est) || null,
    },
    imageUrls: r.amazon_image ? [String(r.amazon_image)] : [],
    imageHash: null,
    modelNumber: null,
    attributes: {},
    source: 'db',
  };
}
