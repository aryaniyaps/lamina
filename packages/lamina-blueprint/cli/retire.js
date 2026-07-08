import fs from 'node:fs';
import path from 'node:path';

function parseArgs(args) {
  const opts = { root: '.lamina/blueprints', id: null };
  const positional = [];

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' && args[i + 1]) opts.root = args[++i];
    else positional.push(arg);
  }

  opts.id = positional[0];
  return opts;
}

export async function runRetire(args) {
  const opts = parseArgs(args);
  if (!opts.id) throw new Error('Usage: lamina-blueprint retire <id> [--root <dir>]');

  const blueprintDir = path.resolve(opts.root, opts.id);
  if (!fs.existsSync(blueprintDir)) {
    throw new Error(`Blueprint not found: ${blueprintDir}`);
  }

  fs.rmSync(blueprintDir, { recursive: true, force: true });
  console.log(`Retired blueprint: ${opts.id}`);
  console.log(`Deleted: ${blueprintDir}`);
  console.log('Durable artifacts per run (run.yaml, report.md) are unchanged.');
}
