# Performance Analysis — lamina.dev

**Captured:** 2026-07-12  
**Tool:** Lighthouse 13 (lab data, mobile + desktop)  
**Field data:** CrUX / PageSpeed Insights API unavailable (rate-limited / no API key)

---

## Executive Summary

| URL | Mobile Score | Desktop Score | CWV Pass (mobile lab) |
|-----|-------------|---------------|----------------------|
| https://lamina.dev | **90** | **78** | LCP ✅ · CLS ✅ · INP N/A |
| https://lamina.dev/docs | **93** | **85** | LCP ⚠️ · CLS ✅ · INP N/A |

Both pages have **excellent CLS (0)**. The homepage is weighed down by **~4.5 MB of third-party video** from CloudFront. Docs is lean (~470 KB) but mobile LCP sits at the edge of the "needs improvement" threshold.

---

## 1. https://lamina.dev (Home)

### Core Web Vitals (Mobile — primary SEO signal)

| Metric | Value | Status | Threshold |
|--------|-------|--------|-----------|
| **LCP** | 2.3 s | ✅ Good | ≤ 2.5 s |
| **INP** | N/A (lab) | — | ≤ 200 ms |
| **CLS** | 0 | ✅ Good | ≤ 0.1 |
| **TTFB** | 541 ms (lab) / 259 ms (raw) | ✅ Good | ≤ 800 ms |

### Core Web Vitals (Desktop)

| Metric | Value | Status |
|--------|-------|--------|
| **LCP** | 2.5 s | ✅ Good |
| **INP** | N/A (lab) | — |
| **CLS** | 0 | ✅ Good |
| **TTFB** | 24 ms | ✅ Good |

### Load Timing

| Metric | Mobile | Desktop |
|--------|--------|---------|
| FCP | 2.2 s | 1.8 s |
| Speed Index | 5.6 s | 1.8 s |
| TBT | 121 ms | 0 ms |
| TTI (total load) | **6.4 s** | **2.5 s** |
| Total transfer | **5,843 KiB** | **5,841 KiB** |

### LCP Element

- **Element:** `<h1>` — "Lamina designs how it works."
- **LCP breakdown (mobile):**
  - Time to first byte: **2,060 ms** (throttled mobile network)
  - Element render delay: **1,193 ms**

### Resource Breakdown

| Type | Requests | Transfer |
|------|----------|----------|
| Media (video) | 2 | **4,520 KiB** |
| Images | 18 | 899 KiB |
| Scripts | 12 | 290 KiB |
| Fonts | 2 | 87 KiB |
| Document | 1 | 21 KiB |
| Third-party | 5 | **4,525 KiB** |

**Largest requests:**
- 3,628 KiB — CloudFront video (`d8j0ntlcm91z4.cloudfront.net`)
- 894 KiB — CloudFront video (`d8j0ntlcm91z4.cloudfront.net`)

### Failing / Warning Audits (mobile)

- Speed Index: 5.6 s
- Time to Interactive: 6.4 s
- Main-thread work: 3.2 s
- Total byte weight: 5,843 KiB
- Unused JavaScript: ~93 KiB savings
- 15 `<img>` tags without explicit width/height
- Render-blocking requests
- Legacy JavaScript: ~31 KiB savings

---

## 2. https://lamina.dev/docs

### Core Web Vitals (Mobile)

| Metric | Value | Status | Threshold |
|--------|-------|--------|-----------|
| **LCP** | 2.7 s | ⚠️ Needs improvement | ≤ 2.5 s |
| **INP** | N/A (lab) | — | ≤ 200 ms |
| **CLS** | 0 | ✅ Good | ≤ 0.1 |
| **TTFB** | 25 ms (lab) / 253 ms (raw) | ✅ Good | ≤ 800 ms |

### Core Web Vitals (Desktop)

| Metric | Value | Status |
|--------|-------|--------|
| **LCP** | 2.4 s | ✅ Good |
| **INP** | N/A (lab) | — |
| **CLS** | 0 | ✅ Good |
| **TTFB** | 24 ms | ✅ Good |

### Load Timing

