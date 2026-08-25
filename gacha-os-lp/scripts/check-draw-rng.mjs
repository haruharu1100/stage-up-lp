/**
 * 本番の抽選に、予測できる乱数が混ざっていないかを機械で確かめる。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、テストとは別にこれが要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   テストが253件そろっていたのに、
 *   「ガチャID＋抽選回数から種を作る」抽選がそのまま残っていました。
 *
 *   理由ははっきりしています。
 *   テストは「引いたら結果が返るか」を確かめていました。
 *   結果は返っていたので、全部通っていたのです。
 *
 *   確かめなければならなかったのは、そこではありません。
 *
 *       次に何が出るかを、外の人が計算できないこと
 *
 *   これは「動いたかどうか」では分かりません。
 *   予測できる乱数を使っていても、動きはするからです。
 *   だから、動作ではなく「使っている道具」を見に行きます。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を見ているのか
 * ═══════════════════════════════════════════════════════
 *
 *   ① 本番の抽選が通る道を、入口から順にたどる
 *
 *      入口は app/api/console/ の受け口と lib/server/draw.ts です。
 *      そこから import をたどり、実際に呼ばれる関数だけを集めます。
 *
 *      ★ファイル単位で見ないこと。
 *        lib/console/draw.ts には、本番用の drawWith と
 *        バックテスト用の drawOnce が同居しています。
 *        ファイルごと禁止にすると本番まで動かせなくなり、
 *        ファイルごと許すと drawOnce の混入を見逃します。
 *        だから「呼ばれている関数だけ」を見ます。
 *
 *   ② その中に、使ってはいけない乱数が無いか
 *
 *      一覧は lib/server/rng.ts の FORBIDDEN_IN_DRAW_PATH から読みます。
 *      ここに書き写さないこと。2か所に書くと、片方だけ増えます。
 *
 *   ③ 本番のファイルに、バックテスト用の道具が入っていないか
 *
 *      lib/server/ と app/api/console/ に drawOnce・seedOf・Math.random が
 *      1文字でも出てきたら落とします。
 *
 *   ④ 乱数が node:crypto から来ていること
 *
 *   ⑤ 抽選の記録に「種」を残していないこと
 *
 *      再現できる＝予測できる、です。
 *      種を保存する欄があること自体が、次に戻す入口になります。
 *
 *   ⑥ 抽選の入口が、二重抽選を防ぐ鍵を必須にしていること
 *
 * ═══════════════════════════════════════════════════════
 * ★使い方
 * ═══════════════════════════════════════════════════════
 *
 *     node scripts/check-draw-rng.mjs
 *
 *   守れていなければ、終了コード 1 で落ちます。
 *   サーバーを立ち上げる必要はありません。コードを読むだけです。
 */

