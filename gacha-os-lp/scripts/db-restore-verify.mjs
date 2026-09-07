/**
 * 控えから「空のDBへ本当に戻せるか」を、実際に戻して確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★「控えが取れている」を合格にしないこと
 * ═══════════════════════════════════════════════════════
 *
 *   控えが取れていることと、戻せることは、別の話です。
 *   実際に多いのは、次のどれかです。
 *
 *     ・取れているが、表が1つ抜けている
 *     ・戻せるが、金額の桁が変わっている（数字が文字になっている等）
 *     ・戻せるが、操作の記録（監査ログ）の鎖が切れている
 *     ・戻せるが、保有ポイントと台帳の合計が合っていない
 *
 *   どれも「戻してみるまで」分かりません。
 *   ですので、この道具は必ず**実際に戻します**。
 *
 * ═══════════════════════════════════════════════════════
 * ★確かめる5つ
 * ═══════════════════════════════════════════════════════
 *
 *   ① 表の数と、各表の行数が、控えを取った時点と同じか
 *   ② 各表の中身の指紋（sha256）が、1文字も違わないか
 *   ③ 保有ポイントと、ポイント台帳の合計が、会員ごとに一致するか
 *   ④ 操作の記録（監査ログ）の鎖が、店舗ごとに切れていないか
 *   ⑤ スキーマの段（schema_migrations）が同じところまで進んでいるか
 *
 *   ★③と④は、②が通っても落ちることがあります。
 *     ②は「控えと同じか」、③④は「そもそも中身が正しいか」だからです。
 *     控えが壊れたデータを忠実に控えていた場合、②だけでは気づけません。
 *
 * ═══════════════════════════════════════════════════════
 * ★戻す先は、必ず新しい空のDBです
 * ═══════════════════════════════════════════════════════
 *
 *   壊れたDBの上に控えを書き戻すと、
 *   「壊れた状態」と「戻した状態」が混ざり、
 *   何が本当か誰にも分からなくなります。原因調査もできなくなります。
 *
 *   この道具は、中身のあるDBへは戻しません。
 *
 * ─────────────────────────────────────────────
 * 使い方
 *
 *   node scripts/db-restore-verify.mjs <控えのフォルダ>
 *
 *   戻す先を自分で決めたいとき（空でなければ止まります）
 *     RESTORE_TARGET_URL="file:./.data/restore-check.db" \
 *     node scripts/db-restore-verify.mjs <控えのフォルダ>
 *
 *   ★中で lib/server/audit.ts を読むので、npx tsx で動かします。
 *     npx tsx scripts/db-restore-verify.mjs <控えのフォルダ>
 * ─────────────────────────────────────────────
 */

import { createClient } from "@libsql/client";
import { createHash } from "node:crypto";
import { readFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
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
   本番へは、絶対に戻しません
   ══════════════════════════════════════════════ */

/* ★DATABASE_ENV を見ています（保存先の見張りが探す文字）。 */
const NAFUDA = t(process.env.DATABASE_ENV || process.env.VERCEL_ENV).toLowerCase();

const kekka = [];
let ng = 0;
function T(no, title, ok, detail = "") {
  kekka.push({ no, title, ok: Boolean(ok), detail });
  if (!ok) ng += 1;
  const mark = ok ? C.green("ok") : C.red("NG");
  console.log(`  ${mark}  ${String(no).padEnd(7)} ${title}`);
  if (detail) console.log(C.dim(`          ${detail}`));
}
function H(title) {
  console.log("");
  console.log(C.bold(`══ ${title} ` + "═".repeat(Math.max(0, 58 - title.length))));
}

/* ══════════════════════════════════════════════
   控えを読む
   ══════════════════════════════════════════════ */

const src = t(process.argv[2]);
if (src === "") {
  console.error("\n  控えのフォルダを指定してください。\n    npx tsx scripts/db-restore-verify.mjs <控えのフォルダ>\n");
  process.exit(1);
}
const SRC = resolve(process.cwd(), src);

for (const f of ["manifest.json", "schema.sql"]) {
  if (!existsSync(join(SRC, f))) {
    console.error(`\n  ${C.red("控えが足りません")}：${join(SRC, f)} がありません。\n`);
    process.exit(1);
  }
}

const manifest = JSON.parse(readFileSync(join(SRC, "manifest.json"), "utf8"));
const schemaSql = readFileSync(join(SRC, "schema.sql"), "utf8");

/* ══════════════════════════════════════════════
   戻す先を決める（新しい空のDBだけ）
   ══════════════════════════════════════════════ */

let TARGET = t(process.env.RESTORE_TARGET_URL);
if (TARGET === "") {
  mkdirSync(join(ROOT, ".data"), { recursive: true });
  const ts = new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14);
  TARGET = `file:${join(ROOT, ".data", `restore-check-${ts}.db`)}`;
}

