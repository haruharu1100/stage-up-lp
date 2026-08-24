import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type InValue } from '@libsql/client';
import { SCHEMA, COLUMN_ADDITIONS, LEGACY_RENAMES } from './schema';
import { config, DATA_DIR } from '../env';

let client: Client | null = null;
let migrated = false;

function resolveUrl(): string {
  const url = config.databaseUrl;
  if (url.startsWith('file:')) {
    const rel = url.slice('file:'.length);
    const abs = path.isAbsolute(rel) ? rel : path.join(process.cwd(), rel);
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    return `file:${abs}`;
  }
  return url;
}

export function db(): Client {
  if (!client) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    client = createClient({ url: resolveUrl() });
  }
  return client;
}

export async function migrate(): Promise<void> {
  if (migrated) return;
  const c = db();
  await renameLegacyTables(c);
  for (const stmt of SCHEMA) await c.execute(stmt);
  await addMissingColumns(c);
  await repairKpiZeros(c);
  migrated = true;
}

/**
 * ★1回だけの手直し（2026-08-20）。
 * -------------------------------------------------------------------
 * Discovery KPI の欄を足したとき、うっかり「初期値0」で足してしまったため、
 * 欄ができる前に走った古い実行にまで 0 が入ってしまった。
 * これでは「本当に0件だった」と「まだ数えていなかった」が見分けられない。
 *
 * そこで、欄を作った日より前に走った実行に限って、0 を「不明（NULL）」へ戻す。
 * ★消すのは、数えていないのに入ってしまった 0 だけ。実データは触らない。
 * ★この日より後の実行は本当に数えた値なので、0 のままにする。
 */
const KPI_COLUMNS_ADDED_AT = '2026-08-20';
async function repairKpiZeros(c: Client): Promise<void> {
  try {
    const info = await c.execute(`PRAGMA table_info(research_runs)`);
    const cols = new Set(info.rows.map((r: any) => String(r.name)));
    if (!cols.has('supplier_api_calls')) return; // まだ欄が無い＝直すものがない
    await c.execute({
      sql:
        `UPDATE research_runs SET supplier_searched = NULL, match_candidates = NULL, supplier_api_calls = NULL ` +
        `WHERE started_at < ? AND keepa_tokens_used IS NULL ` +
        `AND (supplier_searched = 0 OR match_candidates = 0 OR supplier_api_calls = 0)`,
      args: [KPI_COLUMNS_ADDED_AT],
    });
  } catch {
    // 手直しに失敗しても、本体の動作は止めない
  }
}

/**
 * 中身の設計が変わった古い表を、消さずに別名へ避ける。
 * ★DROP は絶対にしない。避けたあとに新しい設計の表が作られる。
 */
async function renameLegacyTables(c: Client): Promise<void> {
  for (const r of LEGACY_RENAMES) {
    try {
      const info = await c.execute(`PRAGMA table_info(${r.table})`);
      if (!info.rows.length) continue; // 表が無い＝これから作られる
      const cols = new Set(info.rows.map((x: any) => String(x.name)));
      if (cols.has(r.missingColumn)) continue; // すでに新しい設計
      const already = await c.execute(`PRAGMA table_info(${r.renameTo})`);
      if (already.rows.length) continue; // 退避先がすでにある
      await c.execute(`ALTER TABLE ${r.table} RENAME TO ${r.renameTo}`);
    } catch {
      // 退避に失敗しても、他の移行は続ける
    }
  }
}

/**
 * 既にある表に、足りない列だけを後から足す。
 * ★データは1件も消さない（ALTER TABLE ADD COLUMN のみ・DROPは絶対にしない）。
 * 列がすでにあれば何もしないので、何度動かしても安全。
 */
async function addMissingColumns(c: Client): Promise<void> {
  for (const [table, cols] of Object.entries(COLUMN_ADDITIONS)) {
    let existing: Set<string>;
    try {
      const info = await c.execute(`PRAGMA table_info(${table})`);
      if (!info.rows.length) continue; // 表そのものが無い＝SCHEMA側で作られる
      existing = new Set(info.rows.map((r: any) => String(r.name)));
    } catch {
      continue;
    }
    for (const [col, ddl] of Object.entries(cols)) {
      if (existing.has(col)) continue;
      try {
        await c.execute(`ALTER TABLE ${table} ADD COLUMN ${col} ${ddl}`);
      } catch (e) {
        // 同時起動などで既に足されていた場合は無視する
        if (!String(e).includes('duplicate column')) throw e;
      }
    }
  }
}

export type Row = Record<string, any>;

export async function all(sql: string, args: InValue[] = []): Promise<Row[]> {
  await migrate();
  const res = await db().execute({ sql, args });
  return res.rows as unknown as Row[];
}

export async function one(sql: string, args: InValue[] = []): Promise<Row | null> {
  const rows = await all(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: InValue[] = []): Promise<void> {
  await migrate();
  await db().execute({ sql, args });
}

/** INSERT を型安全に近づけるヘルパ。undefined は null に落とす */
export async function insert(table: string, data: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(data);
  const placeholders = keys.map(() => '?').join(', ');
  const args = keys.map((k) => normalize(data[k]));
  await run(`INSERT INTO ${table} (${keys.join(', ')}) VALUES (${placeholders})`, args);
}

export async function update(table: string, id: string, data: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(data);
  if (!keys.length) return;
  const sets = keys.map((k) => `${k} = ?`).join(', ');
  const args = [...keys.map((k) => normalize(data[k])), id];
  await run(`UPDATE ${table} SET ${sets} WHERE id = ?`, args);
}

function normalize(v: unknown): InValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (typeof v === 'number' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString();
  return JSON.stringify(v);
}

/** JSON文字列カラムを安全にパース */
export function parseJson<T>(value: unknown, fallback: T): T {
  if (value === null || value === undefined || value === '') return fallback;
  if (typeof value !== 'string') return value as T;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export function nowIso(): string {
  return new Date().toISOString();
}

let counter = 0;
export function newId(prefix: string): string {
  counter = (counter + 1) % 100000;
  const rand = Math.random().toString(36).slice(2, 8);
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}${rand}`;
}
