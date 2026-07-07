#!/usr/bin/env node
/**
 * agent-skill-eval post-grade hook for Lamina-specific assertions.
 * Reads ASE_* env vars; prints JSON array of hook assertion results to stdout.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { checkLaminaInit } from '../../scripts/check_lamina_init.mjs';

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

function gradeAssertion(text, ctx) {
  const lower = text.toLowerCase();
  const { output, workspace, preState, postState, logs, evalMeta } = ctx;
  const newFiles = diffNewFiles(preState, postState);
  const workspaceFiles = listFiles(workspace);

  if (lower.includes('init required') || lower.includes('init-blocked') || lower.includes("'blocked'")) {
    const hasBlocked =
      (/init required|blocked/i.test(output) || /## Lamina: init required/i.test(output)) &&
      (/### Status/i.test(output) || /what's missing/i.test(output) || /### Do not/i.test(output));
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

  return null;
}

function main() {
  const workspace = process.env.ASE_WORKSPACE_PATH || process.cwd();
  const outputDir = process.env.ASE_OUTPUT_DIR || workspace;
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
  for (const text of assertions) {
    const result = gradeAssertion(text, { output, workspace, preState, postState, logs, evalMeta });
    if (result) hookAssertions.push(result);
  }

  const evalId = process.env.ASE_EVAL_ID || '';
  if (evalId.includes('init-gate') || evalId.includes('init-blocked')) {
    const blocked = gradeAssertion('init-blocked contract headings', { output, workspace, preState, postState, logs, evalMeta });
    if (blocked && !hookAssertions.some((h) => h.text.includes('init-blocked'))) {
      hookAssertions.push(blocked);
    }
    const noLamina = gradeAssertion('no `.lamina/` writes', { output, workspace, preState, postState, logs, evalMeta });
    if (noLamina) hookAssertions.push(noLamina);
  }

  if (hookAssertions.length) {
    console.log(JSON.stringify(hookAssertions, null, 2));
  }
  process.exit(0);
}

main();
