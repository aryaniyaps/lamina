#!/usr/bin/env node
/**
 * Generates llms.txt and llms-full.txt into docs/public/.
 * Served at /docs/llms*.txt via basePath. Landing zone proxies lamina.dev/llms*.txt here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const contentDir = path.join(root, "content");
const publicDir = path.join(root, "public");

const DOMAIN = "https://lamina.dev";
const GITHUB = "https://github.com/aryaniyaps/lamina";
const INSTALL = "npx skills install aryaniyaps/lamina";
const DISAMBIGUATION =
  "Lamina (lamina.dev) is an open-source product-design skill for AI coding agents — not uselamina.ai (creative API for media generation).";

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

/** Rewrite relative markdown links to absolute lamina.dev URLs for out-of-context ingestion. */
function absolutizeMarkdownLinks(text) {
  return text
    .replace(/\]\(\/docs\/([^)]+)\)/g, `](${DOMAIN}/docs/$1)`)
    .replace(
      /\]\(\/(guides|getting-started|concepts|commands|reference|advanced)(\/[^)]+)?\)/g,
      (_match, section, rest = "") => `](${DOMAIN}/docs/${section}${rest})`,
    )
    .replace(
      /\]\((guides|getting-started|concepts|commands|reference|advanced)\/([^)]+)\)/g,
      `](${DOMAIN}/docs/$1/$2)`,
    );
}

const files = sortFiles(collectMdxFiles(contentDir));
const pages = files.map(({ rel, full }) => {
  const source = fs.readFileSync(full, "utf8");
  const meta = parseFrontmatter(source);
  const body = absolutizeMarkdownLinks(stripMdxBody(source));

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

${DISAMBIGUATION}

## Install

\`\`\`bash
${INSTALL}
\`\`\`

## License

MIT — ${GITHUB}

## Contact

- Issues: ${GITHUB}/issues
- Creator: https://aryaniyappan.com
- X: https://x.com/aryaniyaps

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

${DISAMBIGUATION}

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

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "llms.txt"), llmsTxt);
fs.writeFileSync(path.join(publicDir, "llms-full.txt"), llmsFullTxt);

console.log(
  `Wrote ${pages.length} pages to public/llms.txt and public/llms-full.txt`,
);
