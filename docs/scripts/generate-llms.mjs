#!/usr/bin/env node
/**
 * Generates llms.txt and llms-full.txt into docs/public/.
 * Served at /docs/llms*.txt via basePath. Landing zone proxies lamina.dev/llms*.txt here.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SITE } from "../lib/site-data.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const contentDir = path.join(root, "content");
const publicDir = path.join(root, "public");

const { domain: DOMAIN, github: GITHUB, install: INSTALL, disambiguation: DISAMBIGUATION } =
  SITE;

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

function splitPreservingInlineCode(text) {
  return text.split(/(`[^`\n]*`)/);
}

/** Remove JSX `{...}` expressions outside inline code spans. */
function stripJsxExpressions(text) {
  return splitPreservingInlineCode(text)
    .map((part, index) =>
      index % 2 === 1 ? part : part.replace(/\{[^}]*\}/g, ""),
    )
    .join("");
}

/** Strip MDX imports and rendered JSX from prose; preserve angle-bracket metavariables. */
function stripMdxProse(text) {
  let out = text.replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "");
  out = out.replace(/<Callout[^>]*>([\s\S]*?)<\/Callout>/gi, "\n$1\n");
  out = out.replace(/<span[^>]*\/>/g, "");
  out = out.replace(/<span[^>]*>([\s\S]*?)<\/span>/gi, "$1");
  out = out.replace(/<[A-Z][A-Za-z0-9]*[^>]*\/>/g, "");
  out = out.replace(
    /<[A-Z][A-Za-z0-9]*[^>]*>([\s\S]*?)<\/[A-Z][A-Za-z0-9]*>/g,
    "$1",
  );
  return stripJsxExpressions(out);
}

const FENCED_CODE_RE = /(```[\s\S]*?```)/g;

function stripMdxBody(source) {
  const body = source.replace(/^---\n[\s\S]*?\n---\n/, "");
  const segments = [];
  let lastIndex = 0;

  for (const match of body.matchAll(FENCED_CODE_RE)) {
    if (match.index > lastIndex) {
      segments.push(stripMdxProse(body.slice(lastIndex, match.index)));
    }
    segments.push(match[0]);
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < body.length) {
    segments.push(stripMdxProse(body.slice(lastIndex)));
  }

  return segments.join("").trim();
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

function bulletList(items) {
  return items.map((item) => `- ${item}`).join("\n");
}

function buildLlmsFreeBody() {
  return `${SITE.productSummary}

Positioning: ${SITE.positioning}

Who it's for: ${SITE.icp}

The loop: ${SITE.loop}. Run slash commands explicitly in agent chat — Lamina does not activate passively after install. Slash commands produce \`.lamina/\` artifacts; your coding agent implements app source; Lamina verifies the live build.

${DISAMBIGUATION}

Key facts:

${bulletList([
  ...SITE.whatIsNot,
  `Open-source ${SITE.license} — ${GITHUB}`,
  `Install: \`${INSTALL}\``,
  `Commands: ${SITE.commands.join(", ")}`,
  ...SITE.outcomes,
  "Fits any stack — framework, database, language, UI library, and AI coding tool",
  `Creator: ${SITE.creator.name} (${SITE.creator.url})`,
  `Contact: ${GITHUB}/issues`,
])}`;
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

function buildLlmsPreamble(title) {
  return `# ${title}

> ${SITE.tagline} ${SITE.description}

${buildLlmsFreeBody()}`;
}

const llmsTxt = `${buildLlmsPreamble(SITE.name)}

## Product

- [Homepage](${DOMAIN}): Product overview, positioning, and install command
- [What is Lamina?](${DOMAIN}/docs/concepts/what-is-lamina): Behavior vs pixels, comparisons, core principles
- [HavenStay demo](${DOMAIN}/docs/guides/demo-havenstay): Side-by-side build with and without Lamina
- [Quickstart](${DOMAIN}/docs/getting-started/quickstart): Run the full init → design → implement → verify loop
- [Installation](${DOMAIN}/docs/getting-started/installation): Install in Cursor, Claude Code, Codex, Gemini, or Pi

## Documentation

${pages
  .map((page) => {
    const line = page.description
      ? `- [${page.title}](${page.url}): ${page.description}`
      : `- [${page.title}](${page.url})`;
    return line;
  })
  .join("\n")}

## Optional

- [Full docs dump](${DOMAIN}/llms-full.txt): Complete markdown export of all docs — skip if per-page URLs suffice
- [GitHub](${GITHUB}): Source, issues, and contributions
- [Creator](${SITE.creator.url}): ${SITE.creator.name}
`;

const llmsFullTxt = `${buildLlmsPreamble(`${SITE.name} — full documentation export`)}

---

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

fs.mkdirSync(publicDir, { recursive: true });
fs.writeFileSync(path.join(publicDir, "llms.txt"), llmsTxt);
fs.writeFileSync(path.join(publicDir, "llms-full.txt"), llmsFullTxt);

console.log(
  `Wrote ${pages.length} pages to public/llms.txt and public/llms-full.txt`,
);
