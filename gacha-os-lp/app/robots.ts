import type { MetadataRoute } from "next";
import { site } from "@/content/site";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/api/",
          "/demo",
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
