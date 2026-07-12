import { SITE } from "@/lib/site";

export const OG_IMAGE = `${SITE.domain}/og-twitter.png`;

export const ORGANIZATION_ID = `${SITE.domain}/#organization`;
export const WEBSITE_ID = `${SITE.domain}/#website`;
export const DOCS_WEBSITE_ID = `${SITE.domain}/docs/#website`;

const SECTION_TITLES: Record<string, string> = {
  "getting-started": "Getting Started",
  concepts: "Concepts",
  commands: "Commands",
  guides: "Guides",
  reference: "Reference",
  advanced: "Advanced",
};

type PageMapItem = {
  name?: string;
  route?: string;
  title?: string;
  children?: PageMapItem[];
};

export function docsUrl(path = ""): string {
  const slug = path.replace(/^\//, "");
  return slug ? `${SITE.domain}/docs/${slug}` : `${SITE.domain}/docs`;
}

export function docsCanonicalPath(mdxPath?: string[]): string {
  if (!mdxPath?.length) return "/docs";
  return `/docs/${mdxPath.join("/")}`;
}

export function flattenPageMapRoutes(
  items: readonly unknown[],
): Array<{ route: string; title?: string }> {
  const routes: Array<{ route: string; title?: string }> = [];

  for (const entry of items) {
    const item = entry as PageMapItem & { data?: unknown };
    if (item.data) continue;
    if (item.route !== undefined && item.name !== undefined) {
      routes.push({ route: item.route, title: item.title });
    }
    if (item.children) {
      routes.push(...flattenPageMapRoutes(item.children));
    }
  }

  return routes;
}

function segmentTitle(segment: string): string {
  return SECTION_TITLES[segment] ?? segment.replace(/-/g, " ");
}

export function buildBreadcrumbs(
  mdxPath: string[] | undefined,
  pageTitle: string,
): Array<{ name: string; url: string }> {
  const items: Array<{ name: string; url: string }> = [
    { name: "Lamina", url: SITE.domain },
    { name: "Docs", url: docsUrl() },
  ];

  if (!mdxPath?.length) {
    items.push({ name: pageTitle, url: docsUrl() });
    return items;
  }

  let path = "";
  for (let i = 0; i < mdxPath.length; i++) {
    const segment = mdxPath[i]!;
    path = path ? `${path}/${segment}` : segment;
    const isLast = i === mdxPath.length - 1;
    items.push({
      name: isLast ? pageTitle : segmentTitle(segment),
      url: docsUrl(path),
    });
  }

  return items;
}

export function buildSiteJsonLd(): Record<string, unknown> {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: "Lamina",
        url: SITE.domain,
        publisher: { "@id": ORGANIZATION_ID },
      },
      {
        "@type": "Organization",
        "@id": ORGANIZATION_ID,
        name: "Lamina",
        url: SITE.domain,
        logo: {
          "@type": "ImageObject",
          url: `${SITE.domain}/brand/lamina-lockup-light.svg`,
        },
        sameAs: [
          "https://github.com/aryaniyaps/lamina",
          "https://x.com/aryaniyaps",
        ],
      },
      {
        "@type": "WebSite",
        "@id": DOCS_WEBSITE_ID,
        name: "Lamina Docs",
        url: docsUrl(),
        description: SITE.description,
        publisher: { "@id": ORGANIZATION_ID },
        isPartOf: { "@id": WEBSITE_ID },
        inLanguage: "en-US",
      },
    ],
  };
}

export function buildPageJsonLd(options: {
  title: string;
  description?: string;
  mdxPath?: string[];
}): Record<string, unknown> {
  const slug = options.mdxPath?.join("/") ?? "";
  const url = docsUrl(slug);
  const breadcrumbId = `${url}#breadcrumb`;

  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "WebPage",
        "@id": `${url}#webpage`,
        url,
        name: options.title,
        description: options.description,
        isPartOf: { "@id": DOCS_WEBSITE_ID },
        breadcrumb: { "@id": breadcrumbId },
        mainEntity: { "@id": `${url}#article` },
        inLanguage: "en-US",
      },
      {
        "@type": "TechArticle",
        "@id": `${url}#article`,
        headline: options.title,
        description: options.description,
        url,
        author: { "@type": "Organization", "@id": ORGANIZATION_ID },
        publisher: {
          "@type": "Organization",
          "@id": ORGANIZATION_ID,
          logo: {
            "@type": "ImageObject",
            url: `${SITE.domain}/brand/lamina-lockup-light.svg`,
          },
        },
        isPartOf: { "@id": DOCS_WEBSITE_ID },
        inLanguage: "en-US",
      },
      {
        "@type": "BreadcrumbList",
        "@id": breadcrumbId,
        itemListElement: buildBreadcrumbs(options.mdxPath, options.title).map(
          (item, index) => ({
            "@type": "ListItem",
            position: index + 1,
            name: item.name,
            item: item.url,
          }),
        ),
      },
    ],
  };
}

export function pageTitleFromMetadata(
  metadata: { title?: string },
  mdxPath?: string[],
): string {
  if (typeof metadata.title === "string" && metadata.title.length > 0) {
    return metadata.title;
  }
  if (!mdxPath?.length) return "Introduction";
  const last = mdxPath[mdxPath.length - 1]!;
  return segmentTitle(last);
}
