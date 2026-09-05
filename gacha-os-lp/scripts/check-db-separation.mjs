/**
 * 「検証のつもりが本番だった」を、公開前に機械で止める（保存先の見張り）。
 *
 * ═══════════════════════════════════════════════════════
 * ★止めたい事故は、たった1つ
 * ═══════════════════════════════════════════════════════
 *
 *   検証のつもりで流した処理が、本番のお客様のデータを書き換える。
 *
 *   この事故は、起きた瞬間には何も起きません。エラーも出ません。
 *   気づくのは数日後、「昨日あったポイントが無い」と言われたときです。
 *   そのときには、原因の特定も、元に戻すことも、ほぼできません。
 *
 *   ですので「気をつける」を対策に数えません。
 *   人が忘れても壊れない形だけを、ここで確かめます。
 *
 * ═══════════════════════════════════════════════════════
 * ★見張っている3つのこと
 * ═══════════════════════════════════════════════════════
 *
 *   ① DBにつなぐ道具（scripts/*.mjs）が、
 *      本番で止まる仕組みを持っていること。
 *
 *      持ち方は2通り認めます。
 *        ・DATABASE_ENV を見て production なら止める
 *        ・つなぎ先の文字に prod が入っていたら止める
 *
 *      ★どちらも無いものは、通しません。
 *        「読むだけだから安全」も通しません。
 *        読むだけの道具は、明日には書く道具になります。
 *
 *   ② 本番として動かすとき、保存先の名前に立場が入っていること。
 *
 *      本番URLに prod が入っていないと、①の2つ目の止め方
 *      （名前で止める）が、そもそも効きません。
 *      効かない安全装置は、有るより悪いです。
 *      「付いている」と思ったまま、外れているからです。
 *
 *   ③ 本番として動かすとき、検証用の設定が混ざっていないこと。
 *      （本番なのに、つなぎ先が preview や file: を向いている）
 *
 * ═══════════════════════════════════════════════════════
 * ★止めるのは本番だけ、というやり方をしない理由
 * ═══════════════════════════════════════════════════════
 *
 *   メールや決済の見張り（check-providers.mjs）は、
 *   手元のビルドまで止めると邪魔になるので、本番だけで止めます。
 *
 *   ここは違います。①は**いつでも**見ます。
 *   道具に安全装置が付いているかどうかは、
 *   どこでビルドしても同じ答えになるはずのことだからです。
 *   本番のときだけ見ると、本番で初めて気づくことになります。
 *
 * ★このファイルを消したくなったら、その前に
 *   「消したあと、誰がこれを見張るのか」を決めてください。
 *   決まらないなら、消さないでください。
 */

import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const t = (v) => String(v ?? "").trim();

/* ══════════════════════════════════════════════
   ① DBにつなぐ道具に、止める仕組みがあるか
   ══════════════════════════════════════════════ */

/**
 * 「DBにつなぐ」と見なす書き方。
 *
 * ★ここを狭くしないこと。狭くすると、新しいつなぎ方を
 *   1つ増やしただけで、見張りの外に出られます。
 */
