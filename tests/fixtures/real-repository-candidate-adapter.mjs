import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';

const [inputFile, repository, outputFile] = process.argv.slice(2);
const input = JSON.parse(fs.readFileSync(inputFile, 'utf8'));

function refusal(operation) {
  try { operation(); return false; } catch { return true; }
}

async function networkRefused() {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '1.1.1.1', port: 53 });
    const done = (value) => { socket.destroy(); resolve(value); };
    socket.once('connect', () => done(false));
    socket.once('error', () => done(true));
    socket.setTimeout(250, () => done(true));
  });
}

if (input.mode === 'success') {
  const inaccessible = input.inaccessible.map((candidate) => !fs.existsSync(candidate));
  const repositoryMutationRefused = refusal(() =>
    fs.writeFileSync(`${repository}/candidate-mutation`, 'forbidden'));
  const outputSiblingRefused = refusal(() => fs.writeFileSync('/output/sibling', 'forbidden'));
  const nestedUsernsToolAbsent = !fs.existsSync('/usr/bin/unshare')
    && !fs.existsSync('/bin/unshare');
  const mountToolAbsent = !fs.existsSync('/usr/bin/mount') && !fs.existsSync('/bin/mount');
  const hostSocketAbsent = !fs.existsSync(input.host_socket);
  const result = {
    repository_text: fs.readFileSync(`${repository}/observed.txt`, 'utf8'),
    input_token: input.token,
    inaccessible,
    repository_mutation_refused: repositoryMutationRefused,
    output_sibling_refused: outputSiblingRefused,
    environment_seed_absent: input.environment_seeds.every((name) => process.env[name] === undefined),
    environment_keys: Object.keys(process.env).sort(),
    network_refused: await networkRefused(),
    host_socket_absent: hostSocketAbsent,
    nested_userns_tool_absent: nestedUsernsToolAbsent,
    mount_tool_absent: mountToolAbsent,
    hostname: os.hostname(),
  };
  fs.writeFileSync(outputFile, JSON.stringify(result));
} else if (input.mode === 'exact-limit' || input.mode === 'overflow') {
  const size = 16 * 1024 * 1024 + (input.mode === 'overflow' ? 1 : 0);
  fs.writeFileSync(outputFile, Buffer.alloc(size, 0x61));
} else if (input.mode === 'timeout' || input.mode === 'supervisor-death') {
  setInterval(() => {}, 60_000);
} else if (input.mode === 'flood') {
  const chunk = Buffer.alloc(256 * 1024, 0x78);
  setInterval(() => { process.stdout.write(chunk); }, 0);
} else if (input.mode === 'double-fork') {
  const grandchild = `const {spawn}=require('node:child_process');
    spawn('/runtime/loader',['--library-path','/runtime','/runtime/node','-e','setInterval(()=>{},60000)'],
      {detached:true,stdio:'ignore'}).unref(); setInterval(()=>{},60000);`;
  spawn('/runtime/loader', [
    '--library-path', '/runtime', '/runtime/node', '-e', grandchild,
  ], { detached: true, stdio: 'ignore' }).unref();
  setInterval(() => {}, 60_000);
} else {
  throw new Error('unknown candidate sandbox fixture mode');
}
