#!/usr/bin/env node
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
const result = {
  schema: 'lamina.landlock-candidate-adversary-result/v1',
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
};
fs.writeFileSync(outputFile, `${JSON.stringify(result)}\n`);
