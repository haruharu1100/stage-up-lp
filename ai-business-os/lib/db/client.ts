import { createClient, type Client, type InValue } from '@libsql/client';
import { config, ensureDataDir } from '../env';
import { ADDITIVE_COLUMNS, SCHEMA } from './schema';

let client: Client | null = null;

export function db(): Client {
  if (!client) {
    ensureDataDir();
    client = createClient({ url: config.databaseUrl });
  }
  return client;
}

export async function migrate(): Promise<void> {
  const c = db();
  for (const sql of SCHEMA) await c.execute(sql);
  // 後から足した列。既にある場合はSQLiteがエラーを返すだけなので無視してよい。
  // 既存データを作り直さないための追記専用の仕組み。
  for (const sql of ADDITIVE_COLUMNS) {
    try {
      await c.execute(sql);
    } catch {
      /* 列が既にある場合。既存データには触らない */
    }
  }
}

export async function run(sql: string, args: InValue[] = []) {
  return db().execute({ sql, args });
}

export async function all<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = []
): Promise<T[]> {
  const res = await db().execute({ sql, args });
  return res.rows as unknown as T[];
}

export async function one<T = Record<string, unknown>>(
  sql: string,
  args: InValue[] = []
): Promise<T | null> {
  const rows = await all<T>(sql, args);
  return rows[0] ?? null;
}

export function nowIso(): string {
  return new Date().toISOString();
}
