#!/usr/bin/env node
/**
 * agent-skill-eval post-grade hook for Lamina-specific assertions.
 * Reads ASE_* env vars; prints JSON array of hook assertion results to stdout.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkLaminaInit } from '../../scripts/check_lamina_init.mjs';
import { checkLaminaPersonas } from '../../scripts/check_lamina_personas.mjs';
import { validateRunYaml } from '../../lib/run.mjs';
import { diffOutsideLamina } from '../lib/lamina-write-boundary.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

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
  init: ['### Mode', '### Business context summary', '### Open questions', '### Recommended next step'],
};

function hasInitContract(output) {
  return OUTPUT_CONTRACTS.init.some((h) => output.includes(h));
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

function diffNewFiles(preState, postState) {
  const pre = new Set(preState?.files ?? preState?.tracked_files ?? []);
  const post = new Set(postState?.files ?? postState?.tracked_files ?? []);
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

function normalizePath(p) {
  return p.replace(/\\/g, '/');
}

function findBlueprintDirs(workspace, newFiles = []) {
  const dirs = new Set();
  for (const rel of newFiles) {
    const norm = normalizePath(rel);
    const match = norm.match(/^\.lamina\/blueprints\/([^/]+)\//);
    if (match) dirs.add(path.join(workspace, '.lamina/blueprints', match[1]));
  }
  const blueprintsRoot = path.join(workspace, '.lamina/blueprints');
  if (fs.existsSync(blueprintsRoot)) {
    for (const entry of fs.readdirSync(blueprintsRoot, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        const dir = path.join(blueprintsRoot, entry.name);
        const hasMeta = fs.existsSync(path.join(dir, 'meta.yaml'));
        const hasFlows = fs.existsSync(path.join(dir, 'flows.tsx'));
        if (hasMeta || hasFlows) dirs.add(dir);
      }
    }
  }
  return [...dirs];
}

function findRunYamlFiles(workspace) {
  const runsRoot = path.join(workspace, '.lamina/runs');
  if (!fs.existsSync(runsRoot)) return [];
  const files = [];
  for (const entry of fs.readdirSync(runsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const runFile = path.join(runsRoot, entry.name, 'run.yaml');
    if (fs.existsSync(runFile)) files.push(runFile);
  }
  return files;
}

function findRunDirs(workspace) {
  const runsRoot = path.join(workspace, '.lamina/runs');
  if (!fs.existsSync(runsRoot)) return [];
  return fs
    .readdirSync(runsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(runsRoot, entry.name))
    .sort();
}

function latestRunDir(workspace) {
  return findRunDirs(workspace).at(-1) ?? null;
}

function listArtifactMarkdownFiles(workspace) {
  const files = [];
  for (const dir of findRunDirs(workspace)) {
    const artifactsDir = path.join(dir, 'artifacts');
    if (!fs.existsSync(artifactsDir)) continue;
    for (const rel of listFiles(artifactsDir)) {
      if (rel.endsWith('.md')) files.push(path.join(artifactsDir, rel));
    }
  }
  return files;
}

function reportMarkdownFiles(workspace) {
  return findRunDirs(workspace)
    .map((dir) => path.join(dir, 'report.md'))
    .filter((file) => fs.existsSync(file));
}

function handoffMarkdownFiles(workspace) {
  return findRunDirs(workspace)
    .map((dir) => path.join(dir, 'handoff.md'))
    .filter((file) => fs.existsSync(file));
}

function markdownHasFrontmatter(text) {
  return /^---\n[\s\S]+?\n---\n/.test(text);
}

function validateArtifactMarkdownText(text) {
  const errors = [];
  if (!markdownHasFrontmatter(text)) errors.push('missing frontmatter');
  for (const required of ['confidence:', 'sources:']) {
    if (!text.includes(required)) errors.push(`missing ${required}`);
  }
  if (!/```mermaid\n[\s\S]+?```/m.test(text) && !/diagram.*blocked|blocked.*diagram/i.test(text)) {
    errors.push('missing mermaid diagram or blocked diagram explanation');
  }
  if (/SUS score|heatmap|click map|scroll map|session recording/i.test(text) && !/source|evidence|provided|observed/i.test(text)) {
    errors.push('possible unsupported test/analytics claim');
  }
  return errors;
}

function readScenariosText(workspace, blueprintDirs) {
  for (const runFile of findRunYamlFiles(workspace)) {
    try {
      const text = fs.readFileSync(runFile, 'utf8');
      if (text.includes('scenarios:')) return text;
    } catch {
      /* ignore */
    }
  }
  for (const dir of blueprintDirs) {
    const file = path.join(dir, 'scenarios.yaml');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  const fallback = path.join(workspace, '.lamina/blueprints');
  if (!fs.existsSync(fallback)) return '';
  for (const entry of fs.readdirSync(fallback, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(fallback, entry.name, 'scenarios.yaml');
    if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8');
  }
  return '';
}

function countEdgeCategories(text) {
  const lower = text.toLowerCase();
  return EDGE_CASE_CATEGORIES.filter((cat) => lower.includes(cat)).length;
}

function loadPersonaIds(workspace) {
  const file = path.join(workspace, '.lamina/personas.yaml');
  if (!fs.existsSync(file)) return [];
  try {
    const data = fs.readFileSync(file, 'utf8');
    const ids = [];
    for (const line of data.split('\n')) {
      const m = line.match(/^\s*-\s*id:\s*(\S+)/);
      if (m) ids.push(m[1]);
    }
    if (!ids.length && /^\s*id:\s*(\S+)/m.test(data)) {
      const m = data.match(/^\s*id:\s*(\S+)/m);
      if (m) ids.push(m[1]);
    }
    return ids;
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

  if (lower.includes('init required') || lower.includes('init-blocked') || lower.includes("'blocked'")) {
    const hasBlocked =
      (/init required|blocked/i.test(allOutput) || /## Lamina: init required/i.test(allOutput)) &&
      (/### Status/i.test(allOutput) || /what's missing/i.test(allOutput) || /### Do not/i.test(allOutput));
    return hookResult(text, hasBlocked, hasBlocked ? 'Output contains init-blocked signals' : 'No init-blocked contract in output');
  }

  if (lower.includes('init-blocked contract') || (lower.includes('init') && lower.includes('contract') && lower.includes('heading'))) {
    const headings = OUTPUT_CONTRACTS['init-blocked'];
    const missing = headings.filter((h) => !output.includes(h));
    const passed = missing.length === 0 && /## Lamina: init required/i.test(output);
    return hookResult(text, passed, passed ? 'All init-blocked headings present' : `Missing: ${missing.join(', ') || 'title'}`);
  }

  if (lower.includes('clarify contract') || lower.includes('clarification contract')) {
    const headings = OUTPUT_CONTRACTS.clarify;
    const missing = headings.filter((h) => !firstTurnOutput.includes(h));
    const passed = missing.length === 0 && /## Lamina: clarification needed/i.test(firstTurnOutput);
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

  if (lower.includes('personas.yaml valid') || lower.includes('valid personas')) {
    const result = checkLaminaPersonas(workspace);
    return hookResult(text, result.ok, result.ok ? 'checkLaminaPersonas passed' : result.errors.join('; '));
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

  if (lower.includes('no run.yaml before clarification')) {
    const runYamlChanged = changedFiles.filter((f) => /^\.lamina\/runs\/[^/]+\/run\.yaml$/i.test(normalizePath(f)));
    const passed = runYamlChanged.length === 0;
    return hookResult(text, passed, passed ? 'No run.yaml changed' : `Changed run.yaml files: ${runYamlChanged.join(', ')}`);
  }

  if (
    lower.includes('no writes outside .lamina') ||
    lower.includes('repo unchanged') ||
    lower.includes('no file was created under `src/`') ||
    lower.includes('no product code')
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

  if (lower.includes('did not auto-run') || lower.includes('did not auto-run /lamina-init')) {
    const invoked = /lamina-init|\/lamina-init/i.test(logs) && evalMeta?.prompt && !/\/lamina-init/i.test(evalMeta.prompt);
    const passed = !invoked;
    return hookResult(text, passed, passed ? 'No auto-init detected' : 'lamina-init appears in logs without user request');
  }

  if (lower.includes('design') && lower.includes('headings')) {
    const missing = OUTPUT_CONTRACTS.design.filter((h) => !output.includes(h));
    return hookResult(text, missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All design headings present');
  }

  if (lower.includes('init output contract') || (lower.includes('init') && lower.includes('headings'))) {
    const passed = hasInitContract(output);
    return hookResult(text, passed, passed ? 'Init output contract present' : 'Missing init contract headings');
  }

  if (lower.includes('verify') && lower.includes('headings')) {
    const missing = OUTPUT_CONTRACTS.verify.filter((h) => !output.includes(h));
    return hookResult(text, missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All verify headings present');
  }

  if (lower.includes('all full-flow lenses') || lower.includes('full-flow lenses')) {
    const missing = FULL_FLOW_SKILLS.filter((s) => !logs.includes(s) && !output.toLowerCase().includes(s.replace('lamina-', '')));
    const refusesTruncation = /full-flow|all (11 )?lenses|do not truncate|cannot skip/i.test(output);
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

  if (lower.includes('contains') && (text.includes('"') || text.includes('`'))) {
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
    const passed = /@[\w/-]+|insufficient detail/i.test(output);
    return hookResult(text, passed, passed ? 'Grounding citations found' : 'No @step/screen/element or insufficient-detail marker');
  }

  if (lower.includes('no styling') || lower.includes('no visual styling')) {
    const styling = /\b(tailwind|shadcn|#[0-9a-f]{3,6}|rgb\(|color:\s*|bg-[a-z]+-\d{3}|text-[a-z]+-\d{3}|className=.*bg-)/i.test(output);
    const structuralOk = /structural|wireframe|greyscale|no visual styling|no className/i.test(output);
    const passed = !styling || structuralOk;
    return hookResult(text, passed, passed ? 'No styling specs detected' : 'Styling specs found in output');
  }

  if (lower.includes('ux guidance only') || lower.includes('guardrail')) {
    const codeBlocks = /```(?:tsx?|jsx?|python|rust|go)\n[\s\S]*?```/i.test(output);
    const passed = !codeBlocks || /\.lamina\/blueprints/i.test(output);
    return hookResult(text, passed, passed ? 'No implementable product code in output' : 'Product code blocks in output');
  }

  if (lower.includes('edge case categories covered')) {
    const scenariosText = readScenariosText(workspace, findBlueprintDirs(workspace, newFiles));
    const combined = `${allOutput}\n${scenariosText}`;
    const count = countEdgeCategories(combined);
    const passed = count >= 3;
    return hookResult(
      text,
      passed,
      passed ? `${count} edge categories found` : `Only ${count} categories (need 3+): ${EDGE_CASE_CATEGORIES.join(', ')}`,
    );
  }

  if (lower.includes('domain contract present') || lower.includes('domain required')) {
    const runFiles = findRunYamlFiles(workspace);
    const hasDomain = runFiles.some((f) => {
      try {
        const t = fs.readFileSync(f, 'utf8');
        return /\ndomain:/m.test(t) || /^domain:/m.test(t);
      } catch {
        return false;
      }
    });
    return hookResult(text, hasDomain, hasDomain ? 'domain block present in run.yaml' : 'Missing domain in run.yaml');
  }

  if (lower.includes('domain contract present')) {
    return hookResult(text, true, 'Assertion deprecated — use domain contract present');
  }

  if (lower.includes('ready_to_build')) {
    const runFiles = findRunYamlFiles(workspace);
    const ok = runFiles.some((f) => fs.readFileSync(f, 'utf8').includes('ready_to_build'));
    return hookResult(text, ok, ok ? 'status ready_to_build' : 'Missing ready_to_build status');
  }

  if (lower.includes('implement.md')) {
    const impl = workspaceFiles.filter((f) => f.endsWith('/implement.md'));
    return hookResult(text, impl.length > 0, impl.length ? 'implement.md written' : 'No implement.md');
  }

  if (lower.includes('blueprint validate passes') || lower.includes('blueprint offer made') || lower.includes('no styling in blueprint') || lower.includes('no blueprint without consent')) {
    return hookResult(text, true, 'Blueprint removed from product — assertion skipped');
  }

  if (lower.includes('no implementation vocabulary')) {
    const runText = findRunYamlFiles(workspace).map((f) => fs.readFileSync(f, 'utf8')).join('\n');
    const edgeSection = `${runText}\n${output.split(/### Edge cases/i)[1] ?? output}`;
    const passed = !IMPL_VOCAB_PATTERNS.test(edgeSection);
    return hookResult(
      text,
      passed,
      passed ? 'No implementation vocabulary in edge-case output' : 'SQL/ORM/API terms found in edge cases',
    );
  }

  if (lower.includes('scenarios.yaml valid') || lower.includes('run.yaml scenarios valid')) {
    const runFiles = findRunYamlFiles(workspace);
    for (const runFile of runFiles) {
      const result = validateRunYaml(runFile);
      if (result.run.scenarios?.length) {
        return hookResult(
          text,
          result.ok,
          result.ok ? `run.yaml scenarios valid (${path.basename(path.dirname(runFile))})` : result.errors.join('; '),
        );
      }
    }
    return hookResult(text, false, 'No scenarios in run.yaml');
  }

  if (lower.includes('run.yaml valid') || lower.includes('run.yaml structured')) {
    const runFiles = findRunYamlFiles(workspace);
    if (!runFiles.length) {
      return hookResult(text, false, 'No run.yaml found under .lamina/runs/');
    }
    const latest = runFiles.sort().at(-1);
    const result = validateRunYaml(latest);
    return hookResult(
      text,
      result.ok,
      result.ok ? `run.yaml valid (${path.basename(path.dirname(latest))})` : result.errors.join('; '),
    );
  }

  if (lower.includes('run.yaml flows')) {
    const runFiles = findRunYamlFiles(workspace);
    const hasFlows = runFiles.some((f) => {
      try {
        return fs.readFileSync(f, 'utf8').includes('\nflows:');
      } catch {
        return false;
      }
    });
    return hookResult(text, hasFlows, hasFlows ? 'run.yaml flows[] present' : 'No flows[] in run.yaml');
  }

  if (lower.includes('artifact pack exists') || lower.includes('artifact packs exist')) {
    const files = listArtifactMarkdownFiles(workspace);
    return hookResult(
      text,
      files.length > 0,
      files.length ? `Artifact markdown files: ${files.map((f) => path.relative(workspace, f)).join(', ')}` : 'No artifact markdown files found',
    );
  }

  if (lower.includes('no artifact pack before clarification')) {
    const artifacts = changedFiles.filter((f) => /^\.lamina\/runs\/[^/]+\/artifacts\/.+\.md$/i.test(normalizePath(f)));
    return hookResult(
      text,
      artifacts.length === 0,
      artifacts.length ? `Changed artifact markdown files: ${artifacts.join(', ')}` : 'No artifact markdown files changed',
    );
  }

  if (lower.includes('artifact contains diagram') || lower.includes('artifact has diagram')) {
    const files = listArtifactMarkdownFiles(workspace);
    const withDiagram = files.filter((f) => /```mermaid\n[\s\S]+?```/m.test(fs.readFileSync(f, 'utf8')));
    return hookResult(
      text,
      withDiagram.length > 0,
      withDiagram.length ? `Mermaid diagram found in ${path.relative(workspace, withDiagram[0])}` : 'No Mermaid diagram in artifact markdown',
    );
  }

  if (lower.includes('artifact docs valid') || lower.includes('artifact markdown valid')) {
    const files = [...listArtifactMarkdownFiles(workspace), ...handoffMarkdownFiles(workspace)];
    if (!files.length) return hookResult(text, false, 'No artifact or handoff markdown files found');
    const failures = [];
    for (const file of files) {
      const errs = validateArtifactMarkdownText(fs.readFileSync(file, 'utf8'));
      if (errs.length) failures.push(`${path.relative(workspace, file)}: ${errs.join(', ')}`);
    }
    return hookResult(text, failures.length === 0, failures.length ? failures.join('; ') : 'Artifact markdown valid');
  }

  if (lower.includes('implement.md exists') || lower.includes('handoff exists')) {
    const impl = workspaceFiles.filter((f) => f.endsWith('/implement.md'));
    const files = handoffMarkdownFiles(workspace);
    const passed = impl.length > 0 || files.length > 0;
    return hookResult(
      text,
      passed,
      passed
        ? impl.length
          ? `implement.md found`
          : `handoff.md found`
        : 'No implement.md or handoff.md under .lamina/runs/',
    );
  }

  if (lower.includes('handoff maps checklist ids') || lower.includes('handoff maps findings')) {
    const dir = latestRunDir(workspace);
    if (!dir) return hookResult(text, false, 'No run directory found');
    const runFile = path.join(dir, 'run.yaml');
    const handoffFile = path.join(dir, 'handoff.md');
    if (!fs.existsSync(runFile) || !fs.existsSync(handoffFile)) {
      return hookResult(text, false, 'Missing run.yaml or handoff.md');
    }
    const result = validateRunYaml(runFile);
    const ids = [
      ...((result.run.checklist ?? []).map((item) => item.id)),
      ...((result.run.findings ?? []).map((item) => item.id)),
    ].filter(Boolean);
    const handoff = fs.readFileSync(handoffFile, 'utf8');
    const missing = ids.filter((id) => !handoff.includes(id));
    return hookResult(
      text,
      ids.length > 0 && missing.length === 0,
      ids.length === 0
        ? 'No checklist[] or findings[] ids in latest run'
        : missing.length
          ? `Missing ids in handoff.md: ${missing.join(', ')}`
          : 'All checklist/findings ids appear in handoff.md',
    );
  }

  if (lower.includes('report.md narrative only') || lower.includes('report remains narrative')) {
    const reports = reportMarkdownFiles(workspace);
    if (!reports.length) return hookResult(text, false, 'No report.md found under .lamina/runs/');
    const violations = [];
    for (const file of reports) {
      const report = fs.readFileSync(file, 'utf8');
      if (/```mermaid/i.test(report)) violations.push(`${path.relative(workspace, file)}: contains Mermaid`);
      if (/\|\s*(priority|severity|checklist|finding|screen|flow)\s*\|/i.test(report)) {
        violations.push(`${path.relative(workspace, file)}: contains structured table`);
      }
    }
    return hookResult(text, violations.length === 0, violations.length ? violations.join('; ') : 'Reports are narrative only');
  }

  if (lower.includes('blueprint validate passes')) {
    return hookResult(text, true, 'Blueprint removed — skipped');
  }

  if (lower.includes('no styling in blueprint')) {
    return hookResult(text, true, 'Blueprint removed — skipped');
  }

  if (lower.includes('persona simulation file exists')) {
    const simNew = newFiles.filter((f) => {
      const p = normalizePath(f);
      return /\.lamina\/runs\/.+\/run\.yaml$/i.test(p) || /\.lamina\/runs\/.+\/simulation\.yaml$/i.test(p);
    });
    const runYamlExists = workspaceFiles.some((f) => f.includes('/runs/') && f.endsWith('/run.yaml'));
    const legacySimExists = workspaceFiles.some(
      (f) => f.includes('/runs/') && f.endsWith('/simulation.yaml'),
    );
    const legacyPersonasSim = workspaceFiles.some(
      (f) => f.includes('personas/simulations/') && f.endsWith('.yaml'),
    );
    const runYamlHasSimulation =
      runYamlExists &&
      workspaceFiles
        .filter((f) => f.endsWith('/run.yaml'))
        .some((f) => {
          try {
            return fs.readFileSync(f, 'utf8').includes('simulation:');
          } catch {
            return false;
          }
        });
    const passed =
      simNew.length > 0 || runYamlHasSimulation || legacySimExists || legacyPersonasSim;
    return hookResult(
      text,
      passed,
      passed ? 'Persona simulation data found' : 'No simulation in .lamina/runs/*/run.yaml',
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

  if (lower.includes('mentions blueprint or wireframe')) {
    const passed = /blueprint|wireframe|SUB\b|\.lamina\/blueprints/i.test(output);
    return hookResult(text, passed, passed ? 'Blueprint/wireframe mentioned' : 'No blueprint or wireframe language');
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

  if (lower.includes('edge cases section present')) {
    const runHasScenarios = findRunYamlFiles(workspace).some((f) => {
      try {
        return fs.readFileSync(f, 'utf8').includes('scenarios:');
      } catch {
        return false;
      }
    });
    const passed = runHasScenarios || /### Edge cases/i.test(allOutput);
    return hookResult(
      text,
      passed,
      passed ? 'scenarios in run.yaml or ### Edge cases in report' : 'Missing run.yaml scenarios and ### Edge cases section',
    );
  }

  if (lower.includes('blueprint offer made')) {
    const firstTurn = turnOutputs[0] ?? allOutput;
    const passed = /ux review studio|wireframe preview|blueprint preview|preview\?|opens a local link/i.test(firstTurn);
    return hookResult(text, passed, passed ? 'Blueprint/wireframe offer found in early turn' : 'No blueprint checkpoint offer');
  }

  if (lower.includes('no blueprint without consent')) {
    const blueprintNew = newFiles.filter((f) => normalizePath(f).startsWith('.lamina/blueprints/'));
    const passed = blueprintNew.length === 0;
    return hookResult(
      text,
      passed,
      passed ? 'No blueprint directory created' : `Blueprint files created: ${blueprintNew.join(', ')}`,
    );
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

function main() {
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
  process.exit(0);
}

main();
