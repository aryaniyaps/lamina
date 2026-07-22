import fs from 'node:fs';
import path from 'node:path';
import {
  CONTRACT_VERSION,
  SUPPORTED_STATUSES,
  assertExactIdSet,
  assertPublicInputsMatchCommit,
  assertUniqueIds,
  buildArmFacts,
  buildArtifactLinks,
  buildControlFacts,
  buildTaskFacts,
  computeProtocolSha256,
  gitCatFileExists,
  hasGitMetadata,
  isCanonicalArtifactUrl,
  isCommitPin,
  isIsoInstant,
  isProtocolHash,
  isPublicTaskBriefPath,
  isSafeRepoRelativePath,
  isSortedById,
  isTrustedRepository,
  loadCorpusManifest,
  resolveRepoRoot,
  stableStringify,
  TRUSTED_REPOSITORY,
} from './web-release-lib.mjs';
import { validateReleaseExactKeys } from './web-release-schema.mjs';

function loadJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertNonEmptyObject(value, label, errors) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length === 0) {
    errors.push(`${label} must be a non-empty object`);
    return false;
  }
  return true;
}

function validatePublishedShape(release, errors) {
  if (!release.publishedAt) {
    errors.push('published release requires publishedAt');
  } else if (!isIsoInstant(release.publishedAt)) {
    errors.push('publishedAt must be a valid ISO-8601 instant');
  }

  if (!release.coverage) {
    errors.push('published release requires coverage');
  } else if (!assertNonEmptyObject(release.coverage, 'coverage', errors)) {
    // recorded above
  } else {
    for (const key of ['tasks', 'arms', 'attemptsPerArm', 'completeCells']) {
      if (typeof release.coverage[key] !== 'number' || release.coverage[key] <= 0) {
        errors.push(`coverage.${key} must be a positive number`);
      }
    }
  }

  if (!release.results) {
    errors.push('published release requires results');
  } else if (!assertNonEmptyObject(release.results, 'results', errors)) {
    // recorded above
  } else {
    if (!assertNonEmptyObject(release.results.aggregate, 'results.aggregate', errors)) {
      // recorded above
    }
    if (!Array.isArray(release.results.perTask) || release.results.perTask.length === 0) {
      errors.push('results.perTask must be a non-empty array');
    }
  }

  errors.push('published release export is not supported in contract version 1.0.0');
}

function validateSortedCollections(release, errors) {
  for (const name of ['arms', 'tasks', 'controls', 'artifacts']) {
    const collection = release[name];
    if (Array.isArray(collection) && collection.length > 0 && !isSortedById(collection)) {
      errors.push(`${name} must be sorted by id`);
    }
  }
}

function validateRuntimeFacts(runtime, errors) {
  if (!runtime?.agent?.trim()) errors.push('runtime.agent is required');
  if (!runtime?.model?.trim()) errors.push('runtime.model is required');
  if (typeof runtime?.attemptsPerArm !== 'number' || runtime.attemptsPerArm <= 0) {
    errors.push('runtime.attemptsPerArm must be a positive number');
  }
  if (typeof runtime?.totalBudgetSecondsPerArm !== 'number' || runtime.totalBudgetSecondsPerArm <= 0) {
    errors.push('runtime.totalBudgetSecondsPerArm must be a positive number');
  }
}

