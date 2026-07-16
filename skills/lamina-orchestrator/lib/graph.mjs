import fs from 'node:fs';
import path from 'node:path';
import { CONTRACT_VERSION, loadRunJson, validateRunFields } from './run.mjs';

const list = (value) => (Array.isArray(value) ? value : []);
const active = (items) => list(items).filter((item) => item.criticality !== 'deferred');
const KIND_BY_COLLECTION = Object.freeze({
  actors: 'actor',
  entities: 'entity',
  operations: 'operation',
  workflows: 'workflow',
  invariants: 'invariant',
  dependencies: 'dependency',
  surfaces: 'surface',
  scenarios: 'scenario',
});

export function createRun({ id, target, problem, outcome, users = [], stage = 'spark', hook = 'design' }) {
  return {
    contract_version: CONTRACT_VERSION,
    id,
    status: 'draft',
    stage,
    hook,
    target,
    intent: {
      problem,
      outcome,
      users,
      critical_promises: [],
      success_signals: [],
      constraints: [],
      scope: { in: [], out: [] },
    },
    decisions: { assumptions: [], forks: [] },
    actors: [],
    entities: [],
    operations: [],
    workflows: [],
    invariants: [],
    dependencies: [],
    surfaces: [],
    scenarios: [],
    persona_findings: [],
    traceability: [],
    findings: [],
    evidence: [],
  };
}

function slug(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 56) || 'risk';
}

function scenarioMeta(reason) {
  return {
    criticality: 'supporting',
    source: 'derived',
    confidence: 'high',
    relevance_reason: reason,
  };
}

export function deriveScenarioSuggestions(run) {
  const existing = new Set(list(run.scenarios).map((item) => item.risk_key).filter(Boolean));
  const suggestions = [];
  const add = (scenario) => {
    if (!existing.has(scenario.risk_key)) {
      existing.add(scenario.risk_key);
      suggestions.push(scenario);
    }
  };

  for (const operation of active(run.operations)) {
    for (const failure of list(operation.failures)) {
      const key = `failure:${operation.id}:${slug(failure.code || failure.outcome || failure)}`;
      add({
        id: slug(key),
        ...scenarioMeta(`Distinct failure outcome for operation.${operation.id}`),
        kind: 'failure',
        risk_key: key,
        given: list(failure.given),
        when: { operation_ref: `operation.${operation.id}` },
        then: list(failure.then).length ? failure.then : [String(failure.outcome || failure)],
        covers: [`operation.${operation.id}`],
      });
    }
    if (operation.destructive === true) {
      const key = `recovery:${operation.id}:destructive`;
      add({
        id: slug(key),
        ...scenarioMeta(`Destructive operation.${operation.id} requires confirmation and recovery`),
        criticality: operation.criticality,
        kind: 'recovery',
        risk_key: key,
        given: ['The destructive action is available'],
        when: { operation_ref: `operation.${operation.id}` },
        then: ['The consequence is explicit', 'Cancellation is safe', 'Recovery or irreversibility is explained'],
        covers: [`operation.${operation.id}`],
      });
    }
  }

  for (const dependency of active(run.dependencies)) {
    const key = `dependency:${dependency.id}:unmet`;
    add({
      id: slug(key),
      ...scenarioMeta(`Unmet behavior for dependency.${dependency.id}`),
      criticality: dependency.criticality,
      kind: 'boundary',
      risk_key: key,
      given: [`dependency.${dependency.id} is unmet`],
      when: { operation_ref: dependency.operation_ref || firstOperationRef(run, dependency.from) },
      then: [dependency.unmet_behavior],
      covers: [`dependency.${dependency.id}`, dependency.from, dependency.to].filter(Boolean),
    });
  }

  return suggestions.filter((scenario) => scenario.when.operation_ref);
}

function firstOperationRef(run, fromRef) {
  if (String(fromRef || '').startsWith('operation.')) return fromRef;
  if (String(fromRef || '').startsWith('workflow.')) {
    const id = fromRef.slice('workflow.'.length);
    const workflow = list(run.workflows).find((item) => item.id === id);
    return workflow?.steps?.[0]?.operation_ref;
  }
  return undefined;
}

