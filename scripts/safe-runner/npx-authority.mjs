import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_CONFIG_BYTES = 1024 * 1024;
const PROMPTFOO_CONFIG_DIGEST = '9033e19f151b29d8fbc5d6739d5941692ed7f923456c95906d67a00492e1b194';
const AGENT_SKILLS_CONFIG_DIGEST = 'f9fbd91dcd907d555833a8379c76fe2741f87903114f6a4e922c7f855a904f5c';

const CONTRACTS = Object.freeze([
  Object.freeze({
    package_name: 'agent-skills-eval',
    script_name: 'test:eval:portable',
    argv: Object.freeze([
      'agent-skills-eval', '--config', 'evals/agent-skills-eval.yaml',
    ]),
    config_relative: 'evals/agent-skills-eval.yaml',
    config_digest: AGENT_SKILLS_CONFIG_DIGEST,
    omit_direct_optional_dependencies: false,
    launch_admitted: true,
  }),
  Object.freeze({
    package_name: 'promptfoo',
    script_name: 'test:eval:redteam',
    argv: Object.freeze([
      'promptfoo', 'eval', '-c', 'evals/promptfoo/lamina-redteam.yaml',
      '--max-concurrency', '1',
    ]),
    config_relative: 'evals/promptfoo/lamina-redteam.yaml',
    config_digest: PROMPTFOO_CONFIG_DIGEST,
    omit_direct_optional_dependencies: true,
    launch_admitted: false,
    launch_refusal: 'Promptfoo launch authority is budget-refused; produce and review a bounded command-specific dependency artifact before enabling this exact eval command',
  }),
]);

function physicalFileAuthority(repository, relative) {
  const expected = path.join(repository, ...relative.split('/'));
  const physical = fs.realpathSync.native(expected);
  const stat = fs.lstatSync(expected, { bigint: true });
  if (physical !== expected || !stat.isFile() || stat.isSymbolicLink()
    || stat.size > BigInt(MAX_CONFIG_BYTES)) {
    throw new Error(`audited npx config is not a bounded physical repository file: ${relative}`);
  }
  const descriptor = fs.openSync(expected, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (!opened.isFile() || opened.dev !== stat.dev || opened.ino !== stat.ino
      || opened.size !== stat.size || opened.size > BigInt(MAX_CONFIG_BYTES)) {
      throw new Error(`audited npx config changed while opening: ${relative}`);
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    const final = fs.fstatSync(descriptor, { bigint: true });
    if (offset !== Number(opened.size) || final.dev !== opened.dev || final.ino !== opened.ino
      || final.size !== opened.size) {
      throw new Error(`audited npx config changed while reading: ${relative}`);
    }
    return {
      path: expected, digest: crypto.createHash('sha256').update(bytes).digest('hex'),
      size: offset, bytes,
    };
  } finally {
    fs.closeSync(descriptor);
  }
}

export function auditedNpxCommand(repository, command = [], cwd = repository) {
  const physicalRepository = fs.realpathSync.native(repository);
  if (fs.realpathSync.native(cwd) !== physicalRepository) {
    throw new Error('audited npx command must run from the repository root');
  }
  const values = command.map((value) => String(value).replaceAll('\\', '/'));
  if (!/^(?:npx|npx\.cmd)$/i.test(path.basename(values[0] || ''))) {
    throw new Error('audited npx authority requires the npx executable');
  }
  const argv = values.slice(1);
  const contract = CONTRACTS.find((candidate) => candidate.argv.length === argv.length
    && candidate.argv.every((value, index) => value === argv[index]));
  if (!contract) {
    throw new Error('npx command does not match an exact repository package-script argv');
  }
  const configFile = physicalFileAuthority(physicalRepository, contract.config_relative);
  const config = {
    path: configFile.path, digest: configFile.digest, size: configFile.size,
  };
  if (contract.config_digest && config.digest !== contract.config_digest) {
    throw new Error(`audited npx config digest changed: ${contract.config_relative}`);
  }
  const packageFile = physicalFileAuthority(physicalRepository, 'package.json');
  const manifest = JSON.parse(packageFile.bytes.toString('utf8'));
  const script = manifest?.scripts?.[contract.script_name];
  if (typeof script !== 'string' || !script.endsWith(`-- npx ${contract.argv.join(' ')}`)) {
    throw new Error(`audited npx argv no longer matches package script: ${contract.script_name}`);
  }
  const package_manifest = {
    path: packageFile.path, digest: packageFile.digest, size: packageFile.size,
  };
  return Object.freeze({ ...contract, config, package_manifest });
}

export function optionalAuditedNpxCommand(repository, command = [], cwd = repository) {
  try { return auditedNpxCommand(repository, command, cwd); } catch { return null; }
}
