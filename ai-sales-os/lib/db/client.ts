import fs from 'node:fs';
import path from 'node:path';
import { createClient, type Client, type InValue } from '@libsql/client';
import { ALL_SCHEMA, COLUMN_ADDITIONS, REPAIRS } from './schema';
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
    const url = config.databaseUrl;
    // ★手元のパソコンで動かすとき（file:）だけ、保存用のフォルダを作る。
    //   サーバー上（libsql:／https:）は書き込めない場所で動くので、フォルダ作成をしない。
    if (url.startsWith('file:')) fs.mkdirSync(DATA_DIR, { recursive: true });
    const authToken = process.env.DATABASE_AUTH_TOKEN?.trim() || undefined;
    client = createClient(authToken ? { url: resolveUrl(), authToken } : { url: resolveUrl() });
  }
  return client;
}

export async function migrate(): Promise<void> {
  if (migrated) return;
  const c = db();
  for (const stmt of ALL_SCHEMA) await c.execute(stmt);
  for (const stmt of COLUMN_ADDITIONS) {
    try {
      await c.execute(stmt);
    } catch (e) {
      // 「その列はもうある」だけは無視してよい。それ以外の失敗は握りつぶさない。
      if (!String((e as Error).message).includes('duplicate column name')) throw e;
    }
  }
  // 列を足したときに既存の行へ入った「初期値の嘘」を直す（何度流しても同じ結果になる）。
  for (const stmt of REPAIRS) await c.execute(stmt);
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

export async function scalar(sql: string, args: unknown[] = []): Promise<number> {
  const r = await one(sql, args);
  if (!r) return 0;
  const v = Object.values(r)[0];
  return Number(v ?? 0);
}

export async function run(sql: string, args: unknown[] = []): Promise<{ rowsAffected: number; lastInsertRowid?: number }> {
  await migrate();
  const res = await db().execute({ sql, args: args.map(norm) });
  return {
    rowsAffected: res.rowsAffected,
    lastInsertRowid: res.lastInsertRowid === undefined ? undefined : Number(res.lastInsertRowid),
  };
}

export async function insert(
  table: string,
  data: Record<string, unknown>,
  mode: '' | 'OR IGNORE' | 'OR REPLACE' = '',
): Promise<number | undefined> {
  const keys = Object.keys(data);
  const sql = `INSERT ${mode} INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`;
  const res = await run(
    sql,
    keys.map((k) => data[k]),
  );
  return res.lastInsertRowid;
}

export async function upsert(
  table: string,
  data: Record<string, unknown>,
  conflictKeys: string[],
): Promise<void> {
  const keys = Object.keys(data);
  const updates = keys.filter((k) => !conflictKeys.includes(k));
  const sql =
    `INSERT INTO ${table} (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')}) ` +
    `ON CONFLICT(${conflictKeys.join(', ')}) DO UPDATE SET ${updates.map((k) => `${k} = excluded.${k}`).join(', ')}`;
  await run(
    sql,
    keys.map((k) => data[k]),
  );
}

export async function update(table: string, id: number, data: Record<string, unknown>): Promise<void> {
  const keys = Object.keys(data);
  if (keys.length === 0) return;
  const sql = `UPDATE ${table} SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`;
  await run(sql, [...keys.map((k) => data[k]), id]);
}

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

export function parseJson<T>(v: unknown, fallback: T): T {
  if (typeof v !== 'string') return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
}
