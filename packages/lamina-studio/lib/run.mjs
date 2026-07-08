import fs from 'node:fs';
import path from 'node:path';
import { validateScenarioFields } from './scenarios.mjs';
import { elementMatchesSource, regionPresent } from './structure-manifest.mjs';

/** @typedef {{ trigger: string; from?: string; target: string }} RunTransition */
/** @typedef {{ id: string; entry_screen?: string; transitions: RunTransition[] }} RunFlowGraph */
/** @typedef {{ id: string; name?: string; status?: string; routes?: string[]; priority?: string; evidence?: string[]; graphs?: RunFlowGraph[] }} RunFlow */
/** @typedef {{ component: string; text?: string; label?: string; name?: string; trigger?: string; columns?: string[]; source?: string; level?: number; type?: string }} RunScreenElement */
/** @typedef {{ id: string; title?: string; status?: string; source?: string; regions?: string[]; elements?: RunScreenElement[] }} RunScreen */
/** @typedef {{ id: string; priority: string; title: string; acceptance?: string[]; screens?: string[]; flows?: string[] }} ChecklistItem */
/** @typedef {{ id: string; priority: string; finding: string; impact?: string; effort?: string; recommendation?: string; screen_id?: string; flow_id?: string }} FindingItem */
/** @typedef {{ id: string; source?: string; kind?: string; summary?: string }} EvidenceItem */
/** @typedef {{ id: string; type?: string; pack?: string; path?: string; confidence?: string; evidence_mode?: string; diagram?: string }} ArtifactItem */

