import fs from 'node:fs';

function parseProcStat(text) {
  const close = text.lastIndexOf(')');
  if (close === -1) return null;
  const fields = text.slice(close + 2).trim().split(/\s+/);
  return {
    state: fields[0],
    ppid: Number(fields[1]),
    process_group: Number(fields[2]),
    start_ticks: fields[19],
  };
}

export function processRecord(pid) {
  try {
    const stat = parseProcStat(fs.readFileSync(`/proc/${pid}/stat`, 'utf8'));
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = Number(status.match(/^VmRSS:\s+(\d+)\s+kB$/m)?.[1] || 0) * 1024;
    const cmdline = fs.readFileSync(`/proc/${pid}/cmdline`).toString('utf8')
      .split('\0').filter(Boolean).join(' ');
    return {
      pid: Number(pid),
      ppid: stat?.ppid ?? null,
      process_group: stat?.process_group ?? null,
      start_ticks: stat?.start_ticks ?? null,
      state: stat?.state ?? null,
      rss_bytes: rss,
      command: cmdline.slice(0, 1_000),
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

function isSourceScript(token) {
  const normalized = String(token || '').replaceAll('\\', '/');
  return /\/(?:packages\/cli|app)\/lib\/graph-runtime\/server\.mjs$/i.test(normalized)
    || basename(normalized).toLowerCase() === 'lamina.mjs'
    || WORKER_SCRIPT_RE.test(basename(normalized));
}

function interpreterScript(tokens, offset = 1) {
  for (let index = offset; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === '--') return tokens[index + 1] || null;
    if (['-e', '--eval', '-p', '--print', '-c', '-m'].includes(token)) return null;
    if (token.startsWith('-')) continue;
    return token;
  }
  return null;
}

export function isLaminaProcessCommand(command = '') {
  const tokens = String(command).trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return false;
  const executable = basename(tokens[0]);
  if (LAMINA_EXECUTABLE_RE.test(executable)) return true;
  if (/^(?:node(?:\.exe)?|python(?:3(?:\.\d+)?)?(?:\.exe)?)$/i.test(executable)) {
    return isSourceScript(interpreterScript(tokens));
  }
  if (/^uv(?:\.exe)?$/i.test(executable)) {
    const pythonIndex = tokens.findIndex((token, index) => index > 0 && /^python(?:3)?$/i.test(token));
    return pythonIndex >= 0 && isSourceScript(interpreterScript(tokens, pythonIndex + 1));
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
