#!/usr/bin/env node
/**
 * Seed a ready_to_build run from the bundled minimal template.
 * Usage:
 *   node ./scripts/seed-ready-run.mjs --slug budgeting --problem "..." --outcome "..."
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
function flag(name, fallback = '') {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
}

const slug = flag('slug', 'feature');
const problem = flag('problem', 'User needs a coherent product behavior for the requested feature');
const outcome = flag('outcome', 'Users complete the primary flow with clear recovery paths');
const users = flag('users', 'primary-user')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const templatePath = path.join(HERE, '../templates/minimal-ready-run.json');
const implTemplatePath = path.join(HERE, '../templates/minimal-implement.md');
if (!fs.existsSync(templatePath)) {
  console.error('Missing templates/minimal-ready-run.json — run build-minimal-ready.mjs first');
  process.exit(1);
}

const run = JSON.parse(fs.readFileSync(templatePath, 'utf8'));
run.id = slug;
run.target = slug;
run.intent.problem = problem;
run.intent.outcome = outcome;
run.intent.users = users;
run.status = 'ready_to_build';

const outDir = path.resolve(process.cwd(), '.lamina/runs', slug);
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(path.join(outDir, 'run.json'), JSON.stringify(run, null, 2) + '\n');

let impl = fs.existsSync(implTemplatePath)
  ? fs.readFileSync(implTemplatePath, 'utf8')
  : `# Implement brief — ${slug}\n\n## Must-implement checklist\n- [ ] Primary workflow screens (structural wireframe only)\n- [ ] Empty, failure, and permission states\n- [ ] No visual styling specs (no Tailwind/colors)\n`;
impl = impl.replaceAll('budgeting', slug).replaceAll('household shared budget tracking', problem);
fs.writeFileSync(path.join(outDir, 'implement.md'), impl);

console.log(`Seeded ${path.relative(process.cwd(), outDir)} (status=${run.status})`);
