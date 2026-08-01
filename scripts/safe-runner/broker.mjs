import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import crypto from 'node:crypto';
import { TIER_ORDER } from './constants.mjs';

const sameScopedIdentity = (record, claimed) => String(record?.start_ticks || '')
  === String(claimed?.start_ticks || '')
  && (Number(record?.pid) === Number(claimed?.pid)
    || record?.namespace_pids?.includes(Number(claimed?.pid)));

const graphdCommand = (command = '') =>
  /(?:^|\s)[^\s]*\/graph-runtime\/server\.mjs(?:\s|$)/.test(command)
  || /(?:^|\s)[^\s]*\/tests\/fixtures\/safe-runner-graphd\/server\.mjs(?:\s|$)/.test(command)
  || /(?:^|\s)--graphd(?:\s|$)/.test(command);

export function authorizeBrokerRequest(request, authority) {
  const records = authority.records();
  const requester = records.find((record) => sameScopedIdentity(record, request?.requester));
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
  if (request.operation === 'reserve_graphd') {
    if (typeof request.socket !== 'string' || !path.isAbsolute(request.socket)
      || typeof request.lock !== 'string' || !path.isAbsolute(request.lock)
      || path.dirname(request.socket) !== path.dirname(request.lock)
      || path.basename(request.socket) !== 'graphd.sock'
      || path.basename(request.lock) !== 'graphd.lock') {
      return { ok: false, error: 'managed graphd reservation requires canonical absolute socket/lock siblings' };
    }
    const reservation = authority.reserve({
      token: crypto.randomBytes(32).toString('hex'),
      requester: { pid: requester.pid, start_ticks: requester.start_ticks },
      socket: path.resolve(request.socket), lock: path.resolve(request.lock),
    });
    return reservation ? { ok: true, reservation: reservation.token }
      : { ok: false, error: 'managed graphd paths were not proven absent and durably reserved' };
  }
  if (request.operation === 'bind_graphd') {
    const reservation = authority.reservations.find((item) => item.token === request.reservation
      && item.requester.pid === requester.pid
      && item.requester.start_ticks === requester.start_ticks);
    if (!reservation) return { ok: false, error: 'managed graphd reservation is missing or requester-bound' };
    const child = records.find((record) => sameScopedIdentity(record, request.child));
    if (!child || !graphdCommand(child.command)) {
      return { ok: false, error: 'managed graphd identity/command is not an in-scope graphd process' };
    }
    if (child.ppid !== requester.pid && child.ppid !== 1) {
      return { ok: false, error: 'managed graphd was not spawned by the authorized requester' };
    }
    const registered = authority.bind({
      ...child,
      namespace_pid: Number(request.child.pid),
      socket: reservation.socket,
      lock: reservation.lock,
      reservation: reservation.token,
    });
    if (!registered) return { ok: false, error: 'managed graphd reservation could not be identity-bound' };
    return {
      ok: true,
      registered: {
        pid: child.pid,
        namespace_pid: Number(request.child.pid),
        start_ticks: child.start_ticks,
        role: 'graphd',
        socket: reservation.socket,
        lock: reservation.lock,
      },
    };
  }
  if (request.operation === 'seal_graphd') {
    const reservation = authority.reservations.find((item) => item.token === request.reservation
      && ((item.requester.pid === requester.pid
        && item.requester.start_ticks === requester.start_ticks)
        || sameScopedIdentity(requester, item.bound)));
    if (!reservation?.bound) return { ok: false, error: 'managed graphd reservation is not child-bound' };
    const child = records.find((record) => sameScopedIdentity(record, reservation.bound));
    if (!child || !graphdCommand(child.command)) {
      return { ok: false, error: 'managed graphd child disappeared or changed before object sealing' };
    }
    const sealed = authority.seal({ reservation: reservation.token });
    return sealed ? { ok: true, sealed }
      : { ok: false, error: 'managed graphd socket/lock objects could not be identity-sealed' };
  }
  return { ok: false, error: 'unsupported proof-broker operation' };
}

export async function createProofBroker(directory, authority) {
  const socketPath = path.join(directory, 'supervisor.sock');
  const connections = new Set();
  const server = net.createServer((socket) => {
    connections.add(socket);
    socket.once('close', () => connections.delete(socket));
    socket.on('error', () => {});
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
      // A requester can die between connect and newline/response. Destroy all
      // accepted sockets before closing the listener so finalization cannot be
      // held indefinitely by a half-open proof request from a killed scope.
      for (const socket of connections) socket.destroy();
      await new Promise((resolve) => {
        let settled = false;
        const finish = () => {
          if (settled) return;
          settled = true;
          clearTimeout(deadline);
          resolve();
        };
        const deadline = setTimeout(finish, 500);
        server.close(finish);
      });
      try { fs.rmSync(socketPath, { force: true }); } catch {}
    },
  };
}
