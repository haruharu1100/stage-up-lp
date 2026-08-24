import crypto from 'node:crypto';
import { all, insert, newId, nowIso, run } from '../db/client';
import { notify } from '../providers/notification';
import { parseSupplierCsvText } from '../providers/supplier';
import { calcResearchCost } from '../research/researchProfit';
import { loadResearchSettings } from '../research/settings';
import { listingFromRow, stubCandidate } from '../research/watch';
import type { ResearchSettings, SupplierListing } from '../types';
import { getImportAdapters, type ImportAdapter } from './importAdapters';

/**
 * 仕入先データの自動取込と差分判定。
 *
 * ユーザー指定：
 *   ・商品名／商品コード／JAN／型番／価格／在庫／最低発注数／送料／更新日時 を比較し、
 *     「変更があった商品だけ」再評価する（全件やり直さない）
 *   ・仕入価格が下がったら利益条件を再判定し、条件を満たせばAランクへ昇格
 *   ・画面に「仕入価格175円下落によりA昇格」と理由を残す
 *
 * ★このモジュールはお金を動かさない。発注は一切しない。
 * ★取れなかった項目を推測で埋めない（在庫欄が無いCSVなら「無い」と扱う）。
 */

// 比較する項目（★ここに1行足すだけで比較対象を増やせる）
const COMPARE: { key: string; label: string; of: (l: SupplierListing) => string | number | null }[] = [
  { key: 'title', label: '商品名', of: (l) => l.title },
  { key: 'gtin', label: 'JAN', of: (l) => l.gtin ?? null },
  { key: 'model_number', label: '型番', of: (l) => l.modelNumber ?? null },
  { key: 'unit_price_jpy', label: '仕入価格', of: (l) => l.unitPriceJpy },
  { key: 'moq', label: '最低発注数', of: (l) => l.moq },
  { key: 'domestic_shipping_jpy', label: '国内送料', of: (l) => l.domesticShippingJpy },
  { key: 'intl_shipping_jpy', label: '国際送料', of: (l) => l.intlShippingPerUnitJpy },
  { key: 'lead_time_days', label: 'リードタイム', of: (l) => l.leadTimeDays },
  { key: 'supplier', label: '仕入先', of: (l) => l.supplier },
];

function contentHashOf(l: SupplierListing): string {
  const src = COMPARE.map((c) => `${c.key}=${c.of(l) ?? ''}`).join('|');
  return crypto.createHash('sha1').update(src).digest('hex');
}

export interface ImportRunResult {
  adapter: string;
  ok: boolean;
  sourceRef: string;
  seen: number;
  added: number;
  changed: number;
  unchanged: number;
  gone: number;
  message: string;
}

export interface SupplierImportSummary {
  runs: ImportRunResult[];
  /** 変更があった商品だけ（＝再評価すべきもの） */
  changed: SupplierListing[];
  added: SupplierListing[];
  promoted: PromotionResult[];
  notes: string[];
}

/** 取込を実行する（毎日の自動実行からも、画面のボタンからも同じ入口） */
export async function runSupplierImport(opts?: { adapters?: string[] }): Promise<SupplierImportSummary> {
  const wanted = opts?.adapters?.map((s) => s.trim().toLowerCase()).filter(Boolean);
  const adapters = getImportAdapters().filter((a) => (wanted?.length ? wanted.includes(a.name) : true));

  const runs: ImportRunResult[] = [];
  const changedAll: SupplierListing[] = [];
  const addedAll: SupplierListing[] = [];
  const notes: string[] = [];

  const usable = adapters.filter((a) => a.ready);
  if (!usable.length) {
    notes.push(
      '使える取込先がありません。' +
        adapters.map((a) => `【${a.name}】${a.note}`).join(' ／ '),
    );
    return { runs, changed: [], added: [], promoted: [], notes };
  }

  for (const adapter of usable) {
    const r = await importOne(adapter, changedAll, addedAll);
    runs.push(r);
    if (!r.ok) notes.push(`【${adapter.name}】${r.message}`);
  }

  // 変更があった商品だけを対象に、利益条件を再判定する
  const promoted = await promoteOnSupplierPriceDrop(changedAll);
  if (promoted.length) {
    await notify({
      kind: 'grade_promoted',
      title: `仕入価格の下落で${promoted.length}件がAランクに上がりました`,
      body:
        promoted.map((p) => `・${p.title}（${p.reason}）`).join('\n') +
        '\n\n※自動で発注はしていません。管理画面で確認してください。',
    });
  }

  return { runs, changed: changedAll, added: addedAll, promoted, notes };
}

