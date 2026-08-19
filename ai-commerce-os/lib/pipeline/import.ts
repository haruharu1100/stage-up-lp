import { all, batch, nowIso, run, today } from '../db/client';
import { ensureSupplier, getSupplierConnector } from '../connectors/registry';
import type { RawSupplierProduct } from '../connectors/types';
import {
  cleanText, contentHash, identityKey, modelKey, normalizeBrand, normalizeCategory,
  normalizeColor, normalizeCondition, normalizeJan, normalizeSize, parseIntOrNull, parseMoney,
  type ConditionRank,
} from '../normalize';

/**
 * IMPORT → NORMALIZE → DEDUPLICATE → VALIDATE
 *
 * 数千〜数万件を一度に処理する前提。1件ずつDBへ往復せず、
 * 既存キーをまとめて読み込み、書き込みは一括で行う。
 */

export type ImportStats = {
  importId: number;
  supplierCode: string;
  rowCount: number;
  inserted: number;
  updated: number;
  duplicatedL1: number;
  duplicatedL2: number;
  invalid: number;
  unknownCondition: number;
  linkedToMaster: number;
  errors: { row: number; reason: string }[];
};

const CHUNK = 500;

type Normalized = {
  external_id: string;
  raw: RawSupplierProduct;
  name: string;
  brand: string;
  category_key: string;
  model_number: string;
  model_key: string;
  jan: string;
  sku: string;
  size: string;
  color: string;
  condition_rank: ConditionRank | null;
  purchase_price: number | null;
  market_price: number | null;
  market_price_source: string | null;
  market_fetched_at: string | null;
  stock: number | null;
  product_url: string | null;
  image_url: string | null;
  content_hash: string;
  identity_key: string | null;
  completeness: number;
};

const REQUIRED_FOR_ANALYSIS = ['purchase_price'] as const;
const COMPLETENESS_FIELDS = [
  'name', 'brand', 'category_key', 'model_number', 'jan', 'sku',
  'size', 'color', 'condition_rank', 'purchase_price', 'market_price', 'stock',
] as const;

function normalizeRow(raw: RawSupplierProduct, condMap: Map<string, ConditionRank>): Normalized | null {
  const name = cleanText(raw.product_name);
  const brand = normalizeBrand(raw.brand);
  const model_number = cleanText(raw.model_number);
  const mk = modelKey(model_number);
  const jan = normalizeJan(raw.jan);
  const size = normalizeSize(raw.size);
  const color = normalizeColor(raw.color);
  const cond = normalizeCondition(raw.condition, condMap);
  const purchase_price = parseMoney(raw.purchase_price);
  const market_price = parseMoney(raw.market_price);
  const stock = parseIntOrNull(raw.stock);
  const category_key = normalizeCategory(raw.category);

  // 名前もブランドも型番も価格も無い行は、そもそも商品として扱えない
  if (!name && !brand && !mk && purchase_price === null) return null;

  const hash = contentHash({
    brand,
    modelKey: mk,
    color,
    size,
    conditionRank: cond.rank,
    purchasePrice: purchase_price,
    name,
  });

  const values: Record<string, unknown> = {
    name, brand, category_key, model_number, jan, sku: cleanText(raw.sku),
    size, color, condition_rank: cond.rank, purchase_price, market_price, stock,
  };
  const filled = COMPLETENESS_FIELDS.filter((f) => {
    const v = values[f];
    return v !== null && v !== undefined && v !== '' && v !== 'unknown';
  }).length;

  let fetchedAt: string | null = null;
  if (raw.market_fetched_at) {
    const d = new Date(raw.market_fetched_at);
    if (!Number.isNaN(d.getTime())) fetchedAt = d.toISOString();
  }

  return {
    external_id: cleanText(raw.supplier_product_id) || `auto:${hash}`,
    raw,
    name,
    brand,
    category_key,
    model_number,
    model_key: mk,
    jan,
    sku: cleanText(raw.sku),
    size,
    color,
    condition_rank: cond.rank,
    purchase_price,
    market_price,
    market_price_source: cleanText(raw.market_price_source) || null,
    market_fetched_at: fetchedAt,
    stock,
    product_url: cleanText(raw.product_url) || null,
    image_url: cleanText(raw.image_url) || null,
    content_hash: hash,
    identity_key: identityKey({ jan, brand, modelKey: mk, color, size }),
    completeness: filled / COMPLETENESS_FIELDS.length,
  };
}

