import fs from 'node:fs';
import path from 'node:path';
import { graphRequest } from './graph-runtime/client.mjs';
import { canonical, digest, ensureRuntime, repositoryContext, runtimePaths } from './graph-runtime/util.mjs';
import { ensureRetrieval, queryRetrieval } from './retrieval-runtime/process.mjs';

const EXPERIENCE_CORE_SKILLS = [
  'lamina-product-behavior',
  'lamina-research',
  'lamina-ux',
];
const EXPERIENCE_CORE_REFERENCES = [
  'skills/lamina-product-behavior/references/product-behavior.md',
  'skills/lamina-product-behavior/references/invariants.md',
  'skills/lamina-research/references/user-modeling.md',
  'skills/lamina-ux/references/edge-cases.md',
  'skills/lamina-ux/references/forms.md',
  'skills/lamina-ux/references/error-handling.md',
  'skills/lamina-ux/references/feedback-and-status.md',
  'skills/lamina-ux/references/content-design.md',
];

function bad(message, details = {}) {
  const error = new Error(message);
  error.code = 'LAMINA_VALIDATION_FAILED';
  error.details = details;
  throw error;
}

function readJson(file, label) {
  if (!file) bad(`${label} is required.`);
  try { return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8')); } catch (error) {
    bad(`Unable to read ${label}: ${error.message}`);
  }
}