function validateArmFacts(release, errors) {
  if (!Array.isArray(release.arms)) return;
  const runtimeBudget = release.runtime?.totalBudgetSecondsPerArm;
  let matchedBudget = null;

  for (const arm of release.arms) {
    const label = arm.id ?? '(unknown)';
    if (!arm.id?.trim()) errors.push('Arm requires a non-empty id');
    if (!arm.label?.trim()) errors.push(`Arm ${label} requires a non-empty label`);
    if (!arm.description?.trim()) errors.push(`Arm ${label} requires a non-empty description`);
    if (!Array.isArray(arm.workflowSteps) || arm.workflowSteps.length === 0) {
      errors.push(`Arm ${label} requires non-empty workflowSteps`);
    }
    if (!Array.isArray(arm.stepBudgets) || arm.stepBudgets.length === 0) {
      errors.push(`Arm ${label} requires non-empty stepBudgets`);
    }
    if (typeof arm.totalBudgetSeconds !== 'number' || arm.totalBudgetSeconds <= 0) {
      errors.push(`Arm ${label} totalBudgetSeconds must be a positive number`);
    }

    if (Array.isArray(arm.workflowSteps) && Array.isArray(arm.stepBudgets)) {
      if (arm.workflowSteps.length !== arm.stepBudgets.length) {
        errors.push(`Arm ${label} stepBudgets must align with workflowSteps`);
      } else {
        for (const [index, step] of arm.workflowSteps.entries()) {
          const budget = arm.stepBudgets[index];
          if (!budget || budget.step !== step) {
            errors.push(`Arm ${label} stepBudgets must align with workflowSteps`);
            break;
          }
          if (typeof budget.agentTimeoutSeconds !== 'number' || budget.agentTimeoutSeconds <= 0) {
            errors.push(`Arm ${label} step ${step} requires a positive agentTimeoutSeconds`);
          }
          if (typeof budget.verifierTimeoutSeconds !== 'number' || budget.verifierTimeoutSeconds <= 0) {
            errors.push(`Arm ${label} step ${step} requires a positive verifierTimeoutSeconds`);
          }
        }
      }

      const stepSum = arm.stepBudgets.reduce(
        (sum, step) => sum + (typeof step.agentTimeoutSeconds === 'number' ? step.agentTimeoutSeconds : 0),
        0
      );
      if (typeof arm.totalBudgetSeconds === 'number' && arm.totalBudgetSeconds !== stepSum) {
        errors.push(`Arm ${label} totalBudgetSeconds must equal the stepBudgets sum`);
      }
    }

    if (typeof runtimeBudget === 'number' && arm.totalBudgetSeconds !== runtimeBudget) {
      errors.push(`Arm ${label} totalBudgetSeconds must match runtime.totalBudgetSecondsPerArm`);
    }

    if (matchedBudget === null) matchedBudget = arm.totalBudgetSeconds;
    else if (arm.totalBudgetSeconds !== matchedBudget) {
      errors.push(`Arm ${label} totalBudgetSeconds must match other arms`);
    }
  }
}

function validateTaskFacts(tasks, errors) {
  if (!Array.isArray(tasks)) return;
  for (const task of tasks) {
    const label = task.id ?? '(unknown)';
    if (!task.id?.trim()) errors.push('Task requires a non-empty id');
    if (!task.kind?.trim()) errors.push(`Task ${label} requires a non-empty kind`);
    if (!task.stage?.trim()) errors.push(`Task ${label} requires a non-empty stage`);
    if (!task.title?.trim()) errors.push(`Task ${label} requires a non-empty title`);
    if (!task.summary?.trim()) errors.push(`Task ${label} requires a non-empty summary`);
    if (!task.briefPath) {
      errors.push(`Task ${label} requires briefPath`);
    } else if (!isSafeRepoRelativePath(task.briefPath)) {
      errors.push(`Task ${label} briefPath must be a safe repository-relative path`);
    } else if (!isPublicTaskBriefPath(task.id, task.briefPath)) {
      errors.push(`Task ${label} briefPath must be benchmarks/corpus/${task.id}/brief.md`);
    }
  }
}

function validateControlFacts(controls, errors) {
  if (!Array.isArray(controls)) return;
  for (const control of controls) {
    const label = control.id ?? '(unknown)';
    if (!control.id?.trim()) errors.push('Control requires a non-empty id');
    if (!control.label?.trim()) errors.push(`Control ${label} requires a non-empty label`);
    if (!control.description?.trim()) errors.push(`Control ${label} requires a non-empty description`);
  }
}