async function loadConditionMap(supplierCode: string): Promise<Map<string, ConditionRank>> {
  const rows = await all('SELECT raw_label, condition_rank FROM supplier_condition_map WHERE supplier_code = ?', [supplierCode]);
  const m = new Map<string, ConditionRank>();
  for (const r of rows) m.set(String(r.raw_label).toLowerCase(), String(r.condition_rank) as ConditionRank);
  return m;
}

/** 商品マスタ（L3）へ紐づける。無ければ作る。 */
async function resolveProductIds(items: Normalized[]): Promise<Map<string, number>> {
  const keys = Array.from(new Set(items.map((i) => i.identity_key).filter((k): k is string => Boolean(k))));
  const map = new Map<string, number>();
  for (let i = 0; i < keys.length; i += CHUNK) {
    const slice = keys.slice(i, i + CHUNK);
    const rows = await all(
      `SELECT id, identity_key, merged_into FROM products WHERE identity_key IN (${slice.map(() => '?').join(',')})`,
      slice,
    );
    for (const r of rows) {
      // 統合済みマスタは統合先へ寄せる（削除はしない）
      map.set(String(r.identity_key), Number(r.merged_into ?? r.id));
    }
  }
  const missing = keys.filter((k) => !map.has(k));
  const now = nowIso();
  for (const k of missing) {
    const src = items.find((i) => i.identity_key === k)!;
    const res = await run(
      `INSERT OR IGNORE INTO products (identity_key, gtin, brand, model_number, model_key, color, size, category_key, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [k, src.jan || null, src.brand, src.model_number, src.model_key, src.color, src.size, src.category_key, src.name, now],
    );
    if (res.lastInsertRowid) map.set(k, res.lastInsertRowid);
  }
  const stillMissing = missing.filter((k) => !map.has(k));
  if (stillMissing.length > 0) {
    const rows = await all(
      `SELECT id, identity_key, merged_into FROM products WHERE identity_key IN (${stillMissing.map(() => '?').join(',')})`,
      stillMissing,
    );
    for (const r of rows) map.set(String(r.identity_key), Number(r.merged_into ?? r.id));
  }
  return map;
}

export async function runImport(args: {
  supplierCode: string;
  text: string;
  filename?: string;
}): Promise<ImportStats> {
  const supplierCode = args.supplierCode.trim().toUpperCase();
  const supplier = await ensureSupplier(supplierCode);
  const connector = await getSupplierConnector(supplierCode);
  if (!connector) throw new Error(`仕入先 ${supplierCode} のConnectorがありません。`);

  const fetched = await connector.fetchCatalog({ text: args.text });
  const now = nowIso();

  const importId = Number(
    (await run(
      `INSERT INTO imports (supplier_code, filename, row_count, created_at) VALUES (?, ?, ?, ?)`,
      [supplierCode, args.filename ?? null, fetched.items.length, now],
    )).lastInsertRowid,
  );

  const stats: ImportStats = {
    importId,
    supplierCode,
    rowCount: fetched.items.length,
    inserted: 0,
    updated: 0,
    duplicatedL1: 0,
    duplicatedL2: 0,
    invalid: 0,
    unknownCondition: 0,
    linkedToMaster: 0,
    errors: [],
  };

  if (!fetched.ok) {
    await run('UPDATE imports SET stats_json = ? WHERE id = ?', [JSON.stringify({ error: fetched.reason, message: fetched.message }), importId]);
    stats.errors.push({ row: 0, reason: fetched.message ?? fetched.reason ?? '取込に失敗しました' });
    return stats;
  }

  const condMap = await loadConditionMap(supplierCode);

  // --- NORMALIZE ---
  const normalized: Normalized[] = [];
  const errorRows: { sql: string; args: unknown[] }[] = [];
  fetched.items.forEach((raw, idx) => {
    const n = normalizeRow(raw, condMap);
    if (!n) {
      stats.invalid++;
      stats.errors.push({ row: idx + 2, reason: '商品名・ブランド・型番・仕入価格がすべて空' });
      errorRows.push({
        sql: 'INSERT INTO import_errors (import_id, row_no, reason, detail, raw_json, created_at) VALUES (?, ?, ?, ?, ?, ?)',
        args: [importId, idx + 2, 'EMPTY_ROW', '商品名・ブランド・型番・仕入価格がすべて空', JSON.stringify(raw), now],
      });
      return;
    }
    normalized.push(n);
  });

  // --- DEDUPLICATE ---
  // L1: 同じ仕入先の同じ商品ID
  const seenExternal = new Set<string>();
  const l1Unique: Normalized[] = [];
  for (const n of normalized) {
    if (seenExternal.has(n.external_id)) {
      stats.duplicatedL1++;
      continue;
    }
    seenExternal.add(n.external_id);
    l1Unique.push(n);
  }

  // 既存DBのハッシュ（L2用）
  const existingHash = new Map<string, number>();
  const existingExternal = new Map<string, number>();
  {
    const rows = await all('SELECT id, external_id, content_hash FROM supplier_products WHERE supplier_id = ?', [supplier.id]);
    for (const r of rows) {
      existingExternal.set(String(r.external_id), Number(r.id));
      if (r.content_hash) existingHash.set(String(r.content_hash), Number(r.id));
    }
  }

  // L2: 同じ仕入先で中身が同一の出品
  const batchHash = new Map<string, string>(); // hash -> external_id
  const toWrite: { n: Normalized; duplicateOf: number | null }[] = [];
  for (const n of l1Unique) {
    let duplicateOf: number | null = null;
    const isExisting = existingExternal.has(n.external_id);
    if (!isExisting) {
      const prevId = existingHash.get(n.content_hash);
      if (prevId !== undefined) {
        duplicateOf = prevId;
        stats.duplicatedL2++;
      } else if (batchHash.has(n.content_hash)) {
        stats.duplicatedL2++;
        duplicateOf = -1; // 同一取込内の重複。IDが未確定なので後で解決しない（状態だけ立てる）
      } else {
        batchHash.set(n.content_hash, n.external_id);
      }
    }
    toWrite.push({ n, duplicateOf });
  }

  // --- L3: 商品マスタへの紐づけ ---
  const productIds = await resolveProductIds(toWrite.map((t) => t.n));

  // --- VALIDATE & 書き込み ---
  const stmts: { sql: string; args: unknown[] }[] = [...errorRows];
  for (const { n, duplicateOf } of toWrite) {
    let state = 'DISCOVERED';
    let skipReason: string | null = null;
    let reviewReason: string | null = null;

    if (duplicateOf !== null) {
      state = 'SKIPPED';
      skipReason = 'DUPLICATE';
    } else if (REQUIRED_FOR_ANALYSIS.some((f) => n[f] === null)) {
      state = 'SKIPPED';
      skipReason = 'INVALID_DATA';
      stats.invalid++;
    } else if (n.condition_rank === null && n.raw.condition) {
      // 未知の状態ラベルは推測でマッピングしない。人間へ回す。
      state = 'MANUAL_REVIEW';
      reviewReason = `UNKNOWN_CONDITION:${n.raw.condition}`;
      stats.unknownCondition++;
    }

    const productId = n.identity_key ? productIds.get(n.identity_key) ?? null : null;
    if (productId) stats.linkedToMaster++;

    const existingId = existingExternal.get(n.external_id);
    if (existingId !== undefined) stats.updated++;
    else stats.inserted++;

    stmts.push({
      sql: `INSERT INTO supplier_products
        (supplier_id, supplier_code, external_id, import_id, product_id,
         raw_name, raw_brand, raw_category, raw_condition, raw_size, raw_color,
         name, brand, category_key, model_number, model_key, jan, sku, size, color, condition_rank,
         purchase_price, market_price, market_price_source, market_fetched_at, stock, product_url, image_url, content_hash,
         pipeline_state, skip_reason, decision, needs_review_reason, duplicate_of, created_at, updated_at)
       VALUES (?,?,?,?,?, ?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?)
       ON CONFLICT(supplier_id, external_id) DO UPDATE SET
         import_id = excluded.import_id,
         product_id = excluded.product_id,
         name = excluded.name, brand = excluded.brand, category_key = excluded.category_key,
         model_number = excluded.model_number, model_key = excluded.model_key,
         jan = excluded.jan, sku = excluded.sku, size = excluded.size, color = excluded.color,
         condition_rank = excluded.condition_rank,
         purchase_price = excluded.purchase_price, market_price = excluded.market_price,
         market_price_source = excluded.market_price_source, market_fetched_at = excluded.market_fetched_at,
         stock = excluded.stock, product_url = excluded.product_url, image_url = excluded.image_url,
         content_hash = excluded.content_hash,
         pipeline_state = excluded.pipeline_state,
         skip_reason = excluded.skip_reason,
         decision = excluded.decision,
         needs_review_reason = excluded.needs_review_reason,
         updated_at = excluded.updated_at`,
      args: [
        supplier.id, supplierCode, n.external_id, importId, productId,
        n.raw.product_name ?? null, n.raw.brand ?? null, n.raw.category ?? null, n.raw.condition ?? null, n.raw.size ?? null, n.raw.color ?? null,
        n.name, n.brand, n.category_key, n.model_number, n.model_key, n.jan, n.sku, n.size, n.color, n.condition_rank,
        n.purchase_price, n.market_price, n.market_price_source, n.market_fetched_at, n.stock, n.product_url, n.image_url, n.content_hash,
        state, skipReason, skipReason ? 'SKIP' : null, reviewReason, duplicateOf === -1 ? null : duplicateOf, now, now,
      ],
    });
  }

  for (let i = 0; i < stmts.length; i += CHUNK) {
    await batch(stmts.slice(i, i + CHUNK));
  }

  // 同一取込内で重複した行は、書き込むまで相手のIDが決まらない。
  // 書き込み後に「どれの重複か」を結びつけておく（画面で元商品を辿れるように）。
  await run(
    `UPDATE supplier_products
        SET duplicate_of = (
              SELECT MIN(o.id) FROM supplier_products o
               WHERE o.supplier_id = supplier_products.supplier_id
                 AND o.content_hash = supplier_products.content_hash
                 AND o.id != supplier_products.id)
      WHERE supplier_id = ? AND import_id = ? AND skip_reason = 'DUPLICATE' AND duplicate_of IS NULL`,
    [supplier.id, importId],
  );

  await run(
    `UPDATE imports SET inserted = ?, updated = ?, duplicated = ?, invalid = ?, stats_json = ? WHERE id = ?`,
    [stats.inserted, stats.updated, stats.duplicatedL1 + stats.duplicatedL2, stats.invalid, JSON.stringify(stats), importId],
  );

  await bumpKpi({
    imported: stats.inserted + stats.updated,
    duplicated: stats.duplicatedL1 + stats.duplicatedL2,
    invalid: stats.invalid,
    manual_review: stats.unknownCondition,
  });

  return stats;
}

export async function bumpKpi(delta: Partial<Record<'imported' | 'duplicated' | 'invalid' | 'analyzed' | 'profitable' | 'skipped' | 'manual_review' | 'ai_candidates', number>>): Promise<void> {
  const day = today();
  const now = nowIso();
  await run(
    `INSERT INTO discovery_kpi (day, updated_at) VALUES (?, ?) ON CONFLICT(day) DO NOTHING`,
    [day, now],
  );
  const keys = Object.keys(delta) as (keyof typeof delta)[];
  if (keys.length === 0) return;
  const sets = keys.map((k) => `${k} = ${k} + ?`).join(', ');
  await run(`UPDATE discovery_kpi SET ${sets}, updated_at = ? WHERE day = ?`, [...keys.map((k) => delta[k] ?? 0), now, day]);
}
