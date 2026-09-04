import type { MetadataRoute } from "next";

const base = "https://TODO-your-domain.example";

export default function sitemap(): MetadataRoute.Sitemap {
  return ["", "/docs", "/token", "/governance", "/terms", "/privacy"].map((path) => ({
    url: `${base}${path}`,
    changeFrequency: "monthly",
    priority: path === "" ? 1 : 0.7,
  }));
}
