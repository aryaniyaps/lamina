import fs from 'node:fs';
import path from 'node:path';
import { graphRequest } from './graph-runtime/client.mjs';
import { canonical, digest, ensureRuntime, repositoryContext, runtimePaths } from './graph-runtime/util.mjs';
import { contextCatalog, sourceCandidates } from './context-index.mjs';

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
  return output;
}

export async function prepareWork({ requestFile, workflows = [], output }, cwd = process.cwd()) {
  const request = fs.readFileSync(path.resolve(requestFile), 'utf8').trim();
  if (!request) bad('The request file is empty.');
  const graph = await graphRequest('work.context', { workflows, request }, cwd);
  if (!graph.implementation_ready) {
    bad('Product graph context is not implementation-ready. Complete the reported design gaps before editing source.', {
      readiness_gaps: graph.readiness_gaps,
      graph_version: graph.graph_version?.id,
    });
  }
  const obligations = graph.workflows.flatMap(compileObligations);
  const packetBody = {
    schema: 'lamina.implementation-packet/v1',
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
    activated_skills: [...new Set(graph.workflows.flatMap((item) =>
      item.workflow.data?.skills || item.workflow.data?.activated_skills || []))],
    source_retrieval: {
      catalog: contextCatalog(cwd),
      candidates: sourceCandidates([
        request,
        ...graph.workflows.map((item) => item.workflow.data?.name || item.workflow.id),
        ...obligations.map((item) => JSON.stringify(item.details)),
      ].join('\n'), cwd),
    },
    verification_contract: {
      every_obligation_requires_passing_evidence: true,
      ui_surfaces_require: ['functional', 'visual', 'responsive', 'accessibility'],
      missing_capability_blocks_verification: true,
    },
    omitted_context: {
      policy: 'Only exact workflow closure, direct provenance, and ranked source candidates are included.',
      dense_retrieval: 'lexical_degraded',
    },
  };
  const packet = { ...packetBody, packet_id: digest('packet', packetBody) };
  if (output) atomicJson(output, packet);
  return { ...packet, output: output ? path.resolve(output) : null };
}

function validateWorkMap(packet, map) {
  if (map.schema !== 'lamina.work-map/v1') bad('WorkMap schema must be lamina.work-map/v1.');
  if (map.packet_id !== packet.packet_id) bad('WorkMap packet_id does not match the ImplementationPacket.');
  const rows = map.obligations || [];
  const entries = new Map(rows.map((item) => [item.obligation_id, item]));
  const missing = packet.obligations.filter((item) => !entries.has(item.obligation_id)).map((item) => item.obligation_id);
  const unknown = [...entries.keys()].filter((id) => !packet.obligations.some((item) => item.obligation_id === id));
  const allowed = new Set(['already_satisfied', 'change_required', 'blocked']);
  const verificationStatuses = new Set(['planned', 'passed', 'failed', 'blocked']);
  const invalid = [...entries.values()].filter((item) =>
    !allowed.has(item.status) ||
    !Array.isArray(item.current_evidence) ||
    !Array.isArray(item.targets) ||
    !Array.isArray(item.verification) ||
    !item.verification.length ||
    item.verification.some((proof) => !proof.kind || !verificationStatuses.has(proof.status)) ||
    (item.status === 'change_required' && !item.targets.length) ||
    (item.status === 'already_satisfied' && !item.current_evidence.length) ||
    item.targets.some((target) => path.isAbsolute(target) || target.split(/[\\/]/).includes('..')));
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
  return entries;
}

export function checkWork({ packetFile, mapFile }, cwd = process.cwd()) {
  const packet = readJson(packetFile, '--packet');
  const map = readJson(mapFile, '--map');
  validateWorkMap(packet, map);
  const repo = repositoryContext(cwd);
  if (packet.source?.source_revision !== repo.source_revision) {
    bad('Source changed after the ImplementationPacket was prepared. Prepare context again.', {
      packet_source_revision: packet.source?.source_revision,
      current_source_revision: repo.source_revision,
    });
  }
  const receiptBody = {
    schema: 'lamina.work-started/v1',
    packet_id: packet.packet_id,
    source_revision: repo.source_revision,
    created_at: new Date().toISOString(),
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
  const entries = validateWorkMap(packet, map);
  const paths = runtimePaths(cwd);
  ensureRuntime(paths);
  const started = path.join(paths.work, `${packet.packet_id}.started.json`);
  if (!fs.existsSync(started)) bad('No WorkStarted receipt exists. Run lamina work check before editing.');
  const status = await graphRequest('status', {}, cwd);
  if (status.stale) bad('The graph is stale for the current source. Observe and reconcile it before verification.', status);

  const missing = [];
  for (const obligation of packet.obligations) {
    const entry = entries.get(obligation.obligation_id);
    const passed = entry.verification.filter((item) => item.status === 'passed' &&
      item.artifact && fs.existsSync(path.resolve(item.artifact)));
    if (!passed.length) missing.push({ obligation_id: obligation.obligation_id, kind: 'passing_evidence' });
    if (obligation.type === 'surface' || obligation.type === 'surface_realization') {
      for (const kind of packet.verification_contract.ui_surfaces_require) {
        if (!passed.some((item) => item.kind === kind)) {
          missing.push({ obligation_id: obligation.obligation_id, kind });
        }
      }
      if (new Set(passed.map((item) => path.resolve(item.artifact))).size !== passed.length) {
        missing.push({ obligation_id: obligation.obligation_id, kind: 'independent_audit_artifacts' });
      }
    }
  }
  if (missing.length) bad('Verification evidence is incomplete.', { missing });
  const repo = repositoryContext(cwd);
  const receiptBody = {
    schema: 'lamina.work-verified/v1',
    verified: true,
    packet_id: packet.packet_id,
    graph_version: status.graph_version,
    source_revision: repo.source_revision,
    created_at: new Date().toISOString(),
    evidence_count: [...entries.values()].flatMap((item) => item.verification).length,
  };
  const receipt = { ...receiptBody, receipt_id: digest('work_verified', receiptBody) };
  const file = atomicJson(path.join(paths.work, `${packet.packet_id}.verified.json`), receipt);
  return { ...receipt, verified: true, receipt: file };
}
