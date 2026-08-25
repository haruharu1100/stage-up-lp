/**
 * 注文と発送の「表の設計」を、そのまま書き出す道具。
 *
 * ★読むだけです。1行も書きません。
 *
 * ★なぜ必要か。
 *   「画面は分けました」は、絵を見れば言えます。
 *   「中身も分けました」は、表の設計を見ないと言えません。
 *   ここで出るのは、実際に動いているデータベースの設計そのものです。
 *
 * 使い方：
 *   DATABASE_URL="file:.data/dev.db" npx tsx scripts/peek-schema.mjs
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { db } = await import(`${ROOT}/lib/server/db.ts`);

const TABLES = ["orders", "order_items", "shipments", "shipment_items", "number_series"];

const t = await db().execute(
  `SELECT name, sql FROM sqlite_master WHERE type = 'table' ORDER BY name`,
);
for (const row of t.rows) {
  if (!TABLES.includes(String(row.name))) continue;
  console.log(`\n═══ 表：${row.name} ═══\n${row.sql};`);
}

const i = await db().execute(
  `SELECT name, tbl_name, sql FROM sqlite_master WHERE type = 'index' ORDER BY tbl_name, name`,
);
console.log("\n\n═══ 重複を止めている決まり（索引） ═══\n");
for (const row of i.rows) {
  if (!TABLES.includes(String(row.tbl_name))) continue;
  if (row.sql == null) continue;
  console.log(`${row.sql};`);
}