import { readFileSync, readdirSync, existsSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const rel = (p) => relative(ROOT, p);

const bad = [];
const lines = [];

/* ══════════════════════════════════════════════
   道具：コメントと文字列を消す
   ══════════════════════════════════════════════
   ★消してから探すこと。
     消さずに探すと、「Math.random は使わない」という注意書き自体が
     違反として引っかかります。そうなると、書いた人は
     注意書きのほうを消します。逆効果です。 */
function stripCommentsAndStrings(src) {
  let out = "";
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    const d = src[i + 1];

    if (c === "/" && d === "/") {
      while (i < n && src[i] !== "\n") i += 1;
      continue;
    }
    if (c === "/" && d === "*") {
      i += 2;
      while (i < n && !(src[i] === "*" && src[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const quote = c;
      i += 1;
      /* 文字列の中身は空白に置き換える。
         行数がずれないよう、改行だけは残す */
      while (i < n) {
        if (src[i] === "\\") {
          i += 2;
          continue;
        }
        if (src[i] === quote) {
          i += 1;
          break;
        }
        if (src[i] === "\n") out += "\n";
        i += 1;
      }
      out += '""';
      continue;
    }
    out += c;
    i += 1;
  }
  return out;
}

/* ══════════════════════════════════════════════
   道具：ファイルを「宣言の集まり」に切る
   ══════════════════════════════════════════════
   一番左の桁から始まる宣言だけを区切りにします。
   次の宣言が始まるところが、前の宣言の終わりです。 */
const DECL_RE =
  /^(?:export\s+)?(?:default\s+)?(?:async\s+)?(?:function|const|let|var|class|type|interface|enum)\s+([A-Za-z_$][\w$]*)/gm;

function declsOf(clean) {
  const found = [];
  DECL_RE.lastIndex = 0;
  let m;
  while ((m = DECL_RE.exec(clean))) found.push({ name: m[1], start: m.index });
  return found.map((d, k) => ({
    name: d.name,
    body: clean.slice(d.start, k + 1 < found.length ? found[k + 1].start : clean.length),
  }));
}

/* ══════════════════════════════════════════════
   道具：import を読む
   ══════════════════════════════════════════════
   型だけの import は runtime に残らないので、たどりません。 */
/* ★import だけは、文字列を潰す前のもとの文から読むこと。
     行き先（"./rng" など）は文字列なので、潰したあとでは消えています。 */
function importsOfRaw(src) {
  const out = [];
  const re =
    /import\s+(?:(type)\s+)?([\s\S]*?)\s*from\s*["']([^"']+)["']|import\s+["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(src))) {
    const spec = m[3] ?? m[4];
    if (m[4]) {
      out.push({ spec, all: true, names: [] });
      continue;
    }
    if (m[1] === "type") continue;

    const clause = m[2] ?? "";
    const names = [];
    let all = false;

    /* 名前つきの取り込み  { a, b as c } */
    const braced = clause.match(/\{([\s\S]*?)\}/);
    if (braced) {
      for (const piece of braced[1].split(",")) {
        const t = piece.trim();
        if (!t || /^type\s/.test(t)) continue;
        const asMatch = t.match(/^([A-Za-z_$][\w$]*)\s+as\s+([A-Za-z_$][\w$]*)$/);
        if (asMatch) names.push({ local: asMatch[2], orig: asMatch[1] });
        else if (/^[A-Za-z_$][\w$]*$/.test(t)) names.push({ local: t, orig: t });
      }
    }

    /* まとめて取り込む  * as ns  /  既定の取り込み  x */
    const head = clause.replace(/\{[\s\S]*?\}/, "").replace(/,/g, " ").trim();
    if (head) all = true;

    out.push({ spec, all, names });
  }
  return out;
}

/* ══════════════════════════════════════════════
   道具：import 先を実ファイルにする
   ══════════════════════════════════════════════ */
function resolveSpec(fromFile, spec) {
  let base;
  if (spec.startsWith("@/")) base = join(ROOT, spec.slice(2));
  else if (spec.startsWith(".")) base = resolve(dirname(fromFile), spec);
  else return null; /* node:crypto / next/server などは外の部品 */

  for (const cand of [
    base,
    `${base}.ts`,
    `${base}.tsx`,
    join(base, "index.ts"),
    join(base, "index.tsx"),
  ]) {
    if (existsSync(cand) && statSync(cand).isFile()) return cand;
  }
  return null;
}

/* ══════════════════════════════════════════════
   ①〜② 本番の通り道を、入口からたどる
   ══════════════════════════════════════════════ */

/** 使ってはいけない乱数の一覧を、実装から読む（写さない） */
const FORBIDDEN = (() => {
  const src = readFileSync(join(ROOT, "lib", "server", "rng.ts"), "utf8");
  const m = src.match(/FORBIDDEN_IN_DRAW_PATH\s*=\s*\[([\s\S]*?)\]/);
  if (!m) {
    console.error("lib/server/rng.ts から FORBIDDEN_IN_DRAW_PATH を読み取れませんでした。");
    process.exit(1);
  }
  const list = [...m[1].matchAll(/["']([^"']+)["']/g)].map((x) => x[1]);
  if (list.length === 0) {
    console.error("FORBIDDEN_IN_DRAW_PATH が空です。空の一覧では何も守れません。");
    process.exit(1);
  }
  return list;
})();

const cache = new Map();
function moduleOf(path) {
  if (cache.has(path)) return cache.get(path);
  const raw = readFileSync(path, "utf8");
  const clean = stripCommentsAndStrings(raw);
  const decls = declsOf(clean);
  const mod = {
    path,
    raw,
    clean,
    decls,
    byName: new Map(decls.map((d) => [d.name, d])),
    imports: importsOfRaw(raw),
  };
  cache.set(path, mod);
  return mod;
}

/** 入口を集める：抽選の受け口ぜんぶ ＋ 抽選の本体 */
function apiEntries() {
  const dir = join(ROOT, "app", "api", "console");
  const out = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) out.push(p);
    }
  };
  walk(dir);
  return out;
}

const ENTRIES = [...apiEntries(), join(ROOT, "lib", "server", "draw.ts")].filter((p) =>
  existsSync(p),
);

