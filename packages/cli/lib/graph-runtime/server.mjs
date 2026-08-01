#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import crypto from 'node:crypto';
import path from 'node:path';
import { GraphEngine } from './engine.mjs';
import { RetrievalStore } from '../retrieval-runtime/store.mjs';
import { RetrievalEmbedder } from '../retrieval-runtime/embedder.mjs';
import { ERROR, GRAPH_CAPABILITIES, GRAPH_PROTOCOL_VERSION } from './constants.mjs';
import { CLI_VERSION } from '../runtime-identity.mjs';
import {
  ensureAuthToken,
  daemonIdentityIsRunning,
  graphSocketPath,
  parseDaemonLock,
  processIsRunning,
  processStartTicks,
  runtimePaths,
} from './util.mjs';

const cwd = process.argv[2] || process.cwd();
const paths = runtimePaths(cwd);
const socketPath = graphSocketPath(paths);
fs.mkdirSync(paths.runtime_dir, { recursive: true });
const authToken = ensureAuthToken(paths);

function daemonLockIdentity() {
  let startTicks = null;
  if (process.platform === 'linux') {
    try {
      const stat = fs.readFileSync('/proc/self/stat', 'utf8');
      const close = stat.lastIndexOf(')');
      startTicks = stat.slice(close + 2).trim().split(/\s+/)[19] || null;
    } catch {}
  }
  return {
    pid: process.pid,
    start_ticks: startTicks,
    protocol_version: GRAPH_PROTOCOL_VERSION,
    runtime_version: CLI_VERSION,
    capabilities: GRAPH_CAPABILITIES,
  };
}

const OPERATION_CLAIM_RE = /^([1-9]\d*)-([1-9]\d*)-([a-f0-9]{32})\.json$/;

function readOperationClaims() {
  const claims = [];
  for (const name of fs.readdirSync(paths.operations_dir)) {
    const match = name.match(OPERATION_CLAIM_RE);
    if (!match) continue;
    const file = `${paths.operations_dir}/${name}`;
    try {
      const stat = fs.lstatSync(file);
      const value = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (!stat.isFile() || stat.isSymbolicLink()
        || (typeof process.getuid === 'function' && stat.uid !== process.getuid())
        || !['graphd', 'cleanup'].includes(value.type)
        || Number(value.pid) !== Number(match[1])
        || String(value.start_ticks || '') !== match[2]
        || String(value.nonce || '') !== match[3]) continue;
      claims.push({ file, name, value });
    } catch {}
  }
  return claims;
}

function operationClaimAlive(claim) {
  return processStartTicks(claim?.value?.pid) === String(claim?.value?.start_ticks || '');
}

function removeExactOperationClaim(claim) {
  try {
    const current = JSON.parse(fs.readFileSync(claim.file, 'utf8'));
    if (current.type === claim.value.type
      && Number(current.pid) === Number(claim.value.pid)
      && String(current.start_ticks || '') === String(claim.value.start_ticks || '')
      && current.nonce === claim.value.nonce) fs.unlinkSync(claim.file);
  } catch {}
}

let operationClaim = null;

function releaseOperationClaim() {
  if (!operationClaim) return;
  if (operationClaim.portable) {
    try {
      const current = JSON.parse(fs.readFileSync(path.join(operationClaim.directory, 'owner.json'), 'utf8'));
      if (current.pid === process.pid && current.nonce === operationClaim.nonce) {
        fs.rmSync(operationClaim.directory, { recursive: true, force: true });
      }
    } catch {}
    operationClaim = null;
    return;
  }
  removeExactOperationClaim(operationClaim);
  try { fs.rmdirSync(paths.operations_dir); } catch {}
  operationClaim = null;
}

function acquirePortableOperationClaim() {
  const directory = path.join(paths.runtime_dir, 'graphd.startup.lock');
  const nonce = crypto.randomBytes(16).toString('hex');
  try {
    fs.mkdirSync(directory, { mode: 0o700 });
  } catch (error) {
    if (!['EEXIST', 'ENOTEMPTY', 'EPERM'].includes(error.code)) throw error;
    let owner = null;
    try { owner = JSON.parse(fs.readFileSync(path.join(directory, 'owner.json'), 'utf8')); } catch {}
    if (Number.isInteger(owner?.pid) && processIsRunning(owner.pid)) {
      process.stderr.write('graphd runtime has an active portable operation claim; refusing unsafe replacement\n');
    } else {
      process.stderr.write('graphd runtime has a stale portable operation claim; refusing automatic replacement\n');
    }
    process.exit(2);
  }
  fs.writeFileSync(path.join(directory, 'owner.json'), `${JSON.stringify({
    pid: process.pid, nonce, created_at: new Date().toISOString(),
  })}\n`, { flag: 'wx', mode: 0o600 });
  operationClaim = { portable: true, directory, nonce };
}

