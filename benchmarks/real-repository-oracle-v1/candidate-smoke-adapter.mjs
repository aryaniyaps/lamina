#!/usr/bin/env node
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import dgram from 'node:dgram';
import fs from 'node:fs';
import net from 'node:net';

const EXPECTED_ARGUMENTS = Object.freeze([
  '/proc/self/fd/6', '/proc/self/fd/7', '/proc/self/fd/8', '/proc/self/fd/9',
]);
const [inputFile, repository, outputFile, scratchFile] = process.argv.slice(2);
if (JSON.stringify(process.argv.slice(2)) !== JSON.stringify(EXPECTED_ARGUMENTS)) {
  throw new Error('candidate smoke argv contains non-FD authority');
}

const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]))
    : value;
const digest = (value) => crypto.createHash('sha256')
  .update(typeof value === 'string' ? value : JSON.stringify(canonical(value))).digest('hex');
const denied = (operation, codes = ['EACCES', 'EPERM']) => {
  try { operation(); return false; } catch (error) { return codes.includes(error?.code); }
};
const streamSocketDenied = (options) => new Promise((resolve) => {
  let socket;
  try {
    socket = net.createConnection(options);
    const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
    socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
    socket.once('error', (error) => {
      clearTimeout(timer);
      resolve(error?.code === 'EPERM');
    });
  } catch (error) {
    try { socket?.destroy(); } catch {}
    resolve(error?.code === 'EPERM');
  }
});
const datagramSocketDenied = () => new Promise((resolve) => {
  let socket;
  try {
    socket = dgram.createSocket('udp4');
    const timer = setTimeout(() => { socket.close(); resolve(false); }, 500);
    socket.once('listening', () => { clearTimeout(timer); socket.close(); resolve(false); });
    socket.once('error', (error) => {
      clearTimeout(timer);
      socket.close();
      resolve(error?.code === 'EPERM');
    });
    socket.bind(0, '127.0.0.1');
  } catch (error) {
    try { socket?.close(); } catch {}
    resolve(error?.code === 'EPERM');
  }
});
const childProcessDenied = () => new Promise((resolve) => {
  let child;
  try {
    child = spawn(process.execPath, ['--eval', 'process.exit(0)'], { stdio: 'ignore' });
    child.once('error', (error) => resolve(error?.code === 'EPERM'));
    child.once('spawn', () => { child.kill('SIGKILL'); resolve(false); });
  } catch (error) {
    resolve(error?.code === 'EPERM');
  }
});

const publicBatch = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const controllerPathAbsent = (() => {
  try {
    const commandLine = fs.readFileSync('/proc/self/cmdline', 'utf8');
    return !commandLine.includes('real-repository-oracle-materializer-')
      && !commandLine.includes('lease-') && !commandLine.includes('/tmp/');
  } catch (error) {
    return error?.code === 'EACCES';
  }
})();
const checks = {
  private_controller_read_denied: denied(() => fs.readFileSync('/etc/passwd')),
  proc_metadata_read_denied: denied(() => fs.readFileSync('/proc/self/status')),
  command_line_controller_paths_absent: controllerPathAbsent,
  repository_mutation_denied: denied(() => fs.writeFileSync(
    `${repository}/candidate-mutation`, 'mutated\n',
  )),
  child_process_denied: await childProcessDenied(),
  tcp_network_denied: await streamSocketDenied({ host: '127.0.0.1', port: 9 }),
  udp_network_denied: await datagramSocketDenied(),
  control_socket_denied: await streamSocketDenied('/run/systemd/private'),
  extra_executable_denied: denied(() => fs.readFileSync('/bin/sh')),
};
if (Object.values(checks).some((value) => value !== true)) {
  throw new Error(`candidate smoke sandbox check failed: ${JSON.stringify(checks)}`);
}

fs.writeFileSync(scratchFile, 'bounded candidate scratch\n');
if (fs.readFileSync(scratchFile, 'utf8') !== 'bounded candidate scratch\n') {
  throw new Error('candidate smoke scratch descriptor is not writable');
}
const head = fs.readFileSync(`${repository}/.git/HEAD`, 'utf8').trim();
if (!/^[a-f0-9]{40}$/.test(head)) throw new Error('candidate smoke repository is not detached');
const observations = [{ category: 'personas', path: publicBatch.persona_probe.path }];
const repositoryState = {
  head,
  branch: '(detached)',
  upstream: null,
  ahead: 0,
  behind: 0,
  worktree_role: 'primary',
  changes: [],
};
const adapter = {
  schema: 'lamina.real-repository-oracle-candidate-adapter/v1',
  id: 'lamina.candidate-smoke-adversary',
  version: 1,
  input_format: 'lamina.real-repository-oracle-candidate-batch/v1',
  output_format: 'lamina.real-repository-oracle-candidate-raw/v1',
};
const artifact = canonical({
  schema: 'lamina.real-repository-oracle-candidate-raw/v1',
  public_input_sha256: publicBatch.public_input_sha256,
  adapter,
  persona_probe: {
    schema: 'lamina.real-repository-oracle-persona-probe-evidence/v1',
    input_sha256: publicBatch.persona_probe.content_sha256,
    observations,
    observations_sha256: digest(observations),
  },
  rows: publicBatch.requests.map((row) => ({
    nonce: row.nonce,
    order: row.order,
    result: {
      workflow_outcome: 'ambiguous',
      selected_workflow_ids: [],
      workflow_ranking: [],
      source_ranking: [],
      observations: [],
      obligations: [],
      repository_state: structuredClone(repositoryState),
    },
  })),
});
fs.writeFileSync(outputFile, JSON.stringify(artifact));
