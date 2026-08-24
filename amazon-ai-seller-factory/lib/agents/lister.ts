import { insert, newId, nowIso, update } from '../db/client';
import { getAmazonProvider, type CatalogMatch } from '../providers/amazon';
import { config } from '../env';
import type { RunLogger } from '../logger';
import type { ListingPlan, ProductCore, ProfitResult } from '../types';

/**
 * AI社員06：Amazon出品担当。
 *   既存ASIN確認 → 相乗り or 新規 → 出品データ生成 → 検証 → （許可時のみ）出品
 * ★AMAZON_AUTO_PUBLISH=false の間は、検証プレビューまでで必ず止まる。
 */

export interface ListingResult {
  draftId: string;
  strategy: 'existing_asin' | 'new_asin';
  existingAsin: string | null;
  productType: string;
  sku: string;
  attributes: Record<string, unknown>;
  validation: { status: string; issues: { code: string; message: string; severity: string }[] };
}

const MARKETPLACE = () => config.marketplaceId;

function jp(value: string) {
  return [{ value, marketplace_id: MARKETPLACE(), language_tag: 'ja_JP' }];
}

function plain(value: unknown) {
  return [{ value, marketplace_id: MARKETPLACE() }];
}

/** カテゴリーからProductTypeを推定。確定は Product Type Definitions API で要確認 */
export function guessProductType(product: ProductCore): string {
  const c = `${product.category || ''} ${product.subcategory || ''}`;
  if (/調味料|ソース|だし/.test(c)) return 'CONDIMENT';
  if (/飲料|お茶|コーヒー/.test(c)) return 'BEVERAGE';
  if (/肉|加工肉/.test(c)) return 'MEAT';
  if (/食品|保存食|ギフト食品|加工食品/.test(c)) return 'FOOD_BEVERAGE';
  if (/日用品|ホーム|キッチン/.test(c)) return 'HOME';
  return 'PRODUCT';
}

export function buildSku(product: ProductCore): string {
  const base = (product.brand || 'SKU').replace(/[^A-Za-z0-9]/g, '').slice(0, 8).toUpperCase() || 'SKU';
  return `${base}-${product.id.slice(-8).toUpperCase()}`;
}

export async function runLister(
  runId: string,
  logger: RunLogger,
  product: ProductCore,
  plan: ListingPlan,
  profit: ProfitResult,
): Promise<ListingResult> {
  const amazon = getAmazonProvider();
  await logger.log('lister', 'info', `Amazon接続：${amazon.isReal ? 'SP-API（本番接続）' : '未接続（下書きのみ作成）'}`);

  // --- 1. 既存ASINを探す ------------------------------------------
  let matches: CatalogMatch[] = [];
  try {
    matches = await amazon.searchCatalog({ gtin: product.gtin, keywords: product.title });
  } catch (err: any) {
    await logger.log('lister', 'warn', `カタログ検索に失敗：${err?.message || err}`);
  }
  const exact = matches.find((m) => (product.gtin && m.asin) || m.title === product.title) || matches[0] || null;
  const strategy: ListingResult['strategy'] = exact ? 'existing_asin' : 'new_asin';
  if (exact) {
    await logger.log('lister', 'info', `既存ASIN ${exact.asin} が見つかったため相乗り出品の形で作ります`);
  } else {
    await logger.log('lister', 'info', '既存ASINが見つからないため、新規商品として出品データを作ります');
  }

  const productType = exact?.productType || guessProductType(product);
  const sku = buildSku(product);
  const title = plan.titles[0] || product.title;

  // --- 2. 出品データ（attributes）を組み立てる ----------------------
  const attributes: Record<string, unknown> = {
    item_name: jp(title),
    brand: jp(product.brand || ''),
    product_description: jp(plan.description),
    bullet_point: plan.bulletPoints.filter(Boolean).map((b) => ({
      value: b,
      marketplace_id: MARKETPLACE(),
      language_tag: 'ja_JP',
    })),
    generic_keyword: jp(plan.searchTerms.join(' ').slice(0, 250)),
    condition_type: plain('new_new'),
    merchant_suggested_asin: exact ? plain(exact.asin) : undefined,
    externally_assigned_product_identifier: product.gtin
      ? [{ value: product.gtin, type: product.gtin.length === 13 ? 'ean' : 'upc', marketplace_id: MARKETPLACE() }]
      : undefined,
    purchasable_offer: [
      {
        marketplace_id: MARKETPLACE(),
        currency: 'JPY',
        our_price: [{ schedule: [{ value_with_tax: profit.sellPriceJpy }] }],
      },
    ],
    fulfillment_availability: [{ fulfillment_channel_code: 'AMAZON_JP', quantity: 0 }],
    item_package_dimensions: product.packageSizeCm
      ? [
          {
            length: { value: product.packageSizeCm.length, unit: 'centimeters' },
            width: { value: product.packageSizeCm.width, unit: 'centimeters' },
            height: { value: product.packageSizeCm.height, unit: 'centimeters' },
            marketplace_id: MARKETPLACE(),
          },
        ]
      : undefined,
    item_package_weight: product.weightG
      ? [{ value: product.weightG / 1000, unit: 'kilograms', marketplace_id: MARKETPLACE() }]
      : undefined,
  };

  if (product.isFood) {
    attributes.storage_instructions = jp(product.storageMethod || '');
    if (product.shelfLifeDays) {
      attributes.shelf_life = [{ value: product.shelfLifeDays, unit: 'days', marketplace_id: MARKETPLACE() }];
    }
  }

  for (const key of Object.keys(attributes)) {
    if (attributes[key] === undefined) delete attributes[key];
  }

  // --- 3. 検証（本番出品はしない）---------------------------------
  let validation: ListingResult['validation'] = { status: 'skipped', issues: [] };
  try {
    const res = await amazon.validateListing({ sku, productType, attributes });
    validation = { status: res.status, issues: res.issues };
    const errors = res.issues.filter((i) => i.severity === 'ERROR');
    if (errors.length) {
      await logger.log('lister', 'warn', `出品データに${errors.length}件の不備：${errors.map((e) => e.message).join(' / ')}`);
    }
  } catch (err: any) {
    validation = { status: 'error', issues: [{ code: 'VALIDATE_FAILED', message: err?.message || String(err), severity: 'ERROR' }] };
    await logger.log('lister', 'warn', `検証に失敗：${err?.message || err}`);
  }

  const draftId = newId('draft');
  await insert('listing_drafts', {
    id: draftId,
    product_id: product.id,
    run_id: runId,
    strategy,
    existing_asin: exact?.asin ?? null,
    title,
    bullet_points: JSON.stringify(plan.bulletPoints),
    description: plan.description,
    search_terms: JSON.stringify(plan.searchTerms),
    seo_keywords: JSON.stringify(plan.seoKeywords),
    target_persona: plan.targetPersona,
    differentiation: JSON.stringify(plan.differentiation),
    ad_angles: JSON.stringify(plan.adAngles),
    image_plan: JSON.stringify(plan.imagePlan),
    video_plan: plan.videoPlanBrief,
    attributes_json: JSON.stringify(attributes),
    listing_payload: JSON.stringify({ sku, productType, requirements: 'LISTING', attributes }),
    validation: JSON.stringify(validation),
    status: 'draft',
    created_at: nowIso(),
  });

  await logger.log('lister', 'info', `出品データ（下書き）を作成しました。SKU：${sku}`);
  return { draftId, strategy, existingAsin: exact?.asin ?? null, productType, sku, attributes, validation };
}

