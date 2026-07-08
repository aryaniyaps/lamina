import fs from 'node:fs';
import path from 'node:path';
import {
  defaultStateFile,
  ensurePreviewRunning,
} from './preview-lifecycle.js';
import { readBlueprintRunId } from '../lib/run.mjs';

function parseArgs(args) {
  const opts = {
    root: '.lamina/blueprints',
    id: null,
    runId: null,
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
    else if (arg === '--run' && args[i + 1]) opts.runId = args[++i];
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

function resolveBlueprintFromRun(laminaRoot, runId) {
  const runPath = path.join(laminaRoot, 'runs', runId, 'run.yaml');
  if (!fs.existsSync(runPath)) return null;
  const m = fs.readFileSync(runPath, 'utf8').match(/^blueprint_id:\s*(.+)$/m);
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, '');
}

export async function runPreview(args) {
  const opts = parseArgs(args);
  const root = path.resolve(opts.root);
  const laminaRoot = path.resolve(root, '..');

  if (opts.list) {
    listBlueprints(root);
    return;
  }

  if (!fs.existsSync(root) && !opts.runId) {
    throw new Error(`Blueprints root not found: ${root}`);
  }

  let runId = opts.runId;
  let id = opts.id;

  if (runId && !id) {
    id = resolveBlueprintFromRun(laminaRoot, runId);
  }

  if (!runId && id) {
    runId = readBlueprintRunId(path.join(root, id));
  }

  if (!id && !runId) {
    const dirs = fs
      .readdirSync(root, { withFileTypes: true })
      .filter((d) => d.isDirectory());
    if (!dirs.length) throw new Error(`No blueprints in ${root}`);
    id = dirs[0].name;
    if (!runId) runId = readBlueprintRunId(path.join(root, id));
  }

  if (!runId && !id) {
    throw new Error('Provide --run <run_id> and/or --id <blueprint_id>');
  }

  if (id) {
    const blueprintDir = path.join(root, id);
    if (!fs.existsSync(blueprintDir)) {
      throw new Error(`Blueprint not found: ${blueprintDir}`);
    }
  }

  const stateFile = opts.stateFile
    ? path.resolve(opts.stateFile)
    : defaultStateFile(root);

  await ensurePreviewRunning({
    root,
    id,
    runId,
    port: opts.port,
    stateFile,
    open: opts.open,
    foreground: !opts.ensure,
  });
}
