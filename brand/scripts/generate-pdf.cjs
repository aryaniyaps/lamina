const puppeteer = require("puppeteer");
const path = require("path");

(async () => {
  const brandDir = path.resolve(__dirname, "..");
  const htmlPath = path.join(brandDir, "lamina-brand-identity.html");
  const pdfPath = path.join(brandDir, "lamina-brand-identity.pdf");

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();
  await page.goto(`file://${htmlPath}`, { waitUntil: "networkidle0", timeout: 60000 });
  await page.emulateMediaType("print");
  await page.pdf({
    path: pdfPath,
    format: "A4",
    printBackground: true,
    margin: { top: "0", right: "0", bottom: "0", left: "0" },
    preferCSSPageSize: true,
  });

  await browser.close();
  console.log(`PDF written: ${pdfPath}`);
})();
