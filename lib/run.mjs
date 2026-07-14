import fs from 'node:fs';
import path from 'node:path';
import { validateScenarioFields } from './scenarios.mjs';
import { validateDependencyGraph } from './dependencies.mjs';
import { extractContractExtras } from './parse-contract-extras.mjs';

/** @typedef {{ trigger: string; from?: string; target: string }} RunTransition */
/** @typedef {{ id: string; entry_screen?: string; transitions: RunTransition[] }} RunFlowGraph */
/** @typedef {{ id: string; name?: string; status?: string; routes?: string[]; priority?: string; evidence?: string[]; graphs?: RunFlowGraph[] }} RunFlow */
/** @typedef {{ component: string; text?: string; label?: string; name?: string; trigger?: string; columns?: string[]; source?: string; level?: number; type?: string }} RunScreenElement */
/** @typedef {{ id: string; title?: string; status?: string; source?: string; regions?: string[]; elements?: RunScreenElement[]; a11y?: Record<string, unknown> }} RunScreen */
/** @typedef {{ id: string; priority: string; title: string; acceptance?: string[]; screens?: string[]; flows?: string[] }} ChecklistItem */
/** @typedef {'product' | 'contract' | 'ops'} FindingFixTarget */
/** @typedef {{ id: string; priority: string; finding: string; impact?: string; effort?: string; recommendation?: string; screen_id?: string; flow_id?: string; fix_target?: FindingFixTarget; severity?: string; description?: string; summary?: string; acceptance?: string; evidence?: string; category?: string; screen?: string; workflow_ref?: string; invariant_ref?: string; scenario_ref?: string; status?: string; verify_mode?: string }} FindingItem */
/** @typedef {{ id: string; source?: string; kind?: string; summary?: string }} EvidenceItem */

const HOOKS = new Set(['design', 'verify', 'audit']);
const FLOW_STATUS = new Set(['shipped', 'draft', 'planned', 'unknown']);
const SCREEN_STATUS = new Set(['new', 'existing']);
const CHECKLIST_PRIORITY = new Set(['P0', 'P1', 'P2']);
const FINDING_PRIORITY = new Set(['high', 'medium', 'low']);
const FINDING_FIX_TARGET = new Set(['product', 'contract', 'ops']);
const RUN_STATUS = new Set(['designing', 'ready_to_build', 'verifying', 'complete']);
const WALKTHROUGH_MODES = new Set(['live_app']);
const WALKTHROUGH_SOURCES = new Set(['product']);
const INVALID_WALKTHROUGH_SOURCES = new Set(['blueprint', 'studio']);

/**
 * @param {string} raw
 */
function stripYamlScalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') return undefined;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

/**
 * @param {string} raw
 * @returns {string[]}
 */
function parseInlineArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner.split(',').map((s) => stripYamlScalar(s.trim())).filter(Boolean);
}

/**
 * Minimal parser for run.yaml structured sections.
 * @param {string} source
 */
