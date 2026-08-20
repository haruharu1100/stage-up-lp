/**
 * 開発用URLの残留チェック。
 *
 * 目的：
 *   本番ドメインに切り替えたあと、コードのどこかに
 *   localhost / preview / staging / 古い vercel.app のURLが残っていると、
 *   ・SNSでシェアしたときに別の場所を指す
 *   ・検索エンジンに正しく登録されない
 *   ・お客様に送ったリンクが開けない
 *   といったことが起きる。目視では必ず見落とすので、機械的に全部探す。
 *
 * 使い方：
 *   npm run check:urls
 *
 * 判定：
 *   見つかったら終了コード1（＝失敗）。見つからなければ0。
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

const C = {
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

/** 探す対象。画面に出るコードと、公開される静的ファイル */
const SCAN_DIRS = ["app", "components", "config", "content", "lib", "public"];
const SCAN_FILES = ["next.config.mjs", "vercel.json"];
const SCAN_EXT = /\.(tsx|ts|jsx|js|mjs|json|xml|txt|html|webmanifest)$/;

/**
 * 除外するファイル。
 * 「開発用URLの一覧そのもの」を持っているファイルは、
 * 当然その文字列を含むので、ここで除く。
 */
const ALLOW_FILES = new Set([
  "lib/readiness.ts", // DEV_URL_HINTS の定義元
  "scripts/check-urls.mjs", // このファイル
  "scripts/check-launch.mjs", // 同じ一覧を写している
]);

/** 見つけたら止めるパターン */
const BAD_PATTERNS = [
  {
    re: /https?:\/\/localhost(:\d+)?/gi,
    why: "手元の開発サーバーのURL。本番では開けません。",
  },
  {
    re: /https?:\/\/127\.0\.0\.1(:\d+)?/g,
    why: "手元の開発サーバーのURL。本番では開けません。",
  },
  {
    re: /https?:\/\/0\.0\.0\.0(:\d+)?/g,
    why: "手元の開発サーバーのURL。本番では開けません。",
  },
  {
    re: /https?:\/\/[a-z0-9-]+\.vercel\.app/gi,
    why: "自動生成のプレビューURL。独自ドメインに置き換えてください。",
  },
  {
    re: /https?:\/\/staging[.-][a-z0-9.-]+/gi,
    why: "検証用URL。本番URLに置き換えてください。",
  },
  {
    re: /https?:\/\/preview[.-][a-z0-9.-]+/gi,
    why: "検証用URL。本番URLに置き換えてください。",
  },
  {
    re: /https?:\/\/[a-z0-9-]+\.ngrok[a-z0-9.-]*/gi,
    why: "一時公開用のURL。すぐに切れます。",
  },
];

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const e of entries) {
    if (e === "node_modules" || e === ".next" || e.startsWith(".")) continue;
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (SCAN_EXT.test(e)) out.push(p);
  }
  return out;
}

const files = [];
for (const d of SCAN_DIRS) files.push(...walk(join(root, d)));
for (const f of SCAN_FILES) {
  const p = join(root, f);
  if (existsSync(p)) files.push(p);
}

const hits = [];
for (const file of files) {
  const rel = relative(root, file);
  if (ALLOW_FILES.has(rel)) continue;

  const lines = readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    for (const p of BAD_PATTERNS) {
      p.re.lastIndex = 0;
      const found = line.match(p.re);
      if (found) {
        for (const m of found) {
          hits.push({ file: rel, line: i + 1, url: m, why: p.why });
        }
      }
    }
  });
}

console.log("");
console.log(C.bold("  ── 開発用URLの残留チェック ──────────────────"));
console.log(C.dim(`  対象 ${files.length} ファイル`));

if (hits.length === 0) {
  console.log(`  ${C.green("✓")} 開発用・プレビュー用のURLは残っていません。`);
  console.log(
    C.dim(
      "  本番URLは環境変数 NEXT_PUBLIC_SITE_URL から組み立てています。\n" +
        "  ドメインを変えるときは、その1か所を変えれば全体に反映されます。"
    )
  );
  console.log("");
  process.exit(0);
}

console.log(`  ${C.red("✗")} ${hits.length}件、開発用URLが残っています。`);
console.log("");
for (const h of hits) {
  console.log(C.red(`  ${h.file}:${h.line}`));
  console.log(`    ${h.url}`);
  console.log(C.dim(`    ${h.why}`));
}
console.log("");
console.log(
  C.dim("  本番URLは NEXT_PUBLIC_SITE_URL から取るように直してください。")
);
console.log("");
process.exit(1);
