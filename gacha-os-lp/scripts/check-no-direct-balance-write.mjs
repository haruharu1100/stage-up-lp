/**
 * 残高を、台帳を通さずに書き換えているところを、機械で見つける。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これが要るのか
 * ═══════════════════════════════════════════════════════
 *
 *   製品のコードは、ポイントを動かすとき必ず台帳へ1行残します。
 *   それでも、Preview のお客様に
 *
 *       「残高はあるのに、台帳にその理由が無い」
 *
 *   人が生まれました。壊していたのは製品ではなく、点検の道具です。
 *
 *       scripts/audit-preview.mjs
 *       scripts/check-points-preview.mjs
 *       scripts/seed-shipping-scenario.mjs   …
 *
 *   これらが下ごしらえのつもりで
 *
 *       UPDATE customers SET points = ...
 *
 *   と書いていました。走らせるたびに増えます。
 *   製品側をいくら直しても止まりません。
 *
 *   ★人が気をつけることで防ごうとしないこと。
 *     この壊し方は、悪意ではなく「便利だから」起きます。
 *     便利なものは、必ずまた書かれます。
 *     だから、書いた瞬間に機械で止めます。
 *
 * ═══════════════════════════════════════════════════════
 * ★何を見ているのか
 * ═══════════════════════════════════════════════════════
 *
 *   ① UPDATE customers ... points = ...
 *      → 台帳を通さない残高の書き換え。原則すべて禁止。
 *
 *   ② INSERT INTO customers (... points ...)
 *      → 会員を作るときに、いきなり残高を持たせている。
 *        台帳へ「開始時の残高」の行を入れていなければ、
 *        その残高は最初から説明できません。
 *        同じファイルが point_ledger を書いていれば通します。
 *
 *   ③ 危ない出口（scripts/lib/fixtures-danger.mjs）を、
 *      製品のコードから呼んでいないこと。
 *
 * ═══════════════════════════════════════════════════════
 * ★通してよい場所（許可リスト）
 * ═══════════════════════════════════════════════════════
 *
 *   lib/server/points.ts        台帳へ入れてから残高を動かす、製品の本体
 *   lib/server/prizes.ts        景品のポイント交換。同じく台帳と1取引
 *   lib/server/draw.ts          ガチャ。使った分と戻り分を同じ取引で台帳へ入れる
 *   lib/server/seed.ts          会員を作る。開始時の残高も台帳へ入れる
 *   lib/server/pointPurchase.ts お客様のポイント購入。決済会社からの
 *                               確定通知1件につき、台帳・残高・監査ログを
 *                               同じ1取引で書く（画面からは1ptも動かない）
 *   lib/server/paymentReversal.ts 決済会社の側でお金が引き戻されたとき
 *                               （チャージバック等）の逆仕訳。過去の行は
 *                               書き換えず、新しい行を1つ足してから
 *                               残高を動かす。台帳・残高・監査ログを
 *                               同じ1取引で書く
 *   scripts/lib/ledger-write.mjs   道具のための、台帳経由の入口
 *   scripts/lib/fixtures-danger.mjs 手元の使い捨てDBでしか動かない出口
 *
 *   ★この一覧を増やすときは、必ず「なぜ台帳と1取引なのか」を
 *     そのファイルの先頭に書くこと。書けないなら、許可しないこと。
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** 見に行く場所 */
const MIRU = ["app", "lib", "components", "scripts", "tests"];

/** 通してよい場所（ルートからの相対パス） */
const YURUSU = new Set([
  "lib/server/points.ts",
  "lib/server/prizes.ts",
  "lib/server/draw.ts",
  "lib/server/seed.ts",
  "lib/server/pointPurchase.ts",
  "lib/server/paymentReversal.ts",
  "scripts/lib/ledger-write.mjs",
  "scripts/lib/fixtures-danger.mjs",
  /* この点検そのもの。禁止する文字列を本文に書いているため */
  "scripts/check-no-direct-balance-write.mjs",
]);

/** 危ない出口を呼んでよいのは、試験の道具だけ */
const KIKEN_YURUSU_DIR = ["scripts/", "tests/"];

/* ──────────────────────────────────────────────
   ファイルを集める
   ────────────────────────────────────────────── */
const HAIRA = new Set(["node_modules", ".next", ".git", ".data", "out", "dist"]);
const files = [];

