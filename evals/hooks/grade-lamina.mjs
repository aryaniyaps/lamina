#!/usr/bin/env node
/**
 * agent-skill-eval post-grade hook for Lamina-specific assertions.
 * Reads ASE_* env vars; prints JSON array of hook assertion results to stdout.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawnSync } from 'node:child_process';
import { checkLaminaInit } from '../../scripts/check_lamina_init.mjs';
import { checkLaminaPersonas } from '../../scripts/check_lamina_personas.mjs';
import { diffOutsideLamina } from '../lib/lamina-write-boundary.mjs';
import { stopIncompatibleServer } from '../../packages/cli/lib/graph-runtime/client.mjs';
import { runtimePaths } from '../../packages/cli/lib/graph-runtime/util.mjs';

function findTemplateLeaks(text, allowed = '') {
  const terms = ['havenstay', 'budgetapp', 'password-reset-template'];
  const haystack = String(text).toLowerCase();
  const allow = String(allowed).toLowerCase();
  return terms.filter((term) => haystack.includes(term) && !allow.includes(term));
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const graphStateCache = new Map();

function liveGraphState(workspace) {
  if (graphStateCache.has(workspace)) return graphStateCache.get(workspace);
  const result = spawnSync(path.join(ROOT, 'evals/bin/lamina'), ['graph', 'query', '--at', 'HEAD'], {
    cwd: workspace,
    env: process.env,
    encoding: 'utf8',
    timeout: 10_000,
  });
  let state = null;
  if (result.status === 0) {
    try { state = JSON.parse(result.stdout); } catch {}
  }
  graphStateCache.set(workspace, state);
  return state;
}

const OUTPUT_CONTRACTS = {
  'init-blocked': ['### Status', "### What's missing", '### Next step', '### Do not'],
  clarify: [
    '### Status',
    '### Clarifying questions',
    '### Why these block the artifact',
    '### How to proceed',
    '### Do not',
  ],
  design: [
    '### Domain and invariants',
    '### Actors and permissions',
    '### Workflows',
    '### Scenarios',
    '### Implement brief',
    '### Open questions',
  ],
  verify: [
    '### Executive summary',
    '### Findings',
    '### Open questions',
  ],
  init: ['### Mode', '### Business context summary', '### Open questions', '### Passive product workflow'],
};

function hasInitContract(output) {
  return OUTPUT_CONTRACTS.init.some((h) => output.includes(h));
}

function hasInitBlockedContract(output) {
  return (
    /## Lamina: init required/i.test(output) &&
    (/### Status/i.test(output) || /what's missing/i.test(output) || /### Do not/i.test(output))
  );
}

const FULL_FLOW_SKILLS = [
  'lamina-flow-design',
  'lamina-heuristic-review',
  'lamina-navigation',
  'lamina-discoverability',
  'lamina-forms',
  'lamina-error-handling',
  'lamina-content-design',
  'lamina-accessibility',
  'lamina-trust',
  'lamina-feedback-and-status',
  'lamina-decision-making',
];

function readJsonSafe(filePath) {
  try {
    return JSON.parse(fs.readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(filePath, 'utf8');
  } catch {
    return '';
  }
}

function listFiles(dir, prefix = '') {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) {
      results.push(...listFiles(path.join(dir, entry.name), rel));
    } else {
      results.push(rel);
    }
  }
  return results;
}

function workReceipts(workspace, suffix) {
  const roots = [
    path.join(workspace, '.git', 'lamina', 'work'),
    path.join(workspace, '.lamina', 'runtime', 'work'),
  ];
  const receipts = new Map();
  for (const root of roots) {
    if (!fs.existsSync(root)) continue;
    for (const name of fs.readdirSync(root)) {
      if (!name.endsWith(suffix)) continue;
      const value = readJsonSafe(path.join(root, name));
      if (value) receipts.set(value.receipt_id || `${root}:${name}`, value);
    }
  }
  return [...receipts.values()];
}

function isStartedReceipt(receipt) {
  return ['lamina.work-started/v1', 'lamina.work-started/v2'].includes(receipt?.schema);
}

function isVerifiedReceipt(receipt) {
  return ['lamina.work-verified/v1', 'lamina.work-verified/v2'].includes(receipt?.schema) &&
    receipt?.verified === true;
}

function isWorkMap(map) {
  return ['lamina.work-map/v1', 'lamina.work-map/v2'].includes(map?.schema);
}

function verifiedWorkMaps(workspace) {
  const startedPacketIds = new Set(
    workReceipts(workspace, '.started.json')
      .filter(isStartedReceipt)
      .map((receipt) => receipt.packet_id)
      .filter(Boolean),
  );
  const verifiedPacketIds = new Set(
    workReceipts(workspace, '.verified.json')
      .filter(isVerifiedReceipt)
      .map((receipt) => receipt.packet_id)
      .filter(Boolean),
  );
  const receiptMaps = workReceipts(workspace, '.verified.json')
    .filter((receipt) =>
      isVerifiedReceipt(receipt) &&
      isWorkMap(receipt.work_map) &&
      receipt.packet_id === receipt.work_map.packet_id)
    .map((receipt) => receipt.work_map);
  const candidates = [
    path.join(workspace, '.git', 'lamina', 'work', 'work-map.json'),
    path.join(workspace, '.git', 'lamina-work-map.json'),
    path.join(workspace, '.lamina', 'runtime', 'work', 'work-map.json'),
  ];
  return [
    ...receiptMaps,
    ...candidates.map(readJsonSafe),
  ]
    .filter((map) =>
      isWorkMap(map) &&
      startedPacketIds.has(map.packet_id) &&
      verifiedPacketIds.has(map.packet_id));
}

function checkedWorkMaps(workspace) {
  const maps = [
    ...workReceipts(workspace, '.started.json')
      .filter(isStartedReceipt)
      .map((receipt) => receipt.work_map)
      .filter(Boolean),
    ...verifiedWorkMaps(workspace),
  ];
  const unique = new Map();
  for (const map of maps) {
    unique.set(`${map.packet_id || 'unknown'}:${JSON.stringify(map)}`, map);
  }
  return [...unique.values()];
}

function passedUiEvidence(workspace, { verifiedOnly = false } = {}) {
  const maps = verifiedOnly ? verifiedWorkMaps(workspace) : checkedWorkMaps(workspace);
  return maps.flatMap((map) =>
    [...(map.obligations || []), ...(map.experience_cases || [])].flatMap((entry) =>
      (entry.verification || []).filter((item) => item.status === 'passed' && item.artifact)));
}

function diffNewFiles(preState, postState) {
  const pre = new Set(preState?.files ?? preState?.tracked_files ?? preState?.changed_files ?? []);
  const post = new Set(postState?.files ?? postState?.tracked_files ?? postState?.changed_files ?? []);
  const added = [];
  for (const f of post) {
    if (!pre.has(f)) added.push(f);
  }
  return added;
}

function diffChangedFiles(preState, postState) {
  const preHashes = preState?.file_hashes;
  const postHashes = postState?.file_hashes;
  if (!preHashes || !postHashes) return diffNewFiles(preState, postState);
  const paths = new Set([...Object.keys(preHashes), ...Object.keys(postHashes)]);
  const changed = [];
  for (const filePath of paths) {
    if (preHashes[filePath] !== postHashes[filePath]) changed.push(filePath);
  }
  return changed;
}

function hookResult(text, passed, evidence) {
  return { text, passed, evidence, method: 'hook', skipped: false };
}

const EDGE_CASE_CATEGORIES = ['empty', 'failure', 'permission', 'conflict', 'boundary', 'precondition', 'external'];
const DOMAIN_MODEL_PATTERNS = /domain-model|entity-catalog|operations-inventory|operation-inventory/i;
const IMPL_VOCAB_PATTERNS =
  /\b(users table|orders table|POST\s+\/|GET\s+\/|Prisma|SELECT\s+|INSERT\s+|ORM\b|graphql\s+mutation)\b/i;

const IMPLEMENTABLE_CODE_FENCE =
  /```(?:tsx?|jsx?|python|rust|go|java|kotlin|swift|php|ruby|cs|cpp|c)\n[\s\S]*?```/i;
const IMPLEMENTABLE_CODE_PATTERNS = [
  IMPLEMENTABLE_CODE_FENCE,
  /\bexport\s+default\b/i,
  /\bimport\s+.+\s+from\s+['"][^'"]+['"]/i,
  /\bnpm\s+install\b/i,
  /\bCREATE\s+TABLE\b/i,
  /\bprisma\.\w+/i,
];

const APP_SOURCE_PATH_EDIT =
  /\b(?:create|edit|modify|update|refactor|scaffold|implement)\b[^.\n]{0,80}\b(?:src\/|app\/|components\/|pages\/|lib\/)[^\s'"]+/i;

/** Returns { hasCode, reasons[] } when text looks like implementable product source. */
export function detectImplementableCode(text) {
  const reasons = [];
  if (!text) return { hasCode: false, reasons };
  for (const pattern of IMPLEMENTABLE_CODE_PATTERNS) {
    if (pattern.test(text)) reasons.push(pattern.source.slice(0, 40));
  }
  if (APP_SOURCE_PATH_EDIT.test(text)) reasons.push('app source path edit language');
  return { hasCode: reasons.length > 0, reasons };
}

