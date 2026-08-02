#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GraphEngine } from '../../packages/cli/lib/graph-runtime/engine.mjs';
import {
  parseDaemonLock,
  processIsRunning,
  runtimePaths,
} from '../../packages/cli/lib/graph-runtime/util.mjs';
import { stopIncompatibleServer } from '../../packages/cli/lib/graph-runtime/client.mjs';
import { contextCatalog } from '../../packages/cli/lib/context-index.mjs';
import {
  compileImplementationObligations,
} from '../../packages/cli/lib/work-context.mjs';
import { semanticDigest } from './contract.mjs';
import {
  adaptCurrentGraphBackup,
  CURRENT_OBSERVATION_SCHEMA,
} from './adapters/current-graph-backup-v1.mjs';

export const FIXTURE_ID = 'compact-product-lifecycle';

const GIT_ENV = Object.freeze({
  ...process.env,
  GIT_AUTHOR_DATE: '2026-01-02T03:04:05Z',
  GIT_COMMITTER_DATE: '2026-01-02T03:04:05Z',
});

function git(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

function visible(engine, branchId) {
  const active = engine.activeIds(branchId);
  return {
    resources: [...active.resources].sort(),
    relations: [...active.statements].sort(),
  };
}

function derivedProjection(engine, branchId) {
  const active = engine.activeIds(branchId);
  return {
    schema: 'lamina.semantic-derived-projection/v1',
    source_version_id: engine.head(branchId).id,
    resource_ids: [...active.resources].sort(),
    relation_ids: [...active.statements].sort(),
  };
}

function publicationReceipt({ id, branchId, baseVersionId, before, result = null, error = null, after }) {
  return {
    id,
    branch_id: branchId,
    before: {
      session_base_version_id: baseVersionId,
      head_version_id: before.head,
      visible_resource_ids: before.visibility.resources,
      visible_relation_ids: before.visibility.relations,
    },
    result,
    error: error ? {
      code: error.code || 'LAMINA_INTERNAL',
      message: error.message,
      details: error.details || {},
    } : null,
    after: {
      head_version_id: after.head,
      visible_resource_ids: after.visibility.resources,
      visible_relation_ids: after.visibility.relations,
    },
  };
}

function publicationState(engine, branchId) {
  return { head: engine.head(branchId).id, visibility: visible(engine, branchId) };
}

const CLI_ENTRY = fileURLToPath(new URL('../../packages/cli/bin/lamina.mjs', import.meta.url));

function runCli({ id, operation, branch, args, cwd }) {
  const child = spawnSync(process.execPath, [CLI_ENTRY, ...args], {
    cwd,
    env: GIT_ENV,
    encoding: 'utf8',
    timeout: 30_000,
  });
  if (child.error) throw child.error;
  const exitCode = child.status ?? 1;
  const raw = exitCode === 0 ? child.stdout : child.stderr;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`semantic fixture could not parse ${operation} CLI output: ${error.message}`);
  }
  return {
    id,
    operation,
    branch,
    exit_code: exitCode,
    stdout: exitCode === 0 ? parsed : null,
    stderr: exitCode === 0 ? null : parsed,
  };
}

class FaultInjectedGraphEngine extends GraphEngine {
  injectInterruptedPublication = false;
  injectCloseFailure = false;
  nativeCloseCompleted = false;

  query(statement, params = {}) {
    const result = super.query(statement, params);
    if (this.injectInterruptedPublication
      && statement.includes('CREATE (b)-[:VIEW_HEAD]->(g)')) {
      const error = new Error('Injected interruption after branch-head mutation.');
      error.code = 'LAMINA_INJECTED_INTERRUPTION';
      throw error;
    }
    return result;
  }

  close() {
    super.close();
    this.nativeCloseCompleted = true;
    if (this.injectCloseFailure) {
      this.injectCloseFailure = false;
      throw new Error('Injected semantic fixture engine close failure.');
    }
  }
}

