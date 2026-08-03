#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import {
  createOracleQuotaRegistry, parseOracleBwrapInfo, parseOracleProcCgroup,
} from '../scripts/safe-runner/oracle-quota-broker.mjs';
import { infrastructureBinaries } from '../scripts/safe-runner/infrastructure.mjs';
import { oracleKeeperBwrapArguments } from '../scripts/safe-runner/oracle-host-profile.mjs';
import { identityAlive, processRecord } from '../scripts/safe-runner/processes.mjs';

if (process.platform !== 'linux') {
  console.log('real repository oracle quota keeper live test skipped outside Linux');
  process.exit(0);
}

const quotaBytes = 64 * 1024;
let infrastructure;
try {
  if (process.argv.slice(2).includes('--simulate-no-trusted-bwrap')) {
    throw Object.assign(new Error(
      'trusted root-owned infrastructure binary is unavailable: bwrap',
    ), { code: 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY' });
  }
  infrastructure = infrastructureBinaries();
} catch (error) {
  if (error?.code !== 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY'
    || error.message !== 'trusted root-owned infrastructure binary is unavailable: bwrap') throw error;
  console.log('real repository oracle quota keeper live test skipped: exact bwrap unavailable');
  process.exit(0);
}
const keeperArguments = oracleKeeperBwrapArguments(quotaBytes);
const child = spawn(infrastructure.bwrap, keeperArguments, {
  cwd: process.cwd(), env: process.env, stdio: ['pipe', 'ignore', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', (chunk) => { stderr = `${stderr}${chunk}`.slice(-8192); });
const outerIdentity = { pid: child.pid, start_ticks: null };
let keeperIdentity = null;
const waitForRecord = async (pid) => {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const record = processRecord(pid);
    if (record) return record;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`process record ${pid} unavailable: ${stderr}`);
};
try {
  let info = '';
  child.stdio[3].setEncoding('utf8');
  for await (const chunk of child.stdio[3]) {
    info += chunk;
    if (Buffer.byteLength(info) > 8 * 1024) throw new Error('live bwrap info exceeded bound');
  }
  const bwrapInfo = parseOracleBwrapInfo(info);
  const keeperPid = bwrapInfo.child_pid;
  const outer = await waitForRecord(child.pid);
  const keeper = await waitForRecord(keeperPid);
  outerIdentity.start_ticks = outer.start_ticks;
  keeperIdentity = { pid: keeper.pid, start_ticks: keeper.start_ticks };
  const registry = createOracleQuotaRegistry({
    cgroup: parseOracleProcCgroup(fs.readFileSync('/proc/self/cgroup', 'utf8')),
    quotaBytes,
    bwrap: infrastructure.bwrap,
    bwrapIdentity: infrastructure.identities.bwrap,
    keeperArguments,
  });
  const proof = registry.register({
    requester: processRecord(process.pid), outer, keeper, bwrap_info: bwrapInfo,
    quota_bytes: quotaBytes,
  });
  assert.equal(proof.schema, 'lamina.safe-runner-oracle-quota-proof/v1');
  assert.equal(proof.non_gradeable, true);
  assert.equal(proof.cgroup, parseOracleProcCgroup(fs.readFileSync('/proc/self/cgroup', 'utf8')));
  assert.equal(proof.keeper.pid, keeper.pid);
  assert.equal(proof.keeper.namespace_pids.at(-1), 1);
  assert.equal(proof.keeper.no_new_privs, 1);
  assert.equal(proof.keeper.effective_capabilities, '0000000000000000');
  assert.equal(proof.filesystem.type_magic, 16_914_836);
  assert.equal(proof.root_filesystem.read_only_write_refused, true);
  assert.ok(proof.filesystem.total_bytes > 0 && proof.filesystem.total_bytes <= quotaBytes + 4096);
  assert.match(proof.namespaces.mount, /^mnt:\[\d+\]$/);
  assert.match(proof.namespaces.user, /^user:\[\d+\]$/);
  assert.equal(proof.nonce.created_read_removed, true);

  const usage = registry.probe({ requester: processRecord(process.pid), exerciseEnospc: true });
  assert.equal(usage.quota_proven, true);
  assert.equal(usage.enospc_proven, true);
  assert.ok(usage.bytes >= 0 && usage.bytes <= quotaBytes);
  const released = registry.release({ requester: processRecord(process.pid) });
  assert.equal(released.mount_fds_released, true);
  assert.deepEqual(released.broker_mount_id_pins, []);

  child.kill('SIGTERM');
  await Promise.race([once(child, 'close'), new Promise((resolve) => setTimeout(resolve, 1_000))]);
  if (identityAlive(keeperIdentity)) {
    try { process.kill(keeperIdentity.pid, 'SIGKILL'); } catch {}
  }
  if (identityAlive(outerIdentity)) {
    try { process.kill(outerIdentity.pid, 'SIGKILL'); } catch {}
  }
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline && (identityAlive(keeperIdentity) || identityAlive(outerIdentity))) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  const finish = registry.finish({ requester: processRecord(process.pid) });
  assert.equal(finish.identities_dead, true);
  assert.equal(finish.anchored_proc_esrch, true);
  assert.equal(finish.proc_anchor_released, true);
} finally {
  try { child.stdin.end(); } catch {}
  if (keeperIdentity && identityAlive(keeperIdentity)) {
    try { process.kill(keeperIdentity.pid, 'SIGKILL'); } catch {}
  }
  if (outerIdentity.start_ticks && identityAlive(outerIdentity)) {
    try { process.kill(outerIdentity.pid, 'SIGKILL'); } catch {}
  }
}

console.log('real repository oracle quota keeper live lifecycle passed');