const HOOKS = new Set(['design', 'audit']);
const FLOW_STATUS = new Set(['shipped', 'draft', 'planned', 'unknown']);
const SCREEN_STATUS = new Set(['new', 'existing']);
const CHECKLIST_PRIORITY = new Set(['P0', 'P1', 'P2']);
const FINDING_PRIORITY = new Set(['high', 'medium', 'low']);
const SIM_OUTCOMES = new Set(['success', 'partial_fail', 'abandon']);
const SEVERITY = new Set(['high', 'medium', 'low']);
const CONFIDENCE = new Set(['high', 'medium', 'low', 'blocked']);
const EVIDENCE_MODES = new Set(['evidence_required', 'assumption_allowed', 'simulation_or_evidence', 'run_yaml_required']);
const ARTIFACT_PACKS = new Set([
  'research',
  'ia',
  'flow',
  'journey',
  'interaction',
  'wireframe',
  'validation',
  'accessibility',
  'strategy',
  'handoff',
]);
const ARTIFACT_TYPES = new Set([
  'research_plan', 'research_brief', 'user_interview_guide', 'observation_notes', 'affinity_diagram',
  'empathy_map', 'persona', 'proto_persona', 'user_archetype', 'jtbd_canvas', 'experience_sampling_log',
  'customer_insights_report', 'user_needs_matrix', 'behavioral_segmentation_map', 'mental_model_diagram',
  'user_motivation_matrix', 'research_repository_index', 'site_map', 'information_architecture_diagram',
  'navigation_map', 'content_inventory', 'content_audit', 'content_model', 'taxonomy_diagram',
  'ontology_diagram', 'labeling_system', 'metadata_schema', 'card_sorting_results', 'tree_testing_report',
  'user_flow', 'task_flow', 'screen_flow', 'flowchart', 'navigation_flow', 'decision_flow', 'happy_path_flow',
  'edge_case_flow', 'alternate_flow', 'use_case_diagram', 'activity_diagram', 'state_diagram',
  'customer_journey_map', 'user_journey_map', 'experience_map', 'service_blueprint', 'ecosystem_map',
  'stakeholder_map', 'journey_timeline', 'emotional_journey_map', 'touchpoint_map', 'channel_map',
  'wireflow', 'interaction_flow', 'storyboard', 'scenario', 'use_scenario', 'interaction_matrix',
  'event_flow', 'state_machine_diagram', 'state_transition_table', 'decision_tree', 'low_fidelity_wireframe',
  'mid_fidelity_wireframe', 'high_fidelity_wireframe', 'annotated_wireframe', 'responsive_wireframe',
  'paper_wireframe', 'digital_wireframe', 'usability_test_plan', 'test_script', 'task_list',
  'observation_sheet', 'heatmap', 'click_map', 'scroll_map', 'session_recording', 'issue_log',
  'severity_matrix', 'usability_findings_report', 'sus_report', 'benchmark_report', 'accessibility_audit',
  'contrast_report', 'keyboard_navigation_map', 'screen_reader_flow', 'focus_order_diagram', 'wcag_checklist',
  'opportunity_solution_tree', 'feature_prioritization_matrix', 'kano_model', 'value_proposition_canvas',
  'lean_ux_canvas', 'product_vision_board', 'roadmap', 'impact_mapping', 'story_mapping',
  'design_specification', 'redlines', 'asset_export', 'component_specs', 'motion_specs',
  'token_documentation', 'api_interaction_spec', 'developer_handoff',
]);

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
  /** @type {ArtifactItem[]} */
  const artifacts = [];

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
  /** @type {ArtifactItem | null} */
  let currentArtifact = null;

  let section = 'root';
  let inSimulation = false;
  let inTrigger = false;
  let inAcceptance = false;
  let inRoutes = false;
  let inEvidence = false;
  let inTransitions = false;
  let inBlockers = false;
  let inPanel = false;
  let inFlowsTouched = false;

  /** @type {Record<string, unknown> | null} */
  let currentResult = null;
  /** @type {Record<string, unknown> | null} */
  let currentBlocker = null;

  for (const line of source.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    if (/^simulation:\s*$/.test(line)) {
      section = 'simulation';
      inSimulation = true;
      run.simulation = { results: [] };
      continue;
    }
    if (/^flows:\s*$/.test(line)) {
      section = 'flows';
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
    if (/^artifacts:\s*$/.test(line)) {
      section = 'artifacts';
      continue;
    }

    if (section === 'root') {
      const kv = line.match(/^(\w+):\s*(.*)$/);
      if (!kv) continue;
      const key = kv[1];
      const val = stripYamlScalar(kv[2]);
      if (key === 'flows_touched' && !val) {
        inFlowsTouched = true;
        run.flows_touched = [];
        continue;
      }
      if (inFlowsTouched) {
        const item = line.match(/^\s+-\s+(.+)$/);
        if (item) {
          const v = stripYamlScalar(item[1]);
          if (v) /** @type {string[]} */ (run.flows_touched).push(v);
          continue;
        }
        if (!/^\s/.test(line)) inFlowsTouched = false;
      }
      if (val !== undefined) run[key] = val;
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
        continue;
      }
      if (!currentScreen) continue;

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

    if (section === 'artifacts') {
      const item = line.match(/^\s*-\s+id:\s*(.+)$/);
      if (item) {
        if (currentArtifact) artifacts.push(currentArtifact);
        currentArtifact = { id: stripYamlScalar(item[1]) };
        continue;
      }
      if (!currentArtifact) continue;
      const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val) currentArtifact[kv[1]] = val;
      }
      continue;
    }

    if (section === 'simulation' && inSimulation) {
      if (/^\s+panel:\s*$/.test(line)) {
        inPanel = true;
        /** @type {import('./scenarios.mjs').ScenarioEntry[]} */ (run.simulation).panel = [];
        continue;
      }
      if (inPanel) {
        const pItem = line.match(/^\s+-\s+(.+)$/);
        if (pItem) {
          const v = stripYamlScalar(pItem[1]);
          if (v) /** @type {string[]} */ (/** @type {Record<string, unknown>} */ (run.simulation).panel).push(v);
          continue;
        }
        if (!/^\s{2,}/.test(line)) inPanel = false;
      }

      const resultItem = line.match(/^\s+-\s+persona_id:\s*(.+)$/);
      if (resultItem) {
        if (currentBlocker && currentResult?.blockers) {
          /** @type {Record<string, unknown>[]} */ (currentResult.blockers).push(currentBlocker);
          currentBlocker = null;
        }
        if (currentResult) /** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>} */ (run.simulation).results).push(currentResult);
        currentResult = { persona_id: stripYamlScalar(resultItem[1]) };
        inBlockers = false;
        continue;
      }

      const simKv = line.match(/^\s{2}(\w+):\s*(.*)$/);
      if (simKv) {
        if (currentBlocker && currentResult?.blockers) {
          /** @type {Record<string, unknown>[]} */ (currentResult.blockers).push(currentBlocker);
          currentBlocker = null;
        }
        if (currentResult) {
          /** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>} */ (run.simulation).results).push(currentResult);
          currentResult = null;
        }
        const val = stripYamlScalar(simKv[2]);
        if (val) /** @type {Record<string, unknown>} */ (run.simulation)[simKv[1]] = val;
        continue;
      }

      if (currentResult) {
        if (/^\s+blockers:\s*$/.test(line)) {
          inBlockers = true;
          currentResult.blockers = [];
          continue;
        }
        if (inBlockers) {
          const bItem = line.match(/^\s+-\s+step:\s*(.+)$/);
          if (bItem) {
            if (currentBlocker) /** @type {Record<string, unknown>[]} */ (currentResult.blockers).push(currentBlocker);
            currentBlocker = { step: stripYamlScalar(bItem[1]) };
            continue;
          }
          if (currentBlocker) {
            const kv = line.match(/^\s{6,}(\w+):\s*(.*)$/);
            if (kv) {
              const val = stripYamlScalar(kv[2]);
              if (val) currentBlocker[kv[1]] = val;
            }
            continue;
          }
        }
        const kv = line.match(/^\s{4,}(\w+):\s*(.*)$/);
        if (kv) {
          const val = stripYamlScalar(kv[2]);
          if (val) currentResult[kv[1]] = val;
        }
      }
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
  if (currentArtifact) artifacts.push(currentArtifact);
  if (currentBlocker && currentResult?.blockers) currentResult.blockers.push(currentBlocker);
  if (currentResult) /** @type {Record<string, unknown>[]} */ (/** @type {Record<string, unknown>} */ (run.simulation)?.results)?.push(currentResult);

  if (flows.length) run.flows = flows;
  if (screens.length) run.screens = screens;
  if (scenarios.length) run.scenarios = scenarios;
  if (checklist.length) run.checklist = checklist;
  if (findings.length) run.findings = findings;
  if (evidence.length) run.evidence = evidence;
  if (artifacts.length) run.artifacts = artifacts;

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

  if (hook === 'design' || hook === 'concept' || hook === 'feature') {
    if (!run.flows?.length) errors.push(`${rel}: missing flows[] (required for ${hook})`);
    if (!run.screens?.length) errors.push(`${rel}: missing screens[] (required for ${hook})`);
  }

  if (hook === 'feature' && !run.checklist?.length) {
    errors.push(`${rel}: missing checklist[] (required for feature)`);
  }

  if (hook === 'audit' && !run.findings?.length) {
    errors.push(`${rel}: missing findings[] (required for audit)`);
  }

  if ((hook === 'design' || hook === 'concept' || hook === 'feature' || hook === 'audit') && !run.artifacts?.length) {
    errors.push(`${rel}: missing artifacts[] index (required for ${hook})`);
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
    if (!f.finding) errors.push(`${rel}: finding "${f.id || '?'}" missing finding text`);
    if (!FINDING_PRIORITY.has(f.priority)) {
      errors.push(`${rel}: finding "${f.id}" invalid priority "${f.priority}"`);
    }
  }

  for (const e of /** @type {EvidenceItem[]} */ (run.evidence ?? [])) {
    if (!e.id) errors.push(`${rel}: evidence item missing id`);
    if (!e.source) errors.push(`${rel}: evidence "${e.id || '?'}" missing source`);
    if (!e.summary) errors.push(`${rel}: evidence "${e.id || '?'}" missing summary`);
  }

  for (const a of /** @type {ArtifactItem[]} */ (run.artifacts ?? [])) {
    if (!a.id) errors.push(`${rel}: artifact item missing id`);
    if (a.type && !ARTIFACT_TYPES.has(String(a.type))) {
      errors.push(`${rel}: artifact "${a.id || '?'}" invalid type "${a.type}"`);
    }
    if (!a.path) errors.push(`${rel}: artifact "${a.id || '?'}" missing path`);
    if (a.path && (path.isAbsolute(String(a.path)) || String(a.path).includes('..'))) {
      errors.push(`${rel}: artifact "${a.id}" path must be relative within run directory`);
    }
    if (a.pack && !ARTIFACT_PACKS.has(String(a.pack))) {
      errors.push(`${rel}: artifact "${a.id}" invalid pack "${a.pack}"`);
    }
    if (a.confidence && !CONFIDENCE.has(String(a.confidence))) {
      errors.push(`${rel}: artifact "${a.id}" invalid confidence "${a.confidence}"`);
    }
    if (a.evidence_mode && !EVIDENCE_MODES.has(String(a.evidence_mode))) {
      errors.push(`${rel}: artifact "${a.id}" invalid evidence_mode "${a.evidence_mode}"`);
    }
  }

  const sim = /** @type {Record<string, unknown>} */ (run.simulation);
  if (sim?.results) {
    for (const r of /** @type {Record<string, unknown>[]} */ (sim.results)) {
      if (!r.persona_id) errors.push(`${rel}: simulation result missing persona_id`);
      if (r.outcome && !SIM_OUTCOMES.has(String(r.outcome))) {
        errors.push(`${rel}: invalid outcome "${r.outcome}"`);
      }
      for (const b of /** @type {Record<string, unknown>[]} */ (r.blockers ?? [])) {
        if (b.severity && !SEVERITY.has(String(b.severity))) {
          errors.push(`${rel}: blocker invalid severity "${b.severity}"`);
        }
        if (b.screen_id && screenIds.size && !screenIds.has(String(b.screen_id))) {
          errors.push(`${rel}: blocker references unknown screen_id "${b.screen_id}"`);
        }
      }
    }
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
 * @param {string} runPath
 * @returns {{ ok: boolean; errors: string[]; run: Record<string, unknown> }}
 */
export function validateRunYaml(runPath) {
  const run = loadRunYaml(runPath);
  const rel = path.basename(runPath);
  const errors = validateRunFields(run, rel);
  const runDir = path.dirname(path.resolve(runPath));
  for (const a of /** @type {ArtifactItem[]} */ (run.artifacts ?? [])) {
    if (!a.path) continue;
    const artifactPath = path.resolve(runDir, String(a.path));
    if (!artifactPath.startsWith(runDir + path.sep) && artifactPath !== runDir) {
      errors.push(`${rel}: artifact "${a.id}" resolves outside run directory`);
      continue;
    }
    if (!fs.existsSync(artifactPath)) {
      errors.push(`${rel}: artifact "${a.id}" file not found: ${a.path}`);
    } else {
      const artifactStat = fs.lstatSync(artifactPath);
      if (artifactStat.isSymbolicLink()) {
        errors.push(`${rel}: artifact "${a.id}" path must not be a symlink: ${a.path}`);
      } else if (!artifactStat.isFile()) {
        errors.push(`${rel}: artifact "${a.id}" path is not a file: ${a.path}`);
      }
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
 * @param {string} blueprintDir
 * @returns {string | null}
 */
export function readBlueprintRunId(blueprintDir) {
  const metaPath = path.join(path.resolve(blueprintDir), 'meta.yaml');
  if (!fs.existsSync(metaPath)) return null;
  const m = fs.readFileSync(metaPath, 'utf8').match(/^run_id:\s*(.+)$/m);
  return m ? stripYamlScalar(m[1]) ?? null : null;
}

/**
 * @param {string} blueprintDir
 * @param {string} repoRoot
 * @param {string[]} errors
 */
export function validateRunScreensFidelity(blueprintDir, repoRoot, errors) {
  const runId = readBlueprintRunId(blueprintDir);
  if (!runId) return;

  const laminaRoot = path.resolve(blueprintDir, '../..');
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) {
    errors.push(`meta.yaml run_id "${runId}" — run.yaml not found`);
    return;
  }

  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  const existingScreens = /** @type {RunScreen[]} */ (run.screens ?? []).filter(
    (s) => s.status === 'existing',
  );

  for (const screen of existingScreens) {
    const relManifest = `run.yaml screens "${screen.id}"`;
    const screenPath = path.join(blueprintDir, 'screens', `${screen.id}.tsx`);
    const screenRel = path.relative(blueprintDir, screenPath);

    if (!fs.existsSync(screenPath)) {
      errors.push(`${screenRel}: run.yaml lists existing screen but blueprint file not found`);
      continue;
    }

    if (screen.source) {
      const sourcePath = path.join(repoRoot, screen.source);
      if (!fs.existsSync(sourcePath)) {
        errors.push(`${relManifest}: source not found: ${screen.source}`);
      }
    }

    const source = fs.readFileSync(screenPath, 'utf8');
    for (const region of screen.regions ?? []) {
      if (!regionPresent(region, source)) {
        errors.push(`${screenRel}: missing region component <${region}>`);
      }
    }
    for (const element of screen.elements ?? []) {
      if (!element.component) {
        errors.push(`${relManifest}: element missing component`);
        continue;
      }
      if (!elementMatchesSource(element, source)) {
        const desc = Object.entries(element)
          .filter(([k]) => k !== 'component' || element.component)
          .map(([k, v]) => (k === 'columns' ? `${k}=[${v.join(', ')}]` : `${k}=${v}`))
          .join(', ');
        errors.push(`${screenRel}: run.yaml element not found in blueprint (${desc})`);
      }
    }
  }
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