function stageInitialContract(engine, sessionId) {
  const resources = [
    ['product.checkout', 'product', { name: 'Checkout approval' }, 'intent'],
    ['actor.reviewer', 'actor', { name: 'Reviewer' }, 'intent'],
    ['persona.operator', 'persona', { name: 'Operations specialist' }, 'intent'],
    ['workflow.approval', 'workflow', { name: 'Approve checkout' }, 'intent'],
    ['operation.approve', 'operation', { name: 'Approve request' }, 'intent'],
    ['operation.archive', 'operation', { name: 'Archive decision' }, 'intent'],
    ['state.pending', 'entity', { semantic_type: 'state', name: 'Pending' }, 'intent'],
    ['state.approved', 'entity', { semantic_type: 'state', name: 'Approved' }, 'intent'],
    ['invariant.separation', 'invariant', { rule: 'Requester cannot self-approve' }, 'intent'],
    ['scenario.denied', 'scenario', { semantic_type: 'failure', recovery: 'Request another reviewer' }, 'persona'],
    ['surface.review', 'surface', { name: 'Review queue' }, 'intent'],
    ['proof.audit', 'proof', { name: 'Approval audit proof' }, 'intent'],
    ['evidence.human-review', 'evidence', { summary: 'Reviewed approval rule' }, 'human'],
    ['observation.route', 'observation', { path: 'src/review.ts' }, 'observation'],
    ['decision.manual-review', 'decision', { outcome: 'Keep manual review' }, 'agent'],
    ['harness.approval', 'harness_result', { events: [{ type: 'oracle_passed' }] }, 'runtime'],
  ];
  for (const [id, kind, data, ingress] of resources) {
    engine.stageResource(sessionId, { id, kind, data, alias: `${id}.alias` }, ingress);
  }
  const statements = [
    [{ subject: 'persona.operator', predicate: 'lamina:canAssume', object: 'actor.reviewer' }, 'intent'],
    [{ subject: 'actor.reviewer', predicate: 'lamina:authorizedFor', object: 'operation.approve' }, 'intent'],
    [{ subject: 'actor.reviewer', predicate: 'lamina:authorizedFor', object: 'operation.archive' }, 'intent'],
    [{ subject: 'workflow.approval', predicate: 'lamina:hasStep', object: 'operation.approve', qualifiers: { position: 1 } }, 'intent'],
    [{ subject: 'workflow.approval', predicate: 'lamina:hasStep', object: 'operation.archive', qualifiers: { position: 2 } }, 'intent'],
    [{ subject: 'surface.review', predicate: 'lamina:realizes', object: 'operation.approve' }, 'intent'],
    [{ subject: 'state.pending', predicate: 'lamina:transitionsTo', object: 'state.approved' }, 'intent'],
    [{ subject: 'operation.approve', predicate: 'lamina:constrainedBy', object: 'invariant.separation' }, 'intent'],
    [{ subject: 'operation.approve', predicate: 'lamina:hasScenario', object: 'scenario.denied' }, 'persona'],
    [{ subject: 'operation.approve', predicate: 'lamina:governedBy', object: 'decision.manual-review' }, 'agent'],
    [{ subject: 'operation.approve', predicate: 'lamina:requiresProof', object: 'proof.audit', evidence: ['harness.approval'] }, 'intent'],
    [{ subject: 'proof.audit', predicate: 'lamina:supportedBy', object: 'evidence.human-review' }, 'human'],
    [{
      subject: 'operation.approve',
      predicate: 'lamina:observedAt',
      object: 'observation.route',
    }, 'observation'],
    [{ subject: 'operation.approve', predicate: 'custom:maxApprovers', literal: 1, qualifiers: { cardinality: 'one' } }, 'intent'],
    [{ subject: 'operation.approve', predicate: 'custom:nullablePolicy', literal: null }, 'intent'],
    [{ subject: 'operation.approve', predicate: 'custom:enabled', literal: false }, 'intent'],
  ];
  for (const [input, ingress] of statements) {
    const staged = engine.stageStatement(sessionId, input, ingress);
    if (input.predicate === 'lamina:observedAt') {
      // Current public Statement authoring has no generator-provenance field.
      // This fixture-only canonical edge exercises backup/adapter preservation;
      // it is not presented as a supported user authoring workflow.
      engine.query(
        'MATCH (s:Statement {id: $id}), (r:Resource {id: $resource}) CREATE (s)-[:GENERATED_BY]->(r)',
        { id: staged.id, resource: 'decision.manual-review' },
      );
    }
  }
}

