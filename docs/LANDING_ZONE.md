# Landing zone changes (separate repo)

The marketing app at `lamina.dev` is a separate Next.js deployment that routes `/docs/*` to this docs app (multi-zone). Apply the changes below in the **landing-page repository**.

## 1. Sitemap index (critical)

Root `sitemap.xml` currently lists only the homepage. After deploying the docs changes in this repo, `/docs/sitemap.xml` will list all 28 documentation pages.

**Simplest approach**: update `public/robots.txt` (or `app/robots.ts`) to reference both sitemaps:

```
User-Agent: *
Allow: /

Sitemap: https://lamina.dev/sitemap.xml
Sitemap: https://lamina.dev/docs/sitemap.xml
```

**Option B — merge in landing `sitemap.ts`**: fetch `https://lamina.dev/docs/sitemap.xml` at build time and merge URLs into the root sitemap.

## 2. `llms.txt` and `llms-full.txt`

After `pnpm build` in `docs/`, copy generated files to the landing app:

```bash
cp docs/generated/llms.txt      <landing>/public/llms.txt
cp docs/generated/llms-full.txt <landing>/public/llms-full.txt
```

Add to landing `<head>` (in root `app/layout.tsx`):

```tsx
<link rel="llms-txt" href="https://lamina.dev/llms.txt" />
```

## 3. Homepage performance — lazy-load hero video

Lighthouse found ~4.5 MB of CloudFront video on the homepage (mobile TTI ~6.4 s).

- Defer or lazy-load hero/demo videos (`loading="lazy"`, `preload="none"`, or load on scroll/interaction)
- Use poster images for above-fold placeholders
- Add `width` and `height` to all images missing dimensions (CLS guard)
- Preload only the LCP image (hero text is LCP element — keep video off critical path)

## 4. Homepage JSON-LD enhancements

Add to existing `@graph`:

```json
{
  "@type": "WebPage",
  "@id": "https://lamina.dev/#webpage",
  "url": "https://lamina.dev",
  "name": "Lamina — Product design skill for AI coding agents",
  "isPartOf": { "@id": "https://lamina.dev/#website" },
  "about": { "@id": "https://lamina.dev/#software" },
  "publisher": { "@id": "https://lamina.dev/#organization" },
  "inLanguage": "en-US"
}
```

On `SoftwareApplication`, add:

```json
"softwareVersion": "0.1.0",
"offers": {
  "@type": "Offer",
  "price": "0",
  "priceCurrency": "USD",
  "availability": "https://schema.org/InStock"
}
```

Optional `FAQPage` schema for homepage problem/solution sections.

## 5. Homepage content — AI citation blocks

Add self-contained 134–167 word definition blocks near the hero and before the HavenStay demo.

## 6. Security headers

Add via `vercel.json` or `next.config.ts` `headers()` on the landing app:

```json
{
  "headers": [
    {
      "source": "/(.*)",
      "headers": [
        { "key": "X-Content-Type-Options", "value": "nosniff" },
        { "key": "Referrer-Policy", "value": "strict-origin-when-cross-origin" },
        { "key": "X-Frame-Options", "value": "DENY" }
      ]
    }
  ]
}
```

Align HSTS on homepage with docs: `max-age=63072000; includeSubDomains; preload`.

## 7. Homepage accessibility

- Add skip-navigation link (docs already has one)
- Bump header/CTA tap targets to ≥44px on mobile

## 8. Explicit AI crawler rules (optional)

```
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /
```

## 9. Multi-zone routing checks

| Path | Served by |
|------|-----------|
| `/sitemap.xml` | Landing |
| `/robots.txt` | Landing |
| `/llms.txt` | Landing `public/` |
| `/llms-full.txt` | Landing `public/` |
| `/og-twitter.png` | Landing `public/` |
| `/docs/sitemap.xml` | Docs zone |
| `/docs/*` | Docs zone |

## 10. Font deduplication

Scope `next/font` to each zone so docs does not pull landing static chunks from `/_next/`.

## 11. Internal linking on homepage

Add deep links to `/docs/getting-started/quickstart`, `/docs/concepts/what-is-lamina`, `/docs/guides/demo-havenstay`.

## Deploy order

1. Deploy **docs** changes from this repo.
2. Copy `docs/generated/llms*.txt` to landing `public/`.
3. Update landing `robots.txt` with second sitemap URL.
4. Apply landing performance, schema, and header changes.
