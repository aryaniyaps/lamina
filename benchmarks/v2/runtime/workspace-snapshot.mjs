import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIRS = new Set(['.agents', '.claude', '.codex', '.benchmark', '.benchmark-review', '.benchmark-reviewers', '.lamina', '.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '.cache', '.turbo', '__pycache__', '.pytest_cache', '.mypy_cache', '.ruff_cache', '.tox', '.venv', 'venv']);
const EXCLUDED_FILES = new Set(['questions.json', 'oracle-answers.json', 'product-discovery.md', 'product-contract.md', 'benchmark-contract.json', 'implementation-contract.json', 'implementation-contract.md', 'product-spec.json', 'product-spec.md', 'product-spec.txt', 'product-review.md', 'product-fix-list.md', 'transfer-review.md', 'transfer-fix-list.md', 'proof-execution-summary.json']);
const GENERATED_REVIEW_DIRS = new Set([
  '.next',
  'dist',
  'build',
  'coverage',
  '.cache',
  '.turbo',
  'artifacts',
  'screenshots',
  'test-results',
  'playwright-report',
  '.test-data',
  'test-data',
  '.runtime-data',
  'runtime-data',
  '.tmp',
  'tmp',
  '.temp',
  'temp',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  '.ruff_cache',
  '.tox',
  '.venv',
  'venv',
]);
const GENERATED_SCREENSHOT = /(?:^screenshot|[-_.](?:desktop|mobile|home))\.(?:png|jpe?g|webp)$/i;
const GENERATED_RUNTIME_DATABASE = /\.(?:sqlite(?:3)?|db)(?:-(?:shm|wal|journal))?$/i;

export function isReviewSourcePath(file) {
  const normalized = String(file).split(path.sep).join('/');
  const parts = normalized.split('/');
  if (parts.some((part) => GENERATED_REVIEW_DIRS.has(part))) return false;
  const basename = parts.at(-1) || '';
  if (basename === 'proof-execution-summary.json') return false;
  if (/\.(?:py[co])$/i.test(basename)) return false;
  if (basename.endsWith('.tsbuildinfo')) return false;
  if (GENERATED_RUNTIME_DATABASE.test(basename)) return false;
  if (GENERATED_SCREENSHOT.test(basename)) return false;
  return true;
}

export function snapshotWorkspace(workspace, destination) {
  const source = path.resolve(workspace);
  const target = path.resolve(destination);
  if (target === source || target.startsWith(`${source}${path.sep}`)) throw new Error('Snapshot destination must be outside the agent workspace');
  fs.rmSync(target, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.cpSync(source, target, {
    recursive: true,
    filter(item) {
      const relative = path.relative(source, item);
      if (!relative) return true;
      const parts = relative.split(path.sep);
      if (parts.some((part) => EXCLUDED_DIRS.has(part))) return false;
      return !EXCLUDED_FILES.has(path.basename(item));
    },
  });
}
