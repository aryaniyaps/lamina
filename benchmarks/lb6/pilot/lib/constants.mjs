export const PILOT_ARMS = Object.freeze(['direct', 'plan', 'lamina']);
export const FORBIDDEN_ARMS = Object.freeze(['checklist']);

export const HARBOR_VERSION = '0.18.0';
export const HARBOR_AGENT = 'cursor-cli';
export const HARBOR_MODEL = 'cursor/composer-2.5';
export const AGENT_RUNTIME_IMAGE = 'lb6-pilot-agent-runtime:cursor-20260720';
export const CURSOR_CLI_VERSION = '2026.07.20-8cc9c0b';
export const CURSOR_CLI_SHA256 = 'eed61c5224668c9236334c4c68936a16aecc37374b592f59e31eb50433817831';

export const BENCHMARK_VERSION = 'lb6-dev-pilot-v3';
export const SKILL_RERUN_CAMPAIGN_ID = 'lb6-dev-pilot-skill-rerun-v3';
export const SKILL_RERUN_JOB_PREFIX = 'skill-rerun-v3';
export const PILOT_SKILL_RERUN_JOB_RE =
  /^lb6-pilot-skill-rerun-v3-(.+)-(direct|plan|lamina)-(\d+)$/;

export function parseSkillRerunPilotJobName(name) {
  const match = String(name || '').match(PILOT_SKILL_RERUN_JOB_RE);
  if (!match) return null;
  return { taskId: match[1], arm: match[2], ts: match[3] };
}

export function expectedPilotTaskDirName(taskId, arm) {
  return `${taskId}-${arm}-v3`;
}
export const PINNED_SKILL_COMMIT = '02aaebe3cd65459347d3b2e617fada0207874315';
export const CANARY_TASK_ID = 'dev-loan-library';
export const MAX_LAMINA_PARENTS = 1;

export const LAMINA_BENCH_SKILLS = Object.freeze([
  'lamina',
  'lamina-init',
  'lamina-design',
  'lamina-verify',
  'lamina-orchestrator',
  'lamina-core',
  'lamina-user-modeling',
  'lamina-flow-design',
  'lamina-edge-cases',
  'lamina-trust',
  'lamina-idempotency-concurrency',
  'lamina-product-behavior',
]);

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
  { name: 'lamina_init', agentTimeout: 360, verifierTimeout: 45 },
  { name: 'lamina_design', agentTimeout: 480, verifierTimeout: 45 },
  { name: 'implement', agentTimeout: 420, verifierTimeout: 45 },
  { name: 'fix', agentTimeout: 240, verifierTimeout: 60 },
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
