export const RESOURCE_KINDS = new Set([
  'product', 'actor', 'persona', 'entity', 'operation', 'workflow', 'invariant',
  'surface', 'scenario', 'proof', 'evidence', 'decision', 'contradiction',
  'capability_manifest', 'persona_walk', 'mission', 'run', 'harness_result',
  'observation',
]);

export const VIEW_KINDS = new Set(['branch', 'session', 'observation', 'historical']);
export const CLI_API_VERSION = 1;
export const GRAPH_PROTOCOL_VERSION = 9;
export const GRAPH_CAPABILITIES = Object.freeze([
  'observation.status.source_key_count',
  'observation.status.generation',
  'retrieval.hybrid.v1',
  'work.context.v5',
  'design.persona-walk.v1',
  'work.persona-case-map.v4',
  'mission.persona-case-evidence.v4',
]);
export const REQUIRED_GRAPH_CAPABILITIES = GRAPH_CAPABILITIES;

export const EPISTEMIC_BY_INGRESS = Object.freeze({
  intent: 'intended',
  observation: 'observed',
  agent: 'inferred',
  persona: 'simulated',
  human: 'human_evidence',
  runtime: 'runtime_evidence',
});

export const SCHEMA = [
  'CREATE NODE TABLE IF NOT EXISTS Resource(id STRING PRIMARY KEY, kind STRING, data JSON)',
  'CREATE NODE TABLE IF NOT EXISTS Statement(id STRING PRIMARY KEY, predicate STRING, literal JSON, qualifiers JSON)',
  'CREATE NODE TABLE IF NOT EXISTS GraphVersion(id STRING PRIMARY KEY, source_revision STRING, receipt JSON)',
  'CREATE NODE TABLE IF NOT EXISTS GraphView(id STRING PRIMARY KEY, kind STRING, name STRING, status STRING)',
  'CREATE NODE TABLE IF NOT EXISTS Alias(key STRING PRIMARY KEY)',
  'CREATE REL TABLE IF NOT EXISTS STMT_SUBJECT(FROM Statement TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS STMT_OBJECT(FROM Statement TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS STMT_SCOPE(FROM Statement TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS SUPPORTED_BY(FROM Statement TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS GENERATED_BY(FROM Statement TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS CONFLICT_MEMBER(FROM Resource TO Statement)',
  'CREATE REL TABLE IF NOT EXISTS ALIAS_TO(FROM Alias TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS VERSION_PARENT(FROM GraphVersion TO GraphVersion)',
  'CREATE REL TABLE IF NOT EXISTS VERSION_ADD_RES(FROM GraphVersion TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS VERSION_ADD_STMT(FROM GraphVersion TO Statement)',
  'CREATE REL TABLE IF NOT EXISTS VERSION_RETIRE_RES(FROM GraphVersion TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS VERSION_RETIRE_STMT(FROM GraphVersion TO Statement)',
  'CREATE REL TABLE IF NOT EXISTS VIEW_HEAD(FROM GraphView TO GraphVersion)',
  'CREATE REL TABLE IF NOT EXISTS VIEW_BASE(FROM GraphView TO GraphView)',
  'CREATE REL TABLE IF NOT EXISTS VIEW_RES(FROM GraphView TO Resource)',
  'CREATE REL TABLE IF NOT EXISTS VIEW_STMT(FROM GraphView TO Statement)',
  'CREATE REL TABLE IF NOT EXISTS SESSION_SUPPORT_STMT(FROM GraphView TO Statement, key STRING)',
  'CREATE REL TABLE IF NOT EXISTS SESSION_SUPPORT_EVIDENCE(FROM GraphView TO Resource, key STRING)',
];

export const ERROR = Object.freeze({
  BAD_REQUEST: 'LAMINA_BAD_REQUEST',
  NOT_FOUND: 'LAMINA_NOT_FOUND',
  VALIDATION: 'LAMINA_VALIDATION_FAILED',
  CONFLICT: 'LAMINA_COMPARE_AND_SWAP_FAILED',
  SPOOFED_STATUS: 'LAMINA_EPISTEMIC_STATUS_FORBIDDEN',
  EVIDENCE_MISSING: 'LAMINA_EVIDENCE_MISSING',
  UNAUTHORIZED: 'LAMINA_UNAUTHORIZED',
  INTERNAL: 'LAMINA_INTERNAL',
});
