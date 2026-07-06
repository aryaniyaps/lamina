export interface TransitionEdge {
  from?: string;
  trigger: string;
  target: string;
  flowId?: string;
}

export interface FlowGroup {
  id: string;
  transitions: TransitionEdge[];
}

export interface FlowGraphData {
  flows: FlowGroup[];
  transitions: TransitionEdge[];
  screens: string[];
}

const TRANSITION_RE = /<Transition\b([^>]*)\/?>/g;
const FLOW_OPEN_RE = /<Flow\b[^>]*\bid=["']([^"']+)["'][^>]*>/g;

function parseTransitionAttrs(attrs: string) {
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

function extractTransitions(chunk: string, flowId: string): TransitionEdge[] {
  const out: TransitionEdge[] = [];
  TRANSITION_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = TRANSITION_RE.exec(chunk)) !== null) {
    const parsed = parseTransitionAttrs(m[1]);
    if (!parsed) continue;
    out.push({ ...parsed, flowId });
  }
  return out;
}

export function parseFlowsSource(source: string): Omit<FlowGraphData, 'screens'> {
  const flows: FlowGroup[] = [];
  const allTransitions: TransitionEdge[] = [];

  const flowIds: { id: string; index: number }[] = [];
  let m: RegExpExecArray | null;
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

export function collectScreensFromTransitions(
  transitions: TransitionEdge[],
  extra: string[] = [],
): string[] {
  const ids = new Set<string>(extra);
  for (const t of transitions) {
    if (t.from) ids.add(t.from);
    ids.add(t.target);
  }
  return [...ids].sort();
}

export function inferEntryScreen(transitions: TransitionEdge[]): string | undefined {
  const targets = new Set(transitions.map((t) => t.target));
  const sources = transitions.map((t) => t.from).filter(Boolean) as string[];
  for (const s of sources) {
    if (!targets.has(s)) return s;
  }
  return transitions[0]?.from ?? transitions[0]?.target;
}

export function outgoingTransitions(
  transitions: TransitionEdge[],
  screenId: string,
  flowId?: string,
): TransitionEdge[] {
  const entry = inferEntryScreen(transitions);
  return transitions.filter((t) => {
    const fromMatch = t.from === screenId || (!t.from && entry === screenId);
    const flowMatch = !flowId || t.flowId === flowId;
    return fromMatch && flowMatch;
  });
}

export function toMermaid(graph: FlowGraphData, changedScreens: string[] = []): string {
  const lines = ['flowchart LR'];
  const seen = new Set<string>();
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

function sanitizeId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_]/g, '_');
}

export function parseScreenIdsFromSource(source: string): string[] {
  const ids: string[] = [];
  const re = /<Screen\b[^>]*\bid=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    ids.push(m[1]);
  }
  return ids;
}

export function parseTriggersFromScreenSource(source: string): string[] {
  const triggers: string[] = [];
  const re = /\b(?:Button|Action|Link)\b[^>]*\btrigger=["']([^"']+)["']/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    triggers.push(m[1]);
  }
  return triggers;
}
