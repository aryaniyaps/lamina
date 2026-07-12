# Lamina docs site

Documentation for [lamina.dev](https://lamina.dev), built with [Next.js 16](https://nextjs.org/) and [Nextra 4](https://nextra.site/).

## Prerequisites

- Node.js 20+
- [pnpm](https://pnpm.io/)

## Local development

```bash
cd docs
pnpm install
pnpm dev
```

Open [http://localhost:3001/docs](http://localhost:3001/docs). The dev server uses port 3001 so it does not clash with other apps in the monorepo.

## Build

```bash
cd docs
pnpm install
pnpm build
```

`postbuild` runs [Pagefind](https://pagefind.app/) to generate the search index in `public/_pagefind/`.

## Project layout

```
docs/
├── app/              # Next.js App Router shell (layout, Nextra theme)
├── content/          # MDX pages and _meta.js navigation files
├── lib/              # Shared site config (name, links, metadata)
├── public/           # Static assets (brand, search index after build)
├── patches/          # patch-package overrides for nextra-theme-docs
├── next.config.mjs   # basePath /docs, Nextra wrapper
└── package.json
```

### Editing content

- Add or edit pages under `content/` as `.mdx` files.
- Control sidebar order and labels with `_meta.js` in each section folder.
- Site-wide metadata lives in `lib/site.ts`.

## Deploying to Vercel

This app is a subdirectory of the Lamina monorepo. Vercel must build from `docs/`, not the repository root.

In **Project Settings → General → Root Directory**, set:

```
docs
```

Leave the framework preset as **Next.js**. Vercel will pick up `next` from `docs/package.json` and run `pnpm install` / `pnpm build` in that directory.

The site is served under `/docs` via `basePath` in `next.config.mjs`, so production URLs look like `https://lamina.dev/docs/getting-started/quickstart`.

## Notes

- `postinstall` applies `patches/nextra-theme-docs+4.6.1.patch` via [patch-package](https://github.com/ds300/patch-package).
- This package has its own `pnpm-lock.yaml` and is not part of the root pnpm workspace.