function section(title, rows) {
  return rows.length ? `\n## ${title}\n\n${rows.join('\n')}\n` : '';
}

function nodeLine(item, detail = '') {
  return `- **${item.id}** [${item.criticality}]${detail ? ` — ${detail}` : ''}`;
}

export function renderRunMarkdown(run) {
  const intent = run.intent || {};
  let output = `# ${run.target || run.id}\n\n`;
  output += `Stage: **${run.stage}** · Status: **${run.status}** · Contract: **${run.contract_version}**\n\n`;
  output += `## Intent\n\n${intent.problem || ''}\n\n**Outcome:** ${intent.outcome || ''}\n`;
  output += section('Critical promises', list(intent.critical_promises).map((item) => nodeLine(item, item.promise)));
  output += section('Actors', active(run.actors).map((item) => nodeLine(item, item.goal || item.relevance_reason)));
  output += section('Entities and lifecycles', active(run.entities).map((item) => nodeLine(item, `${list(item.states).join(' → ') || 'no lifecycle states'}`)));
  output += section('Operations', active(run.operations).map((item) => nodeLine(item, item.outcome || item.relevance_reason)));
  output += section('Workflows', active(run.workflows).map((item) => nodeLine(item, `${list(item.steps).map((step) => step.operation_ref).join(' → ')}`)));
  output += section('Rules and invariants', active(run.invariants).map((item) => nodeLine(item, item.rule)));
  output += section('Dependencies', active(run.dependencies).map((item) => nodeLine(item, `${item.from} requires ${item.to}; unmet: ${item.unmet_behavior}`)));
  output += section('Scenarios', active(run.scenarios).map((item) => nodeLine(item, `${item.kind}: ${list(item.then).join('; ')}`)));
  output += section('Decision forks', list(run.decisions?.forks).map((item) => `- **${item.id}** [${item.status || 'unresolved'}] — ${item.question || item.statement}`));
  output += section('Persona findings', list(run.persona_findings).map((item) => `- **${item.id}** [${item.classification}] — ${item.finding}`));
  return `${output.trim()}\n`;
}

export function renderImplementMarkdown(run) {
  const errors = validateRunFields(run, 'run.json');
  if (errors.length) throw new Error(`Cannot render implementation contract:\n${errors.join('\n')}`);
  const intent = run.intent || {};
  let output = `# Implement: ${run.target || run.id}\n\nSource: \`run.json\` contract ${run.contract_version}\n\n`;
  output += `## Product outcome\n\n${intent.outcome}\n`;
  output += section('Must preserve', list(intent.critical_promises).map((item) => `- [ ] **promise.${item.id}** — ${item.promise}`));
  output += section('Actors and authority', active(run.actors).map((item) => `- **actor.${item.id}** — ${item.goal || item.relevance_reason}; permissions: ${list(item.permissions).join(', ') || 'none specified'}`));
  output += section('Domain and state', active(run.entities).map((item) => `- **entity.${item.id}** — states: ${list(item.states).join(', ')}`));
  output += section('Operations', active(run.operations).map((item) => `- [ ] **operation.${item.id}** — ${item.outcome || item.relevance_reason}`));
  output += section('Workflow acceptance', active(run.workflows).map((item) => `- [ ] **workflow.${item.id}** — ${list(item.steps).map((step) => step.operation_ref).join(' → ')}; terminal outcomes: ${list(item.terminal_outcomes).join(', ')}`));
  output += section('Rules', active(run.invariants).map((item) => `- [ ] **invariant.${item.id}** — ${item.rule}`));
  output += section('Risk scenarios', active(run.scenarios).map((item) => `- [ ] **scenario.${item.id}** — Given ${list(item.given).join('; ') || 'the workflow context'}, when ${item.when?.operation_ref}, then ${list(item.then).join('; ')}`));
  output += section('In scope', list(intent.scope?.in).map((item) => `- ${item}`));
  output += section('Out of scope', list(intent.scope?.out).map((item) => `- ${item}`));
  return `${output.trim()}\n`;
}

