/* Self-contained source observation backend.  It deliberately talks only to
 * graphd: this module must never open the canonical Ladybug database. */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { digest, canonical, runtimePaths } from '../graph-runtime/util.mjs';

export const OBSERVATION_BACKEND = 'node';

const ignoredNames = new Set(['.git', 'node_modules', '__pycache__', '.next', 'dist', 'build', 'coverage']);
const ignoredSuffixes = ['.venv'];

function unique(values, limit = 100) {
  return [...new Set(values.map((value) => String(value).trim()).filter(Boolean))].sort().slice(0, limit);
}

export function brownfieldSignals(relativePath, content) {
  if (content.subarray(0, 4096).includes(0)) return { categories: [], unsupported: ['binary_content'] };
  let text = content.toString('utf8');
  const truncated = text.length > 1_000_000;
  if (truncated) text = text.slice(0, 1_000_000);
  const suffix = path.posix.extname(relativePath).toLowerCase();
  const basename = path.posix.basename(relativePath).toLowerCase();
  const signals = Object.fromEntries(['entry_points', 'commands', 'routes', 'handlers', 'schemas', 'entities', 'state_transitions', 'permissions', 'events', 'tests', 'documentation', 'personas', 'feature_flags', 'dependencies'].map((key) => [key, []]));
  if (new Set(['main.js', 'main.mjs', 'main.ts', 'main.py', 'index.js', 'index.mjs', 'index.ts', 'app.js', 'app.ts', 'app.py', 'server.js', 'server.ts', 'cli.py', 'manage.py']).has(basename) || text.startsWith('#!')) signals.entry_points.push(relativePath);
  if (`/${relativePath}`.includes('/routes/') || basename.startsWith('route.')) signals.routes.push(relativePath);
  if (['.md', '.mdx', '.rst', '.txt'].includes(suffix)) signals.documentation.push(relativePath);
  if (basename.includes('persona')) signals.personas.push(relativePath);
  if (/(?:^|[/_.-])(?:test|tests|spec|specs)(?:[/_.-]|$)/i.test(relativePath)) signals.tests.push(relativePath);
  if (basename === 'package.json') try {
    const pkg = JSON.parse(text);
    signals.commands.push(...Object.keys(pkg.scripts || {}).map((name) => `npm:${name}`));
    if (typeof pkg.bin === 'string') signals.entry_points.push(`bin:${pkg.bin}`);
    else signals.entry_points.push(...Object.entries(pkg.bin || {}).map(([name, target]) => `bin:${name}:${target}`));
    for (const field of ['dependencies', 'devDependencies', 'peerDependencies']) signals.dependencies.push(...Object.keys(pkg[field] || {}).map((name) => `${field}:${name}`));
  } catch {}
  for (const match of text.matchAll(/\b(?:app|router|server)\s*\.\s*(?:get|post|put|patch|delete|use)\s*\(\s*(["'][^"']+["'])/g)) signals.routes.push(match[1].slice(1, -1));
  for (const match of text.matchAll(/\b(?:function|class|const|let|var|def)\s+([A-Za-z_][A-Za-z0-9_]*(?:handler|controller|resolver|listener|callback))\b/gi)) signals.handlers.push(match[1]);
  for (const match of text.matchAll(/\b(?:interface|type|class|model|schema|enum)\s+([A-Z][A-Za-z0-9_]*)\b/g)) { signals.schemas.push(match[1]); signals.entities.push(match[1]); }
  for (const match of text.matchAll(/\b(?:emit|on|once|addEventListener|dispatchEvent)\s*\(\s*["']([^"']+)["']/g)) signals.events.push(match[1]);
  for (const match of text.matchAll(/\b(?:state|status|phase)\s*(?:=|:)\s*["']?([A-Za-z][A-Za-z0-9_-]*)/gi)) signals.state_transitions.push(`state:${match[1]}`);
  for (const match of text.matchAll(/\b(?:authorize|authorization|permission|permissions|role|roles|canAccess|isAdmin|requireAuth|authGuard)\b/gi)) signals.permissions.push(match[0]);
  for (const match of text.matchAll(/\b(?:FEATURE_[A-Z0-9_]+|featureFlag|feature_flag|flagEnabled|toggle)\b/g)) signals.feature_flags.push(match[0]);
  for (const match of text.matchAll(/\b(?:import\s+.*?\s+from|require|from)\s*\(?\s*["']([^"']+)["']/g)) signals.dependencies.push(match[1]);
  if (/\b(?:describe|it|test)\s*\(/.test(text) || /\b(?:assert|expect)\s*[.(]/.test(text)) signals.tests.push(relativePath);
  const normalized = Object.fromEntries(Object.entries(signals).map(([key, values]) => [key, unique(values)]));
  return { categories: Object.keys(normalized).filter((key) => normalized[key].length).sort(), signals: Object.fromEntries(Object.entries(normalized).filter(([, values]) => values.length)), unsupported: truncated ? ['static_scan_truncated'] : [] };
}

function isIgnored(relative, entry) {
  const pieces = relative.split('/');
  if (pieces.includes('.git') || (pieces[0] === '.lamina' && pieces[1] === 'runs')) return true;
  if (
    (pieces[0] === '.lamina' && ['runtime', 'runtime-cli'].includes(pieces[1])) ||
    (['.agents', '.codex', '.claude', '.opencode'].includes(pieces[0]) && pieces[1] === 'skills')
  ) return true;
  return pieces.some((part) => ignoredNames.has(part) || ignoredSuffixes.some((suffix) => part.startsWith(suffix)) || /^\.venv/.test(part)) || relative.startsWith('benchmarks/results/') || relative.includes('/.vendor-tmp');
}

function files(root, directory = root, output = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    const relative = path.relative(root, full).split(path.sep).join('/');
    if (isIgnored(relative, entry)) continue;
    if (entry.isDirectory()) files(root, full, output);
    else if (entry.isFile()) output.push(relative);
  }
  return output.sort();
}

function readState(statePath) {
  try { return JSON.parse(fs.readFileSync(statePath, 'utf8')); } catch { return { version: 1, generation: null, source_revision: null, records: {} }; }
}

export async function observeNode({ paths, generation, graphRequest, live = false, ignoreDigest, extractorDigest }) {
  const statePath = path.join(paths.cocoindex, 'node-observation-state.json');
  const once = async () => {
    // A live observer must take a fresh Git/source snapshot for each pass;
    // otherwise updates would retain stale source revisions indefinitely.
    const current = runtimePaths(paths.root);
    const snapshot = { product: current.product, source_revision: current.source_revision, source_root: current.root, ignore_policy_digest: ignoreDigest, extractor_set_digest: extractorDigest };
    const previous = readState(statePath);
    const next = {};
    const envelopes = [];
    const fullReconcile = previous.generation !== generation || previous.source_revision !== current.source_revision;
    for (const relative of files(current.root)) {
      let content; try { content = fs.readFileSync(path.join(current.root, relative)); } catch { continue; }
      const contentHash = crypto.createHash('sha256').update(content).digest('hex');
      const payload = { media_type: content.subarray(0, 4096).includes(0) ? 'binary' : 'text', byte_length: content.length, brownfield: brownfieldSignals(relative, content) };
      const extractor = { id: 'lamina.source-file', version: '2' };
      const envelope = { source_snapshot: snapshot, source_key: relative, content_hash: contentHash, path: relative, extractor, payload };
      envelope.id = digest('observation', { snapshot: envelope.source_snapshot, source_key: envelope.source_key, content_hash: envelope.content_hash, extractor: envelope.extractor, payload: envelope.payload });
      next[relative] = { id: envelope.id, fingerprint: digest('fingerprint', canonical(envelope)) };
      if (fullReconcile || previous.records[relative]?.fingerprint !== next[relative].fingerprint) envelopes.push(envelope);
    }
    const deletes = Object.entries(previous.records).filter(([relative]) => !next[relative]).map(([, record]) => record.id);
    if (envelopes.length || deletes.length || fullReconcile) await graphRequest('observation.apply', { snapshot, generation, upserts: envelopes, deletes }, current.root);
    fs.writeFileSync(statePath, `${JSON.stringify({ version: 1, generation, source_revision: current.source_revision, records: next })}\n`, { mode: 0o600 });
    if (process.env.LAMINA_TEST_OBSERVATION_CRASH_AFTER_COMMIT === '1') { const error = new Error('Injected observation crash after graphd commit.'); error.code = 'LAMINA_OBSERVATION_FAILED'; throw error; }
  };
  await once();
  if (!live) return;
  // Portable polling keeps the standalone runtime dependency-free and captures
  // directory additions/deletions that fs.watch misses on several platforms.
  await new Promise((resolve, reject) => {
    const timer = setInterval(() => once().catch((error) => { clearInterval(timer); reject(error); }), 300);
    const stop = () => { clearInterval(timer); resolve(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop);
  });
}
