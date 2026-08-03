import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  ORACLE_CACHE_CAPABILITY_MOUNT,
} from '../../scripts/safe-runner/oracle-cache-capability.mjs';
import {
  compileLandlockCandidateLauncher,
  executeLandlockCandidate,
  landlockCandidateFileIdentity,
  landlockCandidateRuntimeClosure,
  queryLandlockCandidateAbi,
} from '../../scripts/safe-runner/landlock-candidate-launcher.mjs';
import { processIdentity } from '../../scripts/safe-runner/processes.mjs';
import {
  CANDIDATE_RAW_MAX_CANONICAL_BYTES,
  parseCandidateRawArtifactBytes,
  readBoundedCandidateOutput,
  serializeCandidatePublicBatch,
} from './candidate-contract.mjs';
import {
  CANDIDATE_LEASE_WORKER_ADAPTER,
  candidateLeaseWorkerAuthority,
  candidateLeaseWorkerRecord,
} from './candidate-lease-worker.mjs';
import {
  createPersistentScenarioMaterializer,
  parseSealedPackedBareCacheCapabilityBytes,
  persistentMaterializerRecoveryAck,
} from './persistent-materializer.mjs';

const ADAPTER = fileURLToPath(new URL('./candidate-smoke-adapter.mjs', import.meta.url));
const TMPFS_MAGIC = 0x01021994;

function exactRunnerTemporaryAuthority() {
  const declared = process.env.LAMINA_SAFE_RUNNER_TEMP_DIR;
  if (!declared || declared !== process.env.LAMINA_SAFE_RUNNER_TEMP
    || !path.isAbsolute(declared) || path.resolve(declared) !== declared) {
    throw new Error('candidate lease worker requires the exact safe-runner temporary authority');
  }
  const physical = fs.realpathSync.native(declared);
  const stat = fs.lstatSync(declared);
  if (physical !== declared || !stat.isDirectory() || stat.isSymbolicLink()
    || (stat.mode & 0o077) !== 0 || Number(fs.statfsSync(physical).type) !== TMPFS_MAGIC) {
    throw new Error('candidate lease worker temporary authority is not a private bounded tmpfs');
  }
  return physical;
}

