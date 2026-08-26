/**
 * 「古い答えを返さない」を、公開前に機械で確かめる（キャッシュの見張り）。
 *
 * ═══════════════════════════════════════════════════════
 * ★なぜ、これをビルドで止めるのか
 * ═══════════════════════════════════════════════════════
 *
 *   キャッシュの事故は、画面を見ても分かりません。
 *   むしろ「速くなった」ように見えます。
 *
 *   たとえば、こうです。
 *
 *       担当者の役職を VIEWER に落とした
 *         → 本人の画面には、まだ管理者のボタンが出ている
 *         → 押すと、通ってしまう
 *
 *   これは、門番が正しくても起きます。
 *   門番の前に「前の答えを覚えている機械」がいるからです。
 *
 *   覚えていてよいものと、絶対に覚えてはいけないものがあります。
 *
 *       覚えてよい   … 会社案内、料金表、法務ページ、画像やCSS
 *       覚えたら事故 … 誰がログインしているか、役職、残高、
 *                      注文、発送、監査ログ
 *
 *   後者は「人によって答えが変わるもの」です。
 *   これを1秒でもどこかに置くと、次に来た人に出ます。
 *
 *   ★だから、人の目ではなく、公開前の機械で止めます。
 *     人は「たぶん大丈夫」と言いますが、機械は言いません。
 *
 * ═══════════════════════════════════════════════════════
 * ★見張っている4つのこと
 * ═══════════════════════════════════════════════════════
 *
 *   ① 通り道（middleware.ts）が、/api の答えを no-store にしていること
 *   ② ログインが要る入口と画面が、force-dynamic のままであること
 *   ③ ログインが要る入口に、revalidate（何秒か覚える指示）が無いこと
 *   ④ 門番のまわりで、答えを覚える道具を使っていないこと
 *      （unstable_cache / react の cache / "use cache"）
 *
 * ★このファイルを消したくなったら、その前に
 *   「消したあと、誰がこれを見張るのか」を決めてください。
 *   決まらないなら、消さないでください。
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
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

const dame = [];
const yoshi = [];

function ng(what, why) {
  dame.push({ what, why });
}
function ok(what) {
  yoshi.push(what);
}

/** コメントを外した本文だけを見る（説明文に書いた単語で誤検知しないため） */
function honbun(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

function subete(dir, out = []) {
  if (!existsSync(dir)) return out;
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) subete(p, out);
    else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(p);
  }
  return out;
}

/* ══════════════════════════════════════════════════════════
   ① 通り道が、/api の答えを no-store にしていること
   ══════════════════════════════════════════════════════════ */

const mwPath = join(root, "middleware.ts");
if (!existsSync(mwPath)) {
  ng(
    "middleware.ts がありません",
    "ログインが要る入口の答えが、共有の機械に保存されてよい状態に戻ります",
  );
} else {
  const mw = honbun(readFileSync(mwPath, "utf8"));

  if (!/no-store/.test(mw)) {
    ng("middleware.ts が no-store を付けていません", "残高や役職が、どこかに保存されます");
  } else if (!/private/.test(mw)) {
    ng("middleware.ts が private を付けていません", "共有の置き場に入る可能性が残ります");
  } else {
    ok("通り道が、/api の答えを private, no-store にしている");
  }

  if (!/matcher/.test(mw) || !/\/api\//.test(mw)) {
    ng("middleware.ts が /api を見ていません", "付けているつもりで、どこにも付いていません");
  } else {
    ok("通り道が、/api をすべて通っている");
  }

  if (!/Vary/.test(mw)) {
    ng(
      "middleware.ts が Vary を付けていません",
      "万一保存されたとき、Aさんの答えがBさんに出ます",
    );
  } else {
    ok("Vary: Cookie を付けている");
  }
}

/* ══════════════════════════════════════════════════════════
   ②③ ログインが要る入口と画面が、毎回作り直しであること
   ══════════════════════════════════════════════════════════ */

/**
 * ★ここを「全部の画面」に広げないこと。
 *   会社案内や料金表まで force-dynamic にすると、
 *   毎回サーバーで作り直しになり、表示が遅くなります。
 *   表示速度は検索順位に効きます（DIGEST：検証済み）。
 *
 *   人によって中身が変わるものだけを、ここに並べます。
 */
const YOUNIN = [
  "app/api/",           /* 入口は、公開用も含めて全部（問い合わせも含む） */
  "app/mypage",
  "app/client-demo",
  "app/login",
  "app/change-password",
  "app/mfa-setup",
  "app/admin/",
  "app/launch",
];

