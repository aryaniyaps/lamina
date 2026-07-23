export const PILOT_ARMS = Object.freeze(['direct', 'plan', 'lamina']);
export const FORBIDDEN_ARMS = Object.freeze(['checklist']);

export const HARBOR_VERSION = '0.18.0';
export const HARBOR_AGENT = 'cursor-cli';
export const HARBOR_MODEL = 'cursor/composer-2.5';
export const AGENT_RUNTIME_IMAGE = 'lb6-pilot-agent-runtime:cursor-20260720';
export const CURSOR_CLI_VERSION = '2026.07.20-8cc9c0b';
export const CURSOR_CLI_SHA256 = 'eed61c5224668c9236334c4c68936a16aecc37374b592f59e31eb50433817831';

export const BENCHMARK_VERSION = 'lb6-dev-pilot';
export const DEVELOPMENT_FLAGS = Object.freeze({
  development_only: true,
  confirmatory: false,
  child_actual_model_unverified: true,
});

export const AGENT_BUDGET_SEC = 1500;

export const BASELINE_STEPS = Object.freeze([
  { name: 'shape_build', agentTimeout: 750, verifierTimeout: 45 },
  { name: 'verify_fix', agentTimeout: 750, verifierTimeout: 60 },
]);

export const LAMINA_STEPS = Object.freeze([
  { name: 'lamina_init', agentTimeout: 300, verifierTimeout: 45 },
  { name: 'lamina_design', agentTimeout: 420, verifierTimeout: 45 },
  { name: 'implement', agentTimeout: 480, verifierTimeout: 45 },
  { name: 'fix', agentTimeout: 300, verifierTimeout: 60 },
]);

export const REQUIRED_PERSONA_CHILDREN = 2;

export const PERSONA_PROVENANCE_ENVELOPE = Object.freeze({
  parentInitModel: 'Composer 2.5',
  nativeTaskToolCall: true,
  childAgentId: true,
  requestedChildModel: 'composer-2.5',
  successfulCompletion: true,
  durationMs: true,
  childActualModelUnverified: true,
});
