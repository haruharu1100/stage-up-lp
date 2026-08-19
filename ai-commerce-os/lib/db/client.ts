import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type InValue } from '@libsql/client';
import { ADD_COLUMNS, SCHEMA } from './schema';
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
  for (const stmt of SCHEMA) await c.execute(stmt);
  // 列追加は「既にある」だけを握りつぶす。それ以外のエラーは隠さない。
  for (const stmt of ADD_COLUMNS) {
    try {
      await c.execute(stmt);
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      if (!/duplicate column name/i.test(msg)) throw e;
    }
  }
  migrated = true;
}

export type Row = Record<string, any>;

function norm(v: unknown): InValue {
  if (v === undefined || v === null) return null;
  if (typeof v === 'boolean') return v ? 1 : 0;
  if (v instanceof Date) return v.toISOString();
  return v as InValue;
}

export async function all(sql: string, args: unknown[] = []): Promise<Row[]> {
  await migrate();
  const res = await db().execute({ sql, args: args.map(norm) });
  return res.rows as unknown as Row[];
}

export async function one(sql: string, args: unknown[] = []): Promise<Row | null> {
  const rows = await all(sql, args);
  return rows[0] ?? null;
}

export async function run(sql: string, args: unknown[] = []): Promise<{ rowsAffected: number; lastInsertRowid?: number }> {
  await migrate();
  const res = await db().execute({ sql, args: args.map(norm) });
  return {
    rowsAffected: res.rowsAffected,
    lastInsertRowid: res.lastInsertRowid === undefined ? undefined : Number(res.lastInsertRowid),
  };
}

export async function insert(table: string, data: Record<string, unknown>, mode: '' | 'OR IGNORE' | 'OR REPLACE' = ''): Promise<number | undefined> {
  const keys = Object.keys(data);
  const sql = `INSERT ${mode} INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const res = await run(sql, keys.map((k) => data[k]));
  return res.lastInsertRowid;
}

export async function update(table: string, id: number, data: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  await run(sql, [...keys.map((k) => data[k]), id]);
}

/** 一括INSERT。数千〜数万件の取込を1件ずつ往復させないため。 */
export async function batch(statements: { sql: string; args: unknown[] }[]): Promise<void> {
  if (statements.length === 0) return;
  await migrate();
  await db().batch(
    statements.map((s) => ({ sql: s.sql, args: s.args.map(norm) })),
    'write',
  );
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}
