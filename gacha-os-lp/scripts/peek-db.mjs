/**
 * 確認用データベースの中身を、数だけ覗く道具。
 *
 * ★読むだけです。1行も書きません。
 *
 *   ですが「読むだけだから本番でもよい」とは考えません。
 *   本番へ向ければ、お客様の氏名とメールが、そのまま画面に出ます。
 *   （下のほうで、注文といっしょに name と email を出しています）
 *   出した画面は報告文に貼られ、報告文は残ります。
 *
 * 使い方：
 *   DATABASE_URL="file:./.data/dev.db" node scripts/peek-db.mjs
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { honbanNiMukenai } from "./lib/db-env-guard.mjs";

honbanNiMukenai("保存先の中身（件数・直近の注文・景品の状態）を覗く");

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { db } = await import(`${ROOT}/lib/server/db.ts`);

const TABLES = [
  "tenants",
  "customers",
  "draws",
  "prizes",
  "orders",
  "order_items",
  "shipments",
  "shipment_items",
  "audit_events",
];

for (const t of TABLES) {
  try {
    const r = await db().execute(`SELECT COUNT(*) AS n FROM ${t}`);
    console.log(String(t).padEnd(18), r.rows[0].n);
  } catch (e) {
    console.log(String(t).padEnd(18), `（読めません：${e.message}）`);
  }
}

const o = await db().execute(
  `SELECT o.order_number, o.order_status, c.name, c.email
     FROM orders o LEFT JOIN customers c ON c.id = o.user_id
    ORDER BY o.ordered_at DESC LIMIT 10`,
);
console.log("\n直近の注文：");
for (const r of o.rows) {
  console.log(
    `  ${r.order_number}  ${String(r.order_status).padEnd(20)} ${r.name ?? "?"}  ${r.email ?? ""}`,
  );
}

const p = await db().execute(
  `SELECT p.status, COUNT(*) AS n FROM prizes p GROUP BY p.status`,
);
console.log("\n景品の状態：");
for (const r of p.rows) console.log(`  ${String(r.status).padEnd(20)} ${r.n}`);