function validateArtifactFacts(release, errors, { root, verifyGitArtifacts }) {
  if (!Array.isArray(release.artifacts) || !isCommitPin(release.source?.commit)) return;

  for (const artifact of release.artifacts) {
    const label = artifact.id ?? '(unknown)';
    if (!artifact.id?.trim()) errors.push('Artifact requires a non-empty id');
    if (!artifact.label?.trim()) errors.push(`Artifact ${label} requires a non-empty label`);
    if (!artifact.role?.trim()) errors.push(`Artifact ${label} requires a non-empty role`);
    if (!artifact.path?.trim()) errors.push(`Artifact ${label} requires a non-empty path`);
    if (!artifact.url?.trim()) errors.push(`Artifact ${label} requires a non-empty url`);
    if (artifact.path && !isSafeRepoRelativePath(artifact.path)) {
      errors.push(`Artifact ${label} path must be a safe repository-relative path`);
    }
    if (
      artifact.url &&
      artifact.path &&
      !isCanonicalArtifactUrl(
        artifact.url,
        release.source.repository,
        release.source.commit,
        artifact.path
      )
    ) {
      errors.push(`Artifact ${label} URL must equal the canonical blob URL for its declared path`);
    }
    if (root && verifyGitArtifacts && hasGitMetadata(root) && artifact.path) {
      const exists = gitCatFileExists(root, release.source.commit, artifact.path);
      if (exists !== true) {
        errors.push(
          `Artifact ${label} path missing at commit ${release.source.commit}: ${artifact.path}`
        );
      }
    }
  }
}

export function loadReleaseManifest(manifestPath) {
  const manifest = loadJson(manifestPath);
  if (manifest.manifestVersion !== '1') {
    throw new Error(`Unsupported manifestVersion: ${manifest.manifestVersion ?? '(missing)'}`);
  }
  if (!SUPPORTED_STATUSES.has(manifest.status)) {
    throw new Error(`Unsupported manifest status: ${manifest.status ?? '(missing)'}`);
  }
  if (!manifest.releaseKey) throw new Error('manifest.releaseKey is required');
  if (!manifest.benchmarkId) throw new Error('manifest.benchmarkId is required');
  if (!manifest.benchmarkVersion) throw new Error('manifest.benchmarkVersion is required');
  if (!manifest.generatedAt) throw new Error('manifest.generatedAt is required');
  if (!isIsoInstant(manifest.generatedAt)) {
    throw new Error('manifest.generatedAt must be a valid ISO-8601 instant');
  }
  if (!manifest.source?.repository) throw new Error('manifest.source.repository is required');
  if (!isTrustedRepository(manifest.source.repository)) {
    throw new Error(`manifest.source.repository must be ${TRUSTED_REPOSITORY}`);
  }
  if (!isCommitPin(manifest.source?.commit)) {
    throw new Error('manifest.source.commit must be a 40-character git commit hash');
  }
  if (!Array.isArray(manifest.protocol?.paths) || manifest.protocol.paths.length === 0) {
    throw new Error('manifest.protocol.paths must be a non-empty array');
  }
  if (!isProtocolHash(manifest.protocol?.expectedSha256)) {
    throw new Error('manifest.protocol.expectedSha256 must be a 64-character sha256 hex digest');
  }
  if (!manifest.corpusManifest) throw new Error('manifest.corpusManifest is required');
  if (!Array.isArray(manifest.expectedTasks) || manifest.expectedTasks.length === 0) {
    throw new Error('manifest.expectedTasks must be a non-empty array');
  }
  if (!Array.isArray(manifest.expectedArms) || manifest.expectedArms.length === 0) {
    throw new Error('manifest.expectedArms must be a non-empty array');
  }
  assertUniqueIds(manifest.expectedTasks.map((id) => ({ id })), 'expected task');
  assertUniqueIds(manifest.expectedArms.map((id) => ({ id })), 'expected arm');
  if (!Array.isArray(manifest.artifactRoles) || manifest.artifactRoles.length === 0) {
    throw new Error('manifest.artifactRoles must be a non-empty array');
  }
  assertUniqueIds(manifest.artifactRoles, 'artifact role');
  for (const role of manifest.artifactRoles) {
    if (!isSafeRepoRelativePath(role.path)) {
      throw new Error(`manifest artifact role ${role.id} has an unsafe path: ${role.path}`);
    }
  }
  return manifest;
}

