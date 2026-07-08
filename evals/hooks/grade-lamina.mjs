#!/usr/bin/env node
/**
 * agent-skill-eval post-grade hook for Lamina-specific assertions.
 * Reads ASE_* env vars; prints JSON array of hook assertion results to stdout.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkLaminaInit } from '../../scripts/check_lamina_init.mjs';
import { validateBlueprint } from '../../packages/lamina-blueprint/cli/validate.js';
import { validateRunYaml } from '../../packages/lamina-blueprint/lib/run.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

const OUTPUT_CONTRACTS = {
  'init-blocked': ['### Status', "### What's missing", '### Next step', '### Do not'],
  'design-concept': [
    '### User model',
    '### Journey',
    '### Information architecture',
    '### Flows',
    '### Screens',
    '### Interactions',
    '### Copy guidance',
    '### Accessibility considerations',
    '### Validation plan',
    '### Open questions',
  ],
  'design-feature': [
    '### Problem definition',
    '### Jobs to be done',
    '### Assumptions',
    '### User goals',
    '### Flows',
    '### Edge cases',
    '### Risks',
    '### Success metrics',
    '### Open questions',
  ],
  audit: [
    '### Executive summary',
    '### Findings by flow',
    '### Prioritized improvements',
    '### Quick wins',
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
  const newFiles = diffNewFiles(preState, postState);
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

  if (lower.includes('business-context.md valid') || lower.includes('valid init')) {
    const result = checkLaminaInit(workspace);
    return hookResult(text, result.ok, result.ok ? 'checkLaminaInit passed' : result.errors.join('; '));
  }

  if (lower.includes('no file was created under `.lamina/`') || lower.includes('no `.lamina/` writes')) {
    const laminaNew = newFiles.filter((f) => f.startsWith('.lamina/') || f.startsWith('.lamina\\'));
    const passed = laminaNew.length === 0;
    return hookResult(text, passed, passed ? 'No new .lamina files' : `New files: ${laminaNew.join(', ')}`);
  }

  if (lower.includes('no file was created under `src/`') || lower.includes('no product code')) {
    const codeNew = newFiles.filter((f) =>
      /^(src|app|components)\//.test(f.replace(/\\/g, '/'))
    );
    const passed = codeNew.length === 0;
    return hookResult(text, passed, passed ? 'No product code files created' : `Created: ${codeNew.join(', ')}`);
  }

  if (lower.includes('did not auto-run') || lower.includes('did not auto-run /lamina-init')) {
    const invoked = /lamina-init|\/lamina-init/i.test(logs) && evalMeta?.prompt && !/\/lamina-init/i.test(evalMeta.prompt);
    const passed = !invoked;
    return hookResult(text, passed, passed ? 'No auto-init detected' : 'lamina-init appears in logs without user request');
  }

  if (lower.includes('design-concept') && lower.includes('headings')) {
    const missing = OUTPUT_CONTRACTS['design-concept'].filter((h) => !output.includes(h));
    return hookResult(text, missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All concept headings present');
  }

  if (lower.includes('design-feature') && lower.includes('headings')) {
    const missing = OUTPUT_CONTRACTS['design-feature'].filter((h) => !output.includes(h));
    return hookResult(text, missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All feature headings present');
  }

  if (lower.includes('init output contract') || (lower.includes('init') && lower.includes('headings'))) {
    const passed = hasInitContract(output);
    return hookResult(text, passed, passed ? 'Init output contract present' : 'Missing init contract headings');
  }

  if (lower.includes('audit') && lower.includes('headings')) {
    const missing = OUTPUT_CONTRACTS.audit.filter((h) => !output.includes(h));
    return hookResult(text, missing.length === 0, missing.length ? `Missing: ${missing.join(', ')}` : 'All audit headings present');
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

  if (lower.includes('no domain model artifact')) {
    const laminaNew = newFiles.filter((f) => normalizePath(f).startsWith('.lamina/'));
    const violations = laminaNew.filter((f) => DOMAIN_MODEL_PATTERNS.test(normalizePath(f)));
    const passed = violations.length === 0;
    return hookResult(
      text,
      passed,
      passed ? 'No domain model artifacts created' : `Domain model files: ${violations.join(', ')}`,
    );
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
    const dirs = findBlueprintDirs(workspace, newFiles);
    const withScenarios = dirs.filter((d) => fs.existsSync(path.join(d, 'scenarios.yaml')));
    if (!withScenarios.length) {
      return hookResult(text, false, 'No scenarios in run.yaml or scenarios.yaml in blueprint dirs');
    }
    for (const dir of withScenarios) {
      const result = validateBlueprint(dir);
      if (result.ok) {
        return hookResult(text, true, `scenarios.yaml valid in ${path.basename(dir)}`);
      }
      return hookResult(text, false, result.errors.join('; '));
    }
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

  if (lower.includes('blueprint validate passes')) {
    const dirs = findBlueprintDirs(workspace, newFiles);
    if (!dirs.length) {
      return hookResult(text, false, 'No blueprint directory found under .lamina/blueprints/');
    }
    for (const dir of dirs) {
      const hasMeta = fs.existsSync(path.join(dir, 'meta.yaml'));
      const hasFlows = fs.existsSync(path.join(dir, 'flows.tsx'));
      const screensDir = path.join(dir, 'screens');
      const hasScreen =
        fs.existsSync(screensDir) &&
        fs.readdirSync(screensDir).some((f) => f.endsWith('.tsx'));
      if (!hasMeta || !hasFlows || !hasScreen) {
        continue;
      }
      const result = validateBlueprint(dir);
      if (result.ok) {
        return hookResult(text, true, `Blueprint ${path.basename(dir)} passes validate`);
      }
      return hookResult(text, false, result.errors.join('; '));
    }
    return hookResult(text, false, 'Blueprint missing meta.yaml, flows.tsx, or screens/*.tsx');
  }

  if (lower.includes('no styling in blueprint')) {
    const tsxFiles = listBlueprintTsxFiles(findBlueprintDirs(workspace, newFiles));
    if (!tsxFiles.length) {
      return hookResult(text, false, 'No blueprint TSX files to scan');
    }
    const stylingPattern = /\bclassName\s*=|style\s*=|bg-[a-z]+-\d{3}|text-[a-z]+-\d{3}|#[0-9a-f]{3,6}\b/i;
    const violations = tsxFiles.filter((f) => stylingPattern.test(fs.readFileSync(f, 'utf8')));
    const passed = violations.length === 0;
    return hookResult(
      text,
      passed,
      passed ? 'No styling in blueprint TSX' : `Styling in: ${violations.map((f) => path.basename(f)).join(', ')}`,
    );
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
    const passed = /wireframe preview|blueprint preview|preview\?|opens a local link/i.test(firstTurn);
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
