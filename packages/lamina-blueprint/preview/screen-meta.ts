import fs from 'node:fs';
import path from 'node:path';
import {
  inferEntryScreen,
  parseTriggersFromScreenSource,
  resolveFlowTransitions,
  type FlowGraphData,
} from './flow-graph.js';

export interface ScreenMeta {
  id: string;
  title: string;
  subtitle?: string;
  triggers: string[];
  states: string[];
  stepIndex: number;
  stepTotal: number;
  isEntry: boolean;
  isTerminal: boolean;
}

const STATE_COMPONENTS = ['EmptyState', 'ErrorState', 'SuccessState', 'Loading', 'Banner'];

function parseInlineText(tag: string, source: string): string | undefined {
  const re = new RegExp(`<${tag}\\b[^>]*>([^<]+)<\\/${tag}>`);
  const m = source.match(re);
  return m?.[1]?.trim();
}

export function parseScreenMetaFromSource(
  source: string,
  screenId: string,
): Omit<ScreenMeta, 'stepIndex' | 'stepTotal' | 'isEntry' | 'isTerminal'> {
  const titleAttr = source.match(/<Screen\b[^>]*\btitle=["']([^"']+)["']/);
  const heading = parseInlineText('Heading', source);
  const text = parseInlineText('Text', source);
  const states = STATE_COMPONENTS.filter((c) => source.includes(`<${c}`));

  return {
    id: screenId,
    title: titleAttr?.[1] ?? screenId,
    subtitle: heading ?? text,
    triggers: parseTriggersFromScreenSource(source),
    states,
  };
}

function orderScreenIds(
  transitions: ReturnType<typeof resolveFlowTransitions>,
  screenIds: string[],
): string[] {
  const entry = inferEntryScreen(transitions);
  const ordered: string[] = [];
  const seen = new Set<string>();

  if (entry) {
    ordered.push(entry);
    seen.add(entry);
  }

  for (const t of transitions) {
    if (t.from && !seen.has(t.from)) {
      ordered.push(t.from);
      seen.add(t.from);
    }
    if (!seen.has(t.target)) {
      ordered.push(t.target);
      seen.add(t.target);
    }
  }

  for (const id of screenIds) {
    if (!seen.has(id)) ordered.push(id);
  }

  return ordered;
}

function resolveScreenFile(
  blueprintRoot: string,
  blueprintId: string,
  subpaths: string[],
): string | null {
  const root = path.resolve(blueprintRoot);
  for (const subpath of subpaths) {
    const filePath = path.resolve(root, blueprintId, subpath);
    if (!filePath.startsWith(path.resolve(root, blueprintId) + path.sep)) continue;
    if (fs.existsSync(filePath)) return filePath;
  }
  return null;
}

function readScreenSource(
  blueprintRoot: string,
  blueprintId: string,
  flowId: string,
  screenId: string,
): string | null {
  const candidates = [
    `flows/${flowId}/screens/${screenId}.tsx`,
    `screens/${screenId}.tsx`,
  ];
  const file = resolveScreenFile(blueprintRoot, blueprintId, candidates);
  if (!file) return null;
  return fs.readFileSync(file, 'utf8');
}

export function loadScreenMetaForFlow(
  blueprintRoot: string,
  blueprintId: string,
  graph: FlowGraphData,
  flowId: string,
): Record<string, ScreenMeta> {
  const transitions = resolveFlowTransitions(graph, flowId);
  const screenIdSet = new Set<string>();
  for (const t of transitions) {
    if (t.from) screenIdSet.add(t.from);
    screenIdSet.add(t.target);
  }
  if (!screenIdSet.size && graph.screens.length) {
    graph.screens.forEach((s) => screenIdSet.add(s));
  }

  const ordered = orderScreenIds(transitions, [...screenIdSet]);
  const entry = inferEntryScreen(transitions);
  const outgoing = new Map<string, number>();
  for (const t of transitions) {
    const from = t.from ?? entry;
    if (from) outgoing.set(from, (outgoing.get(from) ?? 0) + 1);
  }

  const result: Record<string, ScreenMeta> = {};
  ordered.forEach((screenId, index) => {
    const source = readScreenSource(blueprintRoot, blueprintId, flowId, screenId);
    const parsed = source
      ? parseScreenMetaFromSource(source, screenId)
      : { id: screenId, title: screenId, triggers: [], states: [] };

    result[screenId] = {
      ...parsed,
      stepIndex: index + 1,
      stepTotal: ordered.length,
      isEntry: screenId === entry,
      isTerminal: !outgoing.has(screenId),
    };
  });

  return result;
}