if (ENTRIES.length === 0) {
  console.error("抽選の入口が1つも見つかりませんでした。パスの指定を確認してください。");
  process.exit(1);
}

const reached = new Map(); /* path -> Set<宣言名> */
const queue = [];

function push(path, name) {
  const set = reached.get(path) ?? new Set();
  if (set.has(name)) return;
  set.add(name);
  reached.set(path, set);
  queue.push({ path, name });
}

for (const e of ENTRIES) {
  for (const d of moduleOf(e).decls) push(e, d.name);
}

while (queue.length) {
  const { path, name } = queue.shift();
  const mod = moduleOf(path);
  const decl = mod.byName.get(name);
  if (!decl) continue;

  /* 使ってはいけない乱数が、この関数の中にあるか */
  for (const token of FORBIDDEN) {
    const re = new RegExp(`(?<![\\w$])${token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w$])`);
    if (re.test(decl.body)) {
      bad.push(
        `本番の抽選から呼ばれる ${rel(path)} の ${name}() の中で、${token} を使っています。\n` +
          "    これは次に何が出るかを外から計算できる乱数です。\n" +
          "    lib/server/rng.ts の pickBelow（node:crypto）を使ってください。",
      );
    }
  }

  /* 同じファイルの中で呼んでいる関数へ進む */
  for (const other of mod.decls) {
    if (other.name === name) continue;
    if (new RegExp(`(?<![\\w$])${other.name}(?![\\w$])`).test(decl.body)) push(path, other.name);
  }

  /* 別のファイルから取り込んだ関数へ進む */
  for (const imp of mod.imports) {
    const target = resolveSpec(path, imp.spec);
    if (!target) continue;
    if (imp.all) {
      for (const d of moduleOf(target).decls) push(target, d.name);
      continue;
    }
    for (const nm of imp.names) {
      if (new RegExp(`(?<![\\w$])${nm.local}(?![\\w$])`).test(decl.body)) push(target, nm.orig);
    }
  }
}

lines.push(
  `抽選の通り道をたどりました：${reached.size}ファイル / ` +
    `${[...reached.values()].reduce((a, s) => a + s.size, 0)}か所`,
);

/* ★たどれていること自体を確かめる。
   import の書き方を変えたときに、黙って0件になって
   「違反なし」と出るのが、いちばん危ない壊れ方です。 */
{
  const drawTs = join(ROOT, "lib", "console", "draw.ts");
  const hit = reached.get(drawTs);
  if (!hit || !hit.has("drawWith")) {
    bad.push(
      "抽選の中身（lib/console/draw.ts の drawWith）まで、たどり着けませんでした。\n" +
        "    この確認そのものが効いていない状態です。追いかけ方を直してください。",
    );
  } else {
    lines.push("抽選の中身（drawWith）まで、ちゃんと届いています。");
  }
  if (hit && hit.has("drawOnce")) {
    bad.push(
      "本番の抽選から、バックテスト用の drawOnce が呼ばれています。\n" +
        "    drawOnce は同じ種なら同じ結果になります＝外から予測できます。",
    );
  }
}

/* ══════════════════════════════════════════════
   ③ 本番のファイルに、予測できる道具を置かない
   ══════════════════════════════════════════════
   ★上のたどり方は「呼ばれているか」を見ます。
     こちらは「置いてあるか」を見ます。
     置いてあるだけなら害は無い、と考えないこと。
     置いてあれば、いつか誰かが呼びます。 */
{
  const NG = ["Math.random", "seedOf", "mulberry32"];
  const files = [];
  const walk = (d) => {
    if (!existsSync(d)) return;
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.tsx?$/.test(e.name)) files.push(p);
    }
  };
  walk(join(ROOT, "lib", "server"));
  walk(join(ROOT, "app", "api", "console"));

  for (const f of files) {
    const clean = stripCommentsAndStrings(readFileSync(f, "utf8"));
    for (const token of NG) {
      const re = new RegExp(`(?<![\\w$])${token.replace(/\./g, "\\.")}(?![\\w$])`);
      if (re.test(clean)) {
        bad.push(`${rel(f)} に ${token} が置いてあります。本番のファイルには置かないでください。`);
      }
    }
    /* drawOnce（バックテスト用）と drawOnceServer（本番）を取り違えないこと */
    if (/(?<![\w$])drawOnce(?![\w$])/.test(clean)) {
      bad.push(
        `${rel(f)} に drawOnce があります。本番は drawOnceServer です。取り違えています。`,
      );
    }
  }
  lines.push(`本番のファイル ${files.length} 件に、予測できる乱数は置かれていません。`);
}

