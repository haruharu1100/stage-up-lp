import { createClient, type Client } from "@libsql/client";

let _client: Client | null = null;

export function getDb(): Client {
  if (_client) return _client;
  const url = process.env.DATABASE_URL || "file:./data/yamato.db";
  const authToken = process.env.DATABASE_AUTH_TOKEN;
  _client = createClient(authToken ? { url, authToken } : { url });
  if (url.startsWith("file:")) {
    _client
      .execute("PRAGMA busy_timeout=60000")
      .then(() => _client!.execute("PRAGMA journal_mode=WAL"))
      .catch(() => {});
  }
  return _client;
}

export function nowIso(): string {
  return new Date().toISOString();
}

export function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export async function notify(
  severity: "INFO" | "WARN" | "CRITICAL",
  code: string,
  message: string,
): Promise<void> {
  await getDb().execute({
    sql: `INSERT INTO notifications (severity, code, message, created_at) VALUES (?,?,?,?)`,
    args: [severity, code, message, nowIso()],
  });
}