/**
 * 本番出品。呼び出せるのは
 *   AMAZON_AUTO_PUBLISH=true かつ コンプライアンスがpass かつ 検証にERRORが無い
 * の全部が揃った時だけ。
 */
export async function publishListing(
  logger: RunLogger,
  args: { productId: string; draftId: string; sku: string; productType: string; attributes: Record<string, unknown> },
): Promise<{ status: string; message: string }> {
  const jobId = newId('job');
  await insert('publish_jobs', {
    id: jobId,
    product_id: args.productId,
    listing_draft_id: args.draftId,
    mode: config.autoPublish ? 'live' : 'dry_run',
    status: 'running',
    request_payload: JSON.stringify({ sku: args.sku, productType: args.productType, attributes: args.attributes }),
    created_at: nowIso(),
  });

  if (!config.autoPublish) {
    const message = 'AMAZON_AUTO_PUBLISH=false のため、Amazonへは送信していません（下書きまで）';
    await update('publish_jobs', jobId, { status: 'skipped', error: null, response_payload: JSON.stringify({ message }), finished_at: nowIso() });
    await logger.log('lister', 'info', message);
    return { status: 'skipped', message };
  }

  try {
    const amazon = getAmazonProvider();
    const res = await amazon.putListing({ sku: args.sku, productType: args.productType, attributes: args.attributes });
    await update('publish_jobs', jobId, {
      status: res.status === 'accepted' ? 'succeeded' : 'failed',
      submission_id: res.submissionId ?? null,
      response_payload: JSON.stringify(res),
      finished_at: nowIso(),
    });
    const message =
      res.status === 'accepted'
        ? `Amazonへ送信しました（submissionId: ${res.submissionId || '不明'}）`
        : `Amazonに拒否されました：${res.issues.map((i) => i.message).join(' / ')}`;
    await logger.log('lister', res.status === 'accepted' ? 'info' : 'warn', message);
    return { status: res.status, message };
  } catch (err: any) {
    const message = err?.message || String(err);
    await update('publish_jobs', jobId, { status: 'failed', error: message, finished_at: nowIso() });
    await logger.log('lister', 'error', `出品に失敗：${message}`);
    return { status: 'failed', message };
  }
}
