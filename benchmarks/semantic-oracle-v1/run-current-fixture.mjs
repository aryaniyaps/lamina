#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { GraphEngine } from '../../packages/cli/lib/graph-runtime/engine.mjs';
import { runtimePaths } from '../../packages/cli/lib/graph-runtime/util.mjs';
import { contextCatalog } from '../../packages/cli/lib/context-index.mjs';
import {
  compileImplementationObligations,
  deriveWorkMap,
} from '../../packages/cli/lib/work-context.mjs';
import { semanticDigest } from './contract.mjs';
import { adaptCurrentGraphBackup } from './adapters/current-graph-backup-v1.mjs';

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

function attempt({ id, branchId, baseVersionId, outcome, resultVersionId = null,
  errorCode = null, headVersionIdAfter, visibility }) {
  return {
    id,
    branch_id: branchId,
    base_version_id: baseVersionId,
    outcome,
    result_version_id: resultVersionId,
    error_code: errorCode,
    head_version_id_after: headVersionIdAfter,
    visible_resource_ids: visibility.resources,
    visible_relation_ids: visibility.relations,
  };
}

class FaultInjectedGraphEngine extends GraphEngine {
  injectInterruptedPublication = false;

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
}

function stageInitialContract(engine, sessionId) {
  const resources = [
    ['product.checkout', 'product', { name: 'Checkout approval' }, 'intent'],
    ['actor.reviewer', 'actor', { name: 'Reviewer' }, 'intent'],
    ['persona.operator', 'persona', { name: 'Operations specialist' }, 'intent'],
    ['workflow.approval', 'workflow', { name: 'Approve checkout' }, 'intent'],
    ['operation.approve', 'operation', { name: 'Approve request' }, 'intent'],
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
    [{ subject: 'workflow.approval', predicate: 'lamina:hasStep', object: 'operation.approve', qualifiers: { position: 1 } }, 'intent'],
    [{ subject: 'surface.review', predicate: 'lamina:realizes', object: 'operation.approve' }, 'intent'],
    [{ subject: 'state.pending', predicate: 'lamina:transitionsTo', object: 'state.approved' }, 'intent'],
    [{ subject: 'operation.approve', predicate: 'lamina:constrainedBy', object: 'invariant.separation' }, 'intent'],
    [{ subject: 'operation.approve', predicate: 'lamina:hasScenario', object: 'scenario.denied' }, 'persona'],
    [{ subject: 'operation.approve', predicate: 'lamina:governedBy', object: 'decision.manual-review' }, 'agent'],
    [{ subject: 'operation.approve', predicate: 'lamina:requiresProof', object: 'proof.audit', evidence: ['harness.approval'] }, 'intent'],
    [{ subject: 'proof.audit', predicate: 'lamina:supportedBy', object: 'evidence.human-review' }, 'human'],
    [{ subject: 'operation.approve', predicate: 'lamina:observedAt', object: 'observation.route' }, 'observation'],
    [{ subject: 'operation.approve', predicate: 'custom:maxApprovers', literal: 1, qualifiers: { cardinality: 'one' } }, 'intent'],
  ];
  for (const [input, ingress] of statements) engine.stageStatement(sessionId, input, ingress);
}