function assertCorpusMatchesManifest(manifest, corpus) {
  assertExactIdSet(
    corpus.tasks.map((task) => task.id),
    manifest.expectedTasks,
    'Task IDs'
  );
  assertExactIdSet(corpus.arms, manifest.expectedArms, 'Arm IDs');
}

function verifyArtifactPathsAtCommit(root, commit, artifacts) {
  if (!hasGitMetadata(root)) return;
  const missing = [];
  for (const artifact of artifacts) {
    if (gitCatFileExists(root, commit, artifact.path) !== true) {
      missing.push(artifact.path);
    }
  }
  if (missing.length) {
    throw new Error(
      `Advertised artifact path(s) missing at commit ${commit}: ${missing.join(', ')}`
    );
  }
}

export function exportWebRelease({ root, manifestPath, outPath }) {
  const manifest = loadReleaseManifest(manifestPath);
  const commit = manifest.source.commit;
  assertPublicInputsMatchCommit(root, commit, manifest, manifest.corpusManifest);
  const corpus = loadCorpusManifest(root, commit, manifest.corpusManifest);

  if (corpus.version !== manifest.benchmarkVersion) {
    throw new Error(
      `Corpus version ${corpus.version} does not match manifest benchmarkVersion ${manifest.benchmarkVersion}`
    );
  }

  assertCorpusMatchesManifest(manifest, corpus);

  const protocol = computeProtocolSha256(root, manifest.protocol.paths);
  if (protocol.sha256 !== manifest.protocol.expectedSha256) {
    throw new Error(
      `Protocol hash mismatch: manifest expects ${manifest.protocol.expectedSha256}, computed ${protocol.sha256}`
    );
  }

  const runtime = {
    agent: manifest.runtime.agent,
    model: manifest.runtime.model,
    attemptsPerArm: manifest.runtime.attemptsPerArm,
    totalBudgetSecondsPerArm: manifest.runtime.totalBudgetSecondsPerArm,
  };

  const arms = buildArmFacts(corpus.arms, runtime.totalBudgetSecondsPerArm);
  const tasks = buildTaskFacts(corpus.tasks, root, commit);
  const controls = buildControlFacts();
  const artifacts = buildArtifactLinks(manifest, manifest.source.repository, manifest.source.commit);

  assertUniqueIds(arms, 'arm');
  assertUniqueIds(tasks, 'task');
  assertUniqueIds(controls, 'control');
  assertUniqueIds(artifacts, 'artifact');

  verifyArtifactPathsAtCommit(root, manifest.source.commit, artifacts);

  const release = {
    contractVersion: CONTRACT_VERSION,
    releaseKey: manifest.releaseKey,
    benchmarkId: manifest.benchmarkId,
    benchmarkVersion: manifest.benchmarkVersion,
    status: manifest.status,
    generatedAt: manifest.generatedAt,
    construct: corpus.construct,
    measurement: corpus.measurement,
    source: {
      repository: manifest.source.repository,
      commit: manifest.source.commit,
      protocolSha256: protocol.sha256,
    },
    runtime,
    arms,
    tasks,
    controls,
    artifacts,
  };

  if (manifest.status === 'running') {
    if (!manifest.methodologyLockedAt) {
      throw new Error('running release requires manifest.methodologyLockedAt');
    }
    release.methodologyLockedAt = manifest.methodologyLockedAt;
  } else if (manifest.status === 'published') {
    throw new Error('Published export is not implemented in contract version 1.0.0');
  } else if (manifest.status === 'withheld') {
    if (!manifest.withheldAt) throw new Error('withheld release requires manifest.withheldAt');
    if (!manifest.reasonCode) throw new Error('withheld release requires manifest.reasonCode');
    release.withheldAt = manifest.withheldAt;
    release.reasonCode = manifest.reasonCode;
  }

  const errors = validateWebRelease(release, {
    expectedStatus: release.status,
    root,
    verifyGitArtifacts: true,
  });
  if (errors.length) {
    throw new Error(`Release validation failed before export:\n${errors.join('\n')}`);
  }

  const serialized = stableStringify(release);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const tmpPath = `${outPath}.tmp`;
  fs.writeFileSync(tmpPath, serialized);
  fs.renameSync(tmpPath, outPath);
  return { release, serialized, protocolFileCount: protocol.fileCount };
}

