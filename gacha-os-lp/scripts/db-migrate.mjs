/**
 * 保存先の「表の作り」を、最新の段まで進める。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、この道具が要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   本体（lib/server/db.ts）は、誰かが最初にアクセスした時に
 *   足りない段を自動で当てる作りになっています。
 *   手元ではそれで困りません。
 *
 *   ですが本番では、それは
 *   「最初のお客様が、20段の作り替えの引き金を引く」
 *   ということです。
 *
 *   そのお客様は、いちばん遅い画面を見せられます。
 *   もし途中で失敗したら、その人の目の前で壊れます。
 *
 *   ですので本番では、お客様が来る前に、人が自分の手で
 *   ここを1回走らせて、済ませておきます。
 *
 * ═══════════════════════════════════════════════════════
 * ★この道具は、表を消しません
 * ═══════════════════════════════════════════════════════
 *
 *   足りない段を足すだけです。
 *   済んでいる段は飛ばします。何度走らせても同じ結果です。
 *
 * ─────────────────────────────────────────────
 * 使い方（手元）
 *   DATABASE_URL="file:./.data/gacha-os.db" \
 *   node --import tsx scripts/db-migrate.mjs
 *
 * 使い方（本番。合図が2つ要ります）
 *   DATABASE_ENV=production \
 *   ALLOW_PRODUCTION_DB=yes-i-am-sure \
 *   DATABASE_URL="libsql://gacha-os-prod-xxxx.turso.io" \
 *   DATABASE_AUTH_TOKEN="..." \
 *   MIGRATE_ALLOW_PRODUCTION=yes-i-am-migrating \
 *   node --import tsx scripts/db-migrate.mjs
 * ─────────────────────────────────────────────
 */

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const t = (v) => String(v ?? "").trim();

/* ★DATABASE_ENV を見ています（保存先の見張りが探す文字）。
     この道具は本番の表を作り替えるのが役目なので、
     止まるのではなく「2つ目の合図」を求める形にしてあります。 */
const URL_ = t(process.env.DATABASE_URL);
const NAFUDA = t(process.env.DATABASE_ENV || process.env.VERCEL_ENV).toLowerCase();
const honbanRashii = NAFUDA === "production" || /prod/i.test(URL_);

if (honbanRashii && t(process.env.MIGRATE_ALLOW_PRODUCTION) !== "yes-i-am-migrating") {
  console.error(
    [
      "",
      C.red("  本番の保存先の、表の作りを変えようとしています。"),
      "",
      "  足りない段を足すだけで、表は消しませんが、本番です。",
      "  本当に進めるときだけ、次を付けて実行してください。",
      "    MIGRATE_ALLOW_PRODUCTION=yes-i-am-migrating",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

if (URL_ === "") {
  console.error(C.red("\n  DATABASE_URL が設定されていません。\n"));
  process.exit(1);
}

const ROOT = new URL("..", import.meta.url).pathname;

/* ★段の一覧も、当てる処理も、本体から読み込みます。
     ここに写し取らないこと。写した瞬間、本体とずれます。 */
const { appliedMigrations, knownMigrations, db } = await import(
  `${ROOT}/lib/server/db.ts`
);

console.log("");
console.log(C.bold("  保存先の表の作りを、最新の段まで進めます"));
console.log(`    つなぎ先 : ${URL_.replace(/(authToken|token)=[^&]*/gi, "$1=***")}`);
console.log(`    名札     : ${NAFUDA === "" ? "（無し）" : NAFUDA}`);
console.log("");

/* 進める前に、いま何段まで済んでいるかを見ておく。
   ★appliedMigrations() は中で migrate() を呼ぶので、
     「前」を知りたいときは自分で読む必要があります。 */
let mae = [];
try {
  const r = await db().execute(
    `SELECT name FROM schema_migrations ORDER BY name ASC`,
  );
  mae = r.rows.map((x) => String(x.name));
} catch (e) {
  /* 表そのものが無い＝まだ1段も当てていない、まっさらな保存先。 */
  const msg = String(e?.message ?? e);
  if (!/no such table/i.test(msg)) {
    console.error(C.red(`\n  いまの状態を読めませんでした：${msg}\n`));
    process.exit(1);
  }
  mae = [];
}

const hazu = knownMigrations();
console.log(`  いま      : ${mae.length} 段`);
console.log(`  最新      : ${hazu.length} 段`);

const tarinai = hazu.filter((n) => !mae.includes(n));
if (tarinai.length === 0) {
  console.log("");
  console.log(C.green("  すでに最新です。足す段はありません。"));
} else {
  console.log("");
  console.log(`  これから足す段（${tarinai.length} 段）:`);
  for (const n of tarinai) console.log(C.dim(`    ・${n}`));
}

let ato = [];
try {
  ato = await appliedMigrations();
} catch (e) {
  console.error("");
  console.error(C.red(`  途中で失敗しました：${String(e?.message ?? e)}`));
  console.error("");
  console.error("  ★途中まで当たっている場合があります。");
  console.error("    もう一度この道具を走らせると、続きから進みます。");
  console.error("");
  process.exit(1);
}

console.log("");
console.log("═".repeat(64));

/* ★「当てたつもり」で終わらせないこと。
     最後に、当たっている段と、当たっているはずの段が
     ぴったり同じかを確かめます。 */
const onaji =
  ato.length === hazu.length && ato.every((n, i) => n === hazu[i]);

if (onaji) {
  console.log(C.green(`  MIGRATION_OK = YES（${ato.length} 段）`));
  console.log(`  いちばん新しい段 : ${ato[ato.length - 1] ?? "（無し）"}`);
} else {
  console.log(C.red("  MIGRATION_OK = NO"));
  console.log("");
  console.log(`    当たっている段 : ${ato.length} 段`);
  console.log(`    当たるはずの段 : ${hazu.length} 段`);
  const yobun = ato.filter((n) => !hazu.includes(n));
  const nokori = hazu.filter((n) => !ato.includes(n));
  if (nokori.length > 0) console.log(`    足りない : ${nokori.join(" / ")}`);
  /* ★見覚えのない段が入っている＝この保存先は、
       いまのプログラムより新しい版で使われた可能性があります。
       そのまま古い版をつなぐと、データを壊します。 */
  if (yobun.length > 0) {
    console.log(`    ${C.red("見覚えのない段")} : ${yobun.join(" / ")}`);
    console.log("");
    console.log("    ★この保存先は、いまのプログラムより新しい版で");
    console.log("      使われたことがあるかもしれません。");
    console.log("      古い版のままつなぐと、データを壊すおそれがあります。");
  }
}
console.log("═".repeat(64));
console.log("");

process.exit(onaji ? 0 : 1);