function ninshouIru(rel) {
  return YOUNIN.some((y) => rel.startsWith(y));
}

const files = subete(join(root, "app"));

for (const f of files) {
  const rel = relative(root, f).replace(/\\/g, "/");
  const isRoute = /\/route\.tsx?$/.test(rel);
  const isPage = /\/(page|layout)\.tsx?$/.test(rel);
  if (!isRoute && !isPage) continue;
  if (!ninshouIru(rel)) continue;

  const src = honbun(readFileSync(f, "utf8"));

  /* ② 毎回作り直しになっているか */
  if (!/export\s+const\s+dynamic\s*=\s*["']force-dynamic["']/.test(src)) {
    ng(
      `${rel} が force-dynamic ではありません`,
      "ログインした人ごとに変わる中身が、作り置きされて配られます",
    );
  }

  /* ③ 「何秒か覚えておく」指示が入っていないか */
  const rev = src.match(/export\s+const\s+revalidate\s*=\s*([^\s;]+)/);
  if (rev && rev[1] !== "0" && rev[1] !== "false") {
    ng(
      `${rel} に revalidate = ${rev[1]} があります`,
      "その秒数のあいだ、止めた人・役職を変えた人が、前のまま動けます",
    );
  }

  if (/export\s+const\s+dynamic\s*=\s*["']force-static["']/.test(src)) {
    ng(`${rel} が force-static です`, "ログインが要る場所を、作り置きにしています");
  }

  if (/export\s+const\s+fetchCache\s*=\s*["']force-cache["']/.test(src)) {
    ng(`${rel} が fetchCache = force-cache です`, "内部の読み取りが、古い値のまま固定されます");
  }
}

ok(`ログインが要る入口・画面 ${files.filter((f) => ninshouIru(relative(root, f).replace(/\\/g, "/"))).length} 本を確認`);

/* ══════════════════════════════════════════════════════════
   ④ 門番のまわりで、答えを覚える道具を使っていないこと
   ══════════════════════════════════════════════════════════ */

/**
 * ★ここが、いちばん見つけにくい壊れ方です。
 *
 *   「毎回DBを読むのは重いから」と、役職を読むところに
 *   キャッシュを1行入れたくなる日が、必ず来ます。
 *
 *   入れた瞬間、こうなります。
 *
 *       退職した人の行を消した → でも覚えているので、まだ通る
 *       役職を落とした         → でも覚えているので、まだ管理者
 *       利用を止めた           → でも覚えているので、まだ動ける
 *
 *   しかも、覚えている時間が過ぎれば直るので、
 *   「たまたま おかしかった」で片づけられます。
 *   片づけられて、次に同じことが起きます。
 */
const MONBAN = [
  "lib/server/context.ts",
  "lib/server/session.ts",
  "lib/server/auth.ts",
  "lib/server/pageAuth.ts",
  "lib/permissions.ts",
];

const KINSHI = [
  [/unstable_cache/, "unstable_cache"],
  [/\bfrom\s+["']react["'][\s\S]{0,80}\bcache\b/, "react の cache()"],
  [/["']use cache["']/, '"use cache"'],
  [/revalidateTag|unstable_cacheTag/, "cacheTag"],
];

for (const rel of MONBAN) {
  const p = join(root, rel);
  if (!existsSync(p)) {
    ng(`${rel} がありません`, "門番の場所が変わっています。この見張りが効いていません");
    continue;
  }
  const src = honbun(readFileSync(p, "utf8"));
  for (const [re, name] of KINSHI) {
    if (re.test(src)) {
      ng(
        `${rel} が ${name} を使っています`,
        "止めた人・役職を落とした人が、覚えている間ずっと動けます",
      );
    }
  }
}
ok("門番のまわりで、答えを覚える道具を使っていない");

/* ══════════════════════════════════════════════════════════
   結果
   ══════════════════════════════════════════════════════════ */

console.log("");
console.log(C.bold("── 古い答えを返さないか（キャッシュの見張り）──"));
for (const y of yoshi) console.log(`  ${C.green("○")} ${y}`);

if (dame.length === 0) {
  console.log(C.green("  すべて問題ありません。"));
  console.log("");
  process.exit(0);
}

console.log("");
for (const d of dame) {
  console.log(`  ${C.red("×")} ${C.bold(d.what)}`);
  console.log(`    ${C.dim("→ " + d.why)}`);
}
console.log("");
console.log(
  C.red(
    `${dame.length}件あります。このまま公開すると、` +
      "止めたはずの人・権限を落としたはずの人が、そのまま動けます。",
  ),
);
console.log("");
process.exit(1);
