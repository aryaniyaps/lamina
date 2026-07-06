import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

function parseArgs(args) {
  const opts = {
    root: '.lamina/blueprints',
    id: null,
    port: 5173,
    list: false,
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--root' && args[i + 1]) opts.root = args[++i];
    else if (arg === '--id' && args[i + 1]) opts.id = args[++i];
    else if (arg === '--port' && args[i + 1]) opts.port = Number(args[++i]);
    else if (arg === '--list') opts.list = true;
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

  const configPath = path.join(os.tmpdir(), `lamina-blueprint-${opts.port}.json`);
  fs.writeFileSync(
    configPath,
    JSON.stringify({ root, id, port: opts.port }),
  );

  const viteBin = path.join(packageRoot, 'node_modules', 'vite', 'bin', 'vite.js');
  const configFile = path.join(packageRoot, 'preview', 'vite.config.ts');

  console.log(`Lamina Blueprint preview`);
  console.log(`  Blueprint: ${id}`);
  console.log(`  URL:       http://localhost:${opts.port}?id=${id}`);

  const child = spawn(
    process.execPath,
    [viteBin, '--config', configFile, '--port', String(opts.port)],
    {
      cwd: packageRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        SUB_PREVIEW: '1',
        LAMINA_BLUEPRINT_CONFIG: configPath,
      },
    },
  );

  await new Promise((resolve, reject) => {
    child.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`vite exited ${code}`))));
  });
}
