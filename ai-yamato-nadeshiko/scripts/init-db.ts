import { readFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { getDb } from "../lib/db.js";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..");

mkdirSync(resolve(root, "data"), { recursive: true });

const sql = readFileSync(resolve(root, "lib/db/schema.sql"), "utf8");

// libsql の execute は1文ずつ。行コメントを剥がしてから ; で分割する
const statements = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter(Boolean);

const db = getDb();
for (const stmt of statements) {
  await db.execute(stmt);
}

// --- 既存DBへの追いつき（CREATE TABLE IF NOT EXISTS は既存表を直さないため） ---
// compliance_checks.result に 'WARN' を足した。
// 「規約違反ではないが損をする書き方」を FAIL と同じ扱いにすると、
// 本当に止めるべき違反が警告の山に埋もれるので、種別を分けている。
{
  const rs = await db.execute(
    `SELECT sql FROM sqlite_master WHERE type='table' AND name='compliance_checks'`,
  );
  const ddl = String(rs.rows[0]?.["sql"] ?? "");
  if (ddl && !ddl.includes("'WARN'")) {
    console.log("compliance_checks に WARN を許可するよう作り直します（データは引き継ぎます）");
    await db.execute(`ALTER TABLE compliance_checks RENAME TO compliance_checks_old`);
    await db.execute(`
      CREATE TABLE compliance_checks (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        subject_type TEXT NOT NULL,
        subject_id   TEXT NOT NULL,
        check_code   TEXT NOT NULL,
        result       TEXT NOT NULL CHECK (result IN ('PASS','WARN','FAIL','HALT')),
        detail       TEXT,
        checked_at   TEXT NOT NULL
      )`);
    await db.execute(`
      INSERT INTO compliance_checks (id, subject_type, subject_id, check_code, result, detail, checked_at)
      SELECT id, subject_type, subject_id, check_code, result, detail, checked_at FROM compliance_checks_old`);
    await db.execute(`DROP TABLE compliance_checks_old`);
  }
}

const tables = await db.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
);
console.log(`DB初期化 完了: ${tables.rows.length}テーブル`);
console.log(tables.rows.map((r) => `  - ${r.name}`).join("\n"));