export function parseRunYaml(source) {
  /** @type {Record<string, unknown>} */
  const run = {};
  /** @type {RunFlow[]} */
  const flows = [];
  /** @type {RunScreen[]} */
  const screens = [];
  /** @type {import('./scenarios.mjs').ScenarioEntry[]} */
  const scenarios = [];
  /** @type {ChecklistItem[]} */
  const checklist = [];
  /** @type {FindingItem[]} */
  const findings = [];
  /** @type {EvidenceItem[]} */
  const evidence = [];

  /** @type {RunFlow | null} */
  let currentFlow = null;
  /** @type {RunFlowGraph | null} */
  let currentGraph = null;
  /** @type {RunTransition | null} */
  let currentTransition = null;
  /** @type {RunScreen | null} */
  let currentScreen = null;
  /** @type {RunScreenElement | null} */
  let currentElement = null;
  /** @type {import('./scenarios.mjs').ScenarioEntry | null} */
  let currentScenario = null;
  /** @type {ChecklistItem | null} */
  let currentChecklist = null;
  /** @type {FindingItem | null} */
  let currentFinding = null;
  /** @type {EvidenceItem | null} */
  let currentEvidence = null;

  let section = 'root';
  let inTrigger = false;
  let inAcceptance = false;
  let inRoutes = false;
  let inEvidence = false;
  let inTransitions = false;
  let inScreenA11y = false;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^flows:\s*$/.test(line)) {
      section = 'flows';
      continue;
    }
    if (/^workflows:\s*$/.test(line)) {
      section = 'workflows';
      continue;
    }
    if (/^screens:\s*$/.test(line)) {
      section = 'screens';
      continue;
    }
    if (/^scenarios:\s*$/.test(line)) {
      section = 'scenarios';
      continue;
    }
    if (/^checklist:\s*$/.test(line)) {
      section = 'checklist';
      continue;
    }
    if (/^findings:\s*$/.test(line)) {
      section = 'findings';
      continue;
    }
    if (/^evidence:\s*$/.test(line)) {
      section = 'evidence';
      continue;
    }
    // Leave list sections when extras-only top-level keys begin (parsed via extractContractExtras).
    if (
      /^(domain|actors|out_of_scope|forbidden_content|tradeoffs|seed):\s*/.test(line)
    ) {
      section = 'other';
      continue;
    }

    if (section === 'other') continue;

    if (section === 'root') {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const val = stripYamlScalar(kv[2]);
      if (val !== undefined) run[key] = val;
      continue;
    }

    if (section === 'workflows') {
      const workflowItem = line.match(/^\s{2}-\s+id:\s*(.+)$/);
      if (workflowItem) {
        if (!run.workflows) run.workflows = [];
        /** @type {Record<string, unknown>} */
        const workflow = { id: stripYamlScalar(workflowItem[1]) };
        /** @type {Record<string, unknown>[]} */ (run.workflows).push(workflow);
        continue;
      }
      const workflows = /** @type {Record<string, unknown>[]} */ (run.workflows ?? []);
      const currentWorkflow = workflows[workflows.length - 1];
      if (!currentWorkflow) continue;
      const requiresKey = line.match(/^\s{4}requires:\s*\[(.*)\]\s*$/);
      if (requiresKey) {
        currentWorkflow.requires = parseInlineArray(requiresKey[1]);
        continue;
      }
      const kv = line.match(/^\s{4,}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val) currentWorkflow[kv[1]] = val;
      }
      continue;
    }

    if (section === 'flows') {
      const flowItem = line.match(/^\s{2}-\s+id:\s*(.+)$/);
      if (flowItem) {
        if (currentFlow) flows.push(currentFlow);
        currentFlow = { id: stripYamlScalar(flowItem[1]), graphs: [] };
        currentGraph = null;
        inRoutes = false;
        inEvidence = false;
        continue;
      }
      if (!currentFlow) continue;

      if (/^\s+routes:\s*$/.test(line)) {
        inRoutes = true;
        currentFlow.routes = [];
        continue;
      }
      if (/^\s+evidence:\s*$/.test(line)) {
        inEvidence = true;
        currentFlow.evidence = [];
        continue;
      }
      const listItem = line.match(/^\s+-\s+(.+)$/);
      if (listItem && (inRoutes || inEvidence)) {
        const v = stripYamlScalar(listItem[1]);
        if (inRoutes && v) currentFlow.routes.push(v);
        else if (inEvidence && v) currentFlow.evidence.push(v);
        continue;
      }
      if (!/^\s{2,}/.test(line)) {
        inRoutes = false;
        inEvidence = false;
      }

      const graphStart = line.match(/^\s+-\s+id:\s*(.+)$/);
      if (graphStart && /graphs:/.test(source.slice(0, source.indexOf(line)))) {
        // handled below via graphs key
      }

      const graphsKey = line.match(/^\s+graphs:\s*$/);
      if (graphsKey) continue;

      const graphItem = line.match(/^\s{4,}-\s+id:\s*(.+)$/);
      if (graphItem) {
        if (currentGraph && currentFlow.graphs) currentFlow.graphs.push(currentGraph);
        currentGraph = { id: stripYamlScalar(graphItem[1]), transitions: [] };
        inTransitions = false;
        continue;
      }

      const entryScreen = line.match(/^\s{6,}entry_screen:\s*(.+)$/);
      if (entryScreen && currentGraph) {
        currentGraph.entry_screen = stripYamlScalar(entryScreen[1]);
        continue;
      }

      const transList = line.match(/^\s{6,}transitions:\s*$/);
      if (transList && currentGraph) {
        inTransitions = true;
        continue;
      }

      const transItem = line.match(/^\s{8,}-\s+trigger:\s*(.+)$/);
      if (transItem && currentGraph && inTransitions) {
        if (currentTransition) currentGraph.transitions.push(currentTransition);
        currentTransition = { trigger: stripYamlScalar(transItem[1]) };
        continue;
      }

      if (currentTransition && currentGraph) {
        const from = line.match(/^\s{10,}from:\s*(.+)$/);
        const target = line.match(/^\s{10,}target:\s*(.+)$/);
        if (from) currentTransition.from = stripYamlScalar(from[1]);
        if (target) {
          currentTransition.target = stripYamlScalar(target[1]);
          currentGraph.transitions.push(currentTransition);
          currentTransition = null;
        }
        continue;
      }

      const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val) currentFlow[kv[1]] = val;
      }
      continue;
    }

    if (section === 'screens') {
      const screenItem = line.match(/^\s*-\s+id:\s*(.+)$/);
      if (screenItem) {
        if (currentElement && currentScreen) currentScreen.elements.push(currentElement);
        currentElement = null;
        if (currentScreen) screens.push(currentScreen);
        currentScreen = { id: stripYamlScalar(screenItem[1]), elements: [], regions: [] };
        inScreenA11y = false;
        continue;
      }
      if (!currentScreen) continue;

      if (/^\s{2,}a11y:\s*$/.test(line)) {
        inScreenA11y = true;
        currentScreen.a11y = {};
        continue;
      }
      if (inScreenA11y) {
        const a11yKv = line.match(/^\s{4,}(\w+):\s*(.*)$/);
        if (a11yKv) {
          const val = stripYamlScalar(a11yKv[2]);
          if (val !== undefined) currentScreen.a11y[a11yKv[1]] = val;
          continue;
        }
        if (/^\s{2}\w+:/.test(line) || /^\s*-\s+/.test(line)) {
          inScreenA11y = false;
        } else {
          continue;
        }
      }

      const elemItem = line.match(/^\s+-\s+component:\s*(.+)$/);
      if (elemItem) {
        if (currentElement && currentScreen) currentScreen.elements.push(currentElement);
        currentElement = { component: stripYamlScalar(elemItem[1]) };
        continue;
      }
      if (currentElement) {
        const kv = line.match(/^\s{4,}(\w+):\s*(.*)$/);
        if (kv) {
          const val = stripYamlScalar(kv[2]);
          if (val) currentElement[kv[1]] = val;
        }
        continue;
      }

      const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
      if (kv) {
        const key = kv[1];
        const val = stripYamlScalar(kv[2]);
        if (key === 'regions' && val?.startsWith('[')) {
          currentScreen.regions = parseInlineArray(val);
        } else if (val) {
          currentScreen[key] = val;
        }
      }
      continue;
    }

    if (section === 'scenarios') {
      const item = line.match(/^\s*-\s+id:\s*(.+)$/);
      if (item) {
        if (currentScenario) scenarios.push(currentScenario);
        currentScenario = { id: stripYamlScalar(item[1]) };
        inTrigger = false;
        continue;
      }
      if (!currentScenario) continue;

      if (inTrigger) {
        const nested = line.match(/^\s{6,}(\w+):\s*(.*)$/);
        if (nested) {
          const val = stripYamlScalar(nested[2]);
          if (val) {
            if (!currentScenario.trigger) currentScenario.trigger = {};
            currentScenario.trigger[nested[1]] = val;
          }
          continue;
        }
        if (/^\s{4,5}\S/.test(line)) inTrigger = false;
      }

      const kv = line.match(/^\s{4,}(\w+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const val = stripYamlScalar(kv[2]);
      if (key === 'trigger' && !val) {
        inTrigger = true;
        currentScenario.trigger = {};
        continue;
      }
      inTrigger = false;
      if (val) currentScenario[key] = val;
      continue;
    }

    if (section === 'checklist') {
      const item = line.match(/^\s*-\s+id:\s*(.+)$/);
      if (item) {
        if (currentChecklist) checklist.push(currentChecklist);
        currentChecklist = { id: stripYamlScalar(item[1]), priority: 'P1', title: '' };
        inAcceptance = false;
        continue;
      }
      if (!currentChecklist) continue;

      if (/^\s+acceptance:\s*$/.test(line)) {
        inAcceptance = true;
        currentChecklist.acceptance = [];
        continue;
      }
      const accItem = line.match(/^\s+-\s+(.+)$/);
      if (inAcceptance && accItem) {
        const v = stripYamlScalar(accItem[1]);
        if (v) currentChecklist.acceptance.push(v);
        continue;
      }
      if (!/^\s{2,}/.test(line)) inAcceptance = false;

      const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val) currentChecklist[kv[1]] = val;
      }
      continue;
    }

    if (section === 'findings') {
      const item = line.match(/^\s*-\s+id:\s*(.+)$/);
      if (item) {
        if (currentFinding) findings.push(currentFinding);
        currentFinding = { id: stripYamlScalar(item[1]), priority: 'medium', finding: '' };
        continue;
      }
      if (!currentFinding) continue;
      const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val) currentFinding[kv[1]] = val;
      }
      continue;
    }

    if (section === 'evidence') {
      const item = line.match(/^\s*-\s+id:\s*(.+)$/);
      if (item) {
        if (currentEvidence) evidence.push(currentEvidence);
        currentEvidence = { id: stripYamlScalar(item[1]) };
        continue;
      }
      if (!currentEvidence) continue;
      const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val) currentEvidence[kv[1]] = val;
      }
      continue;
    }
  }

  if (currentFlow) flows.push(currentFlow);
  if (currentGraph && currentFlow?.graphs) currentFlow.graphs.push(currentGraph);
  if (currentTransition && currentGraph) currentGraph.transitions.push(currentTransition);
  if (currentScreen) screens.push(currentScreen);
  if (currentElement && currentScreen) currentScreen.elements.push(currentElement);
  if (currentScenario) scenarios.push(currentScenario);
  if (currentChecklist) checklist.push(currentChecklist);
  if (currentFinding) findings.push(currentFinding);
  if (currentEvidence) evidence.push(currentEvidence);

  if (flows.length) run.flows = flows;
  if (screens.length) run.screens = screens;
  if (scenarios.length) run.scenarios = scenarios;
  if (checklist.length) run.checklist = checklist;
  if (findings.length) run.findings = findings;
  if (evidence.length) run.evidence = evidence;

  // Merge nested domain / actors / scope from full-source extract
  const extras = extractContractExtras(source);
  run.domain = {
    ...(/** @type {Record<string, unknown>} */ (run.domain) || {}),
    entities: extras.domain.entities,
    invariants: extras.domain.invariants,
    dependencies: extras.domain.dependencies,
  };
  if (extras.actors.length) run.actors = extras.actors;
  if (extras.out_of_scope.length) run.out_of_scope = extras.out_of_scope;
  if (extras.forbidden_content.length) run.forbidden_content = extras.forbidden_content;
  if (extras.tradeoffs.length) run.tradeoffs = extras.tradeoffs;
  if (extras.seed) run.seed = extras.seed;
  run._freestyle = extras.freestyle;

  return run;
}

