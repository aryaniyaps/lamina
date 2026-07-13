import { chromium, devices } from 'playwright';
import { mkdir, writeFile } from 'fs/promises';
import { join } from 'path';

const OUTPUT_DIR = process.argv[2] || 'screenshots';
const URLS = [
  { slug: 'home', url: 'https://lamina.dev' },
  { slug: 'docs', url: 'https://lamina.dev/docs' },
];

const MOBILE = devices['iPhone 13'];
const DESKTOP = { viewport: { width: 1920, height: 1080 } };

async function analyzePage(page) {
  return page.evaluate(() => {
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const docEl = document.documentElement;
    const body = document.body;

    const getRect = (el) => {
      const r = el.getBoundingClientRect();
      return {
        tag: el.tagName.toLowerCase(),
        text: (el.innerText || el.textContent || '').trim().slice(0, 120),
        aria: el.getAttribute('aria-label') || '',
        role: el.getAttribute('role') || '',
        href: el.href || el.getAttribute('href') || '',
        x: Math.round(r.x),
        y: Math.round(r.y),
        w: Math.round(r.width),
        h: Math.round(r.height),
        visible: r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < vh && r.right > 0 && r.left < vw,
        aboveFold: r.top < vh && r.bottom > 0,
      };
    };

    const styleOf = (el) => {
      const cs = getComputedStyle(el);
      return {
        fontSize: cs.fontSize,
        lineHeight: cs.lineHeight,
        color: cs.color,
        backgroundColor: cs.backgroundColor,
      };
    };

    const h1 = document.querySelector('h1');
    const metaViewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || null;

    const interactive = [...document.querySelectorAll('a, button, [role="button"], input, select, textarea, summary')]
      .filter((el) => {
        const r = el.getBoundingClientRect();
        return r.width > 0 && r.height > 0;
      })
      .map((el) => {
        const r = el.getBoundingClientRect();
        const cs = getComputedStyle(el);
        return {
          ...getRect(el),
          minTapDim: Math.round(Math.min(r.width, r.height)),
          fontSize: cs.fontSize,
          pointerEvents: cs.pointerEvents,
        };
      });

    const aboveFoldInteractive = interactive.filter((i) => i.aboveFold);
    const smallTaps = aboveFoldInteractive.filter((i) => i.minTapDim < 48);

    const headings = [...document.querySelectorAll('h1, h2, h3')]
      .slice(0, 8)
      .map((el) => ({ ...getRect(el), ...styleOf(el) }));

    const ctas = [...document.querySelectorAll('a, button')]
      .filter((el) => /get started|docs|sign|try|learn|explore|install|read/i.test(el.innerText || ''))
      .slice(0, 10)
      .map((el) => ({ ...getRect(el), ...styleOf(el) }));

    return {
      title: document.title,
      metaViewport,
      viewport: { width: vw, height: vh },
      scrollWidth: Math.max(docEl.scrollWidth, body?.scrollWidth || 0),
      hasHorizontalScroll: Math.max(docEl.scrollWidth, body?.scrollWidth || 0) > vw + 1,
      h1: h1 ? { ...getRect(h1), ...styleOf(h1) } : null,
      headings,
      ctas,
      aboveFoldInteractiveCount: aboveFoldInteractive.length,
      smallTapTargetsAboveFold: smallTaps,
      bodyFontSize: styleOf(body || docEl).fontSize,
    };
  });
}

async function capture(browser, url, slug, profile, suffix) {
  const context = await browser.newContext(profile);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle', timeout: 60000 });
  await page.waitForTimeout(1500);

  const outPath = join(OUTPUT_DIR, `${slug}-${suffix}.png`);
  await page.screenshot({ path: outPath, fullPage: false });

  const analysis = await analyzePage(page);
  await context.close();
  return { screenshot: outPath, analysis };
}

await mkdir(OUTPUT_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true });
const results = {};

for (const { slug, url } of URLS) {
  results[slug] = {
    url,
    mobile: await capture(browser, url, slug, MOBILE, 'mobile'),
    desktop: await capture(browser, url, slug, DESKTOP, 'desktop'),
  };
}

await browser.close();
await writeFile(join(OUTPUT_DIR, 'visual-analysis.json'), JSON.stringify(results, null, 2));
console.log(JSON.stringify(results, null, 2));
