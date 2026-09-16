/**
 * 「無料デモへの入口が、ページから消えていないか」の試験。
 *
 * ═══════════════════════════════════════════════════════
 * ★この試験が防いでいる、実際に起きた事故
 * ═══════════════════════════════════════════════════════
 *
 *   2026-09-16 に本番ページのHTMLを調べたところ、
 *   /demo へのリンクが1本もありませんでした。
 *
 *   デモのページ自体は正常に開きます（200が返ります）。
 *   ヘッダーも、ファーストビューの主ボタンも、最後のボタンも、
 *   そろって「導入について相談する」だけを指していたので、
 *   誰もたどり着けなくなっていただけです。
 *
 *   結果、広告で30日間に約72クリック入っても
 *   「デモを触った」は0件。画面を見ても絶対に気づけません。
 *   ボタンはちゃんと表示されていて、押せば動くからです。
 *
 * ★この試験が NO になったときは、試験の条件をゆるめないこと。
 *   直すのは、入口を消したほうです。
 *
 * ★この試験は、外へ1件も送りません。ファイルを読むだけです。
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import { site } from "../content/site";
import { mobileCtaVariants, ctaTrio } from "../content/site";
import { AD_CONVERSION_BY_EVENT } from "../config/ads";
import { EV } from "../lib/track";

const root = path.join(__dirname, "..");
const read = (p: string) => readFileSync(path.join(root, p), "utf8");

describe("無料デモへの入口", () => {
  it("ファーストビューの主ボタンが /demo を指している", () => {
    assert.equal(site.hero.ctaPrimary.href, "/demo");
  });

  it("主ボタンの下の『登録は必要ありません』が、デモ以外を指していない", () => {
    /*
      Hero には「約3分で体験できます。お申し込みや登録は必要ありません。」と
      書いてあります。これは触れるデモに添える文章です。
      主ボタンが相談フォームを指したままだと、文章だけが残って嘘になります。
    */
    const hero = read("components/Hero.tsx");
    assert.ok(
      hero.includes("お申し込みや登録は必要ありません"),
      "Hero の説明文が見つかりません。文章を変えたなら、この試験も一緒に直すこと",
    );
    assert.equal(site.hero.ctaPrimary.href, "/demo");
  });

  it("ヘッダー（PC・スマホの両方）から /demo へ行ける", () => {
    const header = read("components/Header.tsx");
    const hits = header.match(/href="\/demo"/g) ?? [];
    assert.ok(
      hits.length >= 2,
      `ヘッダーの /demo リンクが ${hits.length} 本しかありません（PC用とスマホメニュー用で2本必要）`,
    );
  });

  it("入口を持つ部品が、ページ本体にちゃんと並べてある", () => {
    /*
      ★この試験を足した理由（2026-09-16・検証担当の指摘）

        ここから下の試験は「部品のファイルの中に /demo と書いてあるか」を見ています。
        ところが、部品の中に書いてあっても、その部品を app/page.tsx から
        外してしまえば、ページからは消えます。しかも試験は合格したままです。

        実際に試したところ、<Hero /> と <ClosingMessage /> を page.tsx から
        消しても、試験は 8本すべて合格しました。
        今回の事故（画面を見ても気づけない入口の消失）と、まったく同じ形です。

        だから「部品が本当に並べてあるか」も、ここで数えます。
    */
    const page = read("app/page.tsx");
    for (const tag of ["<Header />", "<Hero />", "<DemoInvite />", "<ClosingMessage />", "<MobileCTA />"]) {
      assert.ok(
        page.includes(tag),
        `app/page.tsx から ${tag} が消えています（入口ごと消えます）`,
      );
    }
  });

  it("ページ本文の途中にも、触れる案内が置いてある", () => {
    const page = read("app/page.tsx");
    assert.ok(page.includes("<DemoInvite />"), "DemoInvite が本文にありません");

    const invite = read("components/sections/DemoInvite.tsx");
    assert.ok(invite.includes('href: "/demo"'), "運営者デモへの行き先がありません");
    assert.ok(
      invite.includes('href: "/demo?side=customer"'),
      "お客様デモへの行き先がありません",
    );
  });

  it("最後の締めくくりからも /demo へ行ける", () => {
    const closing = read("components/sections/ClosingMessage.tsx");
    assert.ok(closing.includes('href="/demo"'), "締めくくりに /demo がありません");
  });

  it("スマホ下部のバーは、どちらの案でも /demo を出す", () => {
    for (const [key, v] of Object.entries(mobileCtaVariants)) {
      const hrefs = [v.primary.href, v.secondary.href];
      assert.ok(
        hrefs.includes("/demo"),
        `案 ${key} のボタン2つが、どちらも /demo を指していません`,
      );
    }
  });

  it("料金の章にも「先に触れます」が置いてある", () => {
    /*
      金額を見ている人は、実物を見ないまま判断しようとします。
      料金表の手前に1本だけ入口を置いています。
    */
    const pricing = read("components/sections/Pricing.tsx");
    assert.ok(
      pricing.includes('href="/demo"'),
      "料金の章から /demo が消えています",
    );
  });

  it("お客様画面の章から、お客様デモへ行ける", () => {
    const cs = read("components/sections/CustomerSide.tsx");
    assert.ok(
      cs.includes('href="/demo?side=customer"'),
      "お客様画面の説明の直後に、お客様デモへの行き先がありません",
    );
  });

  it("最後の3枚のうち1枚目が、相談ではなくデモを向いている", () => {
    /*
      ここは以前、3枚とも行き先が #contact でした。
      しかも1枚目のキーは "demo" なのに中身は相談フォームで、
      名前と行き先が食い違っていました。
    */
    const first = ctaTrio[0];
    assert.equal(first.key, "demo");
    assert.equal(first.href, "/demo");

    const cta = read("components/sections/Cta.tsx");
    assert.ok(
      !cta.includes('c.primary ? "相談する"'),
      "カードの文字が「primaryなら必ず相談する」に戻っています（デモを向いたまま言葉だけ嘘になります）",
    );
  });

  it("robots.txt で /demo を読みに来るなと書いていない", () => {
    /*
      デモは広告のボタン（サイトリンク）の行き先にも使います。
      ここで止めると、広告の審査で行き先を確認できません。
      検索結果に出さないのは、ページ側の robots: { index: false } の役目です。
    */
    const robots = read("app/robots.ts");
    const disallow = robots.slice(robots.indexOf("disallow"));
    assert.ok(
      !/"\/demo"/.test(disallow),
      "robots.ts の disallow に /demo が戻っています",
    );

    const demoPage = read("app/demo/page.tsx");
    assert.ok(
      /index:\s*false/.test(demoPage),
      "デモページの index: false が外れています（robots.ts とセットです）",
    );
  });

  it("デモを触ったことが、広告へ返る対応表に残っている", () => {
    assert.equal(AD_CONVERSION_BY_EVENT[EV.demoStart], "demo");
    assert.equal(AD_CONVERSION_BY_EVENT[EV.contactSubmit], "contact");
  });
});
