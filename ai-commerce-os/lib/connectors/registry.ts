import { all, nowIso, run } from '../db/client';
import { CsvSupplierConnector } from './csv-connector';
import type { SupplierConnector } from './types';

/**
 * 仕入先の初期登録。
 * KOMEHYO専用にしない。最初から複数社を同じ内部形式で扱う。
 *
 * termsChecked=false は「規約・法人契約の確認が未了」という意味。
 * 確認できるまで purchase は manual のまま。CSVを人間が用意して取り込む。
 */
export const SUPPLIER_SEED = [
  { code: 'KOMEHYO', name: 'コメ兵', note: 'BtoBオークション型。固定価格ではない。参加には古物商が必要。' },
  { code: 'BOOKOFF', name: 'ブックオフ', note: '法人取引条件は未確認。' },
  { code: 'HARDOFF', name: 'ハードオフ', note: '法人取引条件は未確認。' },
  { code: '2NDSTREET', name: 'セカンドストリート', note: '法人取引条件は未確認。' },
  { code: 'OTHER', name: 'その他（手入力）', note: '古物市場・卸・個別仕入など。' },
] as const;

/** 販路（売る場所）。Phase 1 は費用計算のためだけに使う。 */
export const CHANNEL_SEED = [
  { code: 'MERCARI', name: 'メルカリ', note: '手数料は仮値。実額の確認が必要。' },
  { code: 'YAHUOKU', name: 'ヤフオク', note: '手数料は仮値。実額の確認が必要。' },
  { code: 'SNKRDUNK', name: 'スニダン', note: '法人出品プランは新規停止中。自動出品は不可。' },
  { code: 'RAKUMA', name: 'ラクマ', note: '手数料は仮値。実額の確認が必要。' },
] as const;

/** 仮の手数料。ESTIMATED として扱い、画面に「概算」と明示する。 */
export const FEE_SEED = [
  {
    channel_code: 'MERCARI',
    marketplace_fee_rate: 0.1,
    payment_fee_rate: 0.0,
    shipping_cost: 800,
    authentication_fee: 0,
    packing_cost: 150,
    expected_return_cost: 300,
    other_cost: 0,
    source_note: '仮値。公式の料金ページで実額を確認すること。',
  },
  {
    channel_code: 'YAHUOKU',
    marketplace_fee_rate: 0.1,
    payment_fee_rate: 0.0,
    shipping_cost: 900,
    authentication_fee: 0,
    packing_cost: 150,
    expected_return_cost: 300,
    other_cost: 0,
    source_note: '仮値。公式の料金ページで実額を確認すること。',
  },
  {
    channel_code: 'SNKRDUNK',
    marketplace_fee_rate: 0.089,
    payment_fee_rate: 0.029,
    shipping_cost: 1100,
    authentication_fee: 0,
    packing_cost: 200,
    expected_return_cost: 400,
    other_cost: 0,
    source_note: '仮値。法人出品プランが新規停止中のため、実際には出品できない。',
  },
  {
    channel_code: 'RAKUMA',
    marketplace_fee_rate: 0.045,
    payment_fee_rate: 0.0,
    shipping_cost: 800,
    authentication_fee: 0,
    packing_cost: 150,
    expected_return_cost: 300,
    other_cost: 0,
    source_note: '仮値。公式の料金ページで実額を確認すること。',
  },
] as const;

export async function ensureSuppliersAndChannels(): Promise<void> {
  const now = nowIso();

  const existing = new Set((await all('SELECT code FROM suppliers')).map((r) => String(r.code)));
  for (const s of SUPPLIER_SEED) {
    if (existing.has(s.code)) continue;
    await run(
      `INSERT INTO suppliers (code, name, connector_type, cap_read_catalog, cap_read_price, cap_purchase, terms_checked, note, created_at)
       VALUES (?, ?, 'csv', 'csv', 'csv', 'manual', 0, ?, ?)`,
      [s.code, s.name, s.note, now],
    );
  }

  const chExisting = new Set((await all('SELECT code FROM channels')).map((r) => String(r.code)));
  for (const c of CHANNEL_SEED) {
    if (chExisting.has(c.code)) continue;
    await run(
      `INSERT INTO channels (code, name, cap_list, cap_reprice, is_active, note, created_at)
       VALUES (?, ?, 'manual', 'manual', 1, ?, ?)`,
      [c.code, c.name, c.note, now],
    );
  }

  const feeExisting = new Set((await all('SELECT channel_code FROM fee_rules')).map((r) => String(r.channel_code)));
  for (const f of FEE_SEED) {
    if (feeExisting.has(f.channel_code)) continue;
    await run(
      `INSERT INTO fee_rules
        (channel_code, category_key, marketplace_fee_rate, payment_fee_rate, shipping_cost,
         authentication_fee, packing_cost, expected_return_cost, other_cost,
         is_estimated, source_note, valid_from, updated_at)
       VALUES (?, '*', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
      [
        f.channel_code, f.marketplace_fee_rate, f.payment_fee_rate, f.shipping_cost,
        f.authentication_fee, f.packing_cost, f.expected_return_cost, f.other_cost,
        f.source_note, now.slice(0, 10), now,
      ],
    );
  }
}

const cache = new Map<string, SupplierConnector>();

/**
 * 仕入先コードから Connector を返す。
 * Phase 1 は全て CSV Connector。将来ここを差し替えるだけで API 化できる。
 */
export async function getSupplierConnector(code: string): Promise<SupplierConnector | null> {
  await ensureSuppliersAndChannels();
  if (cache.has(code)) return cache.get(code)!;
  const row = await all('SELECT * FROM suppliers WHERE code = ?', [code]);
  if (row.length === 0) return null;
  const s = row[0];
  const c = new CsvSupplierConnector(String(s.code), String(s.name), Number(s.terms_checked) === 1, s.note ?? undefined);
  cache.set(code, c);
  return c;
}

export async function listSuppliers() {
  await ensureSuppliersAndChannels();
  return all('SELECT * FROM suppliers ORDER BY code');
}

export async function listChannels() {
  await ensureSuppliersAndChannels();
  return all('SELECT * FROM channels WHERE is_active = 1 ORDER BY code');
}

/** 未登録の仕入先コードが来たら、その場で作る（capability は最も弱い状態）。 */
export async function ensureSupplier(code: string, name?: string): Promise<{ id: number; code: string }> {
  await ensureSuppliersAndChannels();
  const found = await all('SELECT id, code FROM suppliers WHERE code = ?', [code]);
  if (found.length > 0) return { id: Number(found[0].id), code: String(found[0].code) };
  const res = await run(
    `INSERT INTO suppliers (code, name, connector_type, cap_read_catalog, cap_read_price, cap_purchase, terms_checked, note, created_at)
     VALUES (?, ?, 'csv', 'csv', 'csv', 'manual', 0, '自動登録。規約・取引条件は未確認。', ?)`,
    [code, name ?? code, nowIso()],
  );
  return { id: Number(res.lastInsertRowid), code };
}