function graphEvidenceText(workspace) {
  const texts = [];
  const graph = liveGraphState(workspace);
  if (graph) texts.push(JSON.stringify(graph));
  const projectionsRoot = path.join(workspace, '.lamina/projections');
  for (const rel of listFiles(projectionsRoot)) {
    if (/\.(?:md|json|ya?ml|txt)$/i.test(rel)) {
      texts.push(readTextSafe(path.join(projectionsRoot, rel)));
    }
  }
  return texts.join('\n');
}

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function countEdgeCategories(text) {
  const lower = text.toLowerCase();
  return EDGE_CASE_CATEGORIES.filter((cat) => lower.includes(cat)).length;
}

function loadPersonaIds(workspace) {
  const file = path.join(workspace, '.lamina/personas.json');
  if (!fs.existsSync(file)) return [];
  try {
    const data = JSON.parse(fs.readFileSync(file, 'utf8'));
    return (data.personas || []).map((persona) => persona.id).filter(Boolean);
  } catch {
    return [];
  }
}

function listBlueprintTsxFiles(blueprintDirs) {
  const files = [];
  for (const dir of blueprintDirs) {
    for (const rel of listFiles(dir)) {
      if (rel.endsWith('.tsx')) files.push(path.join(dir, rel));
    }
  }
  return files;
}

function loadTurnOutputs(outputDir) {
  const turnsDir = path.join(outputDir, 'turns');
  const outputs = [];
  if (!fs.existsSync(turnsDir)) return outputs;
  const indices = fs
    .readdirSync(turnsDir)
    .filter((n) => /^\d+$/.test(n))
    .sort((a, b) => Number(a) - Number(b));
  for (const idx of indices) {
    const text = readTextSafe(path.join(turnsDir, idx, 'output.txt'));
    if (text) outputs.push(text);
  }
  return outputs;
}

