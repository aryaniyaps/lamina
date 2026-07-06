/**
 * @typedef {{ from?: string; trigger: string; target: string; flowId?: string }} TransitionEdge
 * @typedef {{ id: string; transitions: TransitionEdge[] }} FlowGroup
 * @typedef {{ flows: FlowGroup[]; transitions: TransitionEdge[]; screens: string[] }} FlowGraphData
 */

const TRANSITION_RE = /<Transition\b([^>]*)\/?>/g;
const FLOW_OPEN_RE = /<Flow\b[^>]*\bid=["']([^"']+)["'][^>]*>/g;

function parseTransitionAttrs(attrs) {
  const trigger = attrs.match(/\btrigger=["']([^"']+)["']/);
  const target = attrs.match(/\btarget=["']([^"']+)["']/);
  const from = attrs.match(/\bfrom=["']([^"']+)["']/);
  if (!trigger || !target) return null;
  return {
    trigger: trigger[1],
    target: target[1],
    from: from?.[1] || undefined,
  };
}

/**
 * @param {string} source
 * @returns {{ flows: FlowGroup[]; transitions: TransitionEdge[] }}
 */
export function parseFlowsSource(source) {
  const flows = [];
  const allTransitions = [];

  const flowIds = [];
  let m;
  while ((m = FLOW_OPEN_RE.exec(source)) !== null) {
    flowIds.push({ id: m[1], index: m.index });
  }

  const defaultFlowId = 'default';
  if (flowIds.length === 0) {
    const transitions = extractTransitions(source, defaultFlowId);
    flows.push({ id: defaultFlowId, transitions });
    allTransitions.push(...transitions);
  } else {
    for (let i = 0; i < flowIds.length; i++) {
      const start = flowIds[i].index;
      const end = i + 1 < flowIds.length ? flowIds[i + 1].index : source.length;
      const chunk = source.slice(start, end);
      const transitions = extractTransitions(chunk, flowIds[i].id);
      flows.push({ id: flowIds[i].id, transitions });
      allTransitions.push(...transitions);
    }
  }

  return { flows, transitions: allTransitions };
}

/**
 * @param {string} chunk
 * @param {string} flowId
 * @returns {TransitionEdge[]}
 */
function extractTransitions(chunk, flowId) {
  const out = [];
  TRANSITION_RE.lastIndex = 0;
  let m;
  while ((m = TRANSITION_RE.exec(chunk)) !== null) {
    const parsed = parseTransitionAttrs(m[1]);
    if (!parsed) continue;
    out.push({ ...parsed, flowId });
  }
  return out;
}

/**
 * @param {TransitionEdge[]} transitions
 * @param {string[]} [extra]
 */
export function collectScreensFromTransitions(transitions, extra = []) {
  const ids = new Set(extra);
  for (const t of transitions) {
    if (t.from) ids.add(t.from);
    ids.add(t.target);
  }
  return [...ids].sort();
}

/**
 * @param {TransitionEdge[]} transitions
 */
export function inferEntryScreen(transitions) {
  const targets = new Set(transitions.map((t) => t.target));
  const sources = transitions.map((t) => t.from).filter(Boolean);
  for (const s of sources) {
    if (!targets.has(s)) return s;
  }
  return transitions[0]?.from ?? transitions[0]?.target;
}

/**
 * @param {FlowGraphData} graph
 * @param {string[]} [changedScreens]
 */
export function toMermaid(graph, changedScreens = []) {
  const lines = ['flowchart LR'];
  const seen = new Set();
  for (const t of graph.transitions) {
    const from = t.from ?? inferEntryScreen(graph.transitions) ?? 'start';
    const fromId = sanitizeId(from);
    const toId = sanitizeId(t.target);
    if (!seen.has(fromId)) {
      lines.push(`  ${fromId}${changedScreens.includes(from) ? ':::changed' : ''}`);
      seen.add(fromId);
    }
    if (!seen.has(toId)) {
      lines.push(`  ${toId}${changedScreens.includes(t.target) ? ':::changed' : ''}`);
      seen.add(toId);
    }
    lines.push(`  ${fromId} -->|${t.trigger}| ${toId}`);
  }
  if (changedScreens.length) {
    lines.push('  classDef changed stroke-dasharray: 4 4');
  }
  return lines.join('\n');
}

/** @param {string} id */
function sanitizeId(id) {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

/** @param {string} source */
export function parseScreenIdsFromSource(source) {
  const ids = [];
  const re = /<Screen\b[^>]*\bid=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

/** @param {string} source */
export function parseTriggersFromScreenSource(source) {
  const triggers = [];
  const re = /\b(?:Button|Action|Link)\b[^>]*\btrigger=["']([^"']+)["']/g;
  let m;
  while ((m = re.exec(source)) !== null) {
    triggers.push(m[1]);
  }
  return triggers;
}
