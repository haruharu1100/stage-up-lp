import fs from "fs";
import path from "path";

// テストモード専用の簡易ファイルDB。
// AURA_MODE=test の間、外部に一切出さずに全画面を動かすための永続化。
// 本番(Supabase)には一切影響しない。gitignore 済みの .aura-test/ に保存する。

const DIR = path.join(process.cwd(), ".aura-test");

function filePath(table: string): string {
  return path.join(DIR, `${table}.json`);
}

export function readTable<T>(table: string): T[] {
  try {
    const raw = fs.readFileSync(filePath(table), "utf8");
    return JSON.parse(raw) as T[];
  } catch {
    return [];
  }
}

export function writeTable<T>(table: string, rows: T[]): void {
  fs.mkdirSync(DIR, { recursive: true });
  fs.writeFileSync(filePath(table), JSON.stringify(rows, null, 2), "utf8");
}

export function genId(): string {
  return (
    Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  );
}