/**
 * @param {Record<string, unknown>} run
 * @param {string} [rel]
 * @returns {string[]}
 */
export function validateRunFields(run, rel = 'run.yaml') {
  const errors = [];

  if (!run.id) errors.push(`${rel}: missing id`);
  if (!run.hook) errors.push(`${rel}: missing hook`);
  else if (!HOOKS.has(String(run.hook))) {
    errors.push(`${rel}: invalid hook "${run.hook}" (expected: ${[...HOOKS].join(', ')})`);
  }

  const hook = String(run.hook || '');

  if (run.status && !RUN_STATUS.has(String(run.status))) {
    errors.push(
      `${rel}: invalid status "${run.status}" (expected: ${[...RUN_STATUS].join(', ')})`,
    );
  }

  if (hook === 'design') {
    const hasWorkflows = /** @type {unknown[]} */ (run.workflows ?? []).length > 0;
    const hasFlows = /** @type {unknown[]} */ (run.flows ?? []).length > 0;
    if (!hasWorkflows && !hasFlows) {
      errors.push(`${rel}: missing workflows[] or flows[] (required for design)`);
    }
  }

  const status = String(run.status || '');
  const shipGate =
    status === 'ready_to_build' || status === 'verifying' || status === 'complete';

  if (status === 'ready_to_build') {
    const scenarios = /** @type {import('./scenarios.mjs').ScenarioEntry[]} */ (run.scenarios ?? []);
    if (!scenarios.length) {
      errors.push(`${rel}: status ready_to_build requires scenarios[]`);
    }
    const screens = /** @type {unknown[]} */ (run.screens ?? []);
    if (!screens.length) {
      errors.push(`${rel}: status ready_to_build requires screens[]`);
    }
    const deps = /** @type {unknown[]} */ (
      (/** @type {Record<string, unknown>} */ (run.domain ?? {})).dependencies ?? []
    );
    if (!deps.length) {
      errors.push(
        `${rel}: status ready_to_build requires domain.dependencies[] (first-class reachability graph)`,
      );
    }
    if (!run.out_of_scope || !(/** @type {unknown[]} */ (run.out_of_scope)).length) {
      errors.push(
        `${rel}: status ready_to_build requires out_of_scope[] (brief constraints / ops bans)`,
      );
    }
    if (!run.forbidden_content || !(/** @type {unknown[]} */ (run.forbidden_content)).length) {
      errors.push(
        `${rel}: status ready_to_build requires forbidden_content[] (brief content bans → rejection surfaces)`,
      );
    }
    if (!run.seed) {
      errors.push(
        `${rel}: status ready_to_build requires seed (fixture world summary or fixtures list)`,
      );
    }
    const tradeoffs = /** @type {Record<string, unknown>[]} */ (run.tradeoffs ?? []);
    if (!tradeoffs.length) {
      errors.push(
        `${rel}: status ready_to_build requires tradeoffs[] (stable ids + choice; prefer brief wording)`,
      );
    }
    for (const t of tradeoffs) {
      if (!t.id) errors.push(`${rel}: tradeoff missing id`);
      if (!t.choice) errors.push(`${rel}: tradeoff "${t.id || '?'}" missing choice`);
    }
  }

  // Refuse freestyle substitutes for machine contract
  const freestyle = /** @type {{ edge_cases?: boolean; preconditions?: boolean; illegal_states?: boolean }} */ (
    run._freestyle ?? {}
  );
  if (shipGate) {
    if (freestyle.edge_cases) {
      errors.push(
        `${rel}: freestyle edge_cases: is forbidden at ${status || 'ship'} — use scenarios[] with acceptance`,
      );
    }
    if (freestyle.preconditions) {
      errors.push(
        `${rel}: freestyle preconditions: is forbidden — use domain.dependencies[] + workflows[].requires`,
      );
    }
    if (freestyle.illegal_states) {
      errors.push(
        `${rel}: freestyle illegal_states: is forbidden — use domain.invariants[] with stable ids`,
      );
    }
  }

  errors.push(...validateDependencyGraph(run, rel));

  if ((hook === 'verify' || hook === 'audit') && !run.findings?.length) {
    errors.push(`${rel}: missing findings[] (required for ${hook})`);
  }

  const screenIds = new Set();
  for (const screen of /** @type {RunScreen[]} */ (run.screens ?? [])) {
    if (!screen.id) errors.push(`${rel}: screen missing id`);
    else screenIds.add(screen.id);
    if (screen.status && !SCREEN_STATUS.has(screen.status)) {
      errors.push(`${rel}: screen "${screen.id}" invalid status "${screen.status}"`);
    }
    if (screen.status === 'existing' && !screen.source) {
      errors.push(`${rel}: screen "${screen.id}" status existing requires source`);
    }
    if (shipGate && screen.status === 'new') {
      const a11y = screen.a11y || {};
      if (!a11y.labels) {
        errors.push(`${rel}: screen "${screen.id}" status new requires a11y.labels`);
      }
      if (a11y.touch_min_px === undefined || a11y.touch_min_px === '') {
        errors.push(`${rel}: screen "${screen.id}" status new requires a11y.touch_min_px`);
      }
      if (a11y.color_not_only === undefined || a11y.color_not_only === '') {
        errors.push(`${rel}: screen "${screen.id}" status new requires a11y.color_not_only`);
      }
    }
  }

  for (const flow of /** @type {RunFlow[]} */ (run.flows ?? [])) {
    if (!flow.id) errors.push(`${rel}: flow missing id`);
    if (flow.status && !FLOW_STATUS.has(flow.status)) {
      errors.push(`${rel}: flow "${flow.id}" invalid status "${flow.status}"`);
    }
    for (const graph of flow.graphs ?? []) {
      for (const t of graph.transitions ?? []) {
        if (t.from && !screenIds.has(t.from)) {
          errors.push(`${rel}: transition from unknown screen "${t.from}"`);
        }
        if (t.target && !screenIds.has(t.target)) {
          errors.push(`${rel}: transition to unknown screen "${t.target}"`);
        }
      }
    }
  }

  for (const s of /** @type {import('./scenarios.mjs').ScenarioEntry[]} */ (run.scenarios ?? [])) {
    errors.push(...validateScenarioFields(s).map((e) => e.replace('scenarios.yaml', rel)));
    if (s.screen && screenIds.size && !screenIds.has(s.screen)) {
      errors.push(`${rel}: scenario "${s.id}" references unknown screen "${s.screen}"`);
    }
  }

  for (const item of /** @type {ChecklistItem[]} */ (run.checklist ?? [])) {
    if (!item.id) errors.push(`${rel}: checklist item missing id`);
    if (!item.title) errors.push(`${rel}: checklist "${item.id || '?'}" missing title`);
    if (!CHECKLIST_PRIORITY.has(item.priority)) {
      errors.push(`${rel}: checklist "${item.id}" invalid priority "${item.priority}"`);
    }
  }

  for (const f of /** @type {FindingItem[]} */ (run.findings ?? [])) {
    if (!f.id) errors.push(`${rel}: finding missing id`);
    const findingText = f.finding || f.description || f.summary;
    if (!findingText) {
      errors.push(`${rel}: finding "${f.id || '?'}" missing finding, description, or summary`);
    }
    const priority = f.priority || f.severity;
    if (priority && !FINDING_PRIORITY.has(priority)) {
      errors.push(`${rel}: finding "${f.id}" invalid priority "${priority}"`);
    }
    if (f.fix_target && !FINDING_FIX_TARGET.has(f.fix_target)) {
      errors.push(`${rel}: finding "${f.id}" invalid fix_target "${f.fix_target}"`);
    }

    // Ticket shape required on verify/complete findings
    if (hook === 'verify' || hook === 'audit' || status === 'complete') {
      if (!f.fix_target) {
        errors.push(`${rel}: finding "${f.id}" missing required fix_target (product|contract|ops)`);
      }
      const tgt = f.fix_target || 'product';
      if (tgt === 'product' || tgt === 'contract') {
        if (!f.acceptance) {
          errors.push(`${rel}: finding "${f.id}" missing required acceptance`);
        }
        if (!f.evidence) {
          errors.push(
            `${rel}: finding "${f.id}" missing required evidence (source path, symbol, or walkthrough step)`,
          );
        }
      }
    }
  }

  // Actors: resource_filters encouraged when permissions touch filtered resources
  for (const actor of /** @type {Record<string, unknown>[]} */ (run.actors ?? [])) {
    if (!actor.id) errors.push(`${rel}: actor missing id`);
  }

  for (const e of /** @type {EvidenceItem[]} */ (run.evidence ?? [])) {
    if (!e.id) errors.push(`${rel}: evidence item missing id`);
    if (!e.source) errors.push(`${rel}: evidence "${e.id || '?'}" missing source`);
    if (!e.summary) errors.push(`${rel}: evidence "${e.id || '?'}" missing summary`);
  }

  return errors;
}