async function importOne(
  adapter: ImportAdapter,
  changedOut: SupplierListing[],
  addedOut: SupplierListing[],
): Promise<ImportRunResult> {
  const importId = newId('imp');
  const startedAt = nowIso();
  await insert('supplier_imports', {
    id: importId,
    adapter: adapter.name,
    source_ref: adapter.sourceRef,
    status: 'running',
    started_at: startedAt,
  });

  const fail = async (message: string): Promise<ImportRunResult> => {
    await run(`UPDATE supplier_imports SET status = ?, error = ?, finished_at = ? WHERE id = ?`, [
      'failed',
      message,
      nowIso(),
      importId,
    ]);
    return {
      adapter: adapter.name,
      ok: false,
      sourceRef: adapter.sourceRef,
      seen: 0,
      added: 0,
      changed: 0,
      unchanged: 0,
      gone: 0,
      message,
    };
  };

  let listings: SupplierListing[];
  try {
    const csv = await adapter.fetchCsv();
    if (!csv) return await fail('データが取れませんでした（設定を確認してください）');
    listings = parseSupplierCsvText(csv);
  } catch (e: any) {
    return await fail(String(e?.message ?? e).slice(0, 300));
  }

  if (!listings.length) {
    return await fail('取り込めた商品が0件でした（列名が違うか、Amazon仕入れとして除外された可能性があります）');
  }

  let added = 0;
  let changed = 0;
  let unchanged = 0;
  const sourcesSeen = new Set<string>();

  for (const l of listings) {
    sourcesSeen.add(l.source);
    const hash = contentHashOf(l);
    const rows = await all(
      `SELECT * FROM supplier_listings WHERE source = ? AND external_id = ? ORDER BY updated_at DESC LIMIT 1`,
      [l.source, l.externalId],
    );
    const prev = rows[0];

    if (!prev) {
      await insertListing(l, hash, importId, adapter.name);
      added++;
      addedOut.push(l);
      continue;
    }

    // 既にある商品：中身が変わったかだけを見る
    if (String(prev.content_hash ?? '') === hash) {
      await run(`UPDATE supplier_listings SET last_seen_at = ?, gone = 0 WHERE source = ? AND external_id = ?`, [
        nowIso(),
        l.source,
        l.externalId,
      ]);
      unchanged++;
      continue;
    }

    const diffs = diffFields(prev, l);
    const prevPrice = prev.unit_price_jpy != null ? Number(prev.unit_price_jpy) : null;
    const priceDelta = prevPrice != null ? l.unitPriceJpy - prevPrice : null;

    for (const d of diffs) {
      await insert('supplier_price_history', {
        id: newId('sph'),
        listing_key: `${l.source}:${l.externalId}`,
        source: l.source,
        external_id: l.externalId,
        field: d.field,
        old_value: d.oldValue,
        new_value: d.newValue,
        delta: d.delta,
        import_id: importId,
        created_at: nowIso(),
      });
    }

    await updateListing(l, hash, importId, adapter.name, prevPrice, priceDelta);
    changed++;
    changedOut.push(l);
  }

  // 今回のファイルに載っていなくなった商品（消えた＝もう買えない可能性）
  let gone = 0;
  for (const src of sourcesSeen) {
    const res = await all(
      `SELECT id FROM supplier_listings
        WHERE source = ? AND gone = 0 AND (last_seen_at IS NULL OR last_seen_at < ?)`,
      [src, startedAt],
    );
    if (res.length) {
      gone += res.length;
      await run(`UPDATE supplier_listings SET gone = 1, updated_at = ? WHERE source = ? AND gone = 0 AND (last_seen_at IS NULL OR last_seen_at < ?)`, [
        nowIso(),
        src,
        startedAt,
      ]);
    }
  }

  await run(
    `UPDATE supplier_imports
        SET status = ?, rows_seen = ?, rows_new = ?, rows_changed = ?, rows_unchanged = ?, rows_gone = ?, finished_at = ?
      WHERE id = ?`,
    ['done', listings.length, added, changed, unchanged, gone, nowIso(), importId],
  );

  return {
    adapter: adapter.name,
    ok: true,
    sourceRef: adapter.sourceRef,
    seen: listings.length,
    added,
    changed,
    unchanged,
    gone,
    message:
      `${listings.length}件を確認しました（新規${added}件／変更${changed}件／変化なし${unchanged}件` +
      (gone ? `／消えた${gone}件` : '') +
      `）。変化のない${unchanged}件は再計算していません`,
  };
}

