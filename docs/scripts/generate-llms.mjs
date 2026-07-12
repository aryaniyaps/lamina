#!/usr/bin/env node
/**
 * Generates llms.txt and llms-full.txt for the landing-page zone.
 * Output lands in docs/generated/ — copy to the landing app public/ directory.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const contentDir = path.join(root, "content");
const outDir = path.join(root, "generated");

const DOMAIN = "https://lamina.dev";

const SECTION_ORDER = [
  "index",
  "getting-started",
  "concepts",
  "commands",
  "guides",
  "reference",
  "advanced",
];

function readMeta(dir) {
  const metaPath = path.join(dir, "_meta.js");
  if (!fs.existsSync(metaPath)) return {};
  const source = fs.readFileSync(metaPath, "utf8");
  const match = source.match(/export default\s+(\{[\s\S]*\});?/);
  if (!match) return {};
  // eslint-disable-next-line no-new-func
  return Function(`"use strict"; return (${match[1]});`)();
}

function collectMdxFiles(dir, base = "") {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    if (entry.name.startsWith("_")) continue;
    const rel = base ? `${base}/${entry.name}` : entry.name;
    const full = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...collectMdxFiles(full, rel));
      continue;
    }

    if (entry.name.endsWith(".mdx")) {
      files.push({
        rel: rel.replace(/\.mdx$/, ""),
        full,
      });
    }
  }

  return files;
}

function parseFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---\n/);
  if (!match) return { title: "", description: "" };

  const block = match[1];
  const title = block.match(/^title:\s*(.+)$/m)?.[1]?.trim() ?? "";
  const description =
    block.match(/^description:\s*(.+)$/m)?.[1]?.trim() ?? "";

  return {
    title: title.replace(/^["']|["']$/g, ""),
    description: description.replace(/^["']|["']$/g, ""),
  };
}

function toUrl(rel) {
  if (rel === "index") return `${DOMAIN}/docs`;
  return `${DOMAIN}/docs/${rel}`;
}

function sortFiles(files) {
  return files.sort((a, b) => {
    const [aSection = "", aRest = ""] = a.rel.split("/");
    const [bSection = "", bRest = ""] = b.rel.split("/");
    const aIdx = SECTION_ORDER.indexOf(aSection);
    const bIdx = SECTION_ORDER.indexOf(bSection);

    if (aIdx !== bIdx) return aIdx - bIdx;
    return aRest.localeCompare(bRest);
  });
}

function stripMdxBody(source) {
  return source
    .replace(/^---\n[\s\S]*?\n---\n/, "")
    .replace(/\{[^}]+\}/g, "")
    .replace(/<[^>]+>/g, "")
    .trim();
}

const files = sortFiles(collectMdxFiles(contentDir));
const pages = files.map(({ rel, full }) => {
  const source = fs.readFileSync(full, "utf8");
  const meta = parseFrontmatter(source);
  const body = stripMdxBody(source);

  return {
    rel,
    url: toUrl(rel),
    title: meta.title || rel,
    description: meta.description,
    body,
  };
});

const llmsTxt = `# Lamina

> Design how it works. Headless product-design skill for AI coding agents. Specs how your app works (states, edges, flows) into a contract your agent implements, then verifies with persona walks.

## About

Lamina is an open-source skill for developers who build with AI coding agents (Cursor, Claude Code, Codex, Gemini, Pi). It designs product behavior, not pixels, before your agent writes app source. The loop: design → implement → verify → fix.

Install: \`npx skills install aryaniyaps/lamina\`

MIT licensed. Source: https://github.com/aryaniyaps/lamina

## Key pages

- Homepage: ${DOMAIN}
- Documentation: ${DOMAIN}/docs
- Full docs dump: ${DOMAIN}/llms-full.txt

## Documentation

${pages
  .map((page) => {
    const line = page.description
      ? `- ${page.title}: ${page.url} — ${page.description}`
      : `- ${page.title}: ${page.url}`;
    return line;
  })
  .join("\n")}
`;

const llmsFullTxt = `# Lamina — full documentation export

Generated from docs/content. Prefer per-page URLs for citations when possible.

${pages
  .map(
    (page) => `## ${page.title}

URL: ${page.url}
${page.description ? `Summary: ${page.description}\n` : ""}
${page.body}

---`,
  )
  .join("\n\n")}
`;

fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, "llms.txt"), llmsTxt);
fs.writeFileSync(path.join(outDir, "llms-full.txt"), llmsFullTxt);

console.log(`Wrote ${pages.length} pages to ${outDir}/llms.txt and llms-full.txt`);
