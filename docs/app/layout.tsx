import type { Metadata } from "next";
import Image from "next/image";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import { Head } from "nextra/components";
import { JsonLd } from "@/components/json-ld";
import { OG_IMAGE, buildSiteJsonLd } from "@/lib/seo";
import { SITE } from "@/lib/site";
import "./globals.css";
import "nextra-theme-docs/style.css";
import "./nextra-overrides.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-inter",
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-jetbrains-mono",
});

export const metadata: Metadata = {
  metadataBase: new URL(SITE.domain),
  title: {
    default: `${SITE.name} Docs — Product design skill for AI coding agents`,
    template: `%s — ${SITE.name} docs`,
  },
  description: SITE.description,
  alternates: {
    canonical: "/docs",
  },
  robots: {
    index: true,
    follow: true,
  },
  openGraph: {
    type: "website",
    siteName: `${SITE.name} docs`,
    title: `${SITE.name} Docs — Product design skill for AI coding agents`,
    description: SITE.description,
    url: "/docs",
    images: [
      {
        url: OG_IMAGE,
        width: 1200,
        height: 630,
        alt: `${SITE.name}: Design how it works.`,
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    site: "@aryaniyaps",
    creator: "@aryaniyaps",
    title: `${SITE.name} Docs — Product design skill for AI coding agents`,
    description: SITE.description,
    images: [OG_IMAGE],
  },
  icons: {
    icon: "/brand/favicon-16.svg",
  },
};

const navbar = (
  <Navbar
    logo={
      <Image
        src="/brand/lamina-lockup-light.svg"
        alt="lamina"
        width={160}
        height={38}
        priority
        className="h-8 w-auto md:h-9"
      />
    }
    logoLink={SITE.domain}
    projectLink={SITE.github}
  >
    <a
      href={SITE.domain}
      className="docs-nav-home text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink)]"
    >
      Home
    </a>
  </Navbar>
);

const footer = (
  <Footer>
    MIT {new Date().getFullYear()} ©{" "}
    <a href={SITE.domain} target="_blank" rel="noreferrer">
      {SITE.name}
    </a>
  </Footer>
);

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${inter.variable} ${jetbrainsMono.variable} nextra-docs h-full`}
      suppressHydrationWarning
    >
      <Head faviconGlyph="◆">
        <link rel="llms-txt" href={`${SITE.domain}/llms.txt`} />
      </Head>
      <body className="min-h-full antialiased">
        <JsonLd data={buildSiteJsonLd()} />
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/aryaniyaps/lamina/tree/main/docs/content"
          editLink="Edit this page on GitHub"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          darkMode={false}
          nextThemes={{ forcedTheme: "light" }}
        >
          {children}
        </Layout>
      </body>
    </html>
  );
}
