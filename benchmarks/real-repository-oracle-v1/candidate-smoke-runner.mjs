import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertSafeRunnerContext } from '../../packages/cli/lib/safe-runner-context.mjs';
import {
  compileLandlockCandidateLauncher,
  executeLandlockCandidate,
  landlockCandidateFileIdentity,
  landlockCandidateRuntimeClosure,
  queryLandlockCandidateAbi,
} from '../../scripts/safe-runner/landlock-candidate-launcher.mjs';
import { processIdentity } from '../../scripts/safe-runner/processes.mjs';
import {
  CANDIDATE_SMOKE_ADAPTER,
  candidateSmokeAuthority,
  candidateSmokeRecord,
} from './candidate-smoke.mjs';
import {
  parseCandidateRawArtifactBytes,
  serializeCandidatePublicBatch,
} from './candidate-contract.mjs';
import {
  createPersistentScenarioMaterializer,
  persistentMaterializerRecoveryAck,
} from './persistent-materializer.mjs';

const ADAPTER = fileURLToPath(new URL('./candidate-smoke-adapter.mjs', import.meta.url));
const TMPFS_MAGIC = 0x01021994;

function exactRunnerTemporaryAuthority() {
  assertSafeRunnerContext('real-repository candidate smoke');
  const declared = process.env.LAMINA_SAFE_RUNNER_TEMP_DIR;
  if (!declared || declared !== process.env.LAMINA_SAFE_RUNNER_TEMP
    || !path.isAbsolute(declared) || path.resolve(declared) !== declared) {
    throw new Error('candidate smoke requires the exact safe-runner temporary authority');
  }
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(declared);
  if (physical !== declared || !stat.isDirectory() || stat.isSymbolicLink()
    || (stat.mode & 0o077) !== 0 || Number(fs.statfsSync(physical).type) !== TMPFS_MAGIC) {
    throw new Error('candidate smoke temporary authority is not a private bounded tmpfs');
  }
  return physical;
}

function canonicalLine(value) {
  return `${JSON.stringify(value)}\n`;
}

export async function runCandidateSmoke() {
  const temporary = exactRunnerTemporaryAuthority();
  const authority = candidateSmokeAuthority();
  const retainedConstructionAuthorities = [];
  const owner = processIdentity(process.pid);
  if (!owner) throw new Error('candidate smoke cannot bind its materializer recovery owner');
  const materializer = createPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary,
    collection: authority.collection,
    recoveryOwnerIdentity: owner,
    publishRecoveryAuthority: (recoveryAuthority) => {
      if (!recoveryAuthority.root.startsWith(`${temporary}${path.sep}`)) {
        throw new Error('candidate smoke materializer recovery authority escapes outer temporary root');
      }
      retainedConstructionAuthorities.push(structuredClone(recoveryAuthority));
      return persistentMaterializerRecoveryAck(recoveryAuthority);
    },
    maximumPackBytes: 256 * 1024 * 1024,
    maximumSnapshotFiles: 8_192,
    maximumSnapshotBytes: 256 * 1024 * 1024,
  });
  if (retainedConstructionAuthorities.length !== 2
    || retainedConstructionAuthorities[0].root !== retainedConstructionAuthorities[1].root) {
    throw new Error('candidate smoke materializer construction authority was not retained privately');
  }
  const base = await materializer.prepare(authority.scenario, authority.collection);
  const expectedRepositoryState = authority.expected_artifact.rows[0].result.repository_state;
  const lease = await materializer.lease(base, {
    expected_repository_state: expectedRepositoryState,
  });
  const resolved = materializer.resolve(lease);
  const smokeRoot = fs.realpathSync.native(fs.mkdtempSync(
    path.join(temporary, 'candidate-smoke-'),
  ));
  fs.chmodSync(smokeRoot, 0o700);
  const inputFile = path.join(smokeRoot, 'public-input.json');
  const outputFile = path.join(smokeRoot, 'candidate-output.json');
  const scratchFile = path.join(smokeRoot, 'candidate-scratch.txt');
  fs.writeFileSync(inputFile, serializeCandidatePublicBatch(authority.public_batch), {
    flag: 'wx', mode: 0o400,
  });
  fs.writeFileSync(outputFile, '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(scratchFile, '', { flag: 'wx', mode: 0o600 });
  const node = landlockCandidateFileIdentity(process.execPath);
  const closure = landlockCandidateRuntimeClosure(node);
  const launcher = compileLandlockCandidateLauncher(temporary);
  let parsed;
  try {
    const abi = queryLandlockCandidateAbi(launcher.fd);
    const execution = await executeLandlockCandidate({
      launcherFd: launcher.fd,
      abi,
      node,
      closure,
      adapter: ADAPTER,
      inputFile,
      repository: resolved.repository,
      outputFile,
      scratchFile,
      timeoutMs: 10_000,
      maximumOutputBytes: 8 * 1024,
    });
    if (execution.exitCode !== 0 || execution.signal !== null
      || execution.stdout !== '' || execution.stderr !== ''
      || execution.descendants_remaining.length !== 0) {
      throw new Error(`candidate smoke nested execution failed: ${JSON.stringify(execution)}`);
    }
    parsed = parseCandidateRawArtifactBytes(
      fs.readFileSync(outputFile), authority.public_batch, CANDIDATE_SMOKE_ADAPTER,
    );
    if (parsed.canonical_sha256 !== authority.expected_result_sha256
      || parsed.canonical_json !== JSON.stringify(authority.expected_artifact)) {
      throw new Error('candidate smoke result differs from deterministic host reconstruction');
    }
  } finally {
    fs.closeSync(launcher.fd);
  }
  const release = await materializer.verifyAndRelease(lease);
  if (!release.quarantine?.startsWith(`${temporary}${path.sep}`)) {
    throw new Error('candidate smoke materializer quarantine escaped outer temporary authority');
  }
  const record = candidateSmokeRecord({
    authority,
    candidate_result_sha256: parsed.canonical_sha256,
    lease: {
      provenance_digest: lease.provenance_digest,
      start_digest: lease.start_digest,
    },
    release: {
      end_digest: release.end_digest,
      cleanup_verified: release.cleanup_verified,
      terminal_disposition: release.terminal_disposition,
    },
    repository_unchanged: true,
  });
  process.stdout.write(canonicalLine(record));
}
