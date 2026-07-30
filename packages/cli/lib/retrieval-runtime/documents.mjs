import crypto from 'node:crypto';
import { canonical, repositoryContext } from '../graph-runtime/util.mjs';

function compact(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.length ? value : null;
  if (typeof value === 'object') return Object.keys(value).length ? value : null;
  return value;
}

function named(resources, ids) {
  const byId = new Map(resources.map((item) => [item.id, item]));
  return ids.map((id) => {
    const resource = byId.get(id);
    return {
      id,
      name: resource?.data?.name || resource?.data?.title || null,
      data: canonical(resource?.data || {}),
    };
  });
}

export function retrievalIdentity(cwd = process.cwd()) {
  const repository = repositoryContext(cwd);
  const identity = crypto.createHash('sha256')
    .update(`${repository.common}\0${repository.root}\0${repository.branch}`)
    .digest('hex')
    .slice(0, 32);
  return {
    identity: `retrieval_${identity}`,
    repository_revision: repository.revision || '',
    branch: repository.branch,
    worktree: repository.root,
    source_revision: repository.source_revision,
  };
}

export function workflowDocuments(workflowContexts = []) {
  return workflowContexts.map((context) => {
    const { workflow, closure, resources } = context;
    const aliases = [...new Set([
      workflow.id,
      workflow.data?.name,
      workflow.data?.alias,
      ...(workflow.data?.aliases || []),
    ].filter(Boolean))].sort();
    const sections = canonical({
      workflow: {
        id: workflow.id,
        name: workflow.data?.name || null,
        aliases,
        objective: workflow.data?.objective || workflow.data?.description || null,
        non_goals: workflow.data?.non_goals || [],
      },
      actors: named(resources, closure.actors || []),
      personas: named(resources, closure.personas || []),
      ordered_operations: named(resources, closure.operations || []),
      scenarios: named(resources, closure.scenarios || []),
      invariants: named(resources, closure.invariants || []),
      surfaces: named(resources, closure.surfaces || []),
      entities: named(
        resources,
        (closure.dependencies || []).filter((id) =>
          resources.find((item) => item.id === id)?.kind === 'entity'),
      ),
      states: resources.flatMap((resource) =>
        (resource.data?.states || []).map((state) => ({
          resource: resource.id,
          state,
        }))),
    });
    const text = Object.entries(sections)
      .map(([heading, value]) => `${heading}:\n${JSON.stringify(value)}`)
      .join('\n\n');
    return {
      logical_key: `workflow:${workflow.id}`,
      kind: 'workflow',
      workflow_id: workflow.id,
      aliases,
      text,
      metadata: {
        facets: Object.fromEntries(Object.entries({
          actors: sections.actors.flatMap((item) => [item.id, item.name]).filter(Boolean),
          personas: sections.personas.flatMap((item) => [item.id, item.name]).filter(Boolean),
          operations: sections.ordered_operations.flatMap((item) => [item.id, item.name]).filter(Boolean),
          scenarios: sections.scenarios.flatMap((item) => [item.id, item.name]).filter(Boolean),
          invariants: sections.invariants.flatMap((item) => [item.id, item.name]).filter(Boolean),
          surfaces: sections.surfaces.flatMap((item) => [item.id, item.name]).filter(Boolean),
          entities: sections.entities.flatMap((item) => [item.id, item.name]).filter(Boolean),
          states: sections.states.map((item) =>
            typeof item.state === 'string' ? item.state : item.state?.name || item.state?.id),
        }).map(([key, value]) => [key, compact(value) || []])),
      },
    };
  }).sort((left, right) => left.workflow_id.localeCompare(right.workflow_id));
}
