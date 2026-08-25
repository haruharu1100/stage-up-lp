/**
 * 確認用サイト（Preview）の接続先を、Vercel 側に登録する。
 *
 * ═══════════════════════════════════════════════
 * ★なぜ専用の手順があるのか
 * ═══════════════════════════════════════════════
 *
 *   `vercel env add` は、どのブランチ向けかを対話で聞いてきます。
 *   自動で流すと、その質問に答えられずに止まります。
 *   ここでは、Vercel の窓口（API）へ直接
 *   「Preview 全体に入れてください」と伝えます。
 *
 * ═══════════════════════════════════════════════
 * ★絶対に守ること
 * ═══════════════════════════════════════════════
 *
 *   ・書き込み先は Preview だけ。production には1件も入れません。
 *     （下の TARGET を production にしないこと。
 *       ここを1文字変えるだけで、本番の接続先が書き換わります）
 *
 *   ・合言葉（トークン）は画面に出しません。
 *     出すと、この画面を撮った人・見た人の全員に渡ります。
 *
 * 使い方：
 *   DATABASE_URL="libsql://..." DATABASE_AUTH_TOKEN="..." \
 *     node scripts/set-preview-env.mjs
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** ★ここは preview 固定。production を足さないこと。 */
const TARGET = ["preview"];

const PROJECT = "prj_pwynr4o7ziNTebMaruq5EGPfQ4hd";
const TEAM = "team_Xb21kOU4oo7SPj9yC05jdW6Q";

function stop(why) {
  console.error(`\n✗ 何もせずに止めました。\n\n  ${why}\n`);
  process.exit(1);
}

const authPath = join(
  homedir(),
  "Library",
  "Application Support",
  "com.vercel.cli",
  "auth.json",
);

let token;
try {
  token = JSON.parse(readFileSync(authPath, "utf8")).token;
} catch {
  stop("Vercel にログインしていません。npx vercel login を先に実行してください。");
}
if (!token) stop("Vercel の合言葉が読み取れませんでした。");

const url = (process.env.DATABASE_URL ?? "").trim();
const authToken = (process.env.DATABASE_AUTH_TOKEN ?? "").trim();
if (!url) stop("DATABASE_URL が指定されていません。");
if (!authToken) stop("DATABASE_AUTH_TOKEN が指定されていません。");

/* ★確認用の接続先に、本番らしい名前が入っていないか見ておきます。
     間違えて本番のDBを Preview に差すと、
     確認のたびに本物のお客様のポイントが動きます。 */
if (/prod|honban/i.test(url)) {
  stop(`接続先の名前に本番らしい文字が入っています：${url}`);
}

const items = [
  ["DATABASE_URL", url],
  ["DATABASE_AUTH_TOKEN", authToken],
  /* このDBが何用かを、はっきり名乗らせます。
     production 以外のときだけ、架空データの作成が許されます。 */
  ["DATABASE_ENV", "preview"],
  /* 決済・SMS・メール・配送会社へ、外向きの連絡を1件も出さないモード */
  ["DEMO_MODE", "true"],
];

/** 値そのものは絶対に出さない。出すのは「入ったかどうか」だけ */
const mask = (v) => `（${v.length}文字）`;

for (const [key, value] of items) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${PROJECT}/env?teamId=${TEAM}&upsert=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key,
        value,
        type: "encrypted",
        target: TARGET,
      }),
    },
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.error) {
    stop(`${key} を登録できませんでした：${body?.error?.message ?? res.status}`);
  }
  console.log(`  ✓ ${key} ${mask(value)} → Preview`);
}

console.log("\n✓ 確認用サイトの接続先を登録しました（Preview のみ）。");
