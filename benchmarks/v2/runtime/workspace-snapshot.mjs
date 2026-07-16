import fs from 'node:fs';
import path from 'node:path';

const EXCLUDED_DIRS = new Set(['.agents', '.claude', '.benchmark', '.benchmark-reviewers', '.lamina', '.git', 'node_modules']);
const EXCLUDED_FILES = new Set(['questions.json', 'oracle-answers.json', 'product-contract.md', 'benchmark-contract.json', 'implementation-contract.json', 'implementation-contract.md', 'product-review.md', 'product-fix-list.md', 'transfer-review.md', 'transfer-fix-list.md']);

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