/**
 * @param {string} runPath
 */
export function loadRunYaml(runPath) {
  const file = path.resolve(runPath);
  if (!fs.existsSync(file)) throw new Error(`Not found: ${file}`);
  return parseRunYaml(fs.readFileSync(file, 'utf8'));
}

/**
 * Validate walkthrough/index.yaml and referenced step files for live_app product captures.
 * @param {string} runDir
 * @param {string} indexRel
 * @param {string} rel
 * @returns {string[]}
 */
export function validateWalkthroughPack(runDir, indexRel, rel) {
  /** @type {string[]} */
  const errors = [];
  const walkDir = path.dirname(path.resolve(runDir, indexRel));
  const indexPath = path.resolve(runDir, indexRel);
  if (!indexPath.startsWith(runDir + path.sep) && indexPath !== runDir) {
    errors.push(`${rel}: walkthrough index resolves outside run directory`);
    return errors;
  }
  if (!fs.existsSync(indexPath)) {
    errors.push(`${rel}: walkthrough index not found: ${indexRel}`);
    return errors;
  }
  const content = fs.readFileSync(indexPath, 'utf8');
  const modeMatch = content.match(/^mode:\s*(\S+)/m);
  const sourceMatch = content.match(/^source:\s*(\S+)/m);
  const mode = modeMatch?.[1] ?? '';
  const source = sourceMatch?.[1] ?? '';
  if (!WALKTHROUGH_MODES.has(mode)) {
    errors.push(`${rel}: walkthrough invalid mode "${mode}" — must be live_app`);
  }
  if (INVALID_WALKTHROUGH_SOURCES.has(source)) {
    errors.push(`${rel}: walkthrough source "${source}" is not allowed — use product only`);
  } else if (!WALKTHROUGH_SOURCES.has(source)) {
    errors.push(`${rel}: walkthrough invalid source "${source}" — must be product`);
  }
  const screenshotPaths = [...content.matchAll(/^\s+screenshot:\s*(\S+)/gm)].map((m) => m[1]);
  for (const screenshotRel of screenshotPaths) {
    const screenshotPath = path.resolve(walkDir, screenshotRel);
    if (!screenshotPath.startsWith(runDir + path.sep)) {
      errors.push(`${rel}: walkthrough screenshot resolves outside run directory: ${screenshotRel}`);
      continue;
    }
    if (!fs.existsSync(screenshotPath)) {
      errors.push(`${rel}: walkthrough screenshot not found: ${screenshotRel}`);
    }
  }
  const stepIds = [...content.matchAll(/^\s+- id:\s*(\S+)/gm)].map((m) => m[1]);
  const uniqueIds = new Set(stepIds);
  if (stepIds.length !== uniqueIds.size) {
    errors.push(`${rel}: walkthrough has duplicate step ids`);
  }
  return errors;
}

