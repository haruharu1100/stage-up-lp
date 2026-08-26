/**
 * 公開環境の総点検で使う、データベース側の下ごしらえ道具。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、こんな道具が要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   総点検で、どうしても確かめたいことが3つあります。
 *
 *       ① 担当者の権限を外したら、その人の「いま開いている画面」が
 *          すぐに使えなくなること
 *       ② お客様を止めたら、その人の「いま開いている画面」が
 *          すぐに何もできなくなること
 *       ③ 別の会社の中身が、絶対に見えないこと
 *
 *   ところが、①②を画面から行う入口が、まだありません。
 *   （管理画面に「権限を変える」「利用を止める」ボタンがありません）
 *
 *   ★ここで「入口が無いから、確かめられません」と書いて終わるのは、
 *     いちばん危ない終わり方です。
 *     入口はあとから必ず作ります。そのとき、
 *     「読む側が古い値で通してしまう」という下地が残っていたら、
 *     権限を外したのに外れない、という事故がそのまま出ます。
 *
 *   ですので、この道具でデータベースを直接書き換えて、
 *   ★「読む側」だけを先に確かめます。
 *     入口が無いことは、未実装として別に報告します。
 *
 * ═══════════════════════════════════════════════════════
 * ★安全のために
 * ═══════════════════════════════════════════════════════
 *
 *   この道具は、書き込みます。ですので seed と同じ鍵をかけます。
 *
 *       ・DATABASE_ENV が production なら、何もせず止まる
 *       ・接続先の名前に本番らしい文字があれば、止まる
 *       ・触ってよい会社コードを、こちらから指定させる
 *
 *   使い方：
 *     npx tsx --env-file=.env.local scripts/audit-db.mjs <命令> [...]
 *
 *   命令：
 *     tenant-b                 点検用のB社を作る（すでにあれば作らない）
 *     role <email> <ROLE>      担当者の権限を変える
 *     status <email> <STATUS>  お客様の状態を変える（ACTIVE / SUSPENDED）
 *     show                     いまの状態を並べて見せる
 */

import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));

/** 点検用のB社。★A社（DEMO）とは別物であることが、ひと目で分かる名前にする */
const B_CODE = "KANSA";
const B_NAME = "点検用ダミー商会（架空・B社）";
const PASSWORD = process.env.SEED_PASSWORD ?? "preview-kakuninyou-2026";

function stop(why) {
  console.error(`\n✗ 何もせずに止めました。\n\n  ${why}\n`);
  process.exit(1);
}

/* ── 書き込む前の鍵 ──────────────────────────── */
const env = (process.env.DATABASE_ENV ?? "development").trim().toLowerCase();
if (env === "production") {
  stop("DATABASE_ENV が production です。この道具は本番へは向けられません。");
}
const url = (process.env.DATABASE_URL ?? "").trim();
if (!url) stop("DATABASE_URL が指定されていません。");
if (/prod|honban/i.test(url) && env !== "preview") {
  stop(`接続先の名前に本番らしい文字が入っています：${url}`);
}

const { db, migrate } = await import(`${ROOT}/lib/server/db.ts`);
const seed = await import(`${ROOT}/lib/server/seed.ts`);
const { setPassword } = await import(`${ROOT}/lib/server/auth.ts`);

await migrate();

const [meirei, ...hikisuu] = process.argv.slice(2);

/* ═══════════════════════════════════════════════
   B社を作る
   ═══════════════════════════════════════════════ */
async function tenantB() {
  const aru = await db().execute({
    sql: "SELECT id FROM tenants WHERE code = ?",
    args: [B_CODE],
  });
  if (aru.rows.length > 0) {
    console.log(`すでにあります： ${B_CODE}（${aru.rows[0].id}）`);
    return;
  }

  const tenantId = await seed.createTenant({ code: B_CODE, name: B_NAME });

  const uid = await seed.createAdmin({
    tenantId,
    no: 1,
    email: "b-boss@kansa.example",
    name: "点検 太郎（B社）",
    role: "SUPER_ADMIN",
  });
  await setPassword({
    tenantId,
    subjectKind: "ADMIN",
    subjectId: uid,
    password: PASSWORD,
  });

  const cid = await seed.createCustomer({
    tenantId,
    no: 1,
    name: "点検 花子（B社のお客様）",
    points: 7_777,
    email: "b-user1@kansa.example",
  });
  await setPassword({
    tenantId,
    subjectKind: "CUSTOMER",
    subjectId: cid,
    password: PASSWORD,
  });

  await seed.createGacha({
    tenantId,
    title: "B社専用ガチャ（点検用）",
    price: 200,
    total: 50,
    /* ★還元率は「％」で書くこと（90％なら 90。0.9 ではありません） */
    designedRtp: 90,
  });

  console.log(`✓ B社を作りました： ${B_CODE} / ${tenantId}`);
  console.log(`  担当者　： b-boss@kansa.example`);
  console.log(`  お客様　： b-user1@kansa.example`);
}

/* ═══════════════════════════════════════════════
   担当者の権限を変える
   ═══════════════════════════════════════════════ */