function readSealedCapabilityBytes() {
  const capabilityPath = ORACLE_CACHE_CAPABILITY_MOUNT;
  const named = fs.lstatSync(capabilityPath, { bigint: true });
  if (!named.isFile() || named.isSymbolicLink()
    || fs.realpathSync.native(capabilityPath) !== capabilityPath) {
    throw new Error('oracle cache capability mount is not an exact physical file');
  }
  const descriptor = fs.openSync(capabilityPath, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
  try {
    const opened = fs.fstatSync(descriptor, { bigint: true });
    if (opened.dev !== named.dev || opened.ino !== named.ino || opened.size !== named.size) {
      throw new Error('oracle cache capability identity changed while opening');
    }
    const bytes = Buffer.alloc(Number(opened.size));
    let offset = 0;
    while (offset < bytes.length) {
      const count = fs.readSync(descriptor, bytes, offset, bytes.length - offset, offset);
      if (count === 0) break;
      offset += count;
    }
    if (offset !== bytes.length) throw new Error('oracle cache capability read is incomplete');
    return parseSealedPackedBareCacheCapabilityBytes(bytes);
  } finally {
    fs.closeSync(descriptor);
  }
}

function canonicalLine(value) {
  return `${JSON.stringify(value)}\n`;
}

function loadLandlockRuntimeClosure(snapshotRepository) {
  const relative = 'benchmarks/real-repository-oracle-v1/.oracle-landlock-runtime-closure-sealed';
  const sealedPath = path.join(snapshotRepository, relative);
  const bytes = fs.readFileSync(sealedPath);
  const closure = JSON.parse(bytes.toString('utf8'));
  if (!closure?.resolver || !Array.isArray(closure?.files) || !closure?.configuration) {
    throw new Error('sealed landlock runtime closure is invalid');
  }
  return closure;
}

export async function runCandidateLeaseWorker(argv = process.argv.slice(2)) {
  const [tier, slot_id, phase] = argv;
  const authority = candidateLeaseWorkerAuthority({ tier, slot_id, phase });
  const temporary = exactRunnerTemporaryAuthority();
  const sealed = readSealedCapabilityBytes();
  if (sealed.manifest.tier !== authority.tier
    || sealed.manifest.commit !== authority.collection.commit
    || sealed.manifest.tree_oid !== authority.collection.tree_oid) {
    throw new Error('oracle cache capability does not match lease worker collection authority');
  }
  const intraPayloadConstructionPublications = [];
  const owner = processIdentity(process.pid);
  if (!owner) throw new Error('candidate lease worker cannot bind its materializer recovery owner');
  const materializer = createPersistentScenarioMaterializer({
    runnerTemporaryRoot: temporary,
    collection: authority.collection,
    recoveryOwnerIdentity: owner,
    sealedCapabilityBytes: Buffer.concat([
      Buffer.from(`${JSON.stringify(sealed.manifest)}\n`, 'utf8'),
      ...sealed.files.map((item) => item.bytes),
    ]),
    publishRecoveryAuthority: (recoveryAuthority) => {
      if (!recoveryAuthority.root.startsWith(`${temporary}${path.sep}`)) {
        throw new Error('candidate lease worker materializer recovery authority escapes temporary root');
      }
      intraPayloadConstructionPublications.push(structuredClone(recoveryAuthority));
      return persistentMaterializerRecoveryAck(recoveryAuthority);
    },
    maximumPackBytes: 256 * 1024 * 1024,
    maximumSnapshotFiles: 8_192,
    maximumSnapshotBytes: 256 * 1024 * 1024,
  });
  if (intraPayloadConstructionPublications.length !== 2) {
    throw new Error('candidate lease worker intra-payload materializer publication was not exact');
  }
  const base = await materializer.prepare(authority.scenario, authority.collection);
  const lease = await materializer.lease(base, {
    expected_repository_state: authority.expected_repository_state,
  });
  const resolved = materializer.resolve(lease);
  const workerRoot = fs.realpathSync.native(fs.mkdtempSync(
    path.join(temporary, 'candidate-lease-worker-'),
  ));
  fs.chmodSync(workerRoot, 0o700);
  const inputFile = path.join(workerRoot, 'public-input.json');
  const outputFile = path.join(workerRoot, 'candidate-output.json');
  const scratchFile = path.join(workerRoot, 'candidate-scratch.txt');
  fs.writeFileSync(inputFile, serializeCandidatePublicBatch(authority.public_batch), {
    flag: 'wx', mode: 0o400,
  });
  fs.writeFileSync(outputFile, '', { flag: 'wx', mode: 0o600 });
  fs.writeFileSync(scratchFile, '', { flag: 'wx', mode: 0o600 });
  const node = landlockCandidateFileIdentity(process.execPath);
  const snapshotRepository = process.env.LAMINA_SAFE_RUNNER_SNAPSHOT_REPOSITORY;
  if (!snapshotRepository || !path.isAbsolute(snapshotRepository)) {
    throw new Error('candidate lease worker requires sealed snapshot repository authority');
  }
  const closure = landlockCandidateRuntimeClosure(
    node, loadLandlockRuntimeClosure(snapshotRepository),
  );
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
      throw new Error(`candidate lease worker nested execution failed: ${JSON.stringify(execution)}`);
    }
    parsed = parseCandidateRawArtifactBytes(
      readBoundedCandidateOutput(outputFile), authority.public_batch, CANDIDATE_LEASE_WORKER_ADAPTER,
    );
  } finally {
    fs.closeSync(launcher.fd);
  }
  const release = await materializer.verifyAndRelease(lease);
  if (!release.quarantine?.startsWith(`${temporary}${path.sep}`)) {
    throw new Error('candidate lease worker materializer quarantine escaped temporary authority');
  }
  const record = candidateLeaseWorkerRecord({
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

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await runCandidateLeaseWorker();
}
