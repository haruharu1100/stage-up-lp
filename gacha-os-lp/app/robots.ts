import type { MetadataRoute } from "next";
import { site } from "@/content/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /*
          ★ここに "/demo" を書かないこと（2026-09-17・模倣対策）。

          　この robots.txt は、誰でもそのまま読める公開ファイルです。
          　https://（ドメイン）/robots.txt を開けば全文が見えます。

          　つまり「Disallow: /demo」と書くことは、
          　「/demo という隠しページがあります」と世間に貼り出すのと同じです。
          　真似をしようとする人が最初に見るのが、このファイルです。
          　"見に来るな" と書いても、人間は止められません。止まるのは検索ロボットだけです。

          　検索結果に出さないのは、ページ側の指定の役目です。
          　app/demo/page.tsx の robots: { index: false } がそれで、
          　読みに来てもらって初めて「載せないで」が伝わるぶん、確実です。

          　デモを見せたい相手には、商談の場で個別に URL をお伝えします。
          　広告のサイトリンクにも /demo を使わないこと。
          　この2つの決まりは tests/demoPrivate.test.ts が見張っています。
        */
        disallow: [
          "/api/",
          "/sales",
          "/sales-demo",
          "/launch",
          "/admin",
          "/contact/",
        ],
      },
    ],
    sitemap: `${site.domain}/sitemap.xml`,
  };
}