const ROLES = ["VIEWER", "SUPPORT", "OPERATOR", "FINANCE", "SECURITY", "SUPER_ADMIN"];

async function role(email, atarashii) {
  if (!ROLES.includes(atarashii)) {
    stop(`知らない権限です：${atarashii}\n  使えるのは ${ROLES.join(" / ")} です。`);
  }
  const r = await db().execute({
    sql: "SELECT id, role FROM app_users WHERE email = ?",
    args: [email],
  });
  if (r.rows.length === 0) stop(`その担当者が見つかりません：${email}`);

  await db().execute({
    sql: "UPDATE app_users SET role = ? WHERE email = ?",
    args: [atarashii, email],
  });
  console.log(`✓ ${email}： ${r.rows[0].role} → ${atarashii}`);
}

/* ═══════════════════════════════════════════════
   お客様の状態を変える
   ═══════════════════════════════════════════════ */
async function status(email, atarashii) {
  if (!["ACTIVE", "SUSPENDED"].includes(atarashii)) {
    stop(`知らない状態です：${atarashii}（ACTIVE か SUSPENDED）`);
  }
  const r = await db().execute({
    sql: "SELECT id, status FROM customers WHERE email = ?",
    args: [email],
  });
  if (r.rows.length === 0) stop(`そのお客様が見つかりません：${email}`);

  await db().execute({
    sql: "UPDATE customers SET status = ? WHERE email = ?",
    args: [atarashii, email],
  });
  console.log(`✓ ${email}： ${r.rows[0].status} → ${atarashii}`);
}

/* ═══════════════════════════════════════════════
   いまの状態を見せる
   ═══════════════════════════════════════════════ */
async function show() {
  const t = await db().execute("SELECT code, name, id FROM tenants ORDER BY code");
  console.log("\n会社：");
  for (const r of t.rows) console.log(`  ${String(r.code).padEnd(8)} ${r.name}`);

  const a = await db().execute(
    `SELECT u.email, u.role, t.code FROM app_users u
       JOIN tenants t ON t.id = u.tenant_id ORDER BY t.code, u.email`,
  );
  console.log("\n担当者：");
  for (const r of a.rows) {
    console.log(`  ${String(r.code).padEnd(8)} ${String(r.email).padEnd(30)} ${r.role}`);
  }

  const c = await db().execute(
    `SELECT c.email, c.status, c.points, t.code FROM customers c
       JOIN tenants t ON t.id = c.tenant_id ORDER BY t.code, c.email`,
  );
  console.log("\nお客様：");
  for (const r of c.rows) {
    console.log(
      `  ${String(r.code).padEnd(8)} ${String(r.email).padEnd(26)} ${String(r.status).padEnd(10)} ${r.points}pt`,
    );
  }
  console.log("");
}

/* ═══════════════════════════════════════════════
   点検に必要な id を、機械が読める形で出す
   ═══════════════════════════════════════════════

   ★点検の道具（audit-preview.mjs）は、
     ネット越しにしか触りません。
     ですが「どのガチャを引くか」の id だけは、
     画面から取れる入口がまだありません。
     ここで出して、渡します。 */
async function fixtures() {
  const out = { tenants: {} };

  const t = await db().execute("SELECT id, code, name FROM tenants ORDER BY code");
  for (const row of t.rows) {
    const tid = String(row.id);
    const g = await db().execute({
      sql: `SELECT id, title, price, left_count, status
              FROM gachas WHERE tenant_id = ? ORDER BY price`,
      args: [tid],
    });
    const c = await db().execute({
      sql: `SELECT id, email, name, points, status
              FROM customers WHERE tenant_id = ? ORDER BY email`,
      args: [tid],
    });
    const a = await db().execute({
      sql: `SELECT id, email, role FROM app_users WHERE tenant_id = ? ORDER BY email`,
      args: [tid],
    });
    out.tenants[String(row.code)] = {
      id: tid,
      name: String(row.name),
      gachas: g.rows.map((x) => ({
        id: String(x.id),
        title: String(x.title),
        price: Number(x.price),
        left: Number(x.left_count),
        status: String(x.status),
      })),
      customers: c.rows.map((x) => ({
        id: String(x.id),
        email: String(x.email),
        name: String(x.name),
        points: Number(x.points),
        status: String(x.status),
      })),
      admins: a.rows.map((x) => ({
        id: String(x.id),
        email: String(x.email),
        role: String(x.role),
      })),
    };
  }
  process.stdout.write(JSON.stringify(out, null, 2));
}

switch (meirei) {
  case "fixtures":
    await fixtures();
    break;
  case "tenant-b":
    await tenantB();
    break;
  case "role":
    await role(hikisuu[0], hikisuu[1]);
    break;
  case "status":
    await status(hikisuu[0], hikisuu[1]);
    break;
  case "show":
    await show();
    break;
  default:
    stop(
      "命令を指定してください。\n" +
        "  tenant-b / role <email> <ROLE> / status <email> <STATUS> / show / fixtures",
    );
}
