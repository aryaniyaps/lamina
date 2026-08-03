import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

export const REAL_REPOSITORY_ORACLE_ENTRYPOINT =
  'benchmarks/real-repository-oracle-v1/workload.mjs';
const COMMON = Object.freeze([
  REAL_REPOSITORY_ORACLE_ENTRYPOINT,
  'benchmarks/real-repository-oracle-v1/collection-pins.mjs',
  'benchmarks/runtime-baseline-v1/contract.mjs',
  'benchmarks/runtime-baseline-v1/manifest.json',
  'packages/cli/lib/safe-runner-context.mjs',
  'packages/cli/lib/safe-runner-broker-client.mjs',
  'scripts/safe-runner/git.mjs',
  'scripts/safe-runner/infrastructure.mjs',
]);
export const REAL_REPOSITORY_ORACLE_REVIEW_SOURCE_CLOSURE = Object.freeze([
  ...COMMON, 'benchmarks/real-repository-oracle-v1/inventory-review.mjs',
]);
export const REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE = Object.freeze([
  ...COMMON,
  'benchmarks/real-repository-oracle-v1/materialize.mjs',
  'benchmarks/real-repository-oracle-v1/collection-authority.mjs',
  'benchmarks/real-repository-oracle-v1/inventory-review-receipt.mjs',
  'benchmarks/real-repository-oracle-v1/reviews/inventory-v1.json',
]);
export const REAL_REPOSITORY_ORACLE_DISCOVERY_SOURCE_CLOSURE = Object.freeze([
  ...REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE,
  'benchmarks/real-repository-oracle-v1/case-discovery.mjs',
  'packages/cli/lib/observation-runtime/node.mjs',
  'packages/cli/lib/graph-runtime/util.mjs',
  'scripts/safe-runner/constants.mjs',
  'scripts/safe-runner/redaction.mjs',
  'scripts/safe-runner/report.mjs',
  'scripts/safe-runner/schema/report.schema.json',
]);
export const REAL_REPOSITORY_ORACLE_EVIDENCE_SOURCE_CLOSURE = Object.freeze([
  ...REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE,
  'benchmarks/real-repository-oracle-v1/case-evidence.mjs',
  'benchmarks/real-repository-oracle-v1/reviews/evidence-selection-v1.json',
  'benchmarks/real-repository-oracle-v1/reviewed-selection-identities.mjs',
]);
export const REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_SOURCE_CLOSURE = Object.freeze([
  ...REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE,
  'benchmarks/real-repository-oracle-v1/scenario-verification.mjs',
  'benchmarks/real-repository-oracle-v1/scenario-selection.mjs',
  'benchmarks/real-repository-oracle-v1/reviews/scenario-selection-v1.json',
  'benchmarks/real-repository-oracle-v1/reviewed-selection-identities.mjs',
  'benchmarks/real-repository-oracle-v1/supervisor-cleanup-proof.mjs',
  'scripts/safe-runner/constants.mjs',
  'scripts/safe-runner/redaction.mjs',
  'scripts/safe-runner/report.mjs',
  'scripts/safe-runner/schema/report.schema.json',
  'scripts/safe-runner/real-repository-source-closure.mjs',
  'scripts/safe-runner/source-identity.mjs',
]);
export const REAL_REPOSITORY_ORACLE_HOST_PROBE_SOURCE_CLOSURE = Object.freeze([
  REAL_REPOSITORY_ORACLE_ENTRYPOINT,
  'benchmarks/real-repository-oracle-v1/oracle-host.mjs',
  'scripts/safe-runner/oracle-host-launcher.mjs',
  'scripts/safe-runner/oracle-host-profile.mjs',
]);
export const REAL_REPOSITORY_ORACLE_CANDIDATE_SMOKE_SOURCE_CLOSURE = Object.freeze([
  ...REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_SOURCE_CLOSURE,
  'benchmarks/real-repository-oracle-v1/candidate-smoke-runner.mjs',
  'benchmarks/real-repository-oracle-v1/candidate-smoke-adapter.mjs',
  'benchmarks/real-repository-oracle-v1/candidate-smoke-report.mjs',
  'benchmarks/real-repository-oracle-v1/candidate-smoke.mjs',
  'benchmarks/real-repository-oracle-v1/candidate-contract.mjs',
  'benchmarks/real-repository-oracle-v1/persistent-materializer.mjs',
  'benchmarks/real-repository-oracle-v1/repository-state.mjs',
  'benchmarks/real-repository-oracle-v1/fixture-authority.mjs',
  'benchmarks/real-repository-oracle-v1/case-expectation-review-receipt.mjs',
  'benchmarks/real-repository-oracle-v1/semantic-case-authority.mjs',
  'benchmarks/real-repository-oracle-v1/workflow-seed.mjs',
  'benchmarks/real-repository-oracle-v1/workflows-v1.json',
  'benchmarks/real-repository-oracle-v1/contract.mjs',
  'benchmarks/real-repository-oracle-v1/schema-validation.mjs',
  'benchmarks/real-repository-oracle-v1/schema/fixture.schema.json',
  'benchmarks/real-repository-oracle-v1/schema/result.schema.json',
  'benchmarks/real-repository-oracle-v1/observation-category-authority.mjs',
  'benchmarks/real-repository-oracle-v1/reviews/observation-category-support-v1.json',
  'benchmarks/real-repository-oracle-v1/reviews/case-expectations-v1.json',
  'packages/cli/lib/safe-runner-context.mjs',
  'packages/cli/lib/safe-runner-broker-client.mjs',
  'scripts/safe-runner/landlock-candidate-launcher.mjs',
  'scripts/safe-runner/candidate-smoke-profile.mjs',
  'benchmarks/real-repository-oracle-v1/landlock-candidate-launcher.c',
  'scripts/safe-runner/processes.mjs',
  'scripts/safe-runner/infrastructure.mjs',
]);
export const REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE = Object.freeze([...new Set([
  ...REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE,
  ...REAL_REPOSITORY_ORACLE_DISCOVERY_SOURCE_CLOSURE,
  ...REAL_REPOSITORY_ORACLE_EVIDENCE_SOURCE_CLOSURE,
  ...REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_SOURCE_CLOSURE,
  ...REAL_REPOSITORY_ORACLE_REVIEW_SOURCE_CLOSURE,
  ...REAL_REPOSITORY_ORACLE_HOST_PROBE_SOURCE_CLOSURE,
  ...REAL_REPOSITORY_ORACLE_CANDIDATE_SMOKE_SOURCE_CLOSURE,
])]);
export const REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE_SCHEMA =
  'lamina.safe-runner-real-repository-source-closure/v1';

