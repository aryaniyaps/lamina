#!/usr/bin/env node
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const src = path.join(root, 'evals/patches/agent_skill_eval_hooks.py');
const dest = path.join(
  root,
  '.venv-eval/lib/python3.14/site-packages/agent_skill_eval/hooks.py',
);
if (!fs.existsSync(src)) {
  console.error('missing patch source', src);
  process.exit(1);
}
fs.copyFileSync(src, dest);
console.log('Applied ASE hook-prefer patch →', dest);