if (/prod/i.test(TARGET) || NAFUDA === "production") {
  console.error(
    [
      "",
      C.red("  戻す先が本番に見えます。ここへは戻しません。"),
      `    戻す先 : ${TARGET}`,
      `    名札   : ${NAFUDA === "" ? "（無し）" : NAFUDA}`,
      "",
      "  控えは、必ず新しい空のDBへ戻します。",
      "  壊れたDBの上に書き戻すと、何が本当か分からなくなります。",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

console.log("");
console.log(C.bold("  控えから戻して、中身が一致するかを確かめます"));
console.log(`    控え     : ${SRC}`);
console.log(`    取った日 : ${manifest.at}`);
console.log(`    取った先 : ${manifest.sourceUrl}（名札 ${manifest.sourceEnv}）`);
console.log(`    戻す先   : ${TARGET}`);
console.log("");

const target = createClient({ url: TARGET });

/* ══════════════════════════════════════════════
   戻す
   ══════════════════════════════════════════════ */

H("① 戻す先が、本当に空か");

let karaDaKa = true;
let karaDetail = "";
try {
  const r = await target.execute(
    `SELECT count(*) AS n FROM sqlite_master WHERE name NOT LIKE 'sqlite_%'`,
  );
  const n = Number(r.rows[0].n);
  karaDaKa = n === 0;
  karaDetail = n === 0 ? "空でした" : `すでに ${n} 個の表などがあります`;
} catch (e) {
  karaDaKa = false;
  karaDetail = String(e?.message ?? e).slice(0, 200);
}
T("R-01", "戻す先が空である（上書きしない）", karaDaKa, karaDetail);

if (!karaDaKa) {
  console.error("");
  console.error(C.red("  中身のあるDBへは戻しません。空の場所を指定してください。"));
  console.error("");
  process.exit(1);
}

/* ── 表の作り方を流す ───────────── */
const bun = schemaSql
  .split("\n")
  .filter((l) => !l.trim().startsWith("--"))
  .join("\n")
  .split(";")
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

let ddlNg = "";
for (const s of bun) {
  try {
    await target.execute(s);
  } catch (e) {
    ddlNg = `${String(e?.message ?? e).slice(0, 160)} ／ ${s.slice(0, 80)}`;
    break;
  }
}
T("R-02", "控えにある「表の作り方」がそのまま流せる", ddlNg === "", ddlNg);
if (ddlNg !== "") {
  console.error("");
  console.error(C.red("  表を作れませんでした。ここから先は確かめられません。"));
  console.error("");
  process.exit(1);
}

/* ── 中身を入れる ───────────── */
H("② 控えの中身を入れる");

function modosu(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === "object") {
    if (v.__bigint !== undefined) return BigInt(v.__bigint);
    if (v.__bytes !== undefined) return Buffer.from(v.__bytes, "base64");
  }
  return v;
}

let ireNg = "";
let ireta = 0;
for (const hyou of manifest.tables) {
  const path = join(SRC, "data", `${hyou.name}.jsonl`);
  if (!existsSync(path)) {
    ireNg = `${hyou.name} の中身のファイルがありません`;
    break;
  }
  const gyou = readFileSync(path, "utf8").split("\n").filter((l) => l.trim() !== "");
  if (gyou.length !== hyou.rows) {
    ireNg = `${hyou.name}：控えの行数が合いません（控え ${hyou.rows} ／ ファイル ${gyou.length}）`;
    break;
  }
  if (gyou.length === 0) continue;

  const retsu = hyou.columns;
  const sql = `INSERT INTO "${hyou.name}" (${retsu.map((c) => `"${c}"`).join(",")}) VALUES (${retsu.map(() => "?").join(",")})`;

  /* ★1行ずつ入れないこと。数万行で何十分もかかります。
       まとめて入れて、途中で落ちたらその場で止めます。 */
  const KATAMARI = 200;
  try {
    for (let i = 0; i < gyou.length; i += KATAMARI) {
      const batch = gyou.slice(i, i + KATAMARI).map((l) => ({
        sql,
        args: JSON.parse(l).map(modosu),
      }));
      await target.batch(batch, "write");
    }
  } catch (e) {
    ireNg = `${hyou.name}：${String(e?.message ?? e).slice(0, 200)}`;
    break;
  }
  ireta += gyou.length;
}
T("R-03", "控えの全行を入れられた", ireNg === "", ireNg || `${ireta} 行`);

/* ══════════════════════════════════════════════
   確かめる
   ══════════════════════════════════════════════ */

H("③ 表の数と行数が、控えを取った時点と同じか");

const smNow = await target.execute(
  `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name`,
);
const imaNoHyou = smNow.rows.map((r) => String(r.name)).sort();
const hazuNoHyou = manifest.tables.map((h) => h.name).sort();
T(
  "R-04",
  "表の数が同じ",
  imaNoHyou.length === hazuNoHyou.length && imaNoHyou.join(",") === hazuNoHyou.join(","),
  `控え ${hazuNoHyou.length} 表 ／ 戻した先 ${imaNoHyou.length} 表`,
);

const gyousuChigai = [];
for (const hyou of manifest.tables) {
  const r = await target.execute(`SELECT count(*) AS n FROM "${hyou.name}"`);
  const n = Number(r.rows[0].n);
  if (n !== hyou.rows) gyousuChigai.push(`${hyou.name}（控え ${hyou.rows} ／ 戻した先 ${n}）`);
}
T(
  "R-05",
  "すべての表の行数が同じ",
  gyousuChigai.length === 0,
  gyousuChigai.length === 0 ? `合計 ${manifest.totalRows} 行` : gyousuChigai.slice(0, 5).join(" ／ "),
);

H("④ 中身が1文字も変わっていないか（指紋の照合）");

function gyouWoMoji(retsu, row) {
  return JSON.stringify(retsu.map((k) => atai(row[k])));
}
/* ★db-dump.mjs と、まったく同じ書き方にすること。
     片方だけ直すと、指紋が永久に一致しなくなります。 */
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

const yubimonChigai = [];
for (const hyou of manifest.tables) {
  const res = await target.execute(`SELECT * FROM "${hyou.name}"`);
  const moji = res.rows.map((row) => gyouWoMoji(hyou.columns, row)).sort();
  const y = createHash("sha256").update(moji.join("\n")).digest("hex");
  if (y !== hyou.sha256) {
    yubimonChigai.push(`${hyou.name}（控え ${hyou.sha256.slice(0, 8)}… ／ 戻した先 ${y.slice(0, 8)}…）`);
  }
}
T(
  "R-06",
  "すべての表の指紋が一致する",
  yubimonChigai.length === 0,
  yubimonChigai.length === 0
    ? `${manifest.tables.length} 表すべて一致`
    : yubimonChigai.slice(0, 5).join(" ／ "),
);

H("⑤ スキーマの段が、同じところまで進んでいるか");

/* ★列の名前は name です（id ではありません）。
     間違えたまま try で握りつぶすと「0段 対 0段」で必ず通ります。
     必ず通る確認は、無いより危険なので、読めなければ落とします。 */
let danNow = [];
let danErr = "";
try {
  const r = await target.execute(`SELECT name FROM schema_migrations ORDER BY name ASC`);
  danNow = r.rows.map((x) => String(x.name));
} catch (e) {
  danErr = String(e?.message ?? e).slice(0, 160);
}
const danHazu = manifest.schemaMigrations ?? [];
T(
  "R-07",
  "適用済みのスキーマの段が同じ（1段以上あること）",
  danErr === "" && danHazu.length > 0 && danNow.join(",") === danHazu.join(","),
  danErr !== ""
    ? danErr
    : danHazu.length === 0
      ? "控えに段が1つも記録されていません（控えを取る側が壊れています）"
      : `控え ${danHazu.length} 段 ／ 戻した先 ${danNow.length} 段（最後 ${danNow.at(-1) ?? "―"}）`,
);

H("⑥ 保有ポイントと、ポイント台帳の合計が合うか");

/* ★これは「控えと同じか」ではなく「そもそも中身が正しいか」の確認です。
     控えが、壊れたデータを忠実に控えていた場合、
     指紋の照合（R-06）だけでは絶対に気づけません。 */
let zandakaChigai = [];
try {
  const r = await target.execute(
    `SELECT c.id, c.tenant_id, c.points AS zandaka,
            COALESCE((SELECT SUM(l.delta) FROM point_ledger l
                       WHERE l.tenant_id = c.tenant_id AND l.user_id = c.id), 0) AS goukei
       FROM customers c`,
  );
  for (const row of r.rows) {
    if (Number(row.zandaka) !== Number(row.goukei)) {
      /* ★会員のメールや氏名は出しません。ID だけにします。 */
      zandakaChigai.push(`${String(row.id).slice(0, 12)}…（残高 ${row.zandaka} ／ 台帳 ${row.goukei}）`);
    }
  }
  T(
    "R-08",
    "全会員で、保有ポイント＝台帳の合計",
    zandakaChigai.length === 0,
    zandakaChigai.length === 0
      ? `会員 ${r.rows.length} 人ぶん、すべて一致`
      : zandakaChigai.slice(0, 5).join(" ／ "),
  );
} catch (e) {
  T("R-08", "全会員で、保有ポイント＝台帳の合計", false, String(e?.message ?? e).slice(0, 200));
}

H("⑦ 操作の記録（監査ログ）の鎖が、切れていないか");

/* ★鎖の計算は、自分で書き直さないこと。
     書き直すと「自分の写し間違いを、自分で正しいと言う」ことになります。
     必ず本体と同じ関数（lib/server/audit.ts）を呼びます。 */
let kusariNg = [];
let mitaTenant = 0;
try {
  const { verifyAuditOfTenant } = await import(`${ROOT}/lib/server/audit.ts`);
  const ten = await target.execute(`SELECT id, code FROM tenants ORDER BY id`);
  for (const row of ten.rows) {
    const res = await verifyAuditOfTenant(target, String(row.id));
    mitaTenant += 1;
    if (!res.ok) {
      kusariNg.push(`${row.code}：${res.why}（${res.brokenAt} 番目）`);
    }
  }
  T(
    "R-09",
    "すべての店舗で、記録の鎖がつながっている",
    kusariNg.length === 0,
    kusariNg.length === 0 ? `${mitaTenant} 店舗ぶん、すべて無事` : kusariNg.slice(0, 5).join(" ／ "),
  );
} catch (e) {
  T("R-09", "すべての店舗で、記録の鎖がつながっている", false, String(e?.message ?? e).slice(0, 200));
}

/* ══════════════════════════════════════════════
   判定
   ══════════════════════════════════════════════ */

const hantei = ng === 0 ? "YES" : "NO";
const houkoku = {
  at: new Date().toISOString(),
  tool: "scripts/db-restore-verify.mjs",
  backup: SRC,
  backupAt: manifest.at,
  backupSource: manifest.sourceUrl,
  restoredTo: TARGET,
  tables: manifest.tables.length,
  totalRows: manifest.totalRows,
  ok: kekka.length - ng,
  ng,
  RESTORE_VERIFIED: hantei,
  results: kekka,
};

mkdirSync(join(ROOT, "docs"), { recursive: true });
const houkokuPath = join(
  ROOT,
  "docs",
  `restore-verify-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}.json`,
);
writeFileSync(houkokuPath, JSON.stringify(houkoku, null, 2) + "\n", "utf8");

console.log("");
console.log("═".repeat(64));
console.log(`  ok ${kekka.length - ng} ／ NG ${ng}`);
console.log("");
if (ng === 0) {
  console.log(C.green("  RESTORE_VERIFIED = YES"));
  console.log("  この控えは、空のDBへ戻せて、中身も一致しました。");
} else {
  console.log(C.red("  RESTORE_VERIFIED = NO"));
  console.log("  ★この控えは、まだ「戻せる控え」ではありません。");
  console.log("    販売の GO 条件を満たしていません。");
}
console.log("");
console.log(`  控え： ${houkokuPath}`);
console.log("═".repeat(64));
console.log("");

try {
  target.close();
} catch {
  /* 閉じられなくても、判定には影響しません */
}

process.exit(ng === 0 ? 0 : 1);
