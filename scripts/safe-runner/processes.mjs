import fs from 'node:fs';
import { isExecutionHookEnvironment } from './infrastructure.mjs';

export const MAX_PROCESS_ENVIRONMENT_BYTES = 64 * 1024;

export function processEnvironmentAttestation(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length > MAX_PROCESS_ENVIRONMENT_BYTES) {
    return {
      readable: Buffer.isBuffer(bytes), bounded: false, malformed: false,
      byte_count: Buffer.isBuffer(bytes) ? bytes.length : null,
      names: null, execution_hooks: null,
    };
  }
  if (bytes.length > 0 && bytes.at(-1) !== 0) {
    return {
      readable: true, bounded: true, malformed: true,
      byte_count: bytes.length, names: null, execution_hooks: null,
    };
  }
  const names = [];
  const seen = new Set();
  for (const item of bytes.toString('utf8').split('\0').filter(Boolean)) {
    const separator = item.indexOf('=');
    const name = separator > 0 ? item.slice(0, separator) : '';
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name) || seen.has(name)) {
      return {
        readable: true, bounded: true, malformed: true,
        byte_count: bytes.length, names: null, execution_hooks: null,
      };
    }
    seen.add(name);
    names.push(name);
  }
  names.sort();
  return {
    readable: true, bounded: true, malformed: false,
    byte_count: bytes.length, names,
    execution_hooks: names.filter(isExecutionHookEnvironment),
  };
}

function readProcessEnvironment(pid) {
  let descriptor = null;
  try {
    descriptor = fs.openSync(`/proc/${pid}/environ`,
      fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const bytes = Buffer.alloc(MAX_PROCESS_ENVIRONMENT_BYTES + 1);
    let count = 0;
    while (count < bytes.length) {
      const read = fs.readSync(descriptor, bytes, count, bytes.length - count, null);
      if (read === 0) break;
      count += read;
    }
    return processEnvironmentAttestation(bytes.subarray(0, count));
  } catch {
    return {
      readable: false, bounded: false, malformed: false,
      byte_count: null, names: null, execution_hooks: null,
    };
  } finally {
    if (descriptor !== null) fs.closeSync(descriptor);
  }
}

function parseProcStat(text) {
  const close = text.lastIndexOf(')');
  if (close === -1) return null;
  const fields = text.slice(close + 2).trim().split(/\s+/);
  return {
    state: fields[0],
    ppid: Number(fields[1]),
    start_ticks: fields[19],
  };
}

export function processRecord(pid) {
  try {
    const stat = parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] || 0) * 1024;
    const namespacePids = String(status.match(/^NSpid:\s+(.+)$/m)?.[1] || '')
      .trim().split(/\s+/).filter(Boolean).map(Number);
    const cmdlineBytes = fs.readFileSync(`/proc/${pid}/cmdline`);
    const argv = cmdlineBytes.length <= 8 * 1024
      ? cmdlineBytes.toString('utf8').split('\0').filter(Boolean) : null;
    const cmdline = (argv || []).join(' ');
    const environmentAttestation = readProcessEnvironment(pid);
    let cwd = null;
    try { cwd = fs.realpathSync.native(`/proc/${pid}/cwd`); } catch {}
    let executableIdentity = null;
    try {
      const executable = fs.statSync(`/proc/${pid}/exe`, { bigint: true });
      executableIdentity = {
        dev: String(executable.dev), ino: String(executable.ino), uid: Number(executable.uid),
      };
    } catch {}
    return {
      pid: Number(pid),
      ppid: stat?.ppid ?? null,
      start_ticks: stat?.start_ticks ?? null,
      state: stat?.state ?? null,
      rss_bytes: rss,
      namespace_pids: namespacePids,
      command: cmdline.slice(0, 1_000),
      argv,
      cwd,
      executable_identity: executableIdentity,
      environment_attestation: environmentAttestation,
    };
  } catch {
    return null;
  }
}

export function processIdentity(pid) {
  const record = processRecord(pid);
  return record ? { pid: record.pid, start_ticks: record.start_ticks } : null;
}