function diffFields(prev: Record<string, any>, l: SupplierListing) {
  const out: { field: string; label: string; oldValue: string | null; newValue: string | null; delta: number | null }[] =
    [];
  for (const c of COMPARE) {
    const before = prev[c.key];
    const after = c.of(l);
    const b = before === null || before === undefined ? null : String(before);
    const a = after === null || after === undefined ? null : String(after);
    if (b === a) continue;
    const delta =
      typeof after === 'number' && before !== null && before !== undefined && Number.isFinite(Number(before))
        ? after - Number(before)
        : null;
    out.push({ field: c.label, label: c.label, oldValue: b, newValue: a, delta });
  }
  return out;
}

async function insertListing(l: SupplierListing, hash: string, importId: string, adapter: string) {
  await insert('supplier_listings', {
    id: newId('sl'),
    external_id: l.externalId,
    source: l.source,
    channel: l.channel,
    supplier: l.supplier,
    title: l.title,
    brand: l.brand ?? null,
    model_number: l.modelNumber ?? null,
    gtin: l.gtin ?? null,
    currency: l.currency,
    unit_price_original: l.unitPriceOriginal,
    unit_price_jpy: l.unitPriceJpy,
    moq: l.moq,
    domestic_shipping_jpy: l.domesticShippingJpy,
    intl_shipping_jpy: l.intlShippingPerUnitJpy,
    duty_rate: l.dutyRate,
    inspection_fee_jpy: l.inspectionFeeJpy,
    other_import_fee_jpy: l.otherImportFeeJpy,
    lead_time_days: l.leadTimeDays,
    image_urls: JSON.stringify(l.imageUrls),
    image_hash: l.imageHash ?? null,
    attributes: JSON.stringify(l.attributes),
    url: l.url ?? null,
    note: l.note ?? null,
    category_hint: l.categoryHint ?? null,
    supplier_rating: l.supplierRating ?? null,
    supplier_order_count: l.supplierOrderCount ?? null,
    parent_external_id: l.parentExternalId ?? null,
    depth: l.depth ?? 0,
    content_hash: hash,
    last_seen_at: nowIso(),
    last_changed_at: nowIso(),
    prev_price: null,
    price_delta: null,
    import_id: importId,
    adapter,
    gone: 0,
    first_seen_at: nowIso(),
    updated_at: nowIso(),
  });
}

async function updateListing(
  l: SupplierListing,
  hash: string,
  importId: string,
  adapter: string,
  prevPrice: number | null,
  priceDelta: number | null,
) {
  await run(
    `UPDATE supplier_listings SET
        title = ?, brand = ?, model_number = ?, gtin = ?, currency = ?,
        unit_price_original = ?, unit_price_jpy = ?, moq = ?, domestic_shipping_jpy = ?,
        intl_shipping_jpy = ?, duty_rate = ?, inspection_fee_jpy = ?, other_import_fee_jpy = ?,
        lead_time_days = ?, image_urls = ?, image_hash = ?, attributes = ?, url = ?, note = ?,
        category_hint = ?, supplier_rating = ?, supplier_order_count = ?,
        content_hash = ?, last_seen_at = ?, last_changed_at = ?, prev_price = ?, price_delta = ?,
        import_id = ?, adapter = ?, gone = 0, updated_at = ?
      WHERE source = ? AND external_id = ?`,
    [
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
      hash,
      nowIso(),
      nowIso(),
      prevPrice,
      priceDelta,
      importId,
      adapter,
      nowIso(),
      l.source,
      l.externalId,
    ],
  );
}

// ==================================================================
//  仕入価格が下がった商品のAランク昇格
// ==================================================================

export interface PromotionResult {
  candidateId: string;
  title: string;
  prevGrade: string;
  dropJpy: number;
  reason: string;
}

/**
 * 値下がりした商品だけ利益条件を計算し直し、条件を満たせばAへ上げる。
 * ★上げるのは「表示のランク」だけ。発注は一切しない。
 * ★Amazon側の数字は取り直していないので、保存済みの値で判定する
 *   （そのため月販・競合数・照合の条件は今までどおり満たしている必要がある）。
 */