function atomicJson(file, value) {
  const absolute = path.resolve(file);
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  const temporary = `${absolute}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(canonical(value), null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, absolute);
  return absolute;
}

function obligation(type, scope, resource, statement = null, details = {}) {
  const identity = { type, scope, resource, statement, details };
  return { obligation_id: digest('obligation', identity), ...identity };
}

function compileObligations(workflowContext) {
  const { workflow, closure, resources, statements } = workflowContext;
  const byId = new Map(resources.map((item) => [item.id, item]));
  const output = [
    obligation('workflow_objective', workflow.id, workflow.id, null, workflow.data),
  ];
  for (const operationId of closure.operations) {
    output.push(obligation('operation_contract', workflow.id, operationId, null, byId.get(operationId)?.data || {}));
    for (const statement of statements.filter((item) =>
      item.object === operationId && ['lamina:authorizedFor', 'lamina:realizes'].includes(item.predicate))) {
      output.push(obligation(
        statement.predicate === 'lamina:authorizedFor' ? 'authority' : 'surface_realization',
        workflow.id,
        statement.subject,
        statement.id,
        { operation: operationId, qualifiers: statement.qualifiers || {} },
      ));
    }
  }
  for (const [kind, ids] of [
    ['invariant', closure.invariants],
    ['scenario', closure.scenarios],
    ['surface', closure.surfaces],
    ['proof_spec', closure.proofs],
    ['dependency', closure.dependencies],
  ]) {
    for (const id of ids) output.push(obligation(kind, workflow.id, id, null, byId.get(id)?.data || {}));
  }
  for (const walkId of closure.persona_walks || []) {
    const walk = byId.get(walkId);
    if (walk?.data?.schema !== 'lamina.persona-walk/v1') continue;
    output.push(obligation(
      'persona_walk',
      workflow.id,
      walkId,
      null,
      {
        persona: walk.data.persona_ref,
        goal: walk.data.goal,
        coverage_digest: walk.data.coverage_digest,
      },
    ));
    for (const node of walk.data.nodes || []) {
      output.push(obligation(
        'persona_flow_node',
        workflow.id,
        walkId,
        null,
        {
          persona: walk.data.persona_ref,
          node: node.id,
          operation: node.operation_ref,
          intent: node.intent,
          permission: node.permission,
          surface_refs: node.surface_refs || [],
        },
      ));
    }
  }
  return output;
}

export async function prepareWork({ requestFile, workflows = [], output }, cwd = process.cwd()) {
  const request = fs.readFileSync(path.resolve(requestFile), 'utf8').trim();
  if (!request) bad('The request file is empty.');
  const preparedRetrieval = await ensureRetrieval(cwd, {
    allowLexicalDegraded: workflows.length > 0,
  });
  const ranked = await queryRetrieval(request, preparedRetrieval, cwd);
  if (!workflows.length &&
      !['selected', 'multi_workflow'].includes(ranked.outcome)) {
    bad(
      ranked.outcome === 'new_workflow_required'
        ? 'No current Workflow is relevant enough. Design a new Workflow before editing source.'
        : 'Workflow selection is ambiguous. Name the intended Workflow with --workflow or refine the request.',
      { retrieval: ranked },
    );
  }
  const selectedRefs = workflows.length ? workflows : ranked.selected_workflow_ids;
  const graph = await graphRequest('work.context', { workflows: selectedRefs, request }, cwd);
  if (!graph.implementation_ready) {
    bad('Product graph context is not implementation-ready. Complete the reported design gaps before editing source.', {
      readiness_gaps: graph.readiness_gaps,
      graph_version: graph.graph_version?.id,
    });
  }
  const obligations = graph.workflows.flatMap(compileObligations);
  const experienceCases = graph.workflows.flatMap((item) => item.experience_cases || []);
  const hasPersonaWalks = graph.workflows.some((item) =>
    (item.closure?.personas || []).length ||
    (item.closure?.persona_walks || []).length);
  const packetBody = {
    schema: 'lamina.implementation-packet/v5',
    request,
    source: {
      graph_version: graph.graph_version?.id,
      graph_source_revision: graph.graph_version?.source_revision,
      source_revision: graph.source_revision,
    },
    objective: request,
    scope: graph.workflows.map((item) => item.workflow.id),
    non_goals: graph.workflows.flatMap((item) => item.workflow.data?.non_goals || []),
    workflows: graph.workflows,
    obligations,
    experience_cases: experienceCases,
    activated_skills: [...new Set([
      ...(hasPersonaWalks ? EXPERIENCE_CORE_SKILLS : []),
      ...graph.workflows.flatMap((item) =>
        item.workflow.data?.skills || item.workflow.data?.activated_skills || []),
    ])],
    activated_skill_references: hasPersonaWalks ? EXPERIENCE_CORE_REFERENCES : [],
    retrieval: {
      generation: ranked.generation,
      freshness: ranked.freshness,
      model_digest: ranked.model_digest,
      index_digest: ranked.index_digest,
      candidates: ranked.candidates,
      match_reasons: Object.fromEntries(
        ranked.candidates.map((item) => [item.workflow_id, item.reasons]),
      ),
      outcome: workflows.length ? 'selected' : ranked.outcome,
      selected_workflow_ids: graph.workflows.map((item) => item.workflow.id),
      explicit_workflow_bypass: workflows.length > 0,
      source_chunks: ranked.source_chunks,
      degradation: ranked.degradation,
    },
    verification_contract: {
      work_map_is_immutable_after_check: true,
      graph_must_remain_implementation_ready: true,
      every_experience_case_requires_published_mission_evidence: true,
      ui_surfaces_require: ['functional', 'visual', 'responsive', 'accessibility'],
      missing_capability_blocks_verification: true,
    },
    omitted_context: {
      policy: 'Hybrid retrieval selects roots and source chunks; only exact graph closure and direct provenance define implementation instructions.',
    },
  };
  const packet = { ...packetBody, packet_id: digest('packet', packetBody) };
  if (output) atomicJson(output, packet);
  return { ...packet, output: output ? path.resolve(output) : null };
}

export function deriveWorkMap({ packetFile, output }) {
  const packet = readJson(packetFile, '--packet');
  if (packet.schema !== 'lamina.implementation-packet/v5') {
    if (packet.schema === 'lamina.implementation-packet/v4') {
      bad('ImplementationPacket v4 is no longer supported. Rerun lamina work prepare to create a v5 packet.');
    }
    bad(`Unsupported ImplementationPacket schema: ${packet.schema}. Rerun lamina work prepare.`);
  }
  if (!Array.isArray(packet.obligations) || !Array.isArray(packet.experience_cases)) {
    bad('ImplementationPacket lacks mechanically derivable obligations or Experience Cases.');
  }
  const obligationIds = packet.obligations.map((item) => item?.obligation_id);
  const caseIds = packet.experience_cases.map((item) => item?.case_id);
  if (
    obligationIds.some((id) => !presentId(id)) ||
    caseIds.some((id) => !presentId(id)) ||
    new Set(obligationIds).size !== obligationIds.length ||
    new Set(caseIds).size !== caseIds.length
  ) {
    bad('ImplementationPacket contains missing or duplicate requirement identities.');
  }
  const map = {
    schema: 'lamina.work-map/v4',
    packet_id: packet.packet_id,
    obligations: obligationIds.map((obligation_id) => ({
      obligation_id,
      status: 'unresolved',
      current_evidence: [],
      files: [],
    })),
    experience_cases: caseIds.map((case_id) => ({
      case_id,
      status: 'unresolved',
      current_evidence: [],
      files: [],
    })),
  };
  if (output) atomicJson(output, map);
  return { ...map, output: output ? path.resolve(output) : null };
}

function presentId(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function relativeRepositoryPath(value) {
  return typeof value === 'string' &&
    value.trim() === value &&
    value.length > 0 &&
    !path.isAbsolute(value) &&
    !value.split(/[\\/]/).includes('..') &&
    value.split(/[\\/]/)[0] !== '.git';
}

function insideRepository(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function validateWorkFiles(rows, cwd, phase = 'check') {
  const repo = repositoryContext(cwd);
  const realRoot = fs.realpathSync(repo.root);
  const invalidFiles = [];
  const actions = new Map();
  for (const row of rows) {
    for (const file of row.files || []) {
      const filePath = file?.path;
      if (!relativeRepositoryPath(filePath) ||
          !['modify', 'create'].includes(file?.action) ||
          !['implementation', 'test'].includes(file?.role)) {
        invalidFiles.push({
          id: row.obligation_id || row.case_id,
          path: filePath || null,
          reason: 'invalid_file_mapping',
        });
        continue;
      }
      if (actions.has(filePath) && actions.get(filePath) !== file.action) {
        invalidFiles.push({
          id: row.obligation_id || row.case_id,
          path: filePath,
          reason: 'conflicting_actions',
        });
        continue;
      }
      actions.set(filePath, file.action);
      const absolute = path.resolve(repo.root, filePath);
      if (file.action === 'modify' || phase === 'verify') {
        let real;
        let stat;
        try {
          real = fs.realpathSync(absolute);
          stat = fs.statSync(real);
        } catch {}
        if (!real || !insideRepository(realRoot, real) || !stat?.isFile()) {
          invalidFiles.push({
            id: row.obligation_id || row.case_id,
            path: filePath,
            action: file.action,
            reason: !real
              ? file.action === 'create' ? 'planned_file_missing' : 'missing'
              : !insideRepository(realRoot, real) ? 'outside_repository' : 'not_a_file',
          });
        }
        continue;
      }
      if (fs.existsSync(absolute)) {
        invalidFiles.push({
          id: row.obligation_id || row.case_id,
          path: filePath,
          reason: 'already_exists_use_modify',
        });
        continue;
      }
      let ancestor = path.dirname(absolute);
      while (!fs.existsSync(ancestor) && ancestor !== path.dirname(ancestor)) {
        ancestor = path.dirname(ancestor);
      }
      let realAncestor;
      let stat;
      try {
        realAncestor = fs.realpathSync(ancestor);
        stat = fs.statSync(realAncestor);
      } catch {}
      if (!realAncestor || !insideRepository(realRoot, realAncestor) || !stat?.isDirectory()) {
        invalidFiles.push({
          id: row.obligation_id || row.case_id,
          path: filePath,
          reason: !realAncestor || !insideRepository(realRoot, realAncestor)
            ? 'ancestor_outside_repository'
            : 'ancestor_not_directory',
        });
      }
    }
  }
  if (invalidFiles.length) {
    bad('Every WorkMap file must declare modify for an existing repository file or create for a planned in-repository file.', {
      invalid_files: invalidFiles,
    });
  }
}

function validateWorkMap(packet, map, cwd, phase = 'check') {
  if (packet.schema !== 'lamina.implementation-packet/v5') {
    if (packet.schema === 'lamina.implementation-packet/v4') {
      bad('ImplementationPacket v4 is no longer supported. Rerun lamina work prepare to create a v5 packet.');
    }
    bad(`Unsupported ImplementationPacket schema: ${packet.schema}. Rerun lamina work prepare.`);
  }
  if (map.schema !== 'lamina.work-map/v4') bad('WorkMap schema must be lamina.work-map/v4.');
  if (map.packet_id !== packet.packet_id) bad('WorkMap packet_id does not match the ImplementationPacket.');
  const rows = map.obligations || [];
  const entries = new Map(rows.map((item) => [item.obligation_id, item]));
  const missing = packet.obligations.filter((item) => !entries.has(item.obligation_id)).map((item) => item.obligation_id);
  const unknown = [...entries.keys()].filter((id) => !packet.obligations.some((item) => item.obligation_id === id));
  const allowed = new Set(['already_satisfied', 'change_required', 'blocked']);
  const invalid = [...entries.values()].filter((item) =>
    !allowed.has(item.status) ||
    !Array.isArray(item.current_evidence) ||
    !Array.isArray(item.files) ||
    (item.status === 'change_required' && (
      !item.files.length ||
      !item.files.some((file) => file?.role === 'implementation')
    )) ||
    (item.status === 'already_satisfied' && !item.current_evidence.length));
  const duplicates = rows.length !== entries.size;
  if (missing.length || unknown.length || invalid.length || duplicates) {
    bad('WorkMap must map every packet obligation exactly once.', {
      missing, unknown, duplicates, invalid: invalid.map((item) => item.obligation_id),
    });
  }
  const blocked = [...entries.values()].filter((item) => item.status === 'blocked');
  if (blocked.length) bad('WorkMap contains blocked obligations.', {
    blocked: blocked.map((item) => item.obligation_id),
  });
  const caseRows = map.experience_cases || [];
  const caseEntries = new Map(caseRows.map((item) => [item.case_id, item]));
  const expectedCases = packet.experience_cases || [];
  const missingCases = expectedCases
    .filter((item) => !caseEntries.has(item.case_id))
    .map((item) => item.case_id);
  const unknownCases = [...caseEntries.keys()]
    .filter((id) => !expectedCases.some((item) => item.case_id === id));
  const invalidCases = [...caseEntries.values()].filter((item) =>
    !allowed.has(item.status) ||
    !Array.isArray(item.current_evidence) ||
    !Array.isArray(item.files) ||
    (item.status === 'change_required' && (
      !item.files.length ||
      !item.files.some((file) => file?.role === 'test')
    )) ||
    (item.status === 'already_satisfied' && !item.current_evidence.length));
  const duplicateCases = caseRows.length !== caseEntries.size;
  if (missingCases.length || unknownCases.length || invalidCases.length || duplicateCases) {
    bad('WorkMap must map every Experience Case exactly once to implementation and test files.', {
      missing: missingCases,
      unknown: unknownCases,
      duplicates: duplicateCases,
      invalid: invalidCases.map((item) => item.case_id),
    });
  }
  const blockedCases = [...caseEntries.values()].filter((item) => item.status === 'blocked');
  if (blockedCases.length) bad('WorkMap contains blocked Experience Cases.', {
    blocked: blockedCases.map((item) => item.case_id),
  });
  validateWorkFiles([...entries.values(), ...caseEntries.values()], cwd, phase);
  return { obligations: entries, cases: caseEntries };
}

const UI_AUDIT_KINDS = ['functional', 'visual', 'responsive', 'accessibility'];

export function publishedMissionEvidence(packet, graph, sourceRevision) {
  const resources = graph?.resources || [];
  const missions = resources.filter((resource) =>
    resource.kind === 'mission' &&
    resource.data?.epistemic_class === 'intended' &&
    packet.scope.includes(resource.data?.workflow));
  const missionByWorkflowPersona = new Map(
    missions.map((mission) => [
      `${mission.data.workflow}:${mission.data.persona}`,
      mission,
    ]),
  );
  const expected = packet.workflows.flatMap((workflow) =>
    (workflow.closure?.personas || []).map((persona) => ({
      workflow: workflow.workflow.id,
      persona,
    })));
  const missing = [];
  if (!expected.length) missing.push({
    kind: 'persona_mission',
    reason: 'No active Persona is in the selected Workflow closure.',
  });
  const runs = resources.filter((resource) =>
    resource.kind === 'run' &&
    resource.data?.epistemic_class === 'runtime_evidence' &&
    resource.data?.source_revision === sourceRevision);
  const harnesses = resources.filter((resource) =>
    resource.kind === 'harness_result' &&
    resource.data?.epistemic_class === 'runtime_evidence');
  const accepted = [];

  for (const requirement of expected) {
    const mission = missionByWorkflowPersona.get(`${requirement.workflow}:${requirement.persona}`);
    if (!mission) {
      missing.push({ ...requirement, kind: 'published_mission' });
      continue;
    }
    const candidates = runs.filter((run) => run.data?.mission === mission.id);
    let acceptedRun = null;
    for (const run of candidates) {
      const harness = harnesses.find((item) =>
        item.data?.run === run.id && item.data?.mission === mission.id);
      const events = harness?.data?.events || [];
      const expectedCaseIds = new Set((mission.data?.experience_cases || [])
        .map((item) => item.case_id));
      const passedCaseIds = new Set(events
        .filter((event) => event.type === 'oracle_passed')
        .map((event) => event.case_id)
        .filter(Boolean));
      const auditEvents = events.filter((event) => event.type === 'audit_passed');
      const auditKinds = new Set(auditEvents.map((event) => event.audit_kind));
      const artifacts = auditEvents.map((event) => event.artifact).filter(Boolean);
      const artifactDigests = artifacts.map((artifact) => artifact.digest).filter(Boolean);
      const artifactLocators = artifacts.map((artifact) => artifact.locator).filter(Boolean);
      const failed = events.some((event) =>
        ['oracle_failed', 'budget_failure', 'capability_failure'].includes(event.type));
      const oracleArtifacts = events
        .filter((event) => event.type === 'oracle_passed')
        .map((event) => event.artifact)
        .filter(Boolean);
      const oracleArtifactsValid = oracleArtifacts.length >= expectedCaseIds.size &&
        oracleArtifacts.every((artifact) =>
          artifact.digest && artifact.locator && fs.existsSync(artifact.locator));
      const auditsScoped = auditEvents.every((event) =>
        (mission.data?.closure?.surfaces || []).includes(event.surface) &&
        typeof event.state === 'string' && event.state.trim());
      const uiRequired = (mission.data?.closure?.surfaces || []).length > 0;
      const uiValid = !uiRequired || (
        UI_AUDIT_KINDS.every((kind) => auditKinds.has(kind)) &&
        auditsScoped &&
        artifacts.length >= UI_AUDIT_KINDS.length &&
        artifactDigests.length === artifacts.length &&
        new Set(artifactDigests).size === artifacts.length &&
        artifactLocators.length === artifacts.length &&
        artifactLocators.every((locator) => fs.existsSync(locator))
      );
      if (
        [...expectedCaseIds].every((caseId) => passedCaseIds.has(caseId)) &&
        oracleArtifactsValid &&
        !failed &&
        uiValid
      ) {
        acceptedRun = { mission: mission.id, run: run.id, harness_result: harness.id };
        break;
      }
    }
    if (acceptedRun) accepted.push(acceptedRun);
    else missing.push({ ...requirement, mission: mission.id, kind: 'published_mission_run' });
  }
  return { ok: missing.length === 0, accepted, missing };
}

export function checkWork({ packetFile, mapFile }, cwd = process.cwd()) {
  const packet = readJson(packetFile, '--packet');
  const map = readJson(mapFile, '--map');
  validateWorkMap(packet, map, cwd);
  const repo = repositoryContext(cwd);
  if (packet.source?.source_revision !== repo.source_revision) {
    bad('Source changed after the ImplementationPacket was prepared. Prepare context again.', {
      packet_source_revision: packet.source?.source_revision,
      current_source_revision: repo.source_revision,
    });
  }
  const receiptBody = {
    schema: 'lamina.work-started/v4',
    packet_id: packet.packet_id,
    source_revision: repo.source_revision,
    created_at: new Date().toISOString(),
    work_map_digest: digest('work_map', map),
    work_map: map,
  };
  const receipt = { ...receiptBody, receipt_id: digest('work_started', receiptBody) };
  const paths = runtimePaths(cwd);
  ensureRuntime(paths);
  const file = atomicJson(path.join(paths.work, `${packet.packet_id}.started.json`), receipt);
  return { ...receipt, receipt: file };
}

export async function verifyWork({ packetFile, mapFile }, cwd = process.cwd()) {
  const packet = readJson(packetFile, '--packet');
  const map = readJson(mapFile, '--map');
  const paths = runtimePaths(cwd);
  ensureRuntime(paths);
  const started = path.join(paths.work, `${packet.packet_id}.started.json`);
  if (!fs.existsSync(started)) bad('No WorkStarted receipt exists. Run lamina work check before editing.');
  const startedReceipt = readJson(started, 'WorkStarted receipt');
  if (startedReceipt.schema !== 'lamina.work-started/v4' ||
      startedReceipt.work_map_digest !== digest('work_map', map)) {
    bad('WorkMap changed after WorkStarted. Preserve the checked requirement-to-file map through verification.');
  }
  validateWorkMap(packet, map, cwd, 'verify');
  const status = await graphRequest('status', {}, cwd);
  if (status.stale) bad('The graph is stale for the current source. Observe and reconcile it before verification.', status);
  const validation = await graphRequest('graph.validate', { at: 'HEAD' }, cwd);
  if (!validation.structural_valid || !validation.implementation_ready) {
    bad('The current graph is not implementation-ready.', validation);
  }
  const graph = await graphRequest('graph.query', { at: 'HEAD' }, cwd);
  const missionEvidence = publishedMissionEvidence(packet, graph, status.source_revision);
  if (!missionEvidence.ok) {
    bad('Published live Mission evidence is incomplete.', {
      missing: missionEvidence.missing,
    });
  }
  const repo = repositoryContext(cwd);
  const receiptBody = {
    schema: 'lamina.work-verified/v4',
    verified: true,
    packet_id: packet.packet_id,
    graph_version: status.graph_version,
    source_revision: repo.source_revision,
    created_at: new Date().toISOString(),
    evidence_count: missionEvidence.accepted.length,
    mission_evidence: missionEvidence.accepted,
    work_started_receipt_id: startedReceipt.receipt_id,
    work_map_digest: digest('work_map', map),
  };
  const receipt = { ...receiptBody, receipt_id: digest('work_verified', receiptBody) };
  const file = atomicJson(path.join(paths.work, `${packet.packet_id}.verified.json`), receipt);
  return { ...receipt, verified: true, receipt: file };
}