export function identityAlive(identity) {
  if (!identity?.pid || !identity?.start_ticks) return false;
  const current = processIdentity(identity.pid);
  return current?.start_ticks === identity.start_ticks;
}

function ancestorPids() {
  const ancestors = new Set([process.pid]);
  let current = process.pid;
  for (let depth = 0; depth < 64; depth += 1) {
    const record = processRecord(current);
    if (!record?.ppid || record.ppid === current) break;
    ancestors.add(record.ppid);
    current = record.ppid;
  }
  return ancestors;
}

const LAMINA_EXECUTABLE_RE = /^(?:lamina(?:\.mjs)?|lamina-(?:linux|darwin|win32)-[^/]+|cocoindex-worker(?:\.exe)?|lamina-cocoindex-worker-[^/]+)$/i;
const WORKER_SCRIPT_RE = /^(?:cocoindex_worker|retrieval_worker)\.py$/i;

function basename(token) {
  return String(token || '').replaceAll('\\', '/').split('/').at(-1);
}

function isLaminaScript(token) {
  const normalized = String(token || '').replaceAll('\\', '/');
  return normalized.endsWith('/graph-runtime/server.mjs')
    || basename(normalized).toLowerCase() === 'lamina.mjs'
    || WORKER_SCRIPT_RE.test(basename(normalized));
}

export function isLaminaProcessCommand(command = '') {
  const tokens = String(command).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const executable = basename(tokens[0]);
  if (LAMINA_EXECUTABLE_RE.test(executable)) return true;
  if (/^(?:node(?:\.exe)?|python(?:3(?:\.\d+)?)?(?:\.exe)?)$/i.test(executable)) {
    return tokens.slice(1).some((token) => !token.startsWith('-') && isLaminaScript(token));
  }
  if (/^uv(?:\.exe)?$/i.test(executable)) {
    const pythonIndex = tokens.findIndex((token, index) => index > 0 && /^python(?:3)?$/i.test(token));
    return pythonIndex >= 0 && isLaminaScript(tokens[pythonIndex + 1]);
  }
  return false;
}

export function existingLaminaProcesses() {
  if (process.platform !== 'linux') return [];
  const ancestors = ancestorPids();
  const found = [];
  for (const name of fs.readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    const pid = Number(name);
    if (ancestors.has(pid)) continue;
    const record = processRecord(pid);
    if (record?.command && isLaminaProcessCommand(record.command)) found.push(record);
  }
  return found.sort((left, right) => left.pid - right.pid);
}

export function readPidList(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim().split(/\s+/).filter(Boolean).map(Number);
  } catch {
    return [];
  }
}

export function allProcessRecords() {
  if (process.platform !== 'linux') return [];
  return fs.readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .map(processRecord)
    .filter(Boolean);
}

export function processGroupRecords(processGroup) {
  if (process.platform !== 'linux') return [];
  return fs.readdirSync('/proc')
    .filter((name) => /^\d+$/.test(name))
    .flatMap((name) => {
      try {
        const text = fs.readFileSync(`/proc/${name}/stat`, 'utf8');
        const close = text.lastIndexOf(')');
        const fields = text.slice(close + 2).trim().split(/\s+/);
        return Number(fields[2]) === processGroup ? [processRecord(Number(name))] : [];
      } catch {
        return [];
      }
    })
    .filter(Boolean);
}

export function descendantRecords(rootPid, records = allProcessRecords()) {
  const byParent = new Map();
  for (const record of records) {
    if (!byParent.has(record.ppid)) byParent.set(record.ppid, []);
    byParent.get(record.ppid).push(record);
  }
  const found = [];
  const queue = [rootPid];
  const seen = new Set(queue);
  while (queue.length) {
    const parent = queue.shift();
    for (const child of byParent.get(parent) || []) {
      if (seen.has(child.pid)) continue;
      seen.add(child.pid);
      found.push(child);
      queue.push(child.pid);
    }
  }
  return found;
}

export function signalIdentity(identity, signal) {
  if (!identityAlive(identity)) return false;
  process.kill(identity.pid, signal);
  return true;
}