export function realRepositoryOracleSourceClosure(commandName) {
  const closure = commandName === 'probe-oracle-host'
    ? REAL_REPOSITORY_ORACLE_HOST_PROBE_SOURCE_CLOSURE
    : commandName === 'smoke-candidate-small'
      ? REAL_REPOSITORY_ORACLE_CANDIDATE_SMOKE_SOURCE_CLOSURE
      : commandName === 'review-inventory'
        ? REAL_REPOSITORY_ORACLE_REVIEW_SOURCE_CLOSURE
        : commandName === 'discover-cases'
          ? REAL_REPOSITORY_ORACLE_DISCOVERY_SOURCE_CLOSURE
          : commandName === 'expand-evidence'
            ? REAL_REPOSITORY_ORACLE_EVIDENCE_SOURCE_CLOSURE
            : commandName === 'verify-scenarios'
              ? REAL_REPOSITORY_ORACLE_SCENARIO_VERIFICATION_SOURCE_CLOSURE
              : ['admit-inventory', 'reconstruct-inventory'].includes(commandName)
                ? REAL_REPOSITORY_ORACLE_ADMISSION_SOURCE_CLOSURE : null;
  return closure ? [...closure] : null;
}

export function realRepositoryOracleSourceClosureIdentity(repository, commandName) {
  const closure = realRepositoryOracleSourceClosure(commandName);
  if (!closure) throw new Error('real-repository source closure command is not exact');
  const root = fs.realpathSync.native(repository);
  const rows = closure.map((relative) => {
    const file = path.join(root, relative);
    const named = fs.lstatSync(file, { bigint: true });
    if (!named.isFile() || named.isSymbolicLink() || named.nlink < 1n
      || fs.realpathSync.native(file) !== file) {
      throw new Error(`real-repository source closure member is not physical: ${relative}`);
    }
    const descriptor = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    try {
      const opened = fs.fstatSync(descriptor, { bigint: true });
      if (opened.dev !== named.dev || opened.ino !== named.ino || opened.uid !== named.uid
        || opened.mode !== named.mode || opened.nlink !== named.nlink || opened.size !== named.size) {
        throw new Error(`real-repository source closure member changed while opening: ${relative}`);
      }
      const hash = crypto.createHash('sha256');
      const buffer = Buffer.alloc(1024 * 1024);
      let offset = 0;
      while (offset < Number(opened.size)) {
        const bytes = fs.readSync(descriptor, buffer, 0, buffer.length, offset);
        if (bytes === 0) break;
        hash.update(buffer.subarray(0, bytes));
        offset += bytes;
      }
      const after = fs.fstatSync(descriptor, { bigint: true });
      if (offset !== Number(opened.size) || after.dev !== opened.dev || after.ino !== opened.ino
        || after.uid !== opened.uid || after.mode !== opened.mode || after.nlink !== opened.nlink
        || after.size !== opened.size) {
        throw new Error(`real-repository source closure member changed while reading: ${relative}`);
      }
      return { relative, bytes: Number(opened.size), sha256: hash.digest('hex') };
    } finally { fs.closeSync(descriptor); }
  });
  const entrypoint = rows.find((row) => row.relative === REAL_REPOSITORY_ORACLE_ENTRYPOINT);
  if (!entrypoint || rows.length !== closure.length) {
    throw new Error('real-repository source closure is incomplete');
  }
  return Object.freeze({
    schema: REAL_REPOSITORY_ORACLE_SOURCE_CLOSURE_SCHEMA,
    command: commandName,
    file_count: rows.length,
    total_bytes: rows.reduce((total, row) => total + row.bytes, 0),
    paths_sha256: crypto.createHash('sha256').update(JSON.stringify(closure)).digest('hex'),
    files_sha256: crypto.createHash('sha256').update(JSON.stringify(rows)).digest('hex'),
    entrypoint_bytes: entrypoint.bytes,
    entrypoint_sha256: entrypoint.sha256,
  });
}
