import fs from 'node:fs';
import path from 'node:path';

const FIXED_DIRECTORIES = Object.freeze(['/usr/local/sbin', '/usr/local/bin', '/usr/sbin', '/usr/bin', '/sbin', '/bin']);
export const SAFE_INFRASTRUCTURE_PATH = Object.freeze([
  path.dirname(process.execPath), ...FIXED_DIRECTORIES,
].filter((value, index, values) => values.indexOf(value) === index)).join(path.delimiter);

export const EXECUTION_HOOK_ENVIRONMENT = Object.freeze([
  'LD_PRELOAD', 'LD_AUDIT', 'LD_LIBRARY_PATH', 'NODE_OPTIONS', 'NODE_PATH',
  'BASH_ENV', 'ENV', 'PYTHONPATH', 'PYTHONHOME', 'PERL5OPT', 'PERL5LIB',
  'RUBYOPT', 'RUBYLIB', 'CDPATH', 'GLOBIGNORE', 'SHELLOPTS',
]);

export function trustedHostBinary(name, candidates = FIXED_DIRECTORIES) {
  for (const directory of candidates) {
    const candidate = path.join(directory, name);
    try {
      const stat = fs.statSync(candidate);
      if (stat.isFile() && (stat.mode & 0o111) !== 0) return fs.realpathSync.native(candidate);
    } catch {}
  }
  const error = new Error(`trusted infrastructure binary is unavailable: ${name}`);
  error.code = 'LAMINA_SAFE_INFRASTRUCTURE_IDENTITY';
  throw error;
}

export function infrastructureBinaries() {
  return {
    systemctl: trustedHostBinary('systemctl'),
    systemdRun: trustedHostBinary('systemd-run'),
    bwrap: trustedHostBinary('bwrap'),
    shell: fs.realpathSync.native('/bin/sh'),
    node: fs.realpathSync.native(process.execPath),
  };
}

export function sanitizedEnvironment(...sources) {
  const result = Object.assign({}, ...sources);
  for (const name of EXECUTION_HOOK_ENVIRONMENT) delete result[name];
  result.PATH = SAFE_INFRASTRUCTURE_PATH;
  return result;
}
