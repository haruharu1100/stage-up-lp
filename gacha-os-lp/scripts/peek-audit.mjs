/**
 * 注文と発送の「記録（監査ログ）」を、そのまま見る道具。
 *
 * ★読むだけです。1行も書きません。
 *
 * ★なぜ必要か。
 *   「誰が・いつ・何を・なぜ」が残っていない操作は、
 *   あとから確かめようがありません。
 *   起きたかどうかを、当事者の記憶で決めることになります。
 *
 * ★本番へは向けません。
 *   監査ログの「要約」や「前・後」には、
 *   誰が誰に何をしたかが、名前つきで残っています。
 *   本番で開けば、それがそのまま画面に出ます。
 *
 * 使い方：
 *   DATABASE_URL="file:.data/dev.db" npx tsx scripts/peek-audit.mjs
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { honbanNiMukenai } from "./lib/db-env-guard.mjs";

honbanNiMukenai("注文と発送の監査ログを、そのまま並べて見る");

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const { db } = await import(`${ROOT}/lib/server/db.ts`);

const cols = await db().execute("PRAGMA table_info(audit_events)");
const names = cols.rows.map((r) => String(r.name));

const r = await db().execute(
  `SELECT * FROM audit_events ORDER BY seq ASC`,
);

console.log(`列： ${names.join(" / ")}\n`);

for (const row of r.rows) {
  const o = Object.fromEntries(names.map((n) => [n, row[n]]));
  const action = String(o.action ?? "");
  /* 注文と発送に関わるものだけ */
  if (!/ORDER|SHIPMENT|SHIP/i.test(action)) continue;

  console.log(
    [
      `seq=${String(o.seq).padStart(2, " ")}`,
      `${o.at ?? ""}`,
      `${action}`,
      `対象=${o.target ?? ""}`,
      `実行者=${o.actor_name ?? ""}（${o.actor_kind ?? ""}／${o.actor_role ?? ""}）`,
    ].join("  "),
  );
  if (o.summary) console.log(`        要約： ${o.summary}`);
  if (o.reason) console.log(`        理由： ${o.reason}`);
  if (o.before_text) console.log(`        前　： ${o.before_text}`);
  if (o.after_text) console.log(`        後　： ${o.after_text}`);
  if (o.data) console.log(`        中身： ${o.data}`);
  console.log(`        つながり： prev=${String(o.prev_hash ?? "").slice(0, 12)}… / hash=${String(o.hash ?? "").slice(0, 12)}…`);
  console.log("");
}
