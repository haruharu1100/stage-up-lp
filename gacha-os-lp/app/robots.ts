import type { MetadataRoute } from "next";
import { site } from "@/content/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        /*
          ★2026-09-16：/demo をこの一覧から外しました。

          　無料デモは、広告のボタン（サイトリンク）の行き先にも使います。
          　ここで「見に来るな」と書いてあると、広告の審査で
          　行き先を確認できず不承認になることがあります。

          　検索結果に出したくないだけなら、ページ側の指定で足ります。
          　app/demo/page.tsx に robots: { index: false, follow: true } が
          　入っていて、そちらの方が確実です（読みに来てもらって初めて
          　「載せないで」が伝わるため）。この2行はセットです。片方だけ消さないこと。
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
