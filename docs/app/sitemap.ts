import type { MetadataRoute } from "next";
import { getPageMap } from "nextra/page-map";
import { SITE } from "@/lib/site";
import { flattenPageMapRoutes } from "@/lib/seo";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const pageMap = await getPageMap();
  const routes = flattenPageMapRoutes(pageMap);
  const lastModified = new Date();

  return routes.map(({ route, title }) => {
    const slug = route === "/" ? "" : route.replace(/^\//, "");
    const url = slug ? `${SITE.domain}/docs/${slug}` : `${SITE.domain}/docs`;

    return {
      url,
      lastModified,
      changeFrequency: "weekly" as const,
      priority: route === "/" ? 0.9 : title?.includes("/") ? 0.6 : 0.7,
    };
  });
}
