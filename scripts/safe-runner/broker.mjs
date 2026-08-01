import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { TIER_ORDER } from './constants.mjs';

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
    runtime = path.resolve(root, String(git.stdout || '').trim(), 'lamina');
    if (path.resolve(request.runtime_dir) !== runtime
      || path.resolve(request.socket) !== path.join(runtime, 'graphd.sock')
      || path.resolve(request.lock) !== path.join(runtime, 'graphd.lock')) refuse('runtime paths do not match the graph root Git common directory');
    stat = fs.lstatSync(runtime);
  } catch (error) { refuse(error.message || 'graph runtime could not be verified'); }
  if (!stat.isDirectory() || stat.isSymbolicLink()
    || (typeof process.getuid === 'function' && stat.uid !== process.getuid())) refuse('graph runtime directory ownership is not physical and same-user');
  const argv = authority.arguments?.(child.pid) || [];
  const sourceIndex = argv.findIndex((argument) =>
    String(argument).replaceAll('\\', '/').endsWith('/graph-runtime/server.mjs'));
  const standaloneIndex = argv.findIndex((argument) => argument === '--graphd');
  const standaloneExecutable = /^(?:lamina|lamina-(?:linux|darwin|win32)-[^/]+)$/i
    .test(path.basename(argv[0] || ''));
  const declaredRoot = sourceIndex >= 0 ? argv[sourceIndex + 1]
    : standaloneIndex >= 0 && standaloneExecutable ? argv[standaloneIndex + 1] : null;
  try {
    if (!declaredRoot || fs.realpathSync.native(declaredRoot) !== root) refuse('graphd argv does not declare the exact graph root');
  } catch (error) { refuse(error.message || 'graphd argv root could not be verified'); }
  return {
    root,
    runtime_dir: runtime,
    runtime_identity: {
      path: runtime, dev: String(stat.dev), ino: String(stat.ino), uid: Number(stat.uid),
    },
    socket: path.join(runtime, 'graphd.sock'),
    lock: path.join(runtime, 'graphd.lock'),
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
