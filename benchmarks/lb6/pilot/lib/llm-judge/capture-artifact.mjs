/**
 * Bundle sealed candidate source into an Option D–style implementation.md.
 */
import fs from 'node:fs';
import path from 'node:path';

export const MAX_ARTIFACT_CHARS = 96_000;
export const MAX_FILE_BYTES = 48_000;
export const TRUNCATED_FILE_CHARS = 12_000;

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
  '.agents',
  '.cursor',
  '.lb6-abi',
]);

const SKIP_ROOT_FILES = new Set([
  'bench-context.md',
  'bench-plan.md',
  'bench-build-order.md',
  'bench-review.md',
  'bench-verify-list.md',
  'product-plan.md',
  'product-build-order.md',
  'product-review.md',
  'product-verify-list.md',
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
  '.css',
]);

const PATH_PRIORITY = [
  /^app\.mjs$/i,
  /^ui\.mjs$/i,
  /^index\.html$/i,
  /^src\//i,
  /^lib\//i,
  /^components\//i,
];

function pathScore(relPath) {
  for (let i = 0; i < PATH_PRIORITY.length; i += 1) {
    if (PATH_PRIORITY[i].test(relPath)) return i;
  }
  return PATH_PRIORITY.length;
}

function shouldSkipDir(name) {
  return SKIP_DIRS.has(name) || name.startsWith('.');
}

function walkSourceFiles(root) {
  const files = [];
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).split(path.sep).join('/');
      if (entry.isDirectory()) {
        if (!shouldSkipDir(entry.name)) stack.push(full);
        continue;
      }
      if (!entry.isFile()) continue;
      if (SKIP_ROOT_FILES.has(entry.name) && !rel.includes('/')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!SOURCE_EXT.has(ext)) continue;
      files.push({ full, rel });
    }
  }
  return files.sort((a, b) => {
    const scoreDiff = pathScore(a.rel) - pathScore(b.rel);
    if (scoreDiff !== 0) return scoreDiff;
    return a.rel.localeCompare(b.rel);
  });
}

function readFileSnippet(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size > MAX_FILE_BYTES) {
    const buf = Buffer.alloc(Math.min(stat.size, MAX_FILE_BYTES));
    const fd = fs.openSync(filePath, 'r');
    try {
      fs.readSync(fd, buf, 0, buf.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const text = buf.toString('utf8').slice(0, TRUNCATED_FILE_CHARS);
    return `${text}\n\n/* … truncated (${stat.size} bytes) … */\n`;
  }
  return fs.readFileSync(filePath, 'utf8');
}

export function captureArtifact(candidateRoot, { maxChars = MAX_ARTIFACT_CHARS } = {}) {
  const root = path.resolve(candidateRoot);
  if (!fs.existsSync(root) || !fs.statSync(root).isDirectory()) {
    throw new Error(`candidate root missing: ${root}`);
  }
  const files = walkSourceFiles(root);
  const parts = [
    '# Implementation artifact',
    '',
    `Root: \`${root}\``,
    `Files included: ${files.length}`,
    '',
  ];
  let used = parts.join('\n').length;
  const included = [];
  for (const file of files) {
    const header = `\n## ${file.rel}\n\n\`\`\`\n`;
    const footer = '\n```\n';
    let body;
    try {
      body = readFileSnippet(file.full);
    } catch {
      continue;
    }
    const chunk = `${header}${body}${footer}`;
    if (used + chunk.length > maxChars) {
      const remain = maxChars - used - header.length - footer.length - 32;
      if (remain < 200) break;
      parts.push(`${header}${body.slice(0, remain)}\n\n/* … truncated for artifact budget … */${footer}`);
      included.push(file.rel);
      used = maxChars;
      break;
    }
    parts.push(chunk);
    included.push(file.rel);
    used += chunk.length;
  }
  if (!included.length) {
    parts.push('\n_No source files found under candidate root._\n');
  }
  return {
    markdown: parts.join('\n'),
    files: included,
    root,
    chars: Math.min(used, maxChars),
  };
}

export function writeArtifact(candidateRoot, outPath, options = {}) {
  const artifact = captureArtifact(candidateRoot, options);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, artifact.markdown);
  return artifact;
}