export async function runCurrentObservation({ testFailure = null, onTemporaryDirectory = null } = {}) {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-semantic-oracle-'));
  const root = path.join(temporary, 'main');
  const worktree = path.join(temporary, 'feature');
  const cliRoot = path.join(temporary, 'cli-main');
  const cliWorktree = path.join(temporary, 'cli-feature');
  let engine = null;
  const daemonPids = new Set();
  let observation = null;
  let primaryError = null;
  try {
    onTemporaryDirectory?.(temporary);
    if (testFailure === 'setup') throw new Error('Injected semantic fixture setup failure.');
    fs.mkdirSync(root);
    git(['init', '-b', 'main'], root);
    git(['config', 'user.email', 'semantic-oracle@lamina.invalid'], root);
    git(['config', 'user.name', 'Lamina Semantic Oracle'], root);
    fs.writeFileSync(path.join(root, 'README.md'), '# Compact semantic fixture\n');
    git(['add', 'README.md'], root);
    git(['commit', '-m', 'compact semantic fixture'], root);

    engine = new FaultInjectedGraphEngine(runtimePaths(root));
    const publicationReceipts = [];
    const sourceRevision = git(['rev-parse', 'HEAD'], root);
    const main = engine.ensureBranch('main', sourceRevision);

    const initialBase = engine.head(main.id).id;
    const initial = engine.startSession({
      id: 'session:initial-contract', branch: 'main', source_revision: sourceRevision,
    });
    stageInitialContract(engine, initial.id);
    const initialBefore = publicationState(engine, main.id);
    const initialResult = engine.publishSession(initial.id, sourceRevision);
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:initial-atomic-publication',
      branchId: main.id,
      baseVersionId: initialBase,
      before: initialBefore,
      result: initialResult,
      after: publicationState(engine, main.id),
    }));

    const conflictBase = engine.head(main.id).id;
    const conflict = engine.startSession({
      id: 'session:contradiction', branch: 'main', source_revision: sourceRevision,
    });
    engine.stageStatement(conflict.id, {
      subject: 'operation.approve',
      predicate: 'custom:maxApprovers',
      literal: 2,
      qualifiers: { cardinality: 'one' },
    }, 'agent');
    const conflictBefore = publicationState(engine, main.id);
    const conflictResult = engine.publishSession(conflict.id, sourceRevision);
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:contradiction-publication',
      branchId: main.id,
      baseVersionId: conflictBase,
      before: conflictBefore,
      result: conflictResult,
      after: publicationState(engine, main.id),
    }));

    const invalidBase = engine.head(main.id).id;
    const invalid = engine.startSession({
      id: 'session:invalid-publication', branch: 'main', source_revision: sourceRevision,
    });
    engine.stageResource(invalid.id, {
      id: 'operation.invalid-partial', kind: 'operation', data: { name: 'Must not publish' },
    }, 'intent');
    engine.stageStatement(invalid.id, {
      subject: 'workflow.approval',
      predicate: 'lamina:hasStep',
      object: 'operation.invalid-partial',
      qualifiers: { position: 1 },
    }, 'intent');
    let invalidError = null;
    const invalidBefore = publicationState(engine, main.id);
    try {
      engine.publishSession(invalid.id, sourceRevision);
    } catch (error) {
      invalidError = error;
    }
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:validation-failure',
      branchId: main.id,
      baseVersionId: invalidBase,
      before: invalidBefore,
      error: invalidError,
      after: publicationState(engine, main.id),
    }));
    engine.abortSession(invalid.id);

    const interruptedBase = engine.head(main.id).id;
    const interrupted = engine.startSession({
      id: 'session:interrupted-publication', branch: 'main', source_revision: sourceRevision,
    });
    engine.stageResource(interrupted.id, {
      id: 'entity.interrupted-partial', kind: 'entity', data: { name: 'Must not publish' },
    }, 'intent');
    let interruptionError = null;
    const interruptionBefore = publicationState(engine, main.id);
    engine.injectInterruptedPublication = true;
    try {
      engine.publishSession(interrupted.id, sourceRevision);
    } catch (error) {
      interruptionError = error;
    } finally {
      engine.injectInterruptedPublication = false;
    }
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:interrupted-publication',
      branchId: main.id,
      baseVersionId: interruptedBase,
      before: interruptionBefore,
      error: interruptionError,
      after: publicationState(engine, main.id),
    }));
    engine.abortSession(interrupted.id);

    const concurrentBase = engine.head(main.id).id;
    const concurrentA = engine.startSession({
      id: 'session:concurrent-a', branch: 'main', source_revision: sourceRevision,
    });
    const concurrentB = engine.startSession({
      id: 'session:concurrent-b', branch: 'main', source_revision: sourceRevision,
    });
    engine.stageResource(concurrentA.id, {
      id: 'entity.concurrent-a', kind: 'entity', data: { name: 'Concurrent A' },
    }, 'intent');
    engine.stageResource(concurrentB.id, {
      id: 'entity.concurrent-b', kind: 'entity', data: { name: 'Concurrent B' },
    }, 'intent');
    const concurrentABefore = publicationState(engine, main.id);
    const concurrentAResult = engine.publishSession(concurrentA.id, sourceRevision);
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:concurrent-a-publication',
      branchId: main.id,
      baseVersionId: concurrentBase,
      before: concurrentABefore,
      result: concurrentAResult,
      after: publicationState(engine, main.id),
    }));
    let concurrentError = null;
    const concurrentBBefore = publicationState(engine, main.id);
    try {
      engine.publishSession(concurrentB.id, sourceRevision);
    } catch (error) {
      concurrentError = error;
    }
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:concurrent-b-conflict',
      branchId: main.id,
      baseVersionId: concurrentBase,
      before: concurrentBBefore,
      error: concurrentError,
      after: publicationState(engine, main.id),
    }));
    engine.rebaseSession(concurrentB.id);
    const rebasedBase = engine.head(main.id).id;
    const rebasedBefore = publicationState(engine, main.id);
    const concurrentBResult = engine.publishSession(concurrentB.id, sourceRevision);
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:concurrent-b-rebased-publication',
      branchId: main.id,
      baseVersionId: rebasedBase,
      before: rebasedBefore,
      result: concurrentBResult,
      after: publicationState(engine, main.id),
    }));

    git(['worktree', 'add', '-b', 'feature/semantic-isolation', worktree, sourceRevision], root);
    const featureContext = engine.currentContext(worktree);
    const feature = engine.ensureBranch(featureContext.branch, featureContext.source_revision);
    const featureBase = engine.head(feature.id).id;
    const featureSession = engine.startSession({
      id: 'session:feature-isolation',
      branch: featureContext.branch,
      source_revision: featureContext.source_revision,
    });
    engine.stageResource(featureSession.id, {
      id: 'surface.feature-only', kind: 'surface', data: { name: 'Feature-only surface' },
    }, 'intent');
    const featureBefore = publicationState(engine, feature.id);
    const featureResult = engine.publishSession(featureSession.id, featureContext.source_revision);
    publicationReceipts.push(publicationReceipt({
      id: 'attempt:feature-worktree-publication',
      branchId: feature.id,
      baseVersionId: featureBase,
      before: featureBefore,
      result: featureResult,
      after: publicationState(engine, feature.id),
    }));

    const implementationContext = engine.implementationContext({
      workflows: ['workflow.approval'],
      request: 'Implement the compact approval flow.',
    }, { branch: 'main', source_revision: sourceRevision });
    const implementationObligations = implementationContext.workflows
      .flatMap(compileImplementationObligations);
    const packetPath = path.join(temporary, 'implementation-packet.json');
    fs.writeFileSync(packetPath, `${JSON.stringify({
      schema: 'lamina.implementation-packet/v5',
      packet_id: 'packet_semantic_oracle',
      source: { source_revision: sourceRevision },
      obligations: implementationObligations,
      experience_cases: [],
    })}\n`);

    const canonicalHeadBefore = engine.head(main.id).id;
    const catalogBefore = contextCatalog(root);
    const projectionPath = path.join(temporary, 'derived-projection.json');
    const projectionBefore = derivedProjection(engine, main.id);
    fs.writeFileSync(projectionPath, `${JSON.stringify(projectionBefore)}\n`);
    const digestBefore = semanticDigest(JSON.parse(fs.readFileSync(projectionPath, 'utf8')));
    fs.unlinkSync(projectionPath);
    fs.writeFileSync(projectionPath, '{"corrupt":true}\n');
    fs.unlinkSync(projectionPath);
    const projectionAfter = derivedProjection(engine, main.id);
    fs.writeFileSync(projectionPath, `${JSON.stringify(projectionAfter)}\n`);
    const digestAfter = semanticDigest(JSON.parse(fs.readFileSync(projectionPath, 'utf8')));
    fs.unlinkSync(projectionPath);
    const catalogAfter = contextCatalog(root);
    const canonicalHeadAfter = engine.head(main.id).id;
    const mainHead = engine.head(main.id).id;
    const seedBackupPath = path.join(temporary, 'seed-graph.backup.json');
    engine.backup(seedBackupPath);
    engine.injectCloseFailure = testFailure === 'engine-close';
    engine.close();
    engine = null;

    const cliReceipts = [];
    fs.mkdirSync(cliRoot);
    git(['init', '-b', 'main'], cliRoot);
    git(['config', 'user.email', 'semantic-oracle@lamina.invalid'], cliRoot);
    git(['config', 'user.name', 'Lamina Semantic Oracle'], cliRoot);
    fs.writeFileSync(path.join(cliRoot, 'README.md'), '# Compact semantic fixture\n');
    git(['add', 'README.md'], cliRoot);
    git(['commit', '-m', 'compact semantic fixture'], cliRoot);
    git(['worktree', 'add', '-b', 'feature/semantic-isolation', cliWorktree, sourceRevision], cliRoot);
    const restoredSeed = runCli({
      id: 'cli:graph-restore', operation: 'graph.restore', branch: 'main', cwd: cliRoot,
      args: ['graph', 'restore', '--input', seedBackupPath],
    });
    if (restoredSeed.exit_code !== 0) {
      throw new Error(`fixture CLI graph restore failed: ${JSON.stringify(restoredSeed.stderr)}`);
    }
    cliReceipts.push(restoredSeed);
    daemonPids.add(parseDaemonLock(fs.readFileSync(runtimePaths(cliRoot).lock, 'utf8'))?.pid);
    const draftMapPath = path.join(temporary, 'work-map-draft.json');
    const acceptedMapPath = path.join(temporary, 'work-map-accepted.json');
    const workMapReceipt = runCli({
      id: 'cli:work-map', operation: 'work.map', branch: 'main', cwd: cliRoot,
      args: ['work', 'map', '--packet', packetPath, '--output', draftMapPath],
    });
    if (workMapReceipt.exit_code !== 0) throw new Error('fixture CLI work map failed');
    cliReceipts.push(workMapReceipt);
    const unresolvedCheck = runCli({
      id: 'cli:work-check-unresolved', operation: 'work.check.unresolved', branch: 'main', cwd: cliRoot,
      args: ['work', 'check', '--packet', packetPath, '--map', draftMapPath],
    });
    if (unresolvedCheck.exit_code === 0) throw new Error('fixture unresolved WorkMap was unexpectedly accepted');
    cliReceipts.push(unresolvedCheck);
    const { output: _draftOutput, ...draftMap } = workMapReceipt.stdout;
    const acceptedMap = {
      ...draftMap,
      obligations: draftMap.obligations.map((item, index) => index === 0
        ? {
          ...item,
          status: 'already_satisfied',
          current_evidence: ['README.md records the reviewed compact workflow objective.'],
        }
        : {
          ...item,
          status: 'change_required',
          files: [{ path: 'README.md', action: 'modify', role: 'implementation' }],
        }),
    };
    fs.writeFileSync(acceptedMapPath, `${JSON.stringify(acceptedMap)}\n`);
    const checkedWork = runCli({
      id: 'cli:work-check-accepted', operation: 'work.check', branch: 'main', cwd: cliRoot,
      args: ['work', 'check', '--packet', packetPath, '--map', acceptedMapPath],
    });
    if (checkedWork.exit_code !== 0) {
      throw new Error(`fixture resolved WorkMap was rejected: ${JSON.stringify({
        stdout: checkedWork.stdout,
        stderr: checkedWork.stderr,
      })}`);
    }
    cliReceipts.push(checkedWork);

    for (const [id, branch, cwd] of [
      ['cli:main-status', 'main', cliRoot],
      ['cli:feature-status', 'feature/semantic-isolation', cliWorktree],
    ]) {
      const receipt = runCli({ id, operation: 'graph.status', branch, cwd, args: ['graph', 'status'] });
      if (receipt.exit_code !== 0) throw new Error(`fixture ${id} failed: ${JSON.stringify(receipt.stderr)}`);
      cliReceipts.push(receipt);
    }
    for (const [id, branch, cwd] of [
      ['cli:main-surface-query', 'main', cliRoot],
      ['cli:feature-surface-query', 'feature/semantic-isolation', cliWorktree],
    ]) {
      const receipt = runCli({
        id, operation: 'graph.query.surfaces', branch, cwd,
        args: ['graph', 'query', '--kind', 'surface'],
      });
      if (receipt.exit_code !== 0) throw new Error(`fixture ${id} failed: ${JSON.stringify(receipt.stderr)}`);
      cliReceipts.push(receipt);
    }

    const invalidResourcePath = path.join(temporary, 'cli-invalid-resource.json');
    const invalidStatementPath = path.join(temporary, 'cli-invalid-statement.json');
    fs.writeFileSync(invalidResourcePath, JSON.stringify({
      id: 'operation.cli-invalid-partial', kind: 'operation', data: { name: 'Must not publish from CLI' },
    }));
    fs.writeFileSync(invalidStatementPath, JSON.stringify({
      subject: 'workflow.approval', predicate: 'lamina:hasStep',
      object: 'operation.cli-invalid-partial', qualifiers: { position: 1 },
    }));
    for (const args of [
      ['session', 'start', '--id', 'session:cli-invalid'],
      ['graph', 'propose', '--input', invalidResourcePath, '--session', 'session:cli-invalid'],
      ['graph', 'propose', '--input', invalidStatementPath, '--session', 'session:cli-invalid'],
    ]) {
      const setup = runCli({
        id: `setup:${args.join(':')}`, operation: 'setup', branch: 'main', cwd: cliRoot, args,
      });
      if (setup.exit_code !== 0) throw new Error(`fixture CLI setup failed: ${args.join(' ')}`);
    }
    const invalidPublish = runCli({
      id: 'cli:invalid-session-publish', operation: 'session.publish.invalid', branch: 'main', cwd: cliRoot,
      args: ['session', 'publish', 'session:cli-invalid'],
    });
    if (invalidPublish.exit_code === 0) throw new Error('fixture invalid CLI publication unexpectedly passed');
    cliReceipts.push(invalidPublish);
    runCli({
      id: 'setup:abort-invalid', operation: 'setup', branch: 'main', cwd: cliRoot,
      args: ['session', 'abort', 'session:cli-invalid'],
    });

    const backupPath = path.join(temporary, 'current-graph.backup.json');
    const backupReceipt = runCli({
      id: 'cli:graph-backup', operation: 'graph.backup', branch: 'main', cwd: cliRoot,
      args: ['graph', 'backup', '--output', backupPath],
    });
    if (backupReceipt.exit_code !== 0) throw new Error('fixture CLI graph backup failed');
    cliReceipts.push(backupReceipt);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const tamperedBackupPath = path.join(temporary, 'tampered-graph.backup.json');
    const tamperedBackup = structuredClone(backup);
    tamperedBackup.resources[0].data = {
      ...tamperedBackup.resources[0].data,
      tampered_by_fixture: true,
    };
    fs.writeFileSync(tamperedBackupPath, `${JSON.stringify(tamperedBackup)}\n`);
    const rejectedRestore = runCli({
      id: 'cli:tampered-backup-rejected', operation: 'graph.restore.tampered', branch: 'main', cwd: cliRoot,
      args: ['graph', 'restore', '--input', tamperedBackupPath],
    });
    if (rejectedRestore.exit_code === 0) throw new Error('fixture tampered backup unexpectedly restored');
    cliReceipts.push(rejectedRestore);
    const statusAfterTamper = runCli({
      id: 'cli:status-after-tampered-restore', operation: 'graph.status', branch: 'main', cwd: cliRoot,
      args: ['graph', 'status'],
    });
    if (statusAfterTamper.exit_code !== 0) throw new Error('fixture post-tamper status failed');
    cliReceipts.push(statusAfterTamper);

    daemonPids.add(parseDaemonLock(fs.readFileSync(runtimePaths(cliRoot).lock, 'utf8'))?.pid);
    observation = {
      schema: CURRENT_OBSERVATION_SCHEMA,
      fixture_id: FIXTURE_ID,
      graph_backup: backup,
      publication_receipts: publicationReceipts,
      implementation_obligations: implementationObligations,
      work_started_receipt: checkedWork.stdout,
      cli_receipts: cliReceipts,
      derived_observations: [
        {
          id: 'derived:main-semantic-projection',
          kind: 'semantic_projection',
          source_version_id: mainHead,
          catalog_before: catalogBefore,
          catalog_after: catalogAfter,
          digest_before: digestBefore,
          digest_after: digestAfter,
          canonical_head_before: canonicalHeadBefore,
          canonical_head_after: canonicalHeadAfter,
        },
      ],
    };
  } catch (error) {
    primaryError = error;
  }

  const cleanupErrors = [];
  if (engine && !engine.nativeCloseCompleted) {
    try { engine.close(); } catch (error) { cleanupErrors.push(error); }
  }
  if (fs.existsSync(cliRoot)) {
    try { daemonPids.add(parseDaemonLock(fs.readFileSync(runtimePaths(cliRoot).lock, 'utf8'))?.pid); } catch {}
  }
  daemonPids.delete(null);
  daemonPids.delete(undefined);
  for (const daemonPid of daemonPids) {
    try {
      await stopIncompatibleServer(runtimePaths(cliRoot), daemonPid);
      if (processIsRunning(daemonPid)) throw new Error(`graphd ${daemonPid} survived semantic fixture cleanup`);
    } catch (error) {
      cleanupErrors.push(error);
    }
  }
  try {
    fs.rmSync(temporary, {
      recursive: true,
      force: true,
      maxRetries: process.platform === 'win32' ? 20 : 0,
      retryDelay: 100,
    });
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (primaryError) {
    if (cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors], primaryError.message);
    throw primaryError;
  }
  if (cleanupErrors.length) throw new AggregateError(cleanupErrors, 'semantic fixture cleanup failed');
  return observation;
}

export async function runCurrentFixture(options = {}) {
  return adaptCurrentGraphBackup(await runCurrentObservation(options));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(await runCurrentFixture(), null, 2)}\n`);
}
