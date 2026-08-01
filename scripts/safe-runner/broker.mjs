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

function fileDigest(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

const sameIdentity = (left, right) => Number(left?.pid) === Number(right?.pid)
  && String(left?.start_ticks || '') === String(right?.start_ticks || '');

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
  const executable = path.basename(String(argv[0] || ''));
  const sourceScript = String(argv[1] || '').replaceAll('\\', '/');
  let trustedSource = false;
  try {
    const sourceDigest = fileDigest(fs.realpathSync.native(argv[1]));
    const productionSource = argv.length === 3 && sourceDigest === fileDigest(TRUSTED_GRAPHD_SERVER);
    const fixtureSource = argv.length === 4 && sourceDigest === fileDigest(TRUSTED_GRAPHD_FIXTURE)
      && ['clean', 'leave-stale', 'exit-stale'].includes(argv[3]);
    trustedSource = /^(?:node|node\.exe)$/i.test(executable)
      && sourceScript.endsWith('/graph-runtime/server.mjs')
      && (productionSource || fixtureSource);
  } catch {}
  const trustedStandalone = argv.length === 3 && argv[1] === '--graphd'
    && /^(?:lamina|lamina-(?:linux|darwin|win32)-[^/]+)$/i.test(executable);
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
  let operationOwner = null;
  try { operationOwner = JSON.parse(fs.readFileSync(path.join(runtime, 'graphd.operation.lock'), 'utf8')); } catch {}
  if (operationOwner && (Number(operationOwner.pid) !== Number(child.pid)
    || String(operationOwner.start_ticks || '') !== String(child.start_ticks))) {
    refuse('graph runtime operation lock belongs to a different process identity');
  }
  return {
    root,
    runtime_dir: runtime,
    runtime_identity: {
      path: runtime, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    },
    socket: path.join(runtime, 'graphd.sock'),
    lock: path.join(runtime, 'graphd.lock'),
    operation_lock: path.join(runtime, 'graphd.operation.lock'),
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