const TSUNAGU = [
  /@libsql\/client/,
  /lib\/server\/db/,
  /createClient\s*\(/,
];

/**
 * 「本番で止まる」と見なす書き方。
 *
 * ★文字が入っているかだけを見ています。
 *   本当に止まるかまでは読めません。
 *   ですので、これは「付け忘れ」を止める見張りです。
 *   中身が正しいかは、書いた人と、この見張りの下の一覧が担保します。
 */
const TOMARU = [
  /DATABASE_ENV/,
  /tsukaisuteDB/,       /* scripts/lib/fixtures-danger.mjs の停止装置 */
  /prod\|production/,   /* つなぎ先の名前で止める書き方 */
  /honbanNiMukenai/,    /* scripts/lib/db-env-guard.mjs を呼んでいる */
];

/**
 * 見張りの外に置くもの。
 *
 * ★増やすときは、必ず「なぜ安全か」をここに日本語で書くこと。
 *   書けないなら、外に置かないこと。
 */
const NOZOKU = new Map([
  [
    "scripts/lib/preview-client.mjs",
    "DBにはつながない。画面へHTTPで入るだけの道具",
  ],
  [
    "scripts/check-db-separation.mjs",
    "この見張り自身。つなぎ方の文字を例として持っているだけ",
  ],
  [
    "scripts/check-no-direct-balance-write.mjs",
    "別の見張り。SQLの文字を例として持っているだけで、つながない",
  ],
  [
    "scripts/check-draw-rng.mjs",
    "別の見張り。ソースを読むだけで、つながない",
  ],
  [
    "scripts/lib/ledger-write.mjs",
    "台帳経由で残高を動かす部品。単体では動かず、" +
      "呼ぶ側（停止装置つきの道具）から db を渡してもらう形",
  ],
]);

function mjsFiles(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      out.push(...mjsFiles(p));
    } else if (name.endsWith(".mjs") || name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

function checkTools() {
  const bad = [];
  let mita = 0;

  for (const abs of mjsFiles(join(root, "scripts"))) {
    const rel = relative(root, abs);
    if (NOZOKU.has(rel)) continue;

    const src = readFileSync(abs, "utf8");
    if (!TSUNAGU.some((re) => re.test(src))) continue;

    mita += 1;
    if (!TOMARU.some((re) => re.test(src))) bad.push(rel);
  }

  return { bad, mita };
}

/* ══════════════════════════════════════════════
   ②③ 本番として動かすときの、設定のつじつま
   ══════════════════════════════════════════════ */

function checkEnv() {
  const env = process.env;
  const dbEnv = t(env.DATABASE_ENV).toLowerCase();
  const url = t(env.DATABASE_URL);
  const honban =
    dbEnv === "production" || t(env.VERCEL_ENV).toLowerCase() === "production";

  /* 本番として動かすつもりが無いなら、ここは何も言いません。
     手元では DATABASE_URL が空なのが正しい姿だからです。 */
  if (!honban) return { skip: true, ng: [] };

  const ng = [];

  if (url === "") {
    ng.push(
      "DATABASE_URL が空です。本番で保存先が無いと、" +
        "一時ファイルが正本になり、デプロイのたびに消えます。",
    );
  } else {
    /* ② 名前に立場が入っているか */
    if (!/prod/i.test(url)) {
      ng.push(
        "本番の保存先の名前に prod が入っていません。\n" +
          "      名前で本番を見分けて止めている道具" +
          "（scripts/rotate-mfa-preview.mjs など）が、効かなくなります。\n" +
          "      例: gacha-os-prod-xxxx.turso.io",
      );
    }
    /* ③ 検証用が混ざっていないか */
    if (/preview|staging|stg|test/i.test(url)) {
      ng.push(
        "本番なのに、保存先の名前が検証用に見えます。" +
          "本番と検証で同じDBを使っていないか、確かめてください。",
      );
    }
    if (url.startsWith("file:")) {
      ng.push(
        "本番なのに、保存先が手元のファイルです。" +
          "サーバーが増えるたびに別々の保存先ができ、しばらくすると消えます。",
      );
    }
  }

  if (t(env.DATABASE_AUTH_TOKEN) === "" && !url.startsWith("file:")) {
    ng.push("DATABASE_AUTH_TOKEN が空です。遠くのDBにはつなげません。");
  }

  if (t(env.ALLOW_PRODUCTION_DB) !== "yes-i-am-sure") {
    ng.push(
      "ALLOW_PRODUCTION_DB=yes-i-am-sure がありません。" +
        "本番DBへは、はっきり許可したときだけつなぎます。",
    );
  }

  return { skip: false, ng };
}

/* ══════════════════════════════════════════════
   実行
   ══════════════════════════════════════════════ */

const tools = checkTools();
const env = checkEnv();

let dame = false;

if (tools.bad.length > 0) {
  dame = true;
  console.error(
    C.red(
      `\n✗ 保存先につなぐ道具に、本番で止まる仕組みがありません（${tools.bad.length}件）`,
    ),
  );
  for (const f of tools.bad) console.error(`    ${f}`);
  console.error(
    C.dim(
      "\n  どちらかを入れてください。\n" +
        "    ・DATABASE_ENV が production なら、何もせず止まる\n" +
        "    ・つなぎ先の文字に prod が入っていたら、何もせず止まる\n" +
        "\n  「読むだけだから安全」では通しません。\n" +
        "  読むだけの道具は、明日には書く道具になります。\n",
    ),
  );
} else {
  console.log(
    C.green(
      `✓ 保存先につなぐ道具は、すべて本番で止まります（${tools.mita} 本を確認）。`,
    ),
  );
}

if (env.skip) {
  console.log(
    C.dim("  （本番としてのビルドではないので、保存先の設定は見ていません）"),
  );
} else if (env.ng.length > 0) {
  dame = true;
  console.error(C.red("\n✗ 本番の保存先の設定が、そろっていません"));
  for (const m of env.ng) console.error(`    ・${m}`);
  console.error(
    C.dim("\n  設計は docs/本番DB分離設計.md にあります。\n"),
  );
} else {
  console.log(C.green("✓ 本番の保存先の設定は、そろっています。"));
}

if (dame) {
  console.error(C.bold(C.red("公開前チェックで止めました。\n")));
  process.exit(1);
}