export function coverageReport(run) {
  const promises = list(run.intent?.critical_promises);
  const traced = new Set(list(run.traceability).filter((item) => list(item.graph_refs).length).map((item) => item.promise_ref));
  const critical = [...active(run.operations), ...active(run.workflows), ...active(run.invariants)].filter((item) => item.criticality === 'critical');
  const scenarioRefs = new Set(list(run.scenarios).flatMap((item) => list(item.covers)));
  return {
    promises: { total: promises.length, traced: promises.filter((item) => traced.has(`promise.${item.id}`)).length },
    critical_nodes: { total: critical.length, scenario_covered: critical.filter((item) => scenarioRefs.has(`${kindFor(run, item)}.${item.id}`)).length },
    unresolved_blocking_forks: list(run.decisions?.forks).filter((item) => item.blocking && item.status !== 'resolved').map((item) => item.id),
    deferred_nodes: Object.entries(KIND_BY_COLLECTION).flatMap(([key, kind]) => list(run[key]).filter((item) => item.criticality === 'deferred').map((item) => `${kind}.${item.id}`)),
  };
}

function kindFor(run, item) {
  for (const key of ['operations', 'workflows', 'invariants']) if (list(run[key]).includes(item)) return key.slice(0, -1);
  return 'node';
}

export function scopeRun(run, refs) {
  const selected = new Set(refs);
  const add = (ref) => {
    if (!ref || selected.has(ref)) return false;
    selected.add(ref);
    return true;
  };
  for (const [key, kind] of Object.entries(KIND_BY_COLLECTION)) {
    for (const item of list(run[key])) if (item.criticality === 'critical') add(`${kind}.${item.id}`);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const dependency of list(run.dependencies)) {
      const dependencyRef = `dependency.${dependency.id}`;
      if (selected.has(dependencyRef)) {
        changed = add(dependency.from) || add(dependency.to) || changed;
      } else if (selected.has(dependency.from)) {
        changed = add(dependency.to) || add(dependencyRef) || changed;
      }
    }
    for (const workflow of list(run.workflows)) {
      if (selected.has(`workflow.${workflow.id}`)) {
        changed = add(workflow.actor_ref) || changed;
        for (const step of list(workflow.steps)) changed = add(step.operation_ref) || changed;
        for (const ref of list(workflow.dependency_refs)) changed = add(ref) || changed;
      }
    }
    for (const operation of list(run.operations)) {
      if (!selected.has(`operation.${operation.id}`)) continue;
      for (const ref of list(operation.actor_refs)) changed = add(ref) || changed;
      for (const transition of list(operation.transitions)) changed = add(transition.entity_ref) || changed;
      for (const ref of list(operation.enforces)) changed = add(ref) || changed;
    }
    for (const entity of list(run.entities)) {
      if (!selected.has(`entity.${entity.id}`)) continue;
      for (const relationship of list(entity.relationships)) changed = add(relationship.to) || changed;
    }
    for (const scenario of list(run.scenarios)) {
      if (!selected.has(`scenario.${scenario.id}`)) continue;
      changed = add(scenario.when?.operation_ref) || changed;
      for (const ref of list(scenario.covers)) changed = add(ref) || changed;
    }
    for (const surface of list(run.surfaces)) {
      if (!selected.has(`surface.${surface.id}`)) continue;
      for (const ref of [...list(surface.graph_refs), ...list(surface.workflow_refs), ...list(surface.operation_refs)]) changed = add(ref) || changed;
    }
    for (const trace of list(run.traceability)) {
      if (selected.has(trace.promise_ref)) for (const ref of list(trace.graph_refs)) changed = add(ref) || changed;
    }
  }
  const scoped = structuredClone(run);
  for (const [key, kind] of Object.entries(KIND_BY_COLLECTION)) {
    scoped[key] = list(run[key]).filter((item) => selected.has(`${kind}.${item.id}`) || item.criticality === 'critical');
  }
  scoped.traceability = list(run.traceability).filter((item) => list(item.graph_refs).some((ref) => selected.has(ref)));
  return scoped;
}

export function writeGeneratedArtifacts(runPath) {
  const run = loadRunJson(runPath);
  const dir = path.dirname(path.resolve(runPath));
  fs.writeFileSync(path.join(dir, 'run.md'), renderRunMarkdown(run));
  if (run.status === 'ready_to_build') fs.writeFileSync(path.join(dir, 'implement.md'), renderImplementMarkdown(run));
}
