# Landing zone changes (separate repo)

The marketing app at `lamina.dev` is a separate Next.js deployment that routes `/docs/*` to this docs app (multi-zone).

## 1. Sitemap (critical)

Add a second sitemap line to landing `robots.txt`:

```
Sitemap: https://lamina.dev/sitemap.xml
Sitemap: https://lamina.dev/docs/sitemap.xml
```

## 2. `llms.txt` / `llms-full.txt` (proxied — no landing copy step)

Landing `beforeFiles` rewrites `lamina.dev/llms.txt` → docs deployment (e.g. `/docs/llms.txt`). Do **not** keep static copies in landing `public/`.

This docs app generates both files in `public/` on build. With `basePath: /docs`, they are available at:

- `https://lamina.dev/docs/llms.txt`
- `https://lamina.dev/docs/llms-full.txt`

Landing proxies the root URLs to those paths. Redeploy docs when content changes; landing needs no maintenance.

## 3. Homepage performance

Lazy-load hero videos (~4.5 MB), add image dimensions, preload LCP only.

## 4. Homepage JSON-LD

Add `WebPage`, `softwareVersion`, optional `FAQPage`.

## 5. Security headers + HSTS alignment

See prior audit recommendations in landing `vercel.json`.

## Multi-zone routing

| Path | Served by |
|------|-----------|
| `/llms.txt`, `/llms-full.txt` | Landing proxy → docs |
| `/docs/sitemap.xml` | Docs zone |
| `/docs/*` | Docs zone |
| `/sitemap.xml` | Landing |
