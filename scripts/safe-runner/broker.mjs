import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { TIER_ORDER } from './constants.mjs';

const TRUSTED_GRAPHD_SERVER = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../packages/cli/lib/graph-runtime/server.mjs',
);
const TRUSTED_GRAPHD_FIXTURE = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)), '../../tests/fixtures/graph-runtime/server.mjs',
);
const TRUSTED_REPOSITORY_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const TRUSTED_CLI_ROOT = path.join(TRUSTED_REPOSITORY_ROOT, 'packages', 'cli');
const TRUSTED_FIXTURE_ROOT = path.join(TRUSTED_REPOSITORY_ROOT, 'tests', 'fixtures');

function dependencyRoot(start) {
  let current = start;
  while (true) {
    const candidate = path.join(current, 'node_modules');
    if (fs.existsSync(candidate)) return fs.realpathSync.native(candidate);
    const parent = path.dirname(current);
    if (parent === current) throw new Error('safe-runner dependency root is unavailable');
    current = parent;
  }
}

const TRUSTED_DEPENDENCY_ROOT = dependencyRoot(TRUSTED_REPOSITORY_ROOT);

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const TRUSTED_GRAPHD_SERVER_DIGEST = fileDigest(TRUSTED_GRAPHD_SERVER);
const TRUSTED_GRAPHD_FIXTURE_DIGEST = fileDigest(TRUSTED_GRAPHD_FIXTURE);
const CONTROLLER_EXECUTABLE_DIGEST = fileDigest(process.execPath);
const CONTROLLER_EXECUTABLE_NAME = path.basename(process.execPath);
const FORBIDDEN_GRAPHD_ENVIRONMENT = new Set([
  'NODE_OPTIONS', 'NODE_PATH', 'LD_PRELOAD', 'LD_LIBRARY_PATH',
  'DYLD_INSERT_LIBRARIES', 'DYLD_LIBRARY_PATH',
]);

function processEnvironment(pid) {
  const entries = fs.readFileSync(`/proc/${pid}/environ`).toString('utf8').split('\0').filter(Boolean);
  return Object.fromEntries(entries.map((entry) => {
    const separator = entry.indexOf('=');
    return separator === -1 ? [entry, ''] : [entry.slice(0, separator), entry.slice(separator + 1)];
  }));
}

function decodeMountPath(value) {
  return value.replace(/\\([0-7]{3})/g, (_match, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8)));
}

function processPathIsReadOnly(pid, candidate) {
  const target = fs.realpathSync.native(candidate);
  const mounts = fs.readFileSync(`/proc/${pid}/mountinfo`, 'utf8').trim().split('\n')
    .map((line) => {
      const fields = line.split(' ');
      return { mount: decodeMountPath(fields[4] || ''), options: (fields[5] || '').split(',') };
    })
    .filter((entry) => target === entry.mount || target.startsWith(`${entry.mount}/`))
    .sort((left, right) => right.mount.length - left.mount.length);
  return mounts[0]?.options.includes('ro') === true;
}

const sameIdentity = (left, right) => Number(left?.pid) === Number(right?.pid)
  && String(left?.start_ticks || '') === String(right?.start_ticks || '');
const OPERATION_CLAIM_RE = /^([1-9]\d*)-([1-9]\d*)-([a-f0-9]{32})\.json$/;
const pause = (milliseconds) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);

function graphdOperationClaim(runtime, child) {
  const directory = path.join(runtime, 'graphd.operations');
  let directoryStat;
  try { directoryStat = fs.lstatSync(directory); } catch { return null; }
  if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()
    || (typeof process.getuid === 'function' && directoryStat.uid !== process.getuid())) return null;
  const matches = [];
  for (const name of fs.readdirSync(directory)) {
    const match = name.match(OPERATION_CLAIM_RE);
    if (!match || Number(match[1]) !== Number(child.pid)
      || match[2] !== String(child.start_ticks || '')) continue;
    const file = path.join(directory, name);
    try {
      const stat = fs.lstatSync(file);
      const claim = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (stat.isFile() && !stat.isSymbolicLink()
        && (typeof process.getuid !== 'function' || stat.uid === process.getuid())
        && claim.type === 'graphd'
        && Number(claim.pid) === Number(child.pid)
        && String(claim.start_ticks || '') === String(child.start_ticks || '')
        && claim.nonce === match[3]) matches.push(file);
    } catch {}
  }
  return matches.length === 1 ? {
    claim: matches[0],
    directory_identity: {
      path: directory,
      dev: String(directoryStat.dev),
      ino: String(directoryStat.ino),
      uid: Number(directoryStat.uid),
    },
  } : null;
}

