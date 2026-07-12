import type { Metadata } from "next";
import { generateStaticParamsFor, importPage } from "nextra/pages";
import { useMDXComponents } from "nextra-theme-docs";
import { JsonLd } from "@/components/json-ld";
import {
  OG_IMAGE,
  buildPageJsonLd,
  docsCanonicalPath,
  pageTitleFromMetadata,
} from "@/lib/seo";
import { SITE } from "@/lib/site";

export const generateStaticParams = generateStaticParamsFor("mdxPath");

function resolveDescription(
  metadata: { description?: string | null },
  fallback: string,
): string {
  const value = metadata.description?.trim();
  return value || fallback;
}

export async function generateMetadata(props: {
  params: Promise<{ mdxPath?: string[] }>;
}): Promise<Metadata> {
  const params = await props.params;
  const { metadata } = await importPage(params.mdxPath);
  const canonical = docsCanonicalPath(params.mdxPath);
  const title = pageTitleFromMetadata(metadata, params.mdxPath);
  const description = resolveDescription(metadata, SITE.description);
  const fullTitle = `${title} — ${SITE.name} docs`;

  return {
    ...metadata,
    title,
    description,
    alternates: {
      canonical,
    },
    openGraph: {
      type: "article",
      siteName: `${SITE.name} docs`,
      title: fullTitle,
      description,
      url: canonical,
      images: [
        {
          url: OG_IMAGE,
          width: 1200,
          height: 630,
          alt: `${SITE.name} docs`,
        },
      ],
    },
    twitter: {
      card: "summary_large_image",
      site: "@aryaniyaps",
      creator: "@aryaniyaps",
      title: fullTitle,
      description,
      images: [OG_IMAGE],
    },
  };
}

export default async function Page(props: {
  params: Promise<{ mdxPath?: string[] }>;
}) {
  const params = await props.params;
  const {
    default: MDXContent,
    toc,
    metadata,
    sourceCode,
  } = await importPage(params.mdxPath);

  const Wrapper = useMDXComponents().wrapper;

  if (!Wrapper) {
    throw new Error("Missing MDX wrapper component");
  }

  const title = pageTitleFromMetadata(metadata, params.mdxPath);
  const description = resolveDescription(metadata, SITE.description);
  const jsonLd = buildPageJsonLd({
    title,
    description,
    mdxPath: params.mdxPath,
  });

  return (
    <>
      <JsonLd data={jsonLd} />
      <Wrapper toc={toc} metadata={metadata} sourceCode={sourceCode}>
        <MDXContent {...props} params={params} />
      </Wrapper>
    </>
  );
}