export function validateWebRelease(release, { expectedStatus, root, verifyGitArtifacts = false } = {}) {
  const errors = [];

  if (release.contractVersion !== CONTRACT_VERSION) {
    errors.push(`Unsupported contractVersion: ${release.contractVersion ?? '(missing)'}`);
  }
  if (!release.releaseKey) errors.push('releaseKey is required');
  if (!release.benchmarkId) errors.push('benchmarkId is required');
  if (!release.benchmarkVersion) errors.push('benchmarkVersion is required');
  if (!SUPPORTED_STATUSES.has(release.status)) {
    errors.push(`Invalid status: ${release.status ?? '(missing)'}`);
  }
  if (expectedStatus && release.status !== expectedStatus) {
    errors.push(`Expected status ${expectedStatus}, got ${release.status}`);
  }
  if (!release.generatedAt) {
    errors.push('generatedAt is required');
  } else if (!isIsoInstant(release.generatedAt)) {
    errors.push('generatedAt must be a valid ISO-8601 instant');
  }
  if (!release.construct) errors.push('construct is required');
  if (!release.measurement) errors.push('measurement is required');

  if (!release.source?.repository) {
    errors.push('source.repository is required');
  } else if (!isTrustedRepository(release.source.repository)) {
    errors.push(`source.repository must be the trusted GitHub origin ${TRUSTED_REPOSITORY}`);
  }
  if (!isCommitPin(release.source?.commit)) {
    errors.push('source.commit must be a 40-character git commit hash');
  }
  if (!isProtocolHash(release.source?.protocolSha256)) {
    errors.push('source.protocolSha256 must be a 64-character sha256 hex digest');
  }

  validateReleaseExactKeys(release, errors);

  validateRuntimeFacts(release.runtime, errors);

  for (const collection of ['arms', 'tasks', 'controls', 'artifacts']) {
    if (!Array.isArray(release[collection]) || release[collection].length === 0) {
      errors.push(`${collection} must be a non-empty array`);
    }
  }

  try {
    if (Array.isArray(release.arms)) assertUniqueIds(release.arms, 'arm');
    if (Array.isArray(release.tasks)) assertUniqueIds(release.tasks, 'task');
    if (Array.isArray(release.controls)) assertUniqueIds(release.controls, 'control');
    if (Array.isArray(release.artifacts)) assertUniqueIds(release.artifacts, 'artifact');
  } catch (error) {
    errors.push(error.message);
  }

  validateSortedCollections(release, errors);
  validateArmFacts(release, errors);
  validateTaskFacts(release.tasks, errors);
  validateControlFacts(release.controls, errors);
  validateArtifactFacts(release, errors, { root, verifyGitArtifacts });

  if (release.status === 'running') {
    if (!release.methodologyLockedAt) {
      errors.push('running release requires methodologyLockedAt');
    } else if (!isIsoInstant(release.methodologyLockedAt)) {
      errors.push('methodologyLockedAt must be a valid ISO-8601 instant');
    }
  }

  if (release.status === 'published') {
    validatePublishedShape(release, errors);
  }

  if (release.status === 'withheld') {
    if (!release.withheldAt) {
      errors.push('withheld release requires withheldAt');
    } else if (!isIsoInstant(release.withheldAt)) {
      errors.push('withheldAt must be a valid ISO-8601 instant');
    }
    if (!release.reasonCode) errors.push('withheld release requires reasonCode');
  }

  const serialized = JSON.stringify(release);
  if (/(?:^|[^a-z])\/home\/|(?:^|[^a-z])\/Users\//.test(serialized)) {
    errors.push('Public release must not contain local filesystem paths');
  }

  return errors;
}

export function validateReleaseFile(filePath, options = {}) {
  const release = loadJson(filePath);
  return validateWebRelease(release, options);
}

export function defaultPaths(root) {
  return {
    manifest: path.join(root, 'benchmarks/releases/harbor-v4-running/manifest.json'),
    output: path.join(root, 'benchmarks/releases/current/release.json'),
  };
}

export { resolveRepoRoot };
