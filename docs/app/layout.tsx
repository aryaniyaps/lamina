import type { Metadata } from "next";
import Image from "next/image";
import { Inter, JetBrains_Mono } from "next/font/google";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { getPageMap } from "nextra/page-map";
import { Head } from "nextra/components";
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
  title: {
    default: `Docs — ${SITE.name}`,
    template: `%s — ${SITE.name} docs`,
  },
  description: SITE.description,
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
      className="text-sm font-medium text-[var(--ink-secondary)] transition-colors hover:text-[var(--ink)]"
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
      <Head faviconGlyph="◆" />
      <body className="min-h-full antialiased">
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
