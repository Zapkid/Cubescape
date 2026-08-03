import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        // match rooms are live sessions, not content
        disallow: "/match/",
      },
    ],
    sitemap: "https://cubescape-seven.vercel.app/sitemap.xml",
  };
}