/**
 * @param {string} runPath
 * @returns {{ ok: boolean; errors: string[]; run: Record<string, unknown> }}
 */
export function validateRunYaml(runPath) {
  const run = loadRunYaml(runPath);
  const rel = path.basename(runPath);
  const errors = validateRunFields(run, rel);
  const runDir = path.dirname(path.resolve(runPath));
  for (const e of /** @type {EvidenceItem[]} */ (run.evidence ?? [])) {
    if (e.kind === 'visual_walkthrough' && e.source) {
      errors.push(...validateWalkthroughPack(runDir, String(e.source), rel));
    }
  }
  return { ok: errors.length === 0, errors, run };
}

/**
 * @param {string} laminaRoot
 * @param {string} runId
 */
export function resolveRunPath(laminaRoot, runId) {
  return path.join(path.resolve(laminaRoot), 'runs', runId, 'run.yaml');
}

/**
 * @param {string} laminaRoot
 * @param {string} runId
 * @returns {import('./scenarios.mjs').ScenarioEntry[]}
 */
export function loadScenariosFromRun(laminaRoot, runId) {
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return [];
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return /** @type {import('./scenarios.mjs').ScenarioEntry[]} */ (run.scenarios ?? []);
}

/**
 * @param {string} laminaRoot
 * @param {string} runId
 * @returns {RunFlow[]}
 */
export function loadFlowsFromRun(laminaRoot, runId) {
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return [];
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return /** @type {RunFlow[]} */ (run.flows ?? []);
}
