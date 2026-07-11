/**
 * Harbor task discovery and registry helpers (canonical LaminaBench tasks).
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const HARBOR_ROOT = path.join(ROOT, 'benchmarks/harbor');
export const HARBOR_TASKS_DIR = path.join(HARBOR_ROOT, 'tasks');
export const REGISTRY_PATH = path.join(HARBOR_ROOT, 'registry.yaml');
export const GOLDENS_DIR = path.join(ROOT, 'benchmarks/goldens');

export function parseHarborDirName(name) {
  const m = name.match(/^(task\d{3})-(control|treatment)$/);
  if (!m) return null;
  return { id: m[1], arm: m[2], harbor_name: name };
}

export function loadRegistry() {
  if (!fs.existsSync(REGISTRY_PATH)) {
    throw new Error(`Missing ${REGISTRY_PATH} — run npm run bench:harbor:sync`);
  }
  const doc = readYamlSync(REGISTRY_PATH);
  return doc.tasks || [];
}

export function writeRegistry(tasks, releaseTag) {
  const lines = ['version: "1.0"', `release_tag: ${releaseTag}`, 'tasks:'];
  for (const t of tasks) {
    lines.push(`  - id: ${t.id}`);
    lines.push(`    category: ${t.category}`);
    lines.push(`    workflow: ${t.workflow}`);
    lines.push(`    fixture: ${t.fixture == null ? 'null' : t.fixture}`);
    lines.push(`    prompt: ${JSON.stringify(t.prompt)}`);
    lines.push(`    runs: ${t.runs ?? 1}`);
  }
  fs.mkdirSync(path.dirname(REGISTRY_PATH), { recursive: true });
  fs.writeFileSync(REGISTRY_PATH, lines.join('\n') + '\n');
}

export function readInstructionForTask(taskId) {
  const p = path.join(HARBOR_TASKS_DIR, `${taskId}-control`, 'instruction.md');
  if (!fs.existsSync(p)) return '';
  return fs.readFileSync(p, 'utf8');
}

export function logicalTasksFromRegistry() {
  return loadRegistry().map((t) => ({
    ...t,
    instruction: readInstructionForTask(t.id),
    paths: {
      instruction: path.relative(ROOT, path.join(HARBOR_TASKS_DIR, `${t.id}-control`, 'instruction.md')),
      golden: path.relative(ROOT, path.join(GOLDENS_DIR, t.id, 'golden.yaml')),
    },
  }));
}

export function listHarborTaskDirs(filterIds = null) {
  if (!fs.existsSync(HARBOR_TASKS_DIR)) return [];
  const names = fs
    .readdirSync(HARBOR_TASKS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((n) => parseHarborDirName(n));
  if (!filterIds) return names.sort();
  return names.filter((n) => filterIds.some((id) => n.startsWith(`${id}-`))).sort();
}

export function harborPath(taskId, arm) {
  return path.join(HARBOR_TASKS_DIR, `${taskId}-${arm}`);
}
