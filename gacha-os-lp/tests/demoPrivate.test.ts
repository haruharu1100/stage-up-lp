/**
 * 「無料デモへの入口が、ページに復活していないか」の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が守っている、本人の判断（2026-09-17）
 * ═══════════════════════════════════════════════════════
 *
 *   「でもへの入り口はもういらない。それがあるとそれをパクられるので」
 *
 *   デモのページ（/demo）自体は残してあります。消していません。
 *   ただし、販売ページのどこからもリンクしません。
 *   見せたい相手には、商談の場で個別に URL をお伝えする運用です。
 *
 *   ★ここは「良かれと思って」戻されやすい場所です。
 *     広告の成果を上げるなら、触れるデモを置くのが定石だからです。
 *     実際、2026-09-16 には逆向きの試験（入口が消えていないか）が
 *     ここに置いてありました。それをこの試験で置き換えています。
 *     入口を戻すのは、本人がもう一度そう決めたときだけです。
 *
 * ★この試験が NO になったときは、試験の条件をゆるめないこと。
 *   直すのは、入口を足したほうです。
 *
 * ★広告への影響（承知のうえです）
 *   Google広告の入札の目標は「デモを触った」でした。
 *   入口が無い以上、この成果はもう入りません（0件のままになります）。
 *   config/ads.ts にも同じことを書いてあります。
 *
 * ★この試験は、外へ1件も送りません。ファイルを読むだけです。
 */

import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { site, mobileCtaVariants, ctaTrio } from "../content/site";

const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

/**
 * 販売ページを組み立てているファイルだけを集めます。
 *
 * ★「デモの中身そのもの」は対象から外します。
 *   /demo のページや、その中で使う部品は、当然 /demo を指してよいからです。
 *   外すのは、そこへ「連れて行く」リンクのほうです。
 */
const SKIP_DIRS = new Set(["node_modules", ".next", ".git", "tests", "scripts"]);

/**
 * デモ側（対象外）。ここは /demo を持っていて当然。
 *
 * ★この一覧を安易に増やさないこと（2026-09-17・検証担当の指摘）。
 *   以前ここに components/console/ と lib/console/ を丸ごと入れていました。
 *   ところが components/console/customer/ の中身は、
 *   公開ページの /shop や /mypage が読み込んでいます。
 *   つまり「対象外」にした場所が、実はお客様に見えるページでした。
 *   フォルダごと除外すると、見張りに穴が空きます。
 */
const DEMO_OWN = [
  "app/demo/",
  "app/client-demo/",
  "app/sales/",
  "app/sales-demo/",
  "components/demo/",
  "content/salesDemo.ts",
];

function collect(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(path.join(root, dir))) {
    if (SKIP_DIRS.has(name)) continue;
    const rel = path.join(dir, name);
    if (statSync(path.join(root, rel)).isDirectory()) collect(rel, out);
    else if (/\.(tsx|ts)$/.test(name)) out.push(rel);
  }
  return out;
}

/** コメント行を落とす。注意書きの中の「/demo」まで拾わないため */
function code(src: string): string {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*(\/\/|\*).*$/gm, "");
}