| Metric | Mobile | Desktop |
|--------|--------|---------|
| FCP | 968 ms | 957 ms |
| Speed Index | 968 ms | 1.2 s |
| TBT | 213 ms | 0 ms |
| TTI (total load) | **3.1 s** | **2.4 s** |
| Total transfer | **470 KiB** | **470 KiB** |

### LCP Element

- **Element:** `<p>` — intro paragraph ("Lamina is a headless product-design skill…")
- **LCP breakdown (mobile):**
  - Time to first byte: 139 ms
  - Element render delay: 239 ms

### Resource Breakdown

| Type | Requests | Transfer |
|------|----------|----------|
| Scripts | 9 | 247 KiB |
| Fonts | 4 | 175 KiB |
| Stylesheets | 2 | 30 KiB |
| Document | 1 | 16 KiB |
| Third-party | 0 | 0 |

### Failing / Warning Audits (mobile)

- LCP: 2.7 s (borderline)
- TBT: 210 ms
- Unused JavaScript: ~80 KiB savings (~300 ms est.)
- Render-blocking requests
- Duplicate font loads from both `/docs-static/_next/` and `/_next/` paths

---

## INP Note

INP requires real-user interaction data and cannot be measured in a single Lighthouse lab run. CrUX field data was unavailable during this audit. Lab proxy metrics:

| Page | Max Potential FID (mobile lab) |
|------|-------------------------------|
| lamina.dev | 270 ms |
| lamina.dev/docs | 240 ms |

These are **not** INP replacements — they indicate main-thread responsiveness under lab conditions only.

---

## Prioritized SEO / Performance Recommendations

### High Impact

1. **Defer or lazy-load hero videos on the homepage** — Two CloudFront videos account for 77% of total page weight (4.5 MB). Use `loading="lazy"`, poster images, or load below-the-fold. Expected impact: −3–4 s TTI, +10–15 mobile performance score.

2. **Fix mobile LCP on /docs (2.7 s → <2.5 s)** — LCP element is text blocked by JS/font loading. Preload critical fonts, inline critical CSS for above-fold content, or reduce render-blocking scripts. Expected impact: pass mobile CWV threshold.

3. **Add width/height to all homepage images** — 15 images lack dimensions. Risk of CLS regressions when content shifts. Expected impact: CLS insurance (currently 0, but fragile).

### Medium Impact

4. **Reduce unused JavaScript** — ~93 KiB (home) / ~80 KiB (docs). Code-split route-level chunks; tree-shake unused exports. Expected impact: −200–300 ms LCP on docs.

5. **Eliminate duplicate font requests on /docs** — Fonts loaded from both `/docs-static/_next/static/media/` and `/_next/static/media/`. Consolidate to a single origin/path. Expected impact: −80 KiB, faster FCP.

6. **Improve HTML caching** — `Cache-Control: public, max-age=0, must-revalidate` on both pages. Enable stale-while-revalidate or longer `s-maxage` at the CDN edge for static HTML. Expected impact: lower TTFB for repeat visitors.

7. **Address render-blocking resources** — Both pages flag render-blocking requests. Audit critical CSS inlining and defer non-critical JS. Expected impact: −200–500 ms FCP.

### Lower Impact

8. **Remove legacy JavaScript polyfills** — ~31 KiB (home) / ~14 KiB (docs). Target modern browsers only via `browserslist`. Expected impact: minor JS parse savings.

9. **Optimize image delivery** — ~18 KiB savings flagged on homepage. Ensure Next.js Image component uses WebP/AVIF with appropriate `sizes`. Expected impact: minor on LCP (LCP is text, not image).

10. **Add `preconnect` for third-party origins** — CloudFront and cdn.simpleicons.org used on homepage with no preconnect hints. Expected impact: −50–100 ms for third-party resources.

---

## Methodology

- **Lighthouse 13** with Puppeteer Chrome, mobile throttling (4× CPU, simulated 4G) and desktop (no throttling)
- **Raw network timing** via Python `urllib` from audit runner (uncached, single request)
- **Field data (CrUX):** Not available — PageSpeed API returned 429, CrUX API returned 403 (no API key)
- **INP:** Requires CrUX field data or Real User Monitoring; not reported as a measured value
