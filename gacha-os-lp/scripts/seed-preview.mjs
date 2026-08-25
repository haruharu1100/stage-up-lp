/**
 * 確認用（Preview）のデータを作る。
 *
 * ═══════════════════════════════════════════════════════
 * ★このファイルが、いちばん危ないファイルです
 * ═══════════════════════════════════════════════════════
 *
 *   ここは「データを作る」ためのものです。
 *   接続先を間違えれば、本番のお客様のデータの上に
 *   架空の会社と架空の担当者を書き込みます。
 *
 *   しかも、書き込んだ瞬間には何も起きません。
 *   気づくのは、あとで数が合わなくなったときです。
 *
 *   だから、次の3つを必ず先に確かめてから動きます。
 *
 *       ① DATABASE_ENV が production でないこと
 *       ② DATABASE_URL が指定されていること
 *       ③ すでに中身があるなら、勝手に足さないこと
 *
 *   1つでも合わなければ、何もせずに止まります。
 *
 * ═══════════════════════════════════════════════════════
 * ★入れてよいデータ
 * ═══════════════════════════════════════════════════════
 *
 *   架空のものだけです。
 *
 *     ・実在するお客様のお名前・メール・電話番号・住所は入れない
 *     ・メールは .example（説明用に予約されたドメイン）だけを使う
 *     ・合言葉は、この画面を触る人にだけ渡す仮のもの
 *
 *   ★.example を使う理由。
 *     もし通知の設定を間違えても、そのメールは
 *     どこにも届きません（誰も持てないドメインです）。
 *     実在しそうな gmail.com を書いておくと、
 *     いつか本当に他人へ届きます。
 *
 * 使い方：
 *   DATABASE_URL="file:./.data/dev.db" npm run seed:preview
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 仮の合言葉。★本番では絶対に使わないこと */
const PASSWORD = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

const ADMINS = [
  { no: 1, email: "boss@demo.example", name: "山田 太郎", role: "SUPER_ADMIN" },
  { no: 2, email: "fukushihai@demo.example", name: "佐藤 花子", role: "SUPER_ADMIN" },
  { no: 3, email: "unei@demo.example", name: "鈴木 一郎", role: "OPERATOR" },
  { no: 4, email: "keiri@demo.example", name: "高橋 美咲", role: "FINANCE" },
  { no: 5, email: "support@demo.example", name: "田中 健太", role: "SUPPORT" },
  { no: 6, email: "security@demo.example", name: "伊藤 亮", role: "SECURITY" },
  { no: 7, email: "etsuran@demo.example", name: "渡辺 さくら", role: "VIEWER" },
];

const CUSTOMERS = [
  { no: 1, name: "架空 一郎", points: 12_000 },
  { no: 2, name: "架空 二郎", points: 4_800 },
  { no: 3, name: "架空 三郎", points: 0 },
  { no: 4, name: "架空 四郎", points: 31_500 },
  { no: 5, name: "架空 五郎", points: 900 },
];

const GACHAS = [
  { title: "スタンダードガチャ", price: 500, total: 300, designedRtp: 0.92 },
  { title: "プレミアムガチャ", price: 3_000, total: 120, designedRtp: 0.95 },
  { title: "お試しガチャ", price: 100, total: 500, designedRtp: 0.88 },
];

function stop(why) {
  console.error(`\n✗ 何もせずに止めました。\n\n  ${why}\n`);
  process.exit(1);
}

async function main() {
  /* ── ① どこへ書こうとしているか ───────────── */
  const env = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
  if (env === "production") {
    stop(
      "DATABASE_ENV が production です。\n" +
        "  架空データを本番へ入れることは、この道具ではできません。",
    );
  }

  const url = (process.env.DATABASE_URL ?? "").trim();
  if (!url) {
    stop(
      "DATABASE_URL が指定されていません。\n" +
        '  例： DATABASE_URL="file:./.data/dev.db" npm run seed:preview',
    );
  }

  /* ★接続先の見た目でも、もう一度確かめる。
       環境変数の書き間違いは、ここでしか気づけません。 */
  if (/prod|honban/i.test(url) && env !== "preview") {
    stop(`接続先の名前に本番らしい文字が入っています：${url}`);
  }

  console.log(`\n書き込み先： ${url}`);
  console.log(`用途　　　： ${env}\n`);

  const { db, migrate } = await import(`${ROOT}/lib/server/db.ts`);
  const seed = await import(`${ROOT}/lib/server/seed.ts`);
  const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

  await migrate();

  /* ── ③ すでに中身があるなら、足さない ─────── */
  const already = await db().execute("SELECT COUNT(*) AS n FROM tenants");
  const n = Number(already.rows[0]?.n ?? 0);
  if (n > 0) {
    console.log(
      `すでに ${n} 社ぶんのデータが入っています。二重に作らないため、ここで終わります。`,
    );
    console.log("作り直すときは、保存先のファイルを消してからもう一度実行してください。\n");
    return;
  }

  /* ── 作る ─────────────────────────────────── */
  const tenantId = await seed.createTenant({
    code: "DEMO",
    name: "デモ商事株式会社（架空）",
  });

  for (const a of ADMINS) {
    const uid = await seed.createAdmin({ tenantId, ...a });
    await setPassword({
      tenantId,
      subjectKind: "ADMIN",
      subjectId: uid,
      password: PASSWORD,
    });
  }

  /* ★お客様にも合言葉を入れること。
       入れないと、お客様としてログインできません。
       ログインできないと、発送状況の画面が本物を出しているのかを
       誰も確かめられません。「画面はある」で終わってしまいます。 */
  for (const c of CUSTOMERS) {
    const cid = await seed.createCustomer({
      tenantId,
      no: c.no,
      name: c.name,
      points: c.points,
      email: `user${c.no}@demo.example`,
    });
    await setPassword({
      tenantId,
      subjectKind: "CUSTOMER",
      subjectId: cid,
      password: PASSWORD,
    });
  }

  for (const g of GACHAS) {
    await seed.createGacha({ tenantId, ...g });
  }

  console.log("✓ 架空データを作りました。\n");
  console.log("  会社コード： DEMO");
  console.log(`  合言葉　　： ${PASSWORD}`);
  console.log("  担当者：");
  for (const a of ADMINS) {
    console.log(`    ${a.role.padEnd(12)} ${a.email}`);
  }
  console.log("  お客様（発送状況の確認用）：");
  for (const c of CUSTOMERS) {
    console.log(`    ${c.name.padEnd(8)} user${c.no}@demo.example`);
  }
  console.log(
    "\n★この合言葉は、確認用のものです。本番では必ず別のものに変えてください。\n",
  );
}

main().catch((e) => {
  console.error("\n✗ 途中で失敗しました。\n");
  console.error(e);
  process.exit(1);
});