export async function promoteOnSupplierPriceDrop(changed: SupplierListing[]): Promise<PromotionResult[]> {
  if (!changed.length) return [];
  const settings = await loadResearchSettings();
  const out: PromotionResult[] = [];

  for (const l of changed) {
    const rows = await all(
      `SELECT * FROM research_candidates
        WHERE listing_source = ? AND listing_external_id = ?
        ORDER BY created_at DESC LIMIT 1`,
      [l.source, l.externalId],
    );
    const r = rows[0];
    if (!r) continue;

    const oldPrice = Number(r.supplier_price_jpy) || 0;
    const drop = oldPrice - l.unitPriceJpy;

    // 価格が変わっていない／上がった場合は、価格だけ更新して終わり
    if (drop <= 0) {
      await run(`UPDATE research_candidates SET supplier_price_jpy = ? WHERE id = ?`, [l.unitPriceJpy, r.id]);
      continue;
    }

    const stub = stubCandidate(r);
    const listing = listingFromRow(r, l.unitPriceJpy);
    const cost = calcResearchCost(listing, stub, { fulfillment: settings.fulfillment });

    const blocked = promotionBlockers(r, settings);
    const profitOk =
      cost.netProfitJpy >= settings.minProfitJpy &&
      cost.profitRate >= settings.minProfitRate &&
      cost.roi >= settings.minRoi;

    const prevGrade = String(r.grade ?? '');
    const canPromote = profitOk && !blocked.length && prevGrade !== 'A';
    const reason = canPromote
      ? `仕入価格${drop.toLocaleString()}円下落によりA昇格（${oldPrice.toLocaleString()}円 → ${l.unitPriceJpy.toLocaleString()}円）`
      : `仕入価格${drop.toLocaleString()}円下落（${oldPrice.toLocaleString()}円 → ${l.unitPriceJpy.toLocaleString()}円）。` +
        (blocked.length ? `ただし${blocked.join('／')}のためAには上げていません` : 'ただし利益条件にはまだ届いていません');

    await run(
      `UPDATE research_candidates
          SET supplier_price_jpy = ?, landed_cost_jpy = ?, net_profit_jpy = ?, profit_rate = ?, roi = ?,
              cost_detail = ?, promotion_reason = ?, prev_grade = ?, grade = ?, watch = ?, promoted_at = ?
        WHERE id = ?`,
      [
        l.unitPriceJpy,
        cost.landedCostJpy,
        cost.netProfitJpy,
        cost.profitRate,
        cost.roi,
        JSON.stringify(cost),
        reason,
        prevGrade,
        canPromote ? 'A' : prevGrade,
        canPromote ? 0 : Number(r.watch ?? 0),
        canPromote ? nowIso() : (r.promoted_at ?? null),
        r.id,
      ],
    );

    if (canPromote) {
      out.push({
        candidateId: String(r.id),
        title: String(r.amazon_title ?? r.supplier_title ?? '').slice(0, 40),
        prevGrade,
        dropJpy: drop,
        reason,
      });
    }
  }

  return out;
}

/** 値下がりしてもAに上げられない理由（保存済みの数字で確認する） */
function promotionBlockers(r: Record<string, any>, settings: ResearchSettings): string[] {
  const out: string[] = [];
  if (String(r.match_verdict ?? '') !== 'high') out.push('同一商品と言い切れない');
  if (String(r.monthly_sales_basis ?? '') === 'unknown') out.push('売れている数が分からない');
  else if ((Number(r.monthly_sales_est) || 0) < settings.minMonthlySales) out.push('推定月販が基準未満');
  if ((Number(r.seller_count) || 0) > settings.maxSellerCount) out.push('出品者が多すぎる');
  if (Number(r.amazon_selling) === 1) out.push('Amazon本体が売っている');
  return out;
}

// ==================================================================
//  画面用
// ==================================================================

export async function supplierImportHistory(limit = 20) {
  return all(`SELECT * FROM supplier_imports ORDER BY started_at DESC LIMIT ?`, [limit]);
}

export async function supplierPriceChanges(limit = 50) {
  return all(`SELECT * FROM supplier_price_history ORDER BY created_at DESC LIMIT ?`, [limit]);
}

export async function changedListingsSince(iso: string) {
  return all(`SELECT * FROM supplier_listings WHERE last_changed_at >= ? ORDER BY last_changed_at DESC`, [iso]);
}
