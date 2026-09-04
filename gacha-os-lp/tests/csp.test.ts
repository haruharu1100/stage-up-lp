/**
 * 「広告タグは入っているのに、ブラウザが送信を止めている」を防ぐ試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★2026-09-03に、本番で実際に起きていたこと
 * ═══════════════════════════════════════════════════════
 *
 *   広告IDもラベルも正しく入っていました。
 *   イベントも正しく送っていました。
 *   それでも、成果は1件も届いていませんでした。
 *
 *   止めていたのは、このサイト自身の安全設定（CSP）です。
 *   「読み込んでよい相手」の一覧に、Google広告の受け取り口が
 *   書かれていませんでした。書いていない相手への通信は、
 *   ブラウザが黙って捨てます。★エラーは1つも出ません。
 *
 *   この状態で日1,000円を出していれば、
 *   費用だけが出て、成果は0件のまま終わります。
 *   前回、費用対効果が全く出なかったのと同じ形です。
 *
 * ★ここは「広告IDを入れたら、送信先も一緒に開く」を機械で担保します。
 *   人が2か所を同時に直すのを当てにしません。必ず忘れます。
 */

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const CONFIG_URL = pathToFileURL(join(ROOT, "next.config.mjs")).href;

/** 指定した環境変数のときの CSP を、実際に組み立てさせて取り出す */
function cspWith(env: Record<string, string>): string {
  const out = execFileSync(
    process.execPath,
    [
      "-e",
      `import(${JSON.stringify(CONFIG_URL)}).then((m) => process.stdout.write(m.csp))`,
    ],
    {
      env: {
        ...process.env,
        /* 既定は「どの媒体にも出していない」状態にそろえる */
        NEXT_PUBLIC_GOOGLE_ADS_ID: "",
        NEXT_PUBLIC_META_PIXEL_ID: "",
        NEXT_PUBLIC_X_PIXEL_ID: "",
        ...env,
      },
      encoding: "utf8",
    },
  );
  return out;
}

/** CSP の中から、1つの項目（img-src など）だけ取り出す */
function directive(csp: string, name: string): string {
  const found = csp
    .split(";")
    .map((s) => s.trim())
    .find((s) => s === name || s.startsWith(`${name} `));
  return found ?? "";
}

const GOOGLE_ADS_ON = { NEXT_PUBLIC_GOOGLE_ADS_ID: "AW-18281740627" };

test("Google広告を使うなら、成果の受け取り口をふさがない", () => {
  const csp = cspWith(GOOGLE_ADS_ON);

  /* ★この3つが、実際に本番でふさがれていた送信先です。 */
  const mustReach = [
    "https://www.google.com",
    "https://googleads.g.doubleclick.net",
    "https://www.googleadservices.com",
  ];

  for (const where of ["img-src", "connect-src"]) {
    const line = directive(csp, where);
    for (const host of mustReach) {
      assert.ok(
        line.includes(host),
        `${where} に ${host} がありません。` +
          " 広告費だけが出て、成果は0件のまま終わります。" +
          ` 実際の中身: ${line}`,
      );
    }
  }
});

test("日本の閲覧者ぶんの送信先（google.co.jp）も開いている", () => {
  const csp = cspWith(GOOGLE_ADS_ON);
  /* ★日本からの閲覧は、国別のドメインへ送られることがあります。
       ここが無いと、日本の成果だけが部分的に欠けます。 */
  assert.ok(directive(csp, "img-src").includes("https://www.google.co.jp"));
  assert.ok(directive(csp, "connect-src").includes("https://www.google.co.jp"));
});

test("見えない小窓（iframe）で送る分も止めていない", () => {
  const csp = cspWith(GOOGLE_ADS_ON);
  const line = directive(csp, "frame-src");
  assert.ok(
    line.includes("https://td.doubleclick.net"),
    "frame-src が無い（または狭い）ため、成果の一部が静かに欠けます。",
  );
});

test("広告を出していないなら、余計な穴は開けない", () => {
  const csp = cspWith({});
  for (const where of ["img-src", "connect-src", "script-src"]) {
    const line = directive(csp, where);
    assert.ok(
      !line.includes("doubleclick.net"),
      `広告を使っていないのに ${where} が広告先へ開いています： ${line}`,
    );
    assert.ok(!line.includes("facebook"), `${where} が Meta へ開いています`);
    assert.ok(!line.includes("ads-twitter"), `${where} が X へ開いています`);
  }
});

test("Meta・X も、入れたときだけ開く", () => {
  const meta = cspWith({ NEXT_PUBLIC_META_PIXEL_ID: "1234567890" });
  assert.ok(directive(meta, "script-src").includes("https://connect.facebook.net"));
  assert.ok(!directive(meta, "script-src").includes("ads-twitter"));

  const x = cspWith({ NEXT_PUBLIC_X_PIXEL_ID: "abcde" });
  assert.ok(directive(x, "script-src").includes("https://static.ads-twitter.com"));
  assert.ok(!directive(x, "script-src").includes("connect.facebook.net"));
});

test("もともと守っていたところを、ゆるめていない", () => {
  const csp = cspWith(GOOGLE_ADS_ON);
  for (const keep of [
    "default-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'self'",
    "upgrade-insecure-requests",
  ]) {
    assert.ok(csp.includes(keep), `${keep} が消えています。`);
  }
  /* GA4 の送信先（前に一度、消して事故になった場所） */
  assert.ok(directive(csp, "connect-src").includes("https://analytics.google.com"));
});