function canonicalGraphdRegistration(request, authority, child) {
  const refuse = (message) => { throw new Error(message); };
  if (typeof request.root !== 'string' || !path.isAbsolute(request.root)
    || typeof request.runtime_dir !== 'string' || !path.isAbsolute(request.runtime_dir)
    || typeof request.socket !== 'string' || !path.isAbsolute(request.socket)
    || typeof request.lock !== 'string' || !path.isAbsolute(request.lock)) refuse('paths must be absolute');
  let root;
  let runtime;
  let stat;
  try {
    root = fs.realpathSync.native(request.root);
    const git = spawnSync('git', ['rev-parse', '--git-common-dir'], {
      cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2_000,
    });
    if (git.status !== 0) refuse('graph root is not a readable Git repository');
    runtime = fs.realpathSync.native(path.resolve(root, String(git.stdout || '').trim(), 'lamina'));
    const requestedRuntime = fs.realpathSync.native(request.runtime_dir);
    const requestedSocketParent = fs.realpathSync.native(path.dirname(request.socket));
    const requestedLockParent = fs.realpathSync.native(path.dirname(request.lock));
    if (requestedRuntime !== runtime
      || requestedSocketParent !== runtime || path.basename(request.socket) !== 'graphd.sock'
      || requestedLockParent !== runtime || path.basename(request.lock) !== 'graphd.lock') refuse('runtime paths do not match the graph root Git common directory');
    stat = fs.lstatSync(runtime);
  } catch (error) { refuse(error.message || 'graph runtime could not be verified'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) refuse('graph runtime directory ownership is not physical and same-user');
  const argv = authority.arguments?.(child.pid) || [];
  const environment = authority.environment?.(child.pid) || processEnvironment(child.pid);
  if ([...FORBIDDEN_GRAPHD_ENVIRONMENT].some((name) => Object.hasOwn(environment, name))) {
    refuse('graphd process environment contains a code-injection variable');
  }
  const executable = path.basename(String(argv[0] || ''));
  const sourceScript = String(argv[1] || '').replaceAll('\\', '/');
  let trustedSource = false;
  try {
    const sourceFd = sourceScript.match(/^\/proc\/(?:self|[1-9]\d*)\/fd\/3$/) ? 3 : null;
    const sourceDigest = sourceFd === null ? null
      : authority.openFileDigest?.(child.pid, sourceFd)
        ?? fileDigest(`/proc/${child.pid}/fd/${sourceFd}`);
    const executableDigest = authority.executableDigest?.(child.pid)
      ?? fileDigest(`/proc/${child.pid}/exe`);
    const productionSource = argv.length === 3
      && sourceDigest === TRUSTED_GRAPHD_SERVER_DIGEST;
    const fixtureSource = argv.length === 4
      && sourceDigest === TRUSTED_GRAPHD_FIXTURE_DIGEST
      && ['clean', 'leave-stale', 'exit-stale'].includes(argv[3]);
    const readOnly = (candidate) => authority.pathReadOnly?.(child.pid, candidate)
      ?? processPathIsReadOnly(child.pid, candidate);
    const immutableClosure = readOnly(TRUSTED_CLI_ROOT)
      && readOnly(TRUSTED_DEPENDENCY_ROOT)
      && (!fixtureSource || readOnly(TRUSTED_FIXTURE_ROOT));
    trustedSource = /^(?:node|node\.exe)$/i.test(executable)
      && executableDigest === CONTROLLER_EXECUTABLE_DIGEST
      && immutableClosure
      && (productionSource || fixtureSource);
  } catch {}
  let trustedStandalone = false;
  try {
    trustedStandalone = argv.length === 3 && argv[1] === '--graphd'
      && /^(?:lamina|lamina-(?:linux|darwin|win32)-[^/]+)$/i.test(executable)
      && executable === CONTROLLER_EXECUTABLE_NAME
      && (authority.executableDigest?.(child.pid) ?? fileDigest(`/proc/${child.pid}/exe`))
        === CONTROLLER_EXECUTABLE_DIGEST;
  } catch {}
  const declaredRoot = trustedSource || trustedStandalone ? argv[2] : null;
  try {
    if (!declaredRoot || fs.realpathSync.native(declaredRoot) !== root) refuse('graphd argv does not declare the exact graph root');
  } catch (error) { refuse(error.message || 'graphd argv root could not be verified'); }
  let existingLock = null;
  try { existingLock = JSON.parse(fs.readFileSync(path.join(runtime, 'graphd.lock'), 'utf8')); } catch {}
  if (existingLock && (Number(existingLock.pid) !== Number(child.pid)
    || String(existingLock.start_ticks || '') !== String(child.start_ticks))) {
    refuse('graph runtime lock belongs to a different process identity');
  }
  if (fs.existsSync(path.join(runtime, 'graphd.sock')) && !existingLock) {
    refuse('graph runtime socket exists without a child-owned lock');
  }
  let operation = null;
  const operationDeadline = Date.now() + 500;
  do {
    operation = graphdOperationClaim(runtime, child);
    if (operation) break;
    pause(10);
  } while (Date.now() < operationDeadline);
  if (!operation) refuse('graph runtime does not have exactly one child-owned operation claim');
  return {
    root,
    runtime_dir: runtime,
    runtime_identity: {
      path: runtime, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    },
    socket: path.join(runtime, 'graphd.sock'),
    lock: path.join(runtime, 'graphd.lock'),
    operation_claim: operation.claim,
    operations_identity: operation.directory_identity,
    child_identity: { pid: child.pid, start_ticks: child.start_ticks },
  };
}

export function authorizeBrokerRequest(request, authority) {
  const records = authority.records();
  const requester = records.find((record) => sameIdentity(record, request?.requester));
  if (!requester) return { ok: false, error: 'requester is not an identity-matched member of the supervised scope' };
  if (!authority.unit || !authority.cgroup) {
    return { ok: false, error: 'supervisor has not established a non-empty unit and cgroup' };
  }
  if (request.operation === 'context') {
    const minimum = TIER_ORDER.indexOf(request.minimum_tier || 'small');
    const actual = TIER_ORDER.indexOf(authority.tier);
    if (minimum < 0 || actual < minimum) return { ok: false, error: 'supervised tier is below the requested minimum' };
    return {
      ok: true,
      context: {
        schema: 'lamina.safe-runner-context-proof/v1',
        run_id: authority.runId,
        tier: authority.tier,
        adapter: authority.adapter,
        unit: authority.unit,
        cgroup: authority.cgroup,
        enforcement: authority.enforcement,
      },
    };
  }
  if (request.operation === 'register_graphd') {
    const child = records.find((record) => sameIdentity(record, request.child));
    if (!child) return { ok: false, error: 'managed graphd identity is not in the supervised scope' };
    if (child.ppid !== requester.pid && child.ppid !== 1) {
      return { ok: false, error: 'managed graphd was not spawned by the authorized requester' };
    }
    let registration;
    try { registration = canonicalGraphdRegistration(request, authority, child); }
    catch (error) {
      return { ok: false, error: `managed graphd registration refused: ${error.message}` };
    }
    authority.register({
      ...child,
      ...registration,
    });
    return {
      ok: true,
      registered: {
        pid: child.pid,
        start_ticks: child.start_ticks,
        role: 'graphd',
        ...registration,
      },
    };
  }
  return { ok: false, error: 'unsupported proof-broker operation' };
}

export async function createProofBroker(directory, authority) {
  const socketPath = path.join(directory, 'supervisor.sock');
  const server = net.createServer((socket) => {
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', (chunk) => {
      buffer += chunk;
      if (buffer.length > 8 * 1024) return socket.destroy();
      const newline = buffer.indexOf('\n');
      if (newline === -1) return;
      let response;
      try { response = authorizeBrokerRequest(JSON.parse(buffer.slice(0, newline)), authority); }
      catch (error) { response = { ok: false, error: String(error.message || error).slice(0, 500) }; }
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(socketPath, () => {
      server.off('error', reject);
      fs.chmodSync(socketPath, 0o600);
      resolve();
    });
  });
  return {
    socketPath,
    environment: { LAMINA_SAFE_RUNNER_BROKER: socketPath },
    registrations: authority.registrations,
    async close() {
      await new Promise((resolve) => server.close(resolve));
      try { fs.rmSync(socketPath, { force: true }); } catch {}
    },
  };
}
