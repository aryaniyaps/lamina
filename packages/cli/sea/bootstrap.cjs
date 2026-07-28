/* SEA bootstrap: all executable application files are shipped as SEA assets,
 * extracted to a private, versioned cache, then imported from disk. Native
 * addons cannot be loaded from Node's virtual filesystem. */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getAsset } = require('node:sea');

const manifest = JSON.parse(Buffer.from(getAsset('lamina-manifest')).toString('utf8'));
const cacheBase = process.platform === 'win32'
  ? (process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'))
  : (process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache'));
const runtime = path.join(cacheBase, 'lamina', 'runtime', manifest.version, manifest.target);

function materialize() {
  if (fs.existsSync(path.join(runtime, '.complete'))) return;
  const temporary = `${runtime}.tmp-${process.pid}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  for (const file of manifest.files) {
    const output = path.join(temporary, file.path);
    fs.mkdirSync(path.dirname(output), { recursive: true, mode: 0o700 });
    fs.writeFileSync(output, Buffer.from(getAsset(file.asset)), { mode: file.mode || 0o600 });
  }
  fs.writeFileSync(path.join(temporary, '.complete'), manifest.digest, { mode: 0o600 });
  fs.mkdirSync(path.dirname(runtime), { recursive: true, mode: 0o700 });
  try { fs.renameSync(temporary, runtime); } catch (error) {
    if (!fs.existsSync(path.join(runtime, '.complete'))) throw error;
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

materialize();
process.env.LAMINA_STANDALONE = '1';
// SEA reserves argv[1] for the executable snapshot; user arguments begin at
// argv[2], just as they do for `node script ...`.
const args = process.argv.slice(2);
if (args[0] === '--graphd') {
  process.argv = [process.execPath, path.join(runtime, 'app/lib/graph-runtime/server.mjs'), ...args.slice(1)];
  import(path.join(runtime, 'app/lib/graph-runtime/server.mjs'));
} else {
  process.argv = [process.execPath, path.join(runtime, 'app/bin/lamina.mjs'), ...args];
  import(path.join(runtime, 'app/bin/lamina.mjs'));
}
