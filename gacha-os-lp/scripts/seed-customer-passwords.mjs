/**
 * すでに作ってある確認用データの「お客様」に、合言葉を入れ直す。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これだけの道具を分けて作るのか
 * ═══════════════════════════════════════════════════════
 *
 *   seed-preview.mjs は、中身が空のときにしか動きません。
 *   すでに注文や発送を作ったあとで作り直すと、
 *   確かめたかったデータが消えます。
 *
 *   お客様の合言葉だけを、あとから足せるようにします。
 *
 * ★本番へは向けないこと。
 *   接続先の名前に本番らしい文字があれば、その場で止まります。
 *
 * 使い方：
 *   DATABASE_URL="file:./.data/dev.db" node scripts/seed-customer-passwords.mjs
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

const PASSWORD = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

function stop(why) {
  console.error(`\n✗ 何もせずに止めました。\n\n  ${why}\n`);
  process.exit(1);
}

const env = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (env === "production") stop("DATABASE_ENV が production です。");

const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) stop('DATABASE_URL が指定されていません。例： DATABASE_URL="file:./.data/dev.db"');
if (/prod|honban/i.test(url) && env !== "preview") {
  stop(`接続先の名前に本番らしい文字が入っています：${url}`);
}

const { db } = await import(`${ROOT}/lib/server/db.ts`);
const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

const r = await db().execute(
  "SELECT id, tenant_id, email, name FROM customers WHERE email IS NOT NULL",
);

let n = 0;
for (const c of r.rows) {
  /* ★実在しそうなメールには入れないこと。
       確認用データは .example だけ、と決めてあります */
  if (!String(c.email).endsWith(".example")) {
    console.log(`  とばしました（.example ではありません）： ${c.email}`);
    continue;
  }
  await setPassword({
    tenantId: String(c.tenant_id),
    subjectKind: "CUSTOMER",
    subjectId: String(c.id),
    password: PASSWORD,
  });
  console.log(`  ✓ ${String(c.name).padEnd(10)} ${c.email}`);
  n += 1;
}

console.log(`\n${n} 名のお客様に、確認用の合言葉を入れました。`);
console.log(`合言葉： ${PASSWORD}\n`);