describe("無料デモへの入口（もう置かない）", () => {
  it("ファーストビューの主ボタンが /demo を指していない", () => {
    assert.equal(site.hero.ctaPrimary.href, "#contact");
    assert.ok(!site.hero.ctaSecondary.href.startsWith("/demo"));
  });

  it("主ボタンの下に「体験できます」と書いていない", () => {
    /*
      主ボタンの行き先は相談フォームです。
      「約3分で体験できます。お申し込みや登録は必要ありません。」が
      残っていると、押す前の言葉だけが嘘になります。
    */
    const hero = read("components/Hero.tsx");
    for (const ng of ["約3分で体験できます", "お申し込みや登録は必要ありません"]) {
      assert.ok(
        !code(hero).includes(ng),
        `Hero に「${ng}」が戻っています（行き先は相談フォームです）`,
      );
    }
  });

  it("販売ページのどのファイルにも /demo という行き先が無い", () => {
    /*
      ★href= だけを見ないこと（2026-09-17・検証担当の指摘）。

        最初はこの試験を /href\s*=\s*"\/demo"/ で書いていました。
        検証担当が、次のどれを書いても素通りすることを実際に示しました。

          const demoHref = "/demo";  <Link href={demoHref}>
          <Link href={`${base}/demo`}>
          router.push("/demo")
          redirect("/demo")
          { to: "/demo" } / { url: "/demo" }

        だから「書き方」ではなく「/demo という文字列があるかどうか」で見ます。
        取りこぼすより、たまに余計に引っかかるほうが安全です。

      ★import のパスを巻き込まないこと。
        @/lib/console/demo や ./demo は、ページの行き先ではなくファイルの名前です。
        /demo の直前が英数字（console の e）やドットなら、それは import なので見逃します。
        行き先として書かれた "/demo" は、直前が必ず引用符か ${'{'}…} の閉じ括弧になります。
    */
    const LINK = /(^|[^\w.])\/demo(?=["'`?/\s)]|$)/;

    const files = [
      ...collect("app"),
      ...collect("components"),
      ...collect("content"),
      ...collect("lib"),
      ...collect("config"),
    ].filter((f) => !DEMO_OWN.some((d) => f.startsWith(d)));

    const hits: string[] = [];
    for (const f of files) {
      if (LINK.test(code(read(f)))) hits.push(f);
    }

    assert.deepEqual(
      hits,
      [],
      `販売ページから /demo への行き先が復活しています → ${hits.join(", ")}`,
    );
  });

  it("スマホ下部のバーが /demo を出さない", () => {
    for (const [key, v] of Object.entries(mobileCtaVariants)) {
      for (const b of [v.primary, v.secondary]) {
        assert.ok(
          !b.href.startsWith("/demo"),
          `案 ${key} のボタンが /demo を指しています`,
        );
      }
    }
  });

  it("最後の3枚が、どれも /demo を向いていない", () => {
    for (const c of ctaTrio) {
      assert.ok(!c.href.startsWith("/demo"), `${c.key} が /demo を指しています`);
    }
    /*
      以前は1枚目のキーが "demo" なのに中身は相談フォームで、
      名前と行き先が食い違っていました。"guide" に直してあります。
    */
    assert.equal(ctaTrio[0].key, "guide");
  });

  it("デモの部品ファイル（DemoInvite）が復活していない", () => {
    assert.ok(
      !existsSync(path.join(root, "components/sections/DemoInvite.tsx")),
      "DemoInvite.tsx が戻っています（ページ本文に置く入口でした）",
    );
    assert.ok(
      !read("app/page.tsx").includes("DemoInvite"),
      "app/page.tsx に DemoInvite が戻っています",
    );
  });

  it("robots.txt に /demo と書いて、存在を世間に貼り出していない", () => {
    /*
      robots.txt は誰でも読める公開ファイルです。
      「Disallow: /demo」と書くことは、隠しページの場所を公表するのと同じで、
      模倣対策としては逆効果になります（人間は robots.txt では止まりません）。
      検索結果から外すのは、ページ側の index: false の役目です。
    */
    const robots = read("app/robots.ts");
    const disallow = robots.slice(robots.indexOf("disallow"));
    assert.ok(
      !/"\/demo"/.test(disallow),
      "robots.ts の disallow に /demo が書かれています（隠し場所を公表しています）",
    );

    const demoPage = read("app/demo/page.tsx");
    assert.ok(
      /index:\s*false/.test(demoPage),
      "デモページの index: false が外れています（検索結果に出てしまいます）",
    );
  });

  it("デモのページ自体は残っている（消したのは入口だけ）", () => {
    assert.ok(
      existsSync(path.join(root, "app/demo/page.tsx")),
      "app/demo/page.tsx が消えています。消すのは入口だけで、ページは残す約束です",
    );
  });
});
