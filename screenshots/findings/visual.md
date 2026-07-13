# Visual Analysis — lamina.dev (Mobile)

**Captured:** 2026-07-12  
**Viewport:** iPhone 13 (390×664) via Playwright  
**Screenshots:** `screenshots/home-mobile.png`, `screenshots/docs-mobile.png`

---

## 1. https://lamina.dev (Home)

### Above-the-fold content

| Element | Visible above fold | Notes |
|---------|-------------------|-------|
| H1 — "Lamina designs how it works." | ✅ Yes | 36px, y≈144px |
| Eyebrow — "For developers who build with AI" | ✅ Yes | Small grey label above H1 |
| Subcopy — "UI skills dress the app…" | ✅ Yes | 16px body text |
| Primary CTA — "Install the skill" | ✅ Yes | 150×44px, y≈388px |
| Secondary CTA — "Star on GitHub" | ✅ Yes | 174×46px, side-by-side with primary |
| Docs nav link | ❌ Hidden | Collapsed into hamburger menu |

**Messaging clarity:** Strong. Value prop, differentiation ("how it behaves" vs UI skills), and install path are all visible without scrolling.

### Mobile viewport & layout

- `meta viewport`: `width=device-width, initial-scale=1` ✅
- Document width: 390px — no horizontal scroll ✅
- Body base font: 16px ✅
- Single-column layout; CTAs wrap side-by-side within viewport ✅
- No overlapping elements or text truncation observed ✅

### Tap targets (above fold)

| Element | Size | Meets 48×48px |
|---------|------|---------------|
| Logo/home link | 150×36 | ⚠️ Height 36px |
| Hamburger ("Open menu") | 40×40 | ⚠️ 40px |
| "Install the skill" | 150×44 | ⚠️ Height 44px |
| "Star on GitHub" | 174×46 | ⚠️ Height 46px (close) |

All four above-fold interactives are slightly under the 48px minimum. CTAs are close enough for practical use; header controls are the weakest.

### Text readability

- H1 at 36px with tight line-height (39.6px) — readable ✅
- Body at 16px with high contrast (rgb 29,29,31 on white) ✅
- Eyebrow text is small but legible as secondary label ✅

---

## 2. https://lamina.dev/docs (Introduction)

### Above-the-fold content

| Element | Visible above fold | Notes |
|---------|-------------------|-------|
| H1 — "Design how it works." | ✅ Yes | 36px, y≈114px |
| Intro paragraphs (2) | ✅ Yes | Explains product-design skill positioning |
| "Quick path" H2 | ✅ Yes | y≈498px — install command visible |
| First code block (`npx skills install…`) | ✅ Partial | Top of block visible at fold edge |
| Sidebar nav | ❌ Hidden | Behind mobile menu (expected) |
| "On this page" TOC | ❌ Hidden | Below fold / desktop-only layout |

**Messaging clarity:** Good. Docs H1 mirrors homepage positioning. Intro copy and quick-start install command are immediately visible — strong for developer intent.

### Mobile viewport & layout

- `meta viewport`: `width=device-width, initial-scale=1` ✅
- Document width: 390px — no horizontal scroll ✅
- Body base font: 16px ✅
- H1 + "Copy page" button share one row — visually tight on narrow screens ⚠️

### Tap targets (above fold)

| Element | Size | Meets 48×48px |
|---------|------|---------------|
| Logo/home link | 133×32 | ❌ Height 32px |
| GitHub icon | 24×24 | ❌ |
| "Home" text link | 40×20 | ❌ |
| Menu button | 24×24 | ❌ |
| "Copy page" button | 112×28 | ❌ Height 28px |

**9 interactive elements** above fold; **5 fail** the 48px guideline. Header cluster (GitHub + Home + Menu) is the main concern — icons and text links are undersized and closely spaced (~20px apart), increasing mis-tap risk.

### Text readability

- H1 at 36px — readable ✅
- Body paragraphs at 16px — readable ✅
- Code blocks use monospace with adequate padding; first block fits viewport width ✅
- "Introduction" breadcrumb label is small (14px grey) but acceptable as metadata ✅

---

## Cross-page comparison

| Check | Home | Docs |
|-------|------|------|
| Viewport meta | ✅ | ✅ |
| Horizontal scroll | None | None |
| H1 above fold | ✅ | ✅ |
| Primary CTA above fold | ✅ | ✅ (install command) |
| Body font ≥16px | ✅ | ✅ |
| Tap targets ≥48px | ⚠️ Borderline | ❌ Multiple failures |
| Messaging clarity | Strong | Good |

---

## Priority recommendations

1. **Docs header (high):** Increase hit area for GitHub icon, Home link, and menu button to at least 44–48px (padding or min-width/height). Add spacing between header actions.
2. **Docs "Copy page" (medium):** Increase button height to ≥44px; consider moving below H1 on very narrow screens to reduce crowding.
3. **Home header (low):** Bump hamburger and logo tap targets to 44–48px — currently 40×40 and 36px tall.
4. **Home CTAs (low):** Optional min-height: 48px on primary/secondary buttons for WCAG 2.5.5 alignment.

---

## Screenshots

- `screenshots/home-mobile.png` — Home, mobile
- `screenshots/home-desktop.png` — Home, desktop (1920×1080)
- `screenshots/docs-mobile.png` — Docs, mobile
- `screenshots/docs-desktop.png` — Docs, desktop (1920×1080)
- `screenshots/visual-analysis.json` — Structured DOM measurements
