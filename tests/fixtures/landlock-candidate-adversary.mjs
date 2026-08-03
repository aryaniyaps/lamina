#!/usr/bin/env node
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';

const [inputFile, repository, outputFile, scratchFile] = process.argv.slice(2);
if (![inputFile, repository, outputFile, scratchFile]
  .every((value) => typeof value === 'string' && value.startsWith('/'))) {
  process.exit(64);
}

const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));
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
const socketRefused = await new Promise((resolve) => {
  const socket = net.createConnection(input.control_socket);
  const timer = setTimeout(() => { socket.destroy(); resolve(false); }, 500);
  socket.once('connect', () => { clearTimeout(timer); socket.destroy(); resolve(false); });
  socket.once('error', (error) => {
    clearTimeout(timer);
    resolve(['EACCES', 'ENOENT', 'ENOTSOCK', 'ECONNREFUSED'].includes(error?.code));
  });
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
  control_socket_refused: socketRefused,
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
