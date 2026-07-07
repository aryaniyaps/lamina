#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import fs from "node:fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const brandDir = path.resolve(__dirname, "..");
const htmlPath = path.join(brandDir, "lamina-brand-identity.html");
const pdfPath = path.join(brandDir, "lamina-brand-identity.pdf");

async function runPuppeteer() {
  const script = `
    const puppeteer = require('puppeteer');
    (async () => {
      const browser = await puppeteer.launch({
        headless: 'new',
        args: ['--no-sandbox', '--disable-setuid-sandbox']
      });
      const page = await browser.newPage();
      await page.goto('file://${htmlPath}', { waitUntil: 'networkidle0' });
      await page.pdf({
        path: '${pdfPath}',
        format: 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
        preferCSSPageSize: true
      });
      await browser.close();
      console.log('PDF written to ${pdfPath}');
    })();
  `;

  const tmpScript = path.join(brandDir, "scripts", "_gen.mjs");
  fs.writeFileSync(tmpScript, script);

  return new Promise((resolve, reject) => {
    const child = spawn("npx", ["--yes", "puppeteer", "node", tmpScript], {
      cwd: brandDir,
      stdio: "inherit",
      shell: true,
    });
    child.on("close", (code) => {
      fs.unlinkSync(tmpScript);
      code === 0 ? resolve() : reject(new Error(`puppeteer exited ${code}`));
    });
  });
}

async function runChromeHeadless() {
  const chromeCandidates = [
    "/usr/bin/google-chrome",
    "/usr/bin/chromium-browser",
    "/usr/bin/chromium",
    "/snap/bin/chromium",
  ];
  const chrome = chromeCandidates.find((c) => fs.existsSync(c));
  if (!chrome) throw new Error("No Chrome/Chromium found");

  return new Promise((resolve, reject) => {
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        `--print-to-pdf=${pdfPath}`,
        "--print-to-pdf-no-header",
        htmlPath,
      ],
      { stdio: "inherit" }
    );
    child.on("close", (code) =>
      code === 0 ? resolve() : reject(new Error(`chrome exited ${code}`))
    );
  });
}

async function main() {
  if (!fs.existsSync(htmlPath)) {
    throw new Error(`Missing HTML: ${htmlPath}`);
  }

  try {
    await runPuppeteer();
  } catch {
    console.log("Puppeteer failed, trying system Chrome...");
    await runChromeHeadless();
  }

  if (!fs.existsSync(pdfPath)) {
    throw new Error("PDF generation failed");
  }
  const size = fs.statSync(pdfPath).size;
  console.log(`Done: ${pdfPath} (${(size / 1024).toFixed(1)} KB)`);
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
