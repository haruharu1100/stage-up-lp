/**
 * 保存先（DB）の中身を、まるごと控えに取る。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具だけが、本番を読んでよい道具です
 * ═══════════════════════════════════════════════════════
 *
 *   ほかの道具は、本番へ向けたら止まります（db-env-guard.mjs）。
 *   けれども控えを取る道具だけは、本番を読めないと意味がありません。
 *
 *   そのかわり、次の3つを必ず守ります。
 *
 *     ① 本番を読むときは、専用の合図をもう1つ求める
 *        （DATABASE_ENV=production だけでは動かない）
 *     ② お客様の氏名・住所・メールを、画面に出さない
 *        （出す数は「件数」だけ。中身はファイルにしか書かない）
 *     ③ このリポジトリの中には書けない
 *        （控えには個人情報が入ります。git に入った時点で事故です）
 *
 * ═══════════════════════════════════════════════════════
 * ★「取れた」で終わりにしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   取っただけの控えは、控えではありません。戻せて初めて控えです。
 *   取ったあとは、必ず scripts/db-restore-verify.mjs で
 *   空のDBへ戻して、中身が一致するところまで確かめてください。
 *
 *   ★この道具は、控えの中に「照合用の指紋」を一緒に書きます。
 *     戻したあとで、1行でも欠けたり変わったりしていれば、
 *     指紋が合わなくなるので、必ず分かります。
 *
 * ═══════════════════════════════════════════════════════
 * ★アプリの版に依存しない形にしてあります
 * ═══════════════════════════════════════════════════════
 *
 *   表の作り方（CREATE TABLE）も、DB自身から読み取って一緒に控えます。
 *   アプリのコードから作り直す形にすると、
 *   「半年後、コードが変わったせいで昔の控えが戻せない」が起きます。
 *   控えは、コードが手元から消えても戻せなければ意味がありません。
 *
 * ─────────────────────────────────────────────
 * 使い方
 *
 *   検証DBの控えを取る
 *     DATABASE_URL="file:./.data/e2e-d1.db" DATABASE_ENV=development \
 *     node scripts/db-dump.mjs ~/gacha-os-backup/2026-09-07
 *
 *   本番の控えを取る（合図が2つ要ります）
 *     DATABASE_ENV=production \
 *     DATABASE_URL="libsql://gacha-os-prod-xxxx.turso.io" \
 *     DATABASE_AUTH_TOKEN="..." \
 *     BACKUP_ALLOW_PRODUCTION=yes-i-am-taking-a-backup \
 *     node scripts/db-dump.mjs ~/gacha-os-backup/2026-09-07
 * ─────────────────────────────────────────────
 */

import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync, appendFileSync, rmSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "..");

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const t = (v) => String(v ?? "").trim();

/* ══════════════════════════════════════════════
   ① 本番を読むときの、2つ目の合図
   ══════════════════════════════════════════════ */

const URL_ = t(process.env.DATABASE_URL);
const NAFUDA = t(process.env.DATABASE_ENV || process.env.VERCEL_ENV).toLowerCase();

/* ★DATABASE_ENV を見ています（保存先の見張りが探す文字）。
     ただしこの道具は、控えを取るという役目のため、
     止まるのではなく「2つ目の合図」を求める形にしてあります。 */
const honbanRashii = NAFUDA === "production" || /prod/i.test(URL_);

