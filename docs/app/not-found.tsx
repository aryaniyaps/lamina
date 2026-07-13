import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { NotFoundBlocks } from "@/components/errors/not-found-blocks";
import { NOT_FOUND } from "@/lib/not-found";
import { SITE } from "@/lib/site";

export const metadata: Metadata = {
  title: NOT_FOUND.title,
  description: NOT_FOUND.description,
  robots: {
    index: false,
    follow: true,
  },
};

export default function NotFound() {
  return (
    <div className="not-found-shell fixed inset-0 z-[100] flex min-h-svh flex-col overflow-x-clip bg-canvas">
      <header className="flex items-center justify-between gap-4 border-b border-line px-6 py-4 md:px-8">
        <a
          href={SITE.domain}
          className="inline-flex min-h-11 min-w-11 items-center"
        >
          <Image
            src="/brand/lamina-lockup-light.svg"
            alt="lamina"
            width={160}
            height={38}
            className="h-8 w-auto md:h-9"
          />
        </a>
        <Link
          href="/"
          className="text-sm font-medium text-ink-secondary transition-colors hover:text-ink"
        >
          Docs home
        </Link>
      </header>

      <main
        id="main-content"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center px-6 pb-8 pt-16 text-center md:px-8 md:pb-12 md:pt-20">
            <h1 className="not-found-rise max-w-4xl text-[clamp(2rem,6vw,3.75rem)] font-semibold leading-[1.08] tracking-[-0.03em] text-balance text-ink">
              {NOT_FOUND.headline}
            </h1>
            <div className="not-found-rise mt-10">
              <a
                href={SITE.domain}
                className="inline-flex min-h-11 items-center rounded-full bg-ink px-6 py-3 text-sm font-medium text-canvas transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2"
              >
                {NOT_FOUND.cta}
              </a>
            </div>
          </div>

          <NotFoundBlocks />
        </div>
      </main>
    </div>
  );
}