function acquireOperationClaim() {
  if (process.platform !== 'linux') {
    acquirePortableOperationClaim();
    return;
  }
  fs.mkdirSync(paths.operations_dir, { recursive: true, mode: 0o700 });
  const directory = fs.lstatSync(paths.operations_dir);
  if (!directory.isDirectory() || directory.isSymbolicLink()
    || (typeof process.getuid === 'function' && directory.uid !== process.getuid())) {
    throw new Error('graphd operations path is not a physical same-user directory');
  }
  for (const claim of readOperationClaims()) {
    if (!operationClaimAlive(claim)) removeExactOperationClaim(claim);
  }
  const identity = daemonLockIdentity();
  const nonce = crypto.randomBytes(16).toString('hex');
  const name = `${identity.pid}-${identity.start_ticks}-${nonce}.json`;
  operationClaim = {
    file: `${paths.operations_dir}/${name}`,
    name,
    value: { type: 'graphd', pid: identity.pid, start_ticks: identity.start_ticks, nonce },
  };
  fs.writeFileSync(operationClaim.file, `${JSON.stringify(operationClaim.value)}\n`, {
    flag: 'wx', mode: 0o600,
  });
  const live = readOperationClaims().filter(operationClaimAlive);
  const cleanup = live.find((claim) => claim.value.type === 'cleanup');
  const competingGraphd = live.find((claim) =>
    claim.value.type === 'graphd' && claim.name !== operationClaim.name);
  if (cleanup || competingGraphd) {
    releaseOperationClaim();
    process.stderr.write('graphd runtime has an active operation claim; refusing unsafe replacement\n');
    process.exit(2);
  }
}

