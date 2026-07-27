#!/usr/bin/env node
import fs from 'node:fs';
import net from 'node:net';
import { GraphEngine } from './engine.mjs';
import { ERROR, GRAPH_PROTOCOL_VERSION } from './constants.mjs';
import { graphSocketPath, runtimePaths } from './util.mjs';

const cwd = process.argv[2] || process.cwd();
const paths = runtimePaths(cwd);
const socketPath = graphSocketPath(paths);
fs.mkdirSync(paths.runtime_dir, { recursive: true });

function acquireLock() {
  try {
    fs.writeFileSync(paths.lock, `${process.pid}\n`, { flag: 'wx' });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const pid = Number(fs.readFileSync(paths.lock, 'utf8').trim());
    try {
      process.kill(pid, 0);
      process.stderr.write(`graphd already running with pid ${pid}\n`);
      process.exit(2);
    } catch {
      fs.unlinkSync(paths.lock);
      fs.writeFileSync(paths.lock, `${process.pid}\n`, { flag: 'wx' });
    }
  }
}

acquireLock();
if (fs.existsSync(socketPath)) fs.unlinkSync(socketPath);
const engine = new GraphEngine(paths);

function dispatch(request) {
  if (request.method === 'ping') return {
    pid: process.pid,
    database: paths.database,
    protocol_version: GRAPH_PROTOCOL_VERSION,
  };
  if (request.method === 'observation.apply') return engine.applyObservationBatch(request.params || {});
  if (request.method === 'observation.status') return engine.observationStatus(request.params || {});
  if (request.method === 'observation.invalidate') return engine.invalidateObservations(request.params?.product || paths.product);
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
    case 'graph.validate': {
      const view = engine.resolveView(request.params?.at || 'HEAD', context);
      const active = engine.activeIds(view.id);
      return engine.validateSet(active.resources, active.statements, engine.head(view.id)?.source_revision);
    }
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
  socket.setEncoding('utf8');
  socket.on('data', (chunk) => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline);
      buffer = buffer.slice(newline + 1);
      if (!line.trim()) continue;
      let response;
      try {
        const request = JSON.parse(line);
        response = { id: request.id, ok: true, result: dispatch(request) };
      } catch (error) {
        response = {
          id: (() => { try { return JSON.parse(line).id; } catch { return null; } })(),
          ok: false,
          error: {
            code: error.code || ERROR.INTERNAL,
            message: error.message,
            details: error.details || {},
          },
        };
      }
      socket.write(`${JSON.stringify(response)}\n`);
    }
  });
});

function shutdown() {
  server.close(() => {
    try { engine.close(); } catch {}
    try { fs.unlinkSync(socketPath); } catch {}
    try {
      if (Number(fs.readFileSync(paths.lock, 'utf8').trim()) === process.pid) fs.unlinkSync(paths.lock);
    } catch {}
    process.exit(0);
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
server.listen(socketPath, () => fs.chmodSync(socketPath, 0o600));