export function runCurrentFixture() {
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'lamina-semantic-oracle-'));
  const root = path.join(temporary, 'main');
  const worktree = path.join(temporary, 'feature');
  fs.mkdirSync(root);
  git(['init', '-b', 'main'], root);
  git(['config', 'user.email', 'semantic-oracle@lamina.invalid'], root);
  git(['config', 'user.name', 'Lamina Semantic Oracle'], root);
  fs.writeFileSync(path.join(root, 'README.md'), '# Compact semantic fixture\n');
  git(['add', 'README.md'], root);
  git(['commit', '-m', 'compact semantic fixture'], root);

  const engine = new FaultInjectedGraphEngine(runtimePaths(root));
  const publicationAttempts = [];
  try {
    const sourceRevision = git(['rev-parse', 'HEAD'], root);
    const main = engine.ensureBranch('main', sourceRevision);

    const initialBase = engine.head(main.id).id;
    const initial = engine.startSession({
      id: 'session:initial-contract', branch: 'main', source_revision: sourceRevision,
    });
    stageInitialContract(engine, initial.id);
    const initialResult = engine.publishSession(initial.id, sourceRevision);
    publicationAttempts.push(attempt({
      id: 'attempt:initial-atomic-publication',
      branchId: main.id,
      baseVersionId: initialBase,
      outcome: 'published',
      resultVersionId: initialResult.graph_version,
      headVersionIdAfter: engine.head(main.id).id,
      visibility: visible(engine, main.id),
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
    const conflictResult = engine.publishSession(conflict.id, sourceRevision);
    publicationAttempts.push(attempt({
      id: 'attempt:contradiction-publication',
      branchId: main.id,
      baseVersionId: conflictBase,
      outcome: 'published',
      resultVersionId: conflictResult.graph_version,
      headVersionIdAfter: engine.head(main.id).id,
      visibility: visible(engine, main.id),
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
    let invalidCode = null;
    try {
      engine.publishSession(invalid.id, sourceRevision);
    } catch (error) {
      invalidCode = error.code;
    }
    publicationAttempts.push(attempt({
      id: 'attempt:validation-failure',
      branchId: main.id,
      baseVersionId: invalidBase,
      outcome: 'validation_failed',
      errorCode: invalidCode,
      headVersionIdAfter: engine.head(main.id).id,
      visibility: visible(engine, main.id),
    }));
    engine.abortSession(invalid.id);

    const interruptedBase = engine.head(main.id).id;
    const interrupted = engine.startSession({
      id: 'session:interrupted-publication', branch: 'main', source_revision: sourceRevision,
    });
    engine.stageResource(interrupted.id, {
      id: 'entity.interrupted-partial', kind: 'entity', data: { name: 'Must not publish' },
    }, 'intent');
    let interruptionCode = null;
    engine.injectInterruptedPublication = true;
    try {
      engine.publishSession(interrupted.id, sourceRevision);
    } catch (error) {
      interruptionCode = error.code;
    } finally {
      engine.injectInterruptedPublication = false;
    }
    publicationAttempts.push(attempt({
      id: 'attempt:interrupted-publication',
      branchId: main.id,
      baseVersionId: interruptedBase,
      outcome: 'interrupted',
      errorCode: interruptionCode,
      headVersionIdAfter: engine.head(main.id).id,
      visibility: visible(engine, main.id),
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
    const concurrentAResult = engine.publishSession(concurrentA.id, sourceRevision);
    publicationAttempts.push(attempt({
      id: 'attempt:concurrent-a-publication',
      branchId: main.id,
      baseVersionId: concurrentBase,
      outcome: 'published',
      resultVersionId: concurrentAResult.graph_version,
      headVersionIdAfter: engine.head(main.id).id,
      visibility: visible(engine, main.id),
    }));
    let conflictCode = null;
    try {
      engine.publishSession(concurrentB.id, sourceRevision);
    } catch (error) {
      conflictCode = error.code;
    }
    publicationAttempts.push(attempt({
      id: 'attempt:concurrent-b-conflict',
      branchId: main.id,
      baseVersionId: concurrentBase,
      outcome: 'compare_and_swap_failed',
      errorCode: conflictCode,
      headVersionIdAfter: engine.head(main.id).id,
      visibility: visible(engine, main.id),
    }));
    engine.rebaseSession(concurrentB.id);
    const rebasedBase = engine.head(main.id).id;
    const concurrentBResult = engine.publishSession(concurrentB.id, sourceRevision);
    publicationAttempts.push(attempt({
      id: 'attempt:concurrent-b-rebased-publication',
      branchId: main.id,
      baseVersionId: rebasedBase,
      outcome: 'published',
      resultVersionId: concurrentBResult.graph_version,
      headVersionIdAfter: engine.head(main.id).id,
      visibility: visible(engine, main.id),
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
    const featureResult = engine.publishSession(featureSession.id, featureContext.source_revision);
    publicationAttempts.push(attempt({
      id: 'attempt:feature-worktree-publication',
      branchId: feature.id,
      baseVersionId: featureBase,
      outcome: 'published',
      resultVersionId: featureResult.graph_version,
      headVersionIdAfter: engine.head(feature.id).id,
      visibility: visible(engine, feature.id),
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
      packet_id: 'packet:semantic-oracle',
      obligations: implementationObligations,
      experience_cases: [],
    })}\n`);
    const workMap = deriveWorkMap({ packetFile: packetPath });
    fs.unlinkSync(packetPath);

    const canonicalHeadBefore = engine.head(main.id).id;
    const catalogBefore = contextCatalog(root);
    const digestBefore = semanticDigest({ ...catalogBefore, storage: '<clone-local-derived-state>' });
    const catalogAfter = contextCatalog(root);
    const digestAfter = semanticDigest({ ...catalogAfter, storage: '<clone-local-derived-state>' });
    const canonicalHeadAfter = engine.head(main.id).id;

    const backupPath = path.join(temporary, 'current-graph.backup.json');
    engine.backup(backupPath);
    const backup = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
    const mainHead = engine.head(main.id).id;
    return adaptCurrentGraphBackup({
      fixtureId: FIXTURE_ID,
      backup,
      publicationAttempts,
      implementationObligations,
      workMap,
      derivedObservations: [
        {
          id: 'derived:main-retrieval-index',
          kind: 'retrieval_index',
          source_version_id: mainHead,
          catalog_before: catalogBefore,
          catalog_after: catalogAfter,
          digest_before: digestBefore,
          digest_after: digestAfter,
          canonical_head_before: canonicalHeadBefore,
          canonical_head_after: canonicalHeadAfter,
        },
      ],
    });
  } finally {
    engine.close();
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.stdout.write(`${JSON.stringify(runCurrentFixture(), null, 2)}\n`);
}
