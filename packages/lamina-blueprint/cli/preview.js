import fs from 'node:fs';
import path from 'node:path';
import {
  defaultStateFile,
  ensurePreviewRunning,
} from './preview-lifecycle.js';

function parseArgs(args) {
  const opts = {
    root: '.lamina/blueprints',
    id: null,
    port: 5173,
    list: false,
    ensure: false,
    open: false,
    stateFile: null,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' && args[i + 1]) opts.root = args[++i];
    else if (arg === '--id' && args[i + 1]) opts.id = args[++i];
    else if (arg === '--port' && args[i + 1]) opts.port = Number(args[++i]);
    else if (arg === '--state-file' && args[i + 1]) opts.stateFile = args[++i];
    else if (arg === '--list') opts.list = true;
    else if (arg === '--ensure') opts.ensure = true;
    else if (arg === '--open') opts.open = true;
  }

  return opts;
}

function listBlueprints(root) {
  const abs = path.resolve(root);
  if (!fs.existsSync(abs)) {
    console.log('No blueprints directory:', abs);
    return;
  }

  const entries = fs
    .readdirSync(abs, { withFileTypes: true })
    .filter((d) => d.isDirectory());

  if (!entries.length) {
    console.log('No blueprints in', abs);
    return;
  }

  for (const entry of entries) {
    const metaPath = path.join(abs, entry.name, 'meta.yaml');
    let title = entry.name;
    let status = 'unknown';
    if (fs.existsSync(metaPath)) {
      const meta = fs.readFileSync(metaPath, 'utf8');
      const titleMatch = meta.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      const statusMatch = meta.match(/^status:\s*(\w+)\s*$/m);
      if (titleMatch) title = titleMatch[1];
      if (statusMatch) status = statusMatch[1];
    }
    console.log(`${entry.name}\t${status}\t${title}`);
  }
}

export async function runPreview(args) {
  const opts = parseArgs(args);
  const root = path.resolve(opts.root);

  if (opts.list) {
    listBlueprints(root);
    return;
  }

  if (!fs.existsSync(root)) {
    throw new Error(`Blueprints root not found: ${root}`);
  }

  let id = opts.id;
  if (!id) {
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    if (!dirs.length) throw new Error(`No blueprints in ${root}`);
    id = dirs[0].name;
  }

  const blueprintDir = path.join(root, id);
  if (!fs.existsSync(blueprintDir)) {
    throw new Error(`Blueprint not found: ${blueprintDir}`);
  }

  const stateFile = opts.stateFile
    ? path.resolve(opts.stateFile)
    : defaultStateFile(root);

  await ensurePreviewRunning({
    root,
    id,
    port: opts.port,
    stateFile,
    open: opts.open,
    foreground: !opts.ensure,
  });
}
