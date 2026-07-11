/**
 * Extract scoring artifact: implemented product source (control post-implement, treatment post-fix).
 * Excludes .lamina/ and bench process markdown.
 */
import fs from 'node:fs';
import path from 'node:path';

const MAX_ARTIFACT_CHARS = 48_000;
const MAX_FILE_BYTES = 32_000;

const SKIP_DIRS = new Set([
  '.lamina',
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.claude',
  '.codex',
  '.opencode',
  'coverage',
  '__pycache__',
  '.venv',
  'vendor',
  '.turbo',
  '.cache',
  '.pnpm-store',
]);

const SKIP_ROOT_FILES = new Set([
  'bench-context.md',
  'bench-plan.md',
  'bench-product-brief.md',
  'bench-audit-report.md',
  'bench-post-verify-report.md',
]);

const SOURCE_EXT = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.py',
  '.go',
  '.rs',
  '.java',
  '.kt',
  '.swift',
  '.vue',
  '.svelte',
  '.sql',
  '.prisma',
  '.graphql',
  '.rb',
  '.php',
  '.cs',
  '.html',
]);

function pathPriority(rel) {
  if (/^(src|app|lib|pkg|internal|server|api)\//.test(rel)) return 0;
  if (/(^|\/)test(s)?\//i.test(rel) || /\.(test|spec)\./i.test(rel)) return 2;
  return 1;
}

function walkImplementation(dir, prefix, out) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      walkImplementation(abs, rel, out);
      continue;
    }
    if (!prefix && SKIP_ROOT_FILES.has(entry.name)) continue;
    const ext = path.extname(entry.name).toLowerCase();
    if (!SOURCE_EXT.has(ext)) continue;
    try {
      const stat = fs.statSync(abs);
      if (stat.size > MAX_FILE_BYTES) continue;
      const text = fs.readFileSync(abs, 'utf8');
      if (!text.trim()) continue;
      out.push({ rel, text });
    } catch {
      /* skip unreadable */
    }
  }
}

/** List scored implementation source paths in workspace. */
export function listImplementationFiles(workspace) {
  const files = [];
  walkImplementation(workspace, '', files);
  return files.map((f) => f.rel);
}

/** True when artifact contains bundled source, not stdout fallback or empty capture. */
export function isArtifactValid(artifact) {
  return Boolean(artifact) && /Captured \d+ source file\(s\):/.test(artifact);
}

/** Bundle application source from the workspace. */
export function captureImplementationArtifact(workspace, agentOutput) {
  const files = [];
  walkImplementation(workspace, '', files);
  files.sort((a, b) => pathPriority(a.rel) - pathPriority(b.rel) || a.rel.localeCompare(b.rel));

  const parts = ['# LaminaBench implementation capture\n'];
  const included = [];
  let total = parts[0].length;

  for (const file of files) {
    const block = `## ${file.rel}\n\`\`\`\n${file.text}\n\`\`\`\n\n`;
    if (total + block.length > MAX_ARTIFACT_CHARS) break;
    parts.push(block);
    total += block.length;
    included.push(file.rel);
  }

  if (included.length) {
    const preview = included.slice(0, 10).join(', ');
    parts.splice(
      1,
      0,
      `Captured ${included.length} source file(s): ${preview}${included.length > 10 ? ', …' : ''}\n\n`
    );
  } else if (agentOutput?.trim()) {
    parts.push(
      `## agent_stdout (no source files found)\n\`\`\`\n${agentOutput.trim().slice(0, 12_000)}\n\`\`\`\n\n`
    );
  }

  let out = parts.join('');
  if (out.length > MAX_ARTIFACT_CHARS) {
    out = out.slice(0, MAX_ARTIFACT_CHARS) + '\n\n[truncated for scoring]';
  }
  return out;
}