/* ══════════════════════════════════════════════
   ④ 乱数が node:crypto から来ていること
   ══════════════════════════════════════════════ */
{
  const p = join(ROOT, "lib", "server", "rng.ts");
  const src = readFileSync(p, "utf8");
  if (!/from\s+["']node:crypto["']/.test(src)) {
    bad.push("lib/server/rng.ts が node:crypto を読み込んでいません。");
  } else if (!/randomInt/.test(src)) {
    bad.push("lib/server/rng.ts が randomInt を使っていません。余りを取る書き方は偏ります。");
  } else {
    lines.push("乱数は node:crypto の randomInt から来ています。");
  }

  const d = readFileSync(join(ROOT, "lib", "server", "draw.ts"), "utf8");
  if (!/from\s+["']\.\/rng["']/.test(d) || !/pickBelow/.test(d)) {
    bad.push("lib/server/draw.ts が lib/server/rng.ts の pickBelow を使っていません。");
  } else {
    lines.push("本番の抽選は、その乱数を受け取って引いています。");
  }
}

/* ══════════════════════════════════════════════
   ⑤ 抽選の記録に「種」を残していないこと
   ══════════════════════════════════════════════ */
{
  const before = bad.length;
  const src = readFileSync(join(ROOT, "lib", "server", "db.ts"), "utf8");
  const m = src.match(/CREATE TABLE IF NOT EXISTS draws\s*\(([\s\S]*?)\n\s*\)/);
  if (!m) {
    bad.push("lib/server/db.ts に draws の表が見つかりません。");
  } else {
    const cols = m[1];
    if (/(?<![\w])seed(?![\w])/.test(cols)) {
      bad.push(
        "抽選の記録に seed（種）の欄があります。\n" +
          "    再現できる＝予測できる、です。結果そのものを監査ログに残してください。",
      );
    }
    for (const need of ["rng_source", "rng_nonce"]) {
      if (!cols.includes(need)) bad.push(`抽選の記録に ${need} の欄がありません。`);
    }
    if (!/UNIQUE\s*\(\s*tenant_id\s*,\s*idempotency_key\s*\)/.test(cols)) {
      bad.push(
        "抽選の記録に UNIQUE (tenant_id, idempotency_key) がありません。\n" +
          "    同じ鍵で2回引けてしまいます。",
      );
    }
  }
  if (bad.length === before) {
    lines.push("抽選の記録に種を残す欄は無く、同じ鍵では2回引けません。");
  }
}

/* ══════════════════════════════════════════════
   ⑥ 抽選の入口が、二重抽選の鍵を必須にしていること
   ══════════════════════════════════════════════ */
{
  const p = join(ROOT, "app", "api", "console", "draw", "route.ts");
  if (!existsSync(p)) {
    bad.push("抽選の入口 app/api/console/draw/route.ts がありません。");
  } else {
    const src = readFileSync(p, "utf8");
    const clean = stripCommentsAndStrings(src);

    if (!/Idempotency-Key/.test(src) || !/IDEMPOTENCY_KEY_REQUIRED/.test(src)) {
      bad.push("抽選の入口が Idempotency-Key を必須にしていません。連打で二重抽選になります。");
    } else {
      lines.push("抽選の入口は、二重抽選を防ぐ鍵が無いと受け付けません。");
    }

    if (!/readSession/.test(clean)) {
      bad.push("抽選の入口が、誰であるかをセッションから決めていません。");
    }
    /* 本文から userId / tenantId を読んでいないこと */
    if (/body\s*\.\s*(userId|tenantId)/.test(clean) || /\b(userId|tenantId)\s*\?\s*:/.test(clean.replace(/session[\s\S]{0,40}/g, ""))) {
      bad.push(
        "抽選の入口が、送られてきた本文から userId / tenantId を読んでいます。\n" +
          "    番号を書き換えるだけで、他人のポイントを使えます。",
      );
    } else {
      lines.push("誰であるか・どの会社かは、セッションからだけ決めています。");
    }
  }
}

/* ══════════════════════════════════════════════
   まとめ
   ══════════════════════════════════════════════ */
console.log("");
for (const l of lines) console.log(`  ${l}`);
console.log("");

if (bad.length) {
  console.error("✗ 本番の抽選に、予測できる乱数か二重抽選の穴があります。\n");
  for (const b of bad) console.error(`  ・${b}`);
  console.error("");
  process.exit(1);
}
console.log("✓ 本番の抽選は予測できません。二重抽選の鍵も必須になっています。\n");