if (honbanRashii && t(process.env.BACKUP_ALLOW_PRODUCTION) !== "yes-i-am-taking-a-backup") {
  console.error(
    [
      "",
      C.red("  本番の保存先から控えを取ろうとしています。"),
      "",
      `    つなぎ先 : ${URL_ === "" ? "（未設定）" : kakusu(URL_)}`,
      `    名札     : ${NAFUDA === "" ? "（無し）" : NAFUDA}`,
      "",
      "  控えには、お客様の氏名・住所・メールが入ります。",
      "  取ること自体は必要ですが、置き場所を決めずに取り始めないでください。",
      "",
      "  本当に控えを取るときだけ、次を付けて実行してください。",
      "    BACKUP_ALLOW_PRODUCTION=yes-i-am-taking-a-backup",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (URL_ === "") {
  console.error(C.red("\n  DATABASE_URL が設定されていません。\n"));
  process.exit(1);
}

/* ══════════════════════════════════════════════
   ② 書き出し先（リポジトリの中は禁止）
   ══════════════════════════════════════════════ */

const dest = t(process.argv[2]);
if (dest === "") {
  console.error(
    [
      "",
      "  控えの置き場所を指定してください。",
      "    node scripts/db-dump.mjs <控えを置くフォルダ>",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const OUT = resolve(process.cwd(), dest);

/* ★リポジトリの中には書かせません。
     控えには個人情報が入ります。git に入った時点で事故です。
     例外は .data だけ（git の対象外にしてあるため、試し用に使えます）。 */
if (OUT === ROOT || OUT.startsWith(ROOT + "/")) {
  const nakami = OUT.slice(ROOT.length + 1);
  if (!nakami.startsWith(".data/") && nakami !== ".data") {
    console.error(
      [
        "",
        C.red("  控えを、このリポジトリの中には置けません。"),
        "",
        `    指定された場所 : ${OUT}`,
        "",
        "  控えにはお客様の氏名・住所・メールが入ります。",
        "  うっかり git に入ると、消しても履歴に残ります。",
        "",
        "  リポジトリの外（例：~/gacha-os-backup/2026-09-07）を指定してください。",
        "  試し用であれば .data の下だけ使えます。",
        "",
      ].join("\n"),
    );
    process.exit(1);
  }
}

if (existsSync(OUT)) {
  /* ★上書きしないこと。控えが半分だけ新しい、が一番たちが悪いです。 */
  console.error(
    [
      "",
      C.red("  その場所には、すでに何かあります。"),
      `    ${OUT}`,
      "",
      "  控えを混ぜないため、空の場所にだけ書き出します。",
      "  日付や時刻を足した、新しい名前を指定してください。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

/* ══════════════════════════════════════════════
   ③ 控えを取る
   ══════════════════════════════════════════════ */

function kakusu(u) {
  /* つなぎ先を画面に出すときは、鍵らしき部分を隠します */
  return u.replace(/(authToken|token)=[^&]*/gi, "$1=***");
}

/**
 * 1行を、順番の決まった文字にする（指紋を取るため）。
 *
 * ★JSON.stringify のままにしないこと。
 *   列の順番が変わると、中身が同じでも指紋が変わってしまいます。
 *   ここでは必ず「表の列の順番」に並べます。
 */
function gyouWoMoji(retsu, row) {
  return JSON.stringify(retsu.map((k) => atai(row[k])));
}

/**
 * 1つの値を、控えに書ける形にする。
 *
 * ★画像などの「そのままのデータ（バイナリ）」に注意すること。
 *   この保存先は、それを ArrayBuffer という形で返してきます。
 *   ArrayBuffer は、そのまま文字にすると `{}` になり、
 *   **中身が丸ごと消えます。しかも、エラーは出ません。**
 *   （実際にそれで、画像112件が空の控えになりました。2026-09-07）
 *   ですので、ここで必ず自分の手で base64 に直します。
 */
function atai(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return { __bigint: v.toString() };
  if (v instanceof ArrayBuffer) {
    return { __bytes: Buffer.from(new Uint8Array(v)).toString("base64") };
  }
  if (ArrayBuffer.isView(v)) {
    return { __bytes: Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64") };
  }
  return v;
}

const client = createClient({
  url: URL_,
  authToken: process.env.DATABASE_AUTH_TOKEN?.trim() || undefined,
});

console.log("");
console.log(C.bold("  控えを取ります"));
console.log(`    つなぎ先 : ${kakusu(URL_)}`);
console.log(`    名札     : ${NAFUDA === "" ? "（無し）" : NAFUDA}`);
console.log(`    置き場所 : ${OUT}`);
console.log("");

mkdirSync(join(OUT, "data"), { recursive: true });

let shippai = null;
try {
  /* ── 表の作り方（DDL）を、DB自身から読み取る ───────────── */
  const sm = await client.execute(
    `SELECT type, name, sql FROM sqlite_master
      WHERE sql IS NOT NULL AND name NOT LIKE 'sqlite_%'
      ORDER BY CASE type WHEN 'table' THEN 0 WHEN 'index' THEN 1 ELSE 2 END, name`,
  );

  const ddl = sm.rows.map((r) => String(r.sql).trim() + ";");
  const hyou = sm.rows.filter((r) => String(r.type) === "table").map((r) => String(r.name));

  writeFileSync(
    join(OUT, "schema.sql"),
    [
      "-- この保存先から読み取った、表の作り方そのものです。",
      "-- ★アプリのコードから作り直していません。",
      "--   コードが変わっても、この控えだけで戻せるようにするためです。",
      "",
      ...ddl,
      "",
    ].join("\n"),
    "utf8",
  );

  /* ── 中身を1表ずつ書き出す ───────────── */
  const hyouJouhou = [];
  let goukei = 0;

  for (const name of hyou) {
    const res = await client.execute(`SELECT * FROM "${name}"`);
    const retsu = res.columns.slice();

    const path = join(OUT, "data", `${name}.jsonl`);
    writeFileSync(path, "", "utf8");

    /* ★指紋は、並び順に左右されないようにします。
         戻したあとの並び順は、必ずしも同じにならないからです。 */
    const moji = [];
    const buf = [];
    for (const row of res.rows) {
      const line = gyouWoMoji(retsu, row);
      moji.push(line);
      buf.push(line);
      if (buf.length >= 500) {
        appendFileSync(path, buf.join("\n") + "\n", "utf8");
        buf.length = 0;
      }
    }
    if (buf.length > 0) appendFileSync(path, buf.join("\n") + "\n", "utf8");

    moji.sort();
    const yubimon = createHash("sha256").update(moji.join("\n")).digest("hex");

    hyouJouhou.push({ name, columns: retsu, rows: res.rows.length, sha256: yubimon });
    goukei += res.rows.length;

    /* ★件数だけを出します。中身は出しません（氏名・住所が入るため）。 */
    console.log(`    ${String(res.rows.length).padStart(7)} 行  ${name}`);
  }

  /* ── 適用済みの移行（スキーマの段）も控える ───────────── */
  /* ★列の名前は name です（id ではありません）。
       ここを間違えても、try で握りつぶすと「0段」と控えられ、
       戻したあとの照合が **必ず通ってしまいます**。
       必ず通る確認は、無いより危険です。
       ですので、表があるのに読めない場合は、はっきり失敗させます。
       （実際に id と書き間違えて素通りしました。2026-09-07） */
  let dankai = [];
  if (hyou.includes("schema_migrations")) {
    const r = await client.execute(`SELECT name FROM schema_migrations ORDER BY name ASC`);
    dankai = r.rows.map((x) => String(x.name));
  }

  const manifest = {
    at: new Date().toISOString(),
    tool: "scripts/db-dump.mjs",
    format: 1,
    sourceEnv: NAFUDA || "(無し)",
    sourceUrl: kakusu(URL_),
    schemaMigrations: dankai,
    tables: hyouJouhou,
    totalRows: goukei,
  };

  writeFileSync(join(OUT, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n", "utf8");

  console.log("");
  console.log(C.green(`  控えを取りました（${hyou.length} 表 ／ 合計 ${goukei} 行）`));
  console.log("");
  console.log("  ★まだ「控えが取れた」だけです。戻せるかは、まだ分かりません。");
  console.log("    次を実行して、空のDBへ戻せることを確かめてください。");
  console.log(`      node scripts/db-restore-verify.mjs ${OUT}`);
  console.log("");
} catch (e) {
  shippai = e;
} finally {
  try {
    client.close();
  } catch {
    /* 閉じられなくても、控えの中身には影響しません */
  }
}

if (shippai) {
  /* ★途中で失敗したら、中途半端な控えを残さないこと。
       「あると思っていたのに、半分しか無い」が一番危ないからです。 */
  try {
    rmSync(OUT, { recursive: true, force: true });
  } catch {
    /* 消せなくても、失敗したことは下で必ず伝えます */
  }
  console.error("");
  console.error(C.red("  控えを取れませんでした。中途半端な控えは残していません。"));
  console.error(`    ${String(shippai?.message ?? shippai).slice(0, 300)}`);
  console.error("");
  process.exit(1);
}
