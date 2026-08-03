#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import dgram from 'node:dgram';
import net from 'node:net';

const [inputFile, repository, outputFile, scratchFile] = process.argv.slice(2);
if (![inputFile, repository, outputFile, scratchFile]
  .every((value) => typeof value === 'string' && value.startsWith('/'))) {
  process.exit(64);
}

const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
const highInheritedFdClosed = (() => {
  const prologue = fs.readFileSync(scratchFile, 'utf8');
  const match = prologue.match(/^lamina-fd-seal-canary\/v1:(\d+)\n$/);
  const canaryFd = Number(match?.[1]);
  const direct = fs.fstatSync(9, { bigint: true });
  const alias = fs.statSync(scratchFile, { bigint: true });
  if (!Number.isSafeInteger(canaryFd) || canaryFd < 1025
    || direct.dev !== alias.dev || direct.ino !== alias.ino) return false;
  try { fs.fstatSync(canaryFd); return false; }
  catch (error) { return error?.code === 'EBADF'; }
})();
process.stdout.write('READY\n');
await new Promise((resolve, reject) => {
  process.stdin.once('data', (chunk) => chunk.toString('utf8') === 'G' ? resolve() : reject(
    new Error('candidate release command changed'),
  ));
  process.stdin.once('end', () => reject(new Error('candidate release gate closed')));
});

const refused = (operation) => {
  try { operation(); return false; } catch (error) { return error?.code === 'EACCES'; }
};
const metadataDenialCodes = {};
const metadataRefused = (label, operation) => {
  try { operation(); return false; } catch (error) {
    metadataDenialCodes[label] = error?.code || null;
    return ['EACCES', 'EPERM', 'ENOSYS'].includes(error?.code);
  }
};
const commandLineControllerPathsAbsent = (() => {
  try {
    return !fs.readFileSync('/proc/self/cmdline', 'utf8').includes(input.controller_path);
  } catch (error) {
    return error?.code === 'EACCES';
  }
})();
const socketRefused = await new Promise((resolve) => {
  const socket = net.createConnection(input.control_socket);
  const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
  socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
  socket.once('error', (error) => {
    clearTimeout(timer);
    resolve(['EACCES', 'EPERM', 'ENOENT', 'ENOTSOCK', 'ECONNREFUSED'].includes(error?.code));
  });
});
const tcpSocketRefused = await new Promise((resolve) => {
  const socket = net.createConnection({ host: '127.0.0.1', port: 9 });
  const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
  socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
  socket.once('error', (error) => {
    clearTimeout(timer);
    resolve(error?.code === 'EPERM');
  });
});
const udpSocketRefused = await new Promise((resolve) => {
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

fs.writeFileSync(scratchFile, 'bounded scratch\n');
const childAttempt = await new Promise((resolve) => {
  let child;
  try {
    child = spawn(process.execPath, ['--eval', 'setInterval(() => {}, 60_000)'], {
      stdio: 'ignore',
    });
  } catch (error) {
    resolve({ code: error?.code || null, pid: null });
    return;
  }
  child.once('error', (error) => resolve({ code: error?.code || null, pid: null }));
  child.once('spawn', () => {
    const pid = child.pid;
    child.unref();
    resolve({ code: null, pid });
  });
});
const repositoryFile = `${repository}/visible.txt`;
const fileOwner = fs.statSync(repositoryFile);
const directoryOwner = fs.statSync(repository);
const result = {
  schema: 'lamina.landlock-candidate-adversary-result/v2',
  input_token: input.token,
  repository_text: fs.readFileSync(`${repository}/visible.txt`, 'utf8'),
  scratch_written: fs.readFileSync(scratchFile, 'utf8') === 'bounded scratch\n',
  hidden_read_refused: refused(() => fs.readFileSync(input.hidden_file)),
  repository_mutation_refused: refused(() => fs.writeFileSync(
    `${repository}/candidate-mutation`, 'mutated\n',
  )),
  elsewhere_write_refused: refused(() => fs.writeFileSync(
    input.elsewhere_file, 'escaped\n',
  )),
  proc_read_refused: refused(() => fs.readFileSync('/proc/self/status')),
  command_line_controller_paths_absent: commandLineControllerPathsAbsent,
  high_inherited_fd_closed: highInheritedFdClosed,
  control_socket_refused: socketRefused,
  tcp_socket_refused: tcpSocketRefused,
  udp_socket_refused: udpSocketRefused,
  extra_executable_path_refused: refused(() => fs.writeFileSync(
    input.extra_executable, '#!/bin/sh\nexit 0\n', { mode: 0o700 },
  )),
  file_mode_mutation_refused: metadataRefused(
    'file_mode', () => fs.chmodSync(repositoryFile, 0o600),
  ),
  directory_mode_mutation_refused: metadataRefused(
    'directory_mode', () => fs.chmodSync(repository, 0o755),
  ),
  file_owner_mutation_refused: metadataRefused('file_owner', () => fs.chownSync(
    repositoryFile, fileOwner.uid, fileOwner.gid,
  )),
  directory_owner_mutation_refused: metadataRefused('directory_owner', () => fs.chownSync(
    repository, directoryOwner.uid, directoryOwner.gid,
  )),
  file_time_mutation_refused: metadataRefused('file_time', () => fs.utimesSync(
    repositoryFile, new Date(123456789000), new Date(123456789000),
  )),
  directory_time_mutation_refused: metadataRefused('directory_time', () => fs.utimesSync(
    repository, new Date(123456789000), new Date(123456789000),
  )),
  metadata_denial_codes: metadataDenialCodes,
  child_process_spawn_refused: childAttempt.code === 'EPERM',
  child_process_denial_code: childAttempt.code,
  child_process_spawned_pid: childAttempt.pid,
};
fs.writeFileSync(outputFile, `${JSON.stringify(result)}\n`);