function acquireLock() {
  try {
    fs.writeFileSync(paths.lock, `${JSON.stringify(daemonLockIdentity())}\n`, { flag: 'wx', mode: 0o600 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
    if (daemonIdentityIsRunning(lock)
      || (process.platform === 'linux' && !lock?.start_ticks && processIsRunning(lock?.pid))) {
      process.stderr.write(`graphd already running with pid ${lock.pid}\n`);
      process.exit(2);
    }
    fs.unlinkSync(paths.lock);
    fs.writeFileSync(paths.lock, `${JSON.stringify(daemonLockIdentity())}\n`, { flag: 'wx', mode: 0o600 });
  }
}

acquireOperationClaim();
process.on('exit', releaseOperationClaim);
acquireLock();
if (process.platform !== 'win32' && fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
const engine = new GraphEngine(paths);
const retrieval = new RetrievalStore(paths);
const retrievalEmbedder = new RetrievalEmbedder();

function authenticate(request) {
  const actual = Buffer.from(String(request.auth || ''));
  const expected = Buffer.from(authToken);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    const error = new Error('graphd authentication failed.');
    error.code = ERROR.UNAUTHORIZED;
    throw error;
  }
}

async function dispatch(request) {
  if (request.method === 'ping') return {
    pid: process.pid,
    start_ticks: daemonLockIdentity().start_ticks,
    database: paths.database,
    protocol_version: GRAPH_PROTOCOL_VERSION,
    runtime_version: CLI_VERSION,
    capabilities: GRAPH_CAPABILITIES,
  };
  if (request.method === 'shutdown') return { pid: process.pid, shutting_down: true };
  if (request.method === 'observation.apply') return engine.applyObservationBatch(request.params || {});
  if (request.method === 'observation.status') return engine.observationStatus(request.params || {});
  if (request.method === 'observation.invalidate') return engine.invalidateObservations(request.params?.product || paths.product);
  if (request.method === 'retrieval.status') return retrieval.status(request.params || {});
  if (request.method === 'retrieval.apply') return retrieval.apply(request.params || {});
  if (request.method === 'retrieval.query') {
    const params = request.params || {};
    const status = retrieval.status(params);
    const embedding = params.embedding || (await retrievalEmbedder.embed(
      [params.query],
      status.manifest?.model_digest || params.model_digest,
      params.degradation || null,
    ))[0];
    return retrieval.retrievalQuery({ ...params, embedding });
  }
  if (request.method === 'retrieval.invalidate') return retrieval.invalidate(request.params || {});
  const context = engine.currentContext(request.cwd || cwd);
  switch (request.method) {
    case 'status': return engine.status(context);
    case 'session.start': return engine.startSession({ branch: context.branch, source_revision: context.source_revision, id: request.params?.id });
    case 'session.query': return engine.querySession(request.params?.id);
    case 'session.publish': return engine.publishSession(request.params?.id, context.source_revision);
    case 'session.rebase': return engine.rebaseSession(request.params?.id);
    case 'session.abort': return engine.abortSession(request.params?.id);
    case 'resource.propose': return engine.stageResource(request.params?.session, request.params?.resource, 'agent');
    case 'statement.propose': return engine.stageStatement(request.params?.session, request.params?.statement, 'agent');
    case 'resource.retire': return engine.retireResource(request.params?.session, request.params?.ref);
    case 'statement.retire': return engine.retireStatement(request.params?.session, request.params?.id);
    case 'graph.query': return engine.graphQuery(request.params || {}, context);
    case 'graph.diff': return engine.diff(request.params?.base || 'main', request.params?.head || 'HEAD', context);
    case 'graph.validate': return engine.validateView(
      request.params?.at || 'HEAD',
      request.params?.scope || null,
      context,
    );
    case 'design.walk.prepare': return engine.designWalkTask(request.params || {}, context);
    case 'design.walk.record': return engine.recordDesignWalk(request.params || {}, context);
    case 'work.context': return engine.implementationContext(request.params || {}, context);
    case 'graph.backup': return engine.backup(request.params?.output);
    case 'graph.restore': return engine.restore(request.params?.input);
    case 'mission.compile': return engine.compileMissions(request.params || {}, context);
    case 'mission.run': return engine.runMission(request.params || {}, context);
    default: {
      const error = new Error(`Unknown graphd method: ${request.method}`);
      error.code = ERROR.BAD_REQUEST;
      throw error;
    }
  }
}

const server = net.createServer((socket) => {
  let buffer = '';
  let processing = Promise.resolve();
  socket.setEncoding('utf8');
  // A CLI may time out, be interrupted, or stop reading a large response.
  // Socket errors belong to that connection and must never crash graphd while
  // Ladybug has committed state waiting to be checkpointed.
  socket.on('error', () => {
    try { socket.destroy(); } catch {}
  });
  socket.on('data', (chunk) => {
    buffer += chunk;
    processing = processing.then(async () => {
      let newline;
      while ((newline = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newline);
        buffer = buffer.slice(newline + 1);
        if (!line.trim()) continue;
        let response;
        let request;
        try {
          request = JSON.parse(line);
          authenticate(request);
          response = { id: request.id, ok: true, result: await dispatch(request) };
        } catch (error) {
          response = {
            id: request?.id ?? null,
            ok: false,
            error: {
              code: error.code || ERROR.INTERNAL,
              message: error.message,
              details: error.details || {},
            },
          };
        }
        if (!socket.destroyed) socket.write(`${JSON.stringify(response)}\n`);
        if (response.ok && request.method === 'shutdown') {
          socket.end();
          setImmediate(shutdown);
        }
      }
    }).catch(() => {
      try { socket.destroy(); } catch {}
    });
  });
});

function shutdown() {
  server.close(() => {
    try { retrievalEmbedder.close(); } catch {}
    try { retrieval.close(); } catch {}
    try { engine.close(); } catch {}
    if (process.platform !== 'win32') {
      try { fs.unlinkSync(socketPath); } catch {}
    }
    try {
      const lock = parseDaemonLock(fs.readFileSync(paths.lock, 'utf8'));
      if (lock?.pid === process.pid) fs.unlinkSync(paths.lock);
    } catch {}
    releaseOperationClaim();
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(socketPath, () => {
  if (process.platform !== 'win32') fs.chmodSync(socketPath, 0o600);
});