function atsumeru(dir) {
  let ents;
  try {
    ents = readdirSync(dir);
  } catch {
    return;
  }
  for (const name of ents) {
    if (HAIRA.has(name)) continue;
    const p = join(dir, name);
    let st;
    try {
      st = statSync(p);
    } catch {
      continue;
    }
    if (st.isDirectory()) {
      atsumeru(p);
    } else if (/\.(ts|tsx|mjs|js|jsx)$/.test(name)) {
      files.push(p);
    }
  }
}
for (const d of MIRU) atsumeru(join(ROOT, d));

/* ──────────────────────────────────────────────
   注釈（コメント）を消す
   ────────────────────────────────────────────── */
/**
 * ★コメントを消してから探すこと。
 *   消さないと、この点検の説明文そのものが違反になります。
 *   ただし文字列は消しません。SQL は文字列の中にあるからです。
 */
function chushakuWoKesu(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
    .replace(/(^|[^:'"`\\])\/\/[^\n]*/g, (m, p1) => p1 + " ".repeat(m.length - p1.length));
}

/** 何行目かを数える */
function gyou(src, index) {
  return src.slice(0, index).split("\n").length;
}

/* ──────────────────────────────────────────────
   探す
   ────────────────────────────────────────────── */
const warui = [];
let mita = 0;

for (const p of files) {
  const rel = relative(ROOT, p).split("\\").join("/");
  const src = readFileSync(p, "utf8");
  mita++;

  /* ③ 危ない出口を、製品のコードから呼んでいないか */
  if (/fixtures-danger/.test(src) && rel !== "scripts/lib/fixtures-danger.mjs") {
    const ok = KIKEN_YURUSU_DIR.some((d) => rel.startsWith(d));
    if (!ok) {
      warui.push({
        rel,
        line: gyou(src, src.indexOf("fixtures-danger")),
        naze:
          "製品のコードから fixtures-danger を呼んでいます。\n" +
          "      あれは、台帳を通さずに残高を壊すための道具です。\n" +
          "      製品から呼べる場所に置いてはいけません。",
      });
    }
  }

  if (YURUSU.has(rel)) continue;

  const clean = chushakuWoKesu(src);

  /* ① UPDATE customers ... points = */
  const up = /UPDATE\s+customers\b[\s\S]{0,400}?\bpoints\s*=/gi;
  let m;
  while ((m = up.exec(clean)) !== null) {
    /* SET まで届いていない（別の文にまたがった）ものは数えない */
    const naka = clean.slice(m.index, m.index + m[0].length);
    if (!/\bSET\b/i.test(naka)) continue;
    warui.push({
      rel,
      line: gyou(clean, m.index),
      naze:
        "台帳を通さずに、残高を直接書き換えています。\n" +
        "      道具から動かすなら scripts/lib/ledger-write.mjs の\n" +
        "      movePointsViaLedger / setPointsViaLedger を使ってください。\n" +
        "      わざと食い違いを作りたいなら scripts/lib/fixtures-danger.mjs です\n" +
        "      （あちらは手元の使い捨てDBでしか動きません）。",
    });
  }

  /* ② INSERT INTO customers (... points ...) */
  const ins = /INSERT\s+INTO\s+customers\s*\(([\s\S]{0,400}?)\)/gi;
  while ((m = ins.exec(clean)) !== null) {
    if (!/\bpoints\b/.test(m[1])) continue;
    if (/point_ledger/.test(clean)) continue; /* 台帳も書いているなら通す */
    warui.push({
      rel,
      line: gyou(clean, m.index),
      naze:
        "会員を作るときに、いきなり残高を持たせています。\n" +
        "      同じファイルで台帳（point_ledger）へ入れていないので、\n" +
        "      その残高は、あとから誰にも説明できません。\n" +
        "      lib/server/seed.ts の createCustomer を使ってください。",
    });
  }
}

/* ──────────────────────────────────────────────
   まとめ
   ────────────────────────────────────────────── */
console.log("");
if (warui.length === 0) {
  console.log(
    `✓ 残高を台帳ぬきで動かしている場所はありません（${mita} ファイルを確認）。\n`,
  );
  process.exit(0);
}

console.error("✗ 残高を、台帳を通さずに書き換えているところがあります。\n");
for (const w of warui) {
  console.error(`  ${w.rel}:${w.line}`);
  console.error(`      ${w.naze}\n`);
}
console.error(
  `  ${warui.length} か所（${mita} ファイルを確認）。\n` +
    "  ここを直さないかぎり、点検を走らせるたびに\n" +
    "  「残高はあるのに、台帳にその理由が無い」人が増えます。\n",
);
process.exit(1);
