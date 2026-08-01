#!/usr/bin/env node
import net from 'node:net';

const request = JSON.parse(process.argv[2] || '{}');
const socketPath = process.env.LAMINA_SAFE_RUNNER_BROKER;
if (!socketPath) process.exit(66);
const socket = net.createConnection(socketPath);
let buffer = '';
const timer = setTimeout(() => socket.destroy(new Error('proof broker timeout')), 1_000);
socket.setEncoding('utf8');
socket.once('connect', () => socket.write(`${JSON.stringify(request)}\n`));
socket.on('data', (chunk) => {
  buffer += chunk;
  const newline = buffer.indexOf('\n');
  if (newline === -1) return;
  clearTimeout(timer);
  process.stdout.write(buffer.slice(0, newline));
  socket.end();
});
socket.once('error', () => process.exit(67));