function combinedOutputText(output, turnOutputs) {
  if (turnOutputs.length) return turnOutputs.join('\n\n');
  return output;
}
function gradeAssertion(text, ctx) {
  const lower = text.toLowerCase();
  const { output, workspace, preState, postState, logs, evalMeta, turnOutputs = [] } = ctx;
  const allOutput = combinedOutputText(output, turnOutputs);
  const firstTurnOutput = turnOutputs[0] ?? output;
  const newFiles = diffNewFiles(preState, postState);
  const changedFiles = diffChangedFiles(preState, postState);
  const workspaceFiles = listFiles(workspace);

  if (lower.includes('does not emit') && (lower.includes('init-blocked') || lower.includes('init required'))) {
    const hasBlocked = hasInitBlockedContract(allOutput);
    return hookResult(
      text,
      !hasBlocked,
      !hasBlocked ? 'Output does not emit init-blocked contract' : 'Output contains init-blocked contract',
    );
  }

  if (lower.includes('init output contract')) {
    const passed = hasInitContract(output);
    return hookResult(text, passed, passed ? 'Init output contract present' : 'Missing init contract headings');
  }

  if (lower.includes('init-blocked contract')) {
    const headings = OUTPUT_CONTRACTS['init-blocked'];
    const missing = headings.filter((h) => !output.includes(h));
    const passed = missing.length === 0 && /## Lamina: init required/i.test(output);
    return hookResult(text, passed, passed ? 'All init-blocked headings present' : `Missing: ${missing.join(', ') || 'title'}`);
  }

  if (lower.includes('init required') || lower.includes('init-blocked') || lower.includes("'blocked'")) {
    const hasBlocked = hasInitBlockedContract(allOutput);
    return hookResult(text, hasBlocked, hasBlocked ? 'Output contains init-blocked signals' : 'No init-blocked contract in output');
  }

  if (lower.includes('clarify contract') || lower.includes('clarification contract')) {
    const headings = OUTPUT_CONTRACTS.clarify;
    const firstLower = firstTurnOutput.toLowerCase();
    const missing = headings.filter((h) => !firstLower.includes(h.toLowerCase()));
    const passed = missing.length === 0 && /##\s*lamina:\s*clarification needed/i.test(firstTurnOutput);
    return hookResult(text, passed, passed ? 'All clarify headings present in first response' : `Missing: ${missing.join(', ') || 'title'}`);
  }

  if (lower.includes('clarifying questions asked') || lower.includes('asks clarifying questions')) {
    const asks =
      /\?/.test(firstTurnOutput) &&
      /clarifying questions?|clarification needed|before (I|we) (generate|create|write|proceed)|to proceed/i.test(firstTurnOutput);
    const notFinalArtifact =
      !/### Artifact packs/i.test(firstTurnOutput) &&
      !/### Developer handoff/i.test(firstTurnOutput) &&
      !/### Findings by flow/i.test(firstTurnOutput);
    return hookResult(
      text,
      asks && notFinalArtifact,
      asks && notFinalArtifact ? 'First response asks clarifying questions before artifacts' : 'First response did not clearly ask upfront clarifying questions',
    );
  }

  if (lower.includes('business-context.md valid') || lower.includes('valid init')) {
    const result = checkLaminaInit(workspace);
    return hookResult(text, result.ok, result.ok ? 'checkLaminaInit passed' : result.errors.join('; '));
  }

  if (lower.includes('personas.json valid') || lower.includes('valid personas')) {
    const result = checkLaminaPersonas(workspace);
    return hookResult(text, result.ok, result.ok ? 'checkLaminaPersonas passed' : result.errors.join('; '));
  }

  if (lower.includes('transactional graph workflow')) {
    const receipt = /\bgraph(?:[_ ]?version)\b/i.test(allOutput) &&
      /\bsource(?:[_ ]?revision)\b/i.test(allOutput) &&
      (/\bvalidation\b|\breceipt\b/i.test(allOutput));
    const legacyWrites = changedFiles.filter((file) => /^\.lamina\/runs\//.test(normalizePath(file)));
    const graph = liveGraphState(workspace);
    const currentVersion = graph?.graph_version?.id;
    const actualMutation = Boolean(currentVersion) &&
      ((graph?.resources?.length || 0) > 0 || (graph?.statements?.length || 0) > 0) &&
      allOutput.includes(currentVersion);
    // A matching live, non-empty current version is stronger evidence than a
    // pasted CLI command. Agent summaries should not fail merely because they
    // report the receipt without echoing their shell transcript.
    const passed = receipt && actualMutation && legacyWrites.length === 0;
    return hookResult(
      text,
      passed,
      passed
        ? 'Live non-empty graph mutation and matching GraphVersion receipt present without legacy writes'
        : `Expected a real non-empty graph mutation and matching current GraphVersion receipt; live=${currentVersion || 'unavailable'} legacy=${legacyWrites.join(', ')}`,
    );
  }

  if (lower.includes('implementation packet present')) {
    const started = workReceipts(workspace, '.started.json')
      .find((receipt) =>
        isStartedReceipt(receipt) &&
        (receipt.work_map || /^packet_[a-z0-9]+$/i.test(receipt.packet_id || '')));
    const hasPacket = Boolean(started) ||
      /lamina\.implementation-packet\/v[12]|\bpacket_id\b\s*["':=]+\s*["']?packet_/i.test(allOutput);
    return hookResult(
      text,
      hasPacket,
      hasPacket
        ? started
          ? `Versioned ImplementationPacket materialized by WorkStarted receipt${started.packet_id ? ` for ${started.packet_id}` : ''}`
          : 'Versioned ImplementationPacket and packet id reported'
        : 'No ImplementationPacket identity or WorkStarted packet receipt',
    );
  }

  if (lower.includes('complete workmap checked')) {
    const maps = checkedWorkMaps(workspace);
    const complete = maps.some((map) => {
      const entries = map.obligations || [];
      const cases = map.experience_cases || [];
      return isWorkMap(map) &&
        entries.length > 0 &&
        new Set(entries.map((item) => item.obligation_id)).size === entries.length &&
        entries.every((item) =>
          item.obligation_id &&
          item.status !== 'blocked' &&
          Array.isArray(item.targets) &&
          Array.isArray(item.verification) &&
          item.verification.length > 0) &&
        (map.schema !== 'lamina.work-map/v2' ||
          (new Set(cases.map((item) => item.case_id)).size === cases.length &&
            cases.every((item) =>
              item.case_id &&
              item.status !== 'blocked' &&
              Array.isArray(item.targets) &&
              item.targets.length > 0 &&
              item.fixture &&
              Array.isArray(item.steps) &&
              item.steps.length > 0 &&
              item.expected &&
              Array.isArray(item.verification) &&
              item.verification.length > 0)));
    });
    return hookResult(
      text,
      complete,
      complete ? 'A WorkStarted receipt contains a complete unique WorkMap' : 'No complete checked WorkMap receipt',
    );
  }

  if (lower.includes('source edits follow workstarted')) {
    const started = workReceipts(workspace, '.started.json');
    const productChanges = changedFiles.filter((file) => {
      const normalized = normalizePath(file);
      return !normalized.startsWith('.lamina/') &&
        !normalized.startsWith('.git/') &&
        !/^(?:AGENTS\.md|CLAUDE\.md|\.cursor\/rules\/lamina\.mdc)$/.test(normalized);
    });
    const passed = started.length > 0 && productChanges.length > 0;
    return hookResult(
      text,
      passed,
      passed
        ? `WorkStarted exists and product files changed: ${productChanges.join(', ')}`
        : `Expected WorkStarted before product changes; receipts=${started.length} changes=${productChanges.join(', ')}`,
    );
  }

  if (lower.includes('terminal workverified receipt')) {
    const receipts = workReceipts(workspace, '.verified.json');
    const passed = receipts.some(isVerifiedReceipt);
    return hookResult(
      text,
      passed,
      passed ? 'Terminal WorkVerified receipt present' : 'No terminal WorkVerified receipt',
    );
  }

  if (lower.includes('passive implementation workflow')) {
    const started = workReceipts(workspace, '.started.json').length > 0;
    const verified = workReceipts(workspace, '.verified.json')
      .some((receipt) => receipt.verified === true);
    const recommendsPhase = /\b(?:run|invoke|use|next(?:\s+step)?(?:\s+is)?)\b[^\n]{0,80}\/lamina-(?:design|verify)\b/i
      .test(allOutput);
    const passed = started && verified && !recommendsPhase;
    return hookResult(
      text,
      passed,
      passed
        ? 'Ordinary request produced WorkStarted and WorkVerified without phase-command handoff'
        : `Passive lifecycle incomplete or explicit handoff present (started=${started}, verified=${verified}, recommendation=${recommendsPhase})`,
    );
  }

  if (lower.includes('no explicit phase recommendation')) {
    const recommendsPhase = /\b(?:run|invoke|use|next(?:\s+step)?(?:\s+is)?)\b[^\n]{0,80}\/lamina-(?:design|verify)\b/i
      .test(allOutput);
    return hookResult(
      text,
      !recommendsPhase,
      !recommendsPhase ? 'No explicit design/verify phase recommendation' : 'Normal flow recommended an explicit phase command',
    );
  }

  if (lower.includes('implementation-ready graph context')) {
    const ready = /\bimplementation_ready\b\s*["':=]+\s*true\b/i.test(allOutput);
    const started = workReceipts(workspace, '.started.json').length > 0;
    return hookResult(
      text,
      started,
      started
        ? ready
          ? 'Implementation-ready graph context and WorkStarted receipt preceded work'
          : 'WorkStarted receipt proves an implementation-ready packet passed the CLI gate'
        : 'No WorkStarted receipt proving implementation-ready context',
    );
  }

  if (lower.includes('all live ui audit classes')) {
    const evidence = passedUiEvidence(workspace, { verifiedOnly: true });
    const kinds = new Set(evidence.map((item) => item.kind));
    const required = ['functional', 'visual', 'responsive', 'accessibility'];
    const graph = liveGraphState(workspace);
    const graphEvents = (graph?.resources || [])
      .filter((resource) => resource.kind === 'harness_result')
      .flatMap((resource) => resource.data?.events || [])
      .filter((event) => event.type === 'audit_passed');
    const graphKinds = new Set(graphEvents.map((event) => event.audit_kind));
    const passed = required.every((kind) => kinds.has(kind) && graphKinds.has(kind));
    return hookResult(
      text,
      passed,
      passed
        ? 'Verified WorkMap and published HarnessResult contain all four live UI audit classes'
        : `Missing live UI audit classes; map=${[...kinds].join(',')} graph=${[...graphKinds].join(',')}`,
    );
  }

  if (lower.includes('independent ui audit artifacts')) {
    const evidence = passedUiEvidence(workspace, { verifiedOnly: true })
      .filter((item) => ['functional', 'visual', 'responsive', 'accessibility'].includes(item.kind));
    const byKind = new Map(evidence.map((item) => [item.kind, path.resolve(workspace, item.artifact)]));
    const files = [...byKind.values()];
    const passed = byKind.size === 4 &&
      new Set(files).size === 4 &&
      files.every((file) => fs.existsSync(file));
    return hookResult(
      text,
      passed,
      passed ? 'Four distinct UI audit artifacts exist' : 'UI audit artifacts are missing, reused, or not reproducible',
    );
  }

  if (lower.includes('graph publication receipt present')) {
    const hasVersion = /\bgraph_version\b\s*["':=]*\s*["']?(?:version_)?[a-f0-9]{12,}/i.test(allOutput);
    const hasSource = /\bsource_revision\b\s*["':=]*\s*["']?(?:dirty:)?[a-z0-9_:-]{7,}/i.test(allOutput);
    const hasValidation = /\bvalidation\b[\s\S]{0,300}\b(?:ok|approved)\b/i.test(allOutput);
    const graph = liveGraphState(workspace);
    const currentVersion = graph?.graph_version?.id;
    const matchesLive = Boolean(currentVersion && allOutput.includes(currentVersion));
    const passed = hasVersion && hasSource && hasValidation && matchesLive;
    return hookResult(
      text,
      passed,
      passed ? 'Concrete GraphVersion publication receipt present' :
        `Incomplete/unconfirmed publication receipt (version=${hasVersion}, source=${hasSource}, validation=${hasValidation}, live=${matchesLive})`,
    );
  }

  if (lower.includes('graphversion projection present')) {
    const hasVersion = /\bGraphVersion\b|\bgraph_version\b/i.test(allOutput);
    const hasSource = /\bsource revision\b|\bsource_revision\b/i.test(allOutput);
    const hasDomain = /Actors? and permissions|Workflows?|Scenarios?|invariants?/i.test(allOutput);
    const passed = hasVersion && hasSource && hasDomain;
    return hookResult(text, passed, passed ? 'Version-pinned design projection present' : 'Projection lacks GraphVersion, source revision, or domain sections');
  }

  if (lower.includes('graph domain contract present')) {
    const resourceKinds = ['actor', 'operation', 'workflow', 'invariant'].filter((term) =>
      new RegExp(`\\b${term}s?\\b`, 'i').test(allOutput));
    const statementModel = /\bStatement\b|\bpredicate\b|lamina:[a-z]/i.test(allOutput);
    const passed = resourceKinds.length >= 3 && statementModel;
    return hookResult(
      text,
      passed,
      passed ? `Graph domain includes ${resourceKinds.join(', ')} and typed Statements` : 'Missing normalized Resource/Statement domain contract',
    );
  }

  if (lower.includes('graph projection traceability present') || lower.includes('graph traceability complete')) {
    const versionPinned = /\bGraphVersion\b|\bgraph_version\b/i.test(allOutput);
    const traces = /\b(?:proof|check|finding|requirement|scenario)[._:-][a-z0-9_-]+\b/i.test(allOutput) &&
      /\b(?:maps? to|traces? to|supported by|evidence)\b/i.test(allOutput);
    return hookResult(text, versionPinned && traces, versionPinned && traces ? 'Stable ids trace to a pinned GraphVersion' : 'Missing stable-id traceability to GraphVersion/evidence');
  }

  if (lower.includes('graph proof coverage present')) {
    const passed = /\bproof\b/i.test(allOutput) && /\bevidence\b/i.test(allOutput) &&
      /\b(?:stale|missing|covered|supported|oracle)\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Proof coverage and evidence state present' : 'Missing graph Proof/Evidence coverage');
  }

  if (lower.includes('mission evidence valid')) {
    const passed = /\bMission\b/i.test(allOutput) && /\bHarnessResult\b|\bharness_result\b/i.test(allOutput) &&
      /\b(?:runtime_evidence|normalized events?|oracle_(?:passed|failed))\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Mission has normalized HarnessResult evidence' : 'Missing normalized Mission/HarnessResult evidence');
  }

  if (lower.includes('agent proposal remains inferred')) {
    const inferred = /\b(?:agent proposal|agent-authored|agent claims?)[^\n.]{0,100}\binferred\b|\binferred ingress\b/i.test(allOutput);
    const rejectsElevation = /\b(?:rejects?|forbids?|cannot|can't|must not|does not)\b[^\n.]{0,140}\b(?:intended|observed|approved|epistemic)\b/i.test(allOutput);
    return hookResult(text, inferred && rejectsElevation, inferred && rejectsElevation ? 'Agent ingress remains inferred and elevation is rejected' : 'Did not prove agent-ingress spoof rejection');
  }

  if (lower.includes('no legacy run writes')) {
    const legacyWrites = changedFiles.filter((file) => /^\.lamina\/runs\//.test(normalizePath(file)));
    return hookResult(
      text,
      legacyWrites.length === 0,
      legacyWrites.length === 0 ? 'No legacy run files changed' : `Legacy run files changed: ${legacyWrites.join(', ')}`,
    );
  }

  if (lower.includes('all relevant persona missions')) {
    const allRelevant = /\b(?:every|all)(?:\s+\w+){0,2}\s+relevant personas?\b/i.test(allOutput) ||
      /\ball\s+(?:four|4)\b[\s\S]{0,100}\bindependent missions?\b/i.test(allOutput);
    const mentionsCap = /(?:at most|up to|maximum of|cap(?:ped)?(?:\s+at)?|top)\s*(?:three|3)/i.test(allOutput);
    const rejectsCap = /\b(?:reject(?:ed|s)?|refus(?:e|ed)|conflicts?|disallow(?:ed|s)?|rather than dropping|retained all)\b[^\n.]{0,160}\b(?:cap|top three|three-person|all four)\b/i.test(allOutput) ||
      /\b(?:cap|top three|three-person)\b[^\n.]{0,160}\b(?:reject(?:ed|s)?|refus(?:e|ed)|conflicts?|disallow(?:ed|s)?|retained all)\b/i.test(allOutput);
    const passed = allRelevant && /\bMission/i.test(allOutput) &&
      /\bindependent\b|\bisolated\b/i.test(allOutput) &&
      (!mentionsCap || rejectsCap);
    return hookResult(
      text,
      passed,
      passed ? 'Every relevant Persona receives an independent Mission' : 'Missing uncapped all-Persona Mission protocol',
    );
  }

  if (lower.includes('no file was created under `.lamina/`') || lower.includes('no `.lamina/` writes')) {
    const laminaChanged = changedFiles.filter((f) => normalizePath(f).startsWith('.lamina/'));
    const passed = laminaChanged.length === 0;
    return hookResult(text, passed, passed ? 'No .lamina files changed' : `Changed files: ${laminaChanged.join(', ')}`);
  }

  if (lower.includes('no `.lamina/runs` writes') || lower.includes('no .lamina/runs writes')) {
    const runChanged = changedFiles.filter((f) => normalizePath(f).startsWith('.lamina/runs/'));
    const passed = runChanged.length === 0;
    return hookResult(text, passed, passed ? 'No .lamina/runs files changed' : `Changed run files: ${runChanged.join(', ')}`);
  }

  if (
    lower.includes('no writes outside .lamina') ||
    lower.includes('repo unchanged') ||
    lower.includes('no file was created under `src/`')
  ) {
    const violations = diffOutsideLamina(preState, postState, workspace);
    const passed = violations.length === 0;
    return hookResult(
      text,
      passed,
      passed
        ? 'No writes outside .lamina/'
        : `Files outside .lamina/ changed: ${violations.join(', ')}`,
    );
  }

  if (
    lower.includes('no product code in output') ||
    lower.includes('no product code') ||
    lower.includes('implementable product code') ||
    (lower.includes('does not include') && lower.includes('product code')) ||
    (lower.includes('does not jump to') && lower.includes('implementation code'))
  ) {
    const { hasCode, reasons } = detectImplementableCode(allOutput);
    return hookResult(
      text,
      !hasCode,
      !hasCode ? 'No implementable product code in output' : `Implementable code in output: ${reasons.join(', ')}`,
    );
  }

  if (
    lower.includes('addresses design or problem') ||
    lower.includes('design or problem framing') ||
    (lower.includes('addresses') && lower.includes('problem framing'))
  ) {
    const passed =
      /design\s+workflow|problem\s+fram|\/lamina-design|\/lamina-ideate|user\s+problem/i.test(allOutput) ||
      (
        /\b(?:clarifying questions?|primary user|painful|success|outcome|scope|constraints?|product direction)\b/i.test(allOutput) &&
        /\b(?:assumptions?|unknown|problem|user|product|design|context|persona)\b/i.test(allOutput)
      );
    return hookResult(
      text,
      passed,
      passed ? 'Design/problem framing addressed' : 'No design or problem framing language',
    );
  }

  if (lower.includes('scopes a feature') || (lower.includes('scopes') && lower.includes('feature'))) {
    const passed = /\b(feature|wishlist|scope)\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Feature scoping language found' : 'No feature scoping language');
  }

  if (lower.includes('mentions audit or improvements') || (lower.includes('audit') && lower.includes('improvement'))) {
    const passed = /\b(audit|improv)/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Audit/improvements language found' : 'No audit/improvements language');
  }

  if (
    (lower.includes('mentions') || lower.includes('includes') || lower.includes('frames') || lower.includes('follows')) &&
    (lower.includes('design workflow') || lower.includes('user problem'))
  ) {
    const mentionsDesign =
      /design\s+workflow|routes?\s+to\s+design|\/lamina-design|problem\s+fram|user\s+problem/i.test(allOutput);
    const passed = mentionsDesign;
    return hookResult(
      text,
      passed,
      passed ? 'Design/problem framing language found' : 'No design workflow / problem framing language in output',
    );
  }

  if (
    (lower.includes('addresses') || lower.includes('scopes') || lower.includes('specific feature') || lower.includes('single feature')) &&
    lower.includes('feature')
  ) {
    const featureNamed =
      /\b(wishlist|feature|authentication|2fa|two-factor|budgeting|alerts?|checkout|onboarding|signup|login|settings)\b/i.test(
        allOutput,
      ) || /specific feature|single feature|feature request|for the \w+ feature/i.test(allOutput);
    return hookResult(
      text,
      featureNamed,
      featureNamed ? 'Specific feature language found' : 'No specific feature named in output',
    );
  }

  if (lower.includes('flows or edge cases') || (lower.includes('flows') && lower.includes('edge'))) {
    const passed = /\bflows?\b/i.test(allOutput) && /\bedge cases?\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Flows and edge cases mentioned' : 'Missing flows and/or edge cases');
  }

  if (lower.includes('mentions audit or review') || (lower.includes('audit') && lower.includes('review'))) {
    const passed = /\b(audit|review|verify|\/lamina-verify)\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Audit/review language found' : 'No audit/review language');
  }

  if (lower.includes('prioritized or findings') || (lower.includes('prioritized') && lower.includes('findings'))) {
    const passed = /\b(prioritiz|findings?|severity)\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Prioritized/findings language found' : 'No prioritized/findings language');
  }

  if (lower.includes('improving existing') || lower.includes('improve existing')) {
    const passed =
      /improv(e|ing)\s+existing|existing\s+(ux|ui|flow|feature|checkout)|not\s+(a\s+)?net-?new|audit\s+not\s+design|improve(?:s|ing)?\s+(?:the\s+)?(?:existing\s+)?(?:checkout|flow|ux)|audit(?:ing)?\s+(?:the\s+)?(?:existing\s+)?(?:checkout|flow)|redesign\s+of\s+an\s+existing/i.test(
        allOutput,
      );
    return hookResult(text, passed, passed ? 'Improving-existing UX language found' : 'No improving-existing language');
  }

  if (lower.includes('does not start greenfield') || lower.includes('greenfield design from scratch')) {
    const startsGreenfield =
      /greenfield\s+design|from\s+scratch|net-?new\s+(product|app)|design\s+a\s+new\s+/i.test(allOutput) &&
      !/not\s+(a\s+)?(greenfield|net-?new)|avoid\s+greenfield|not\s+start\s+greenfield/i.test(allOutput);
    return hookResult(
      text,
      !startsGreenfield,
      !startsGreenfield ? 'Did not start greenfield design' : 'Appears to start greenfield design from scratch',
    );
  }

  if (lower.includes('does not emit audit output') || (lower.includes('does not emit') && lower.includes('audit'))) {
    const emitted = /##\s*Audit\b|###\s*Executive summary/i.test(allOutput);
    return hookResult(text, !emitted, !emitted ? 'No audit output contract' : 'Audit output contract detected');
  }

  if (lower.includes('validation or usability') || lower.includes('usability test')) {
    const passed = /usability\s+test|validation\s+plan|moderated\s+usability|user\s+test|validate\b|validation\b/i.test(
      allOutput,
    );
    return hookResult(
      text,
      passed,
      passed ? 'Validation/usability language found' : 'No validation or usability-test language',
    );
  }

  if (lower.includes('mentions risks') || (lower.includes('mentions') && lower.includes('risk'))) {
    const passed = /\brisks?\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Risk language found' : 'No risk/risks mention in output');
  }

  if (lower.includes('discusses forms') || lower.includes('validation ux')) {
    const passed = /\b(forms?|validation|signup|input)\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Forms/validation UX discussed' : 'No forms/validation language');
  }

  if (lower.includes('navigation or wayfinding') || lower.includes('addresses navigation')) {
    const passed = /\b(navigation|wayfinding|nav\b|menu|ia\b)\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Navigation/wayfinding language found' : 'No navigation language');
  }

  if (lower.includes('research planning') || lower.includes('focuses on research')) {
    const passed = /\b(research|usability\s+study|study\s+plan|interview|protocol)\b/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Research planning language found' : 'No research planning language');
  }

  if (lower.includes('does not emit full design output') || (lower.includes('does not emit') && lower.includes('design output'))) {
    const emitted = OUTPUT_CONTRACTS.design.some((h) => allOutput.includes(h));
    return hookResult(text, !emitted, !emitted ? 'No full design output contract' : 'Design output contract headings present');
  }

  // Router-only: do not match multiturn "turn N output contains \"Clarifying questions\""
  if (lower.includes('new ux, existing ux') || lower.includes('focused ux question')) {
    const passed =
      /new\s+ux|existing\s+ux|focused\s+(ux\s+)?question|design\s+new|verify\s+existing|one\s+focused\s+question/i.test(
        allOutput,
      );
    return hookResult(text, passed, passed ? 'Clarifying route question found' : 'No clarifying UX route question');
  }

  if (lower.includes('picks one primary workflow') || lower.includes('one primary workflow')) {
    const routes = [
      /\bdesign\s+workflow\b/i.test(allOutput),
      /\b(audit|verify)\s+workflow\b|\b\/lamina-verify\b/i.test(allOutput),
      /lamina-(forms|navigation|accessibility|onboarding|error-handling|research)/i.test(allOutput),
    ].filter(Boolean).length;
    const passed = routes >= 1;
    return hookResult(text, passed, passed ? `Primary workflow signaled (${routes})` : 'No primary workflow signal');
  }

  if (lower.includes('does not invent ui without grounding') || lower.includes('without grounding')) {
    const invents =
      /here(?:'s| is) (?:a |the )?mockup|pixel-perfect|tailwind class|create src\//i.test(allOutput) &&
      !/@[\w/-]+|insufficient detail|init required/i.test(allOutput);
    return hookResult(text, !invents, !invents ? 'No ungrounded UI invention' : 'Appears to invent UI without grounding');
  }

  if (lower.includes('no app source in artifacts')) {
    const { hasCode, reasons } = detectImplementableCode(graphEvidenceText(workspace));
    const passed = !hasCode;
    return hookResult(
      text,
      passed,
      passed ? 'No implementable code in .lamina artifacts' : `Implementable code in artifacts: ${reasons.join(', ')}`,
    );
  }

  if (lower.includes('did not auto-run') || lower.includes('did not auto-run /lamina-init')) {
    const claimedAutoInit =
      /ran\s+`?\/lamina-init`?\s+automatically|automatically(?:\s+\w+){0,6}\s+\/lamina-init|bootstrapping.*business context|i(?:'m| am) (?:running|starting|invoking) (?:\/)?lamina-init/i.test(
        allOutput,
      );
    const invokedInLogs =
      /lamina-init|\/lamina-init/i.test(logs) && evalMeta?.prompt && !/\/lamina-init/i.test(evalMeta.prompt);
    const passed = !claimedAutoInit && !invokedInLogs;
    return hookResult(
      text,
      passed,
      passed ? 'No auto-init detected' : claimedAutoInit ? 'Output claims auto-running lamina-init' : 'lamina-init appears in logs without user request',
    );
  }

  if (lower.includes('design') && lower.includes('headings')) {
    const missing = OUTPUT_CONTRACTS.design.filter((h) => !output.includes(h));
    return hookResult(text, missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All design headings present');
  }

  if (lower.includes('verify') && lower.includes('headings')) {
    const missing = OUTPUT_CONTRACTS.verify.filter((h) => !output.includes(h));
    return hookResult(text, missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All verify headings present');
  }

  if (lower.includes('all full-flow lenses') || lower.includes('full-flow lenses')) {
    const corpus = `${output}\n${logs}\n${graphEvidenceText(workspace)}`.toLowerCase();
    const missing = FULL_FLOW_SKILLS.filter((s) => {
      const short = s.replace(/^lamina-/, '');
      return !corpus.includes(s.toLowerCase()) && !corpus.includes(short.toLowerCase());
    });
    const refusesTruncation =
      /full-flow|all (11 )?lenses|do not truncate|cannot skip|refuse(?:s|d)? truncation|will not skip lenses|do not omit lenses/i.test(
        corpus,
      );
    const passed = missing.length <= 2 || refusesTruncation;
    return hookResult(text, passed, passed ? 'Full-flow skills referenced or truncation refused' : `Missing refs: ${missing.join(', ')}`);
  }

  const skillMatch = text.match(/read skill (lamina-[a-z-]+)|(?:using|load(?:ed)?) [`']?(lamina-[a-z-]+)/i);
  if (skillMatch) {
    const skill = skillMatch[1] || skillMatch[2];
    const passed =
      logs.includes(`${skill}/SKILL.md`) ||
      logs.includes(skill) ||
      new RegExp(skill.replace('-', '[- ]?'), 'i').test(output);
    return hookResult(text, passed, passed ? `${skill} referenced` : `${skill} not found in logs or output`);
  }

  const fileMatch = text.match(/file [`'"]([^`'"]+)[`'"] (exists|was created)/i);
  if (fileMatch) {
    const [, fileName] = fileMatch;
    const exists = workspaceFiles.some((f) => f.endsWith(fileName) || f === fileName);
    const created = newFiles.some((f) => f.endsWith(fileName) || f === fileName);
    const wantCreated = lower.includes('was created') || lower.includes('exists');
    const passed = wantCreated ? exists || created : exists;
    return hookResult(text, passed, passed ? `${fileName} present` : `${fileName} not found`);
  }

  if (lower.includes('was not modified') || lower.includes('not modified')) {
    const modMatch = text.match(/[`'"]([^`'"]+)[`'"]/);
    if (modMatch) {
      const file = modMatch[1];
      const inNew = newFiles.includes(file);
      return hookResult(text, !inNew, !inNew ? `${file} unchanged` : `${file} was modified`);
    }
  }

  // Generic quoted-contains. Skip "turn N output contains …" — handled by turnMatch below
  // so multiturn asserts check the specific turn, not the combined final output.
  if (
    lower.includes('contains') &&
    (text.includes('"') || text.includes('`')) &&
    !/^turn \d+ output contains /i.test(text)
  ) {
    const quoted = text.match(/["'`]([^"'`]+)["'`]/);
    if (quoted) {
      const passed = output.toLowerCase().includes(quoted[1].toLowerCase());
      return hookResult(text, passed, passed ? `Found "${quoted[1]}"` : `Missing "${quoted[1]}"`);
    }
  }

  if (lower.includes('did not emit') && lower.includes('lamina')) {
    const emitted = /## (Design|Audit|Lamina)/i.test(output) || /### Executive summary/i.test(output);
    return hookResult(text, !emitted, !emitted ? 'No Lamina workflow output' : 'Lamina output contract detected');
  }

  if (lower.includes('grounded') || lower.includes('citation')) {
    const passed = /@[\w/-]+|insufficient detail/i.test(`${output}\n${logs}\n${allOutput}`);
    return hookResult(text, passed, passed ? 'Grounding citations found' : 'No @step/screen/element or insufficient-detail marker');
  }

  if (lower.includes('no styling') || lower.includes('no visual styling')) {
    const styling = /\b(tailwind|shadcn|#[0-9a-f]{3,6}|rgb\(|color:\s*|bg-[a-z]+-\d{3}|text-[a-z]+-\d{3}|className=.*bg-)/i.test(output);
    const structuralOk = /structural|wireframe|greyscale|no visual styling|no className/i.test(output);
    const passed = !styling || structuralOk;
    return hookResult(text, passed, passed ? 'No styling specs detected' : 'Styling specs found in output');
  }

  if (lower.includes('ux guidance only') || (lower.includes('guardrail') && !lower.includes('no app source'))) {
    const { hasCode, reasons } = detectImplementableCode(allOutput);
    return hookResult(
      text,
      !hasCode,
      !hasCode ? 'No implementable product code in output' : `Product code in output: ${reasons.join(', ')}`,
    );
  }

  if (
    lower.includes('mentions changelog or stale artifacts') ||
    (lower.includes('changelog') && lower.includes('stale'))
  ) {
    const businessContext = readTextSafe(path.join(workspace, '.lamina/business-context.md'));
    const combined = `${allOutput}\n${businessContext}\n${graphEvidenceText(workspace)}`;
    const hasChangelog = /\bchangelog\b/i.test(combined);
    const hasStale = /\bstale\b/i.test(combined);
    const passed = hasChangelog && hasStale;
    return hookResult(
      text,
      passed,
      passed
        ? 'Changelog and stale language present'
        : `Missing update cues (changelog=${hasChangelog}, stale=${hasStale})`,
    );
  }

  if (lower.includes('edge case categories covered')) {
    const combined = `${allOutput}\n${graphEvidenceText(workspace)}`;
    const count = countEdgeCategories(combined);
    const passed = count >= 3;
    return hookResult(
      text,
      passed,
      passed ? `${count} edge categories found` : `Only ${count} categories (need 3+): ${EDGE_CASE_CATEGORIES.join(', ')}`,
    );
  }

  if (lower.includes('no template domain leak')) {
    const allowed = `${evalMeta?.prompt || ''}\n${process.env.ASE_EVAL_PROMPT || ''}`;
    const leaks = findTemplateLeaks(`${allOutput}\n${graphEvidenceText(workspace)}`, allowed);
    const unique = [...new Set(leaks)];
    return hookResult(
      text,
      unique.length === 0,
      unique.length === 0 ? 'No legacy template domain leaks' : `Template leaks: ${unique.join(', ')}`,
    );
  }

  if (lower.includes('no implementation vocabulary')) {
    const edgeSection = `${graphEvidenceText(workspace)}\n${output.split(/### Edge cases/i)[1] ?? output}`;
    const passed = !IMPL_VOCAB_PATTERNS.test(edgeSection);
    return hookResult(
      text,
      passed,
      passed ? 'No implementation vocabulary in edge-case output' : 'SQL/ORM/API terms found in edge cases',
    );
  }

  if (lower.includes('persona perspectives in output')) {
    const personaIds = loadPersonaIds(workspace);
    const passed =
      personaIds.some((id) => allOutput.includes(id)) ||
      /persona panel|from .+'s perspective|as (the )?(primary|demo)/i.test(allOutput);
    return hookResult(
      text,
      passed,
      passed ? 'Persona voice or id referenced in output' : `Expected one of: ${personaIds.join(', ') || 'persona references'}`,
    );
  }

  if (lower.includes('mentions flows or edge cases')) {
    const passed = /\bflows?\b/i.test(output) && /edge cases?/i.test(output);
    return hookResult(text, passed, passed ? 'Flows and edge cases mentioned' : 'Missing flows or edge cases mention');
  }

  if (lower.includes('mentions flows') && !lower.includes('edge cases')) {
    const passed = /\bflows?\b/i.test(output);
    return hookResult(text, passed, passed ? 'Flows mentioned in output' : 'No flows mention in output');
  }

  if (lower.includes('mentions conflict or open questions')) {
    const passed = /conflict|open questions?|trade-?off|tension between/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Conflict or open questions mentioned' : 'No conflict/open-questions language');
  }

  if (lower.includes('mentions failure or empty or permission')) {
    const passed = /failure|empty|permission|session expired|not found|unavailable/i.test(allOutput);
    return hookResult(text, passed, passed ? 'Operational gap language found' : 'No failure/empty/permission mentions');
  }

  const turnMatch = text.match(/turn (\d+) output contains ["'`]([^"'`]+)["'`]/i);
  if (turnMatch) {
    const turnIdx = Number(turnMatch[1]) - 1;
    const needle = turnMatch[2].toLowerCase();
    const turnText = (turnOutputs[turnIdx] ?? '').toLowerCase();
    const passed = turnText.includes(needle);
    return hookResult(text, passed, passed ? `Found in turn ${turnMatch[1]}` : `Missing in turn ${turnMatch[1]}`);
  }

  return null;
}

async function main() {
  const workspace = process.env.ASE_WORKSPACE_PATH || process.cwd();
  const outputDir = process.env.ASE_OUTPUT_DIR || workspace;
  const turnOutputs = loadTurnOutputs(outputDir);
  const output =
    readTextSafe(path.join(outputDir, 'outputs', 'output.txt')) ||
    readTextSafe(path.join(outputDir, 'output.txt')) ||
    '';
  const logs =
    readTextSafe(path.join(outputDir, 'outputs', 'stdout.log')) +
    readTextSafe(path.join(outputDir, 'outputs', 'stderr.log'));
  const preState = readJsonSafe(process.env.ASE_PRE_STATE_PATH);
  const postState = readJsonSafe(process.env.ASE_POST_STATE_PATH);
  const evalMeta = readJsonSafe(
    path.join(path.dirname(process.env.ASE_ITERATION_DIR || '.'), 'evals_meta.json')
  );

  const gradingPath = process.env.ASE_GRADING_PATH;
  const grading = gradingPath ? readJsonSafe(gradingPath) : null;
  const assertions = grading?.assertion_results?.map((a) => a.text) ?? [];

  const hookAssertions = [];
  const gradeCtx = { output, workspace, preState, postState, logs, evalMeta, turnOutputs };
  for (const text of assertions) {
    const result = gradeAssertion(text, gradeCtx);
    if (result) hookAssertions.push(result);
  }

  const evalId = process.env.ASE_EVAL_ID || '';
  if (evalId.includes('init-gate') || evalId.includes('init-blocked')) {
    const blocked = gradeAssertion('init-blocked contract headings', gradeCtx);
    if (blocked && !hookAssertions.some((h) => h.text.includes('init-blocked'))) {
      hookAssertions.push(blocked);
    }
    const noLamina = gradeAssertion('no `.lamina/` writes', gradeCtx);
    if (noLamina) hookAssertions.push(noLamina);
  }

  if (hookAssertions.length) {
    console.log(JSON.stringify(hookAssertions, null, 2));
  }
  // The eval workspace is disposable and ASE removes it immediately after this
  // hook. Stop its persistent graphd first so cleanup cannot orphan a daemon
  // whose repository path no longer exists.
  try {
    await stopIncompatibleServer(runtimePaths(workspace));
  } catch {}
}

export { gradeAssertion };

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  await main();
}
