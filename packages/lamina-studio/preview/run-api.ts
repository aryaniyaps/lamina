import fs from 'node:fs';
import path from 'node:path';
import { loadCoverageForRun } from '../lib/coverage.mjs';
import {
  loadRunYaml,
  parseRunYaml,
  resolveRunPath,
  readBlueprintRunId,
} from '../lib/run.mjs';
import { loadFlowsFromRun } from '../lib/run.mjs';
import { loadScenariosFromRun } from '../lib/run.mjs';
import { runFlowsToFlowGraph } from './flows-inventory.js';
import type { FlowGraphData } from './flow-graph.js';

export interface RunMeta {
  id: string;
  hook?: string;
  command?: string;
  blueprint_id?: string;
  simulation?: unknown;
}

export interface RunArtifactIndexEntry {
  id: string;
  type?: string;
  pack?: string;
  path?: string;
  confidence?: string;
  evidence_mode?: string;
  diagram?: string;
}

export interface RunArtifactDocument {
  id: string;
  title: string;
  path: string;
  kind: 'report' | 'handoff' | 'artifact';
  pack?: string;
  confidence?: string;
  evidenceMode?: string;
  diagram?: string;
  content: string;
}

function isSafeRunId(runId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(runId);
}

function safeRunRelativePath(runDir: string, rel: string): string | null {
  const resolved = path.resolve(runDir, rel);
  const root = path.resolve(runDir);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) return null;
  if (!fs.existsSync(resolved)) return null;
  const rootReal = fs.realpathSync(root);
  const fileReal = fs.realpathSync(resolved);
  if (!fileReal.startsWith(rootReal + path.sep) && fileReal !== rootReal) return null;
  return resolved;
}

function titleFromMarkdown(content: string, fallback: string): string {
  const heading = content.match(/^#\s+(.+)$/m);
  if (heading) return heading[1].trim();
  const frontmatterTitle = content.match(/^title:\s*(.+)$/m);
  return frontmatterTitle?.[1]?.trim() || fallback;
}

export function resolveLaminaRoot(blueprintRoot: string): string {
  return path.resolve(blueprintRoot, '..');
}

export function listRuns(laminaRoot: string): { id: string; hook?: string }[] {
  const runsDir = path.join(laminaRoot, 'runs');
  if (!fs.existsSync(runsDir)) return [];
  return fs
    .readdirSync(runsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => {
      const runPath = path.join(runsDir, d.name, 'run.yaml');
      if (!fs.existsSync(runPath)) return { id: d.name };
      const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
      return { id: d.name, hook: run.hook as string | undefined };
    });
}

export function resolveRunId(
  laminaRoot: string,
  blueprintRoot: string,
  blueprintId?: string,
  runId?: string,
): string | null {
  if (runId) return isSafeRunId(runId) ? runId : null;
  if (blueprintId) {
    const fromMeta = readBlueprintRunId(path.join(blueprintRoot, blueprintId));
    if (fromMeta) return fromMeta;
  }
  return null;
}

export function resolveBlueprintId(
  laminaRoot: string,
  runId?: string,
  blueprintId?: string,
): string | null {
  if (blueprintId) return blueprintId;
  if (!runId) return null;
  if (!isSafeRunId(runId)) return null;
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return null;
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return (run.blueprint_id as string) ?? null;
}

export function loadRunFlowGraphByRunId(laminaRoot: string, runId: string): FlowGraphData | null {
  if (!isSafeRunId(runId)) return null;
  const runFlows = loadFlowsFromRun(laminaRoot, runId);
  if (!runFlows.length) return null;
  return runFlowsToFlowGraph(runFlows);
}

export function getRunMeta(laminaRoot: string, runId: string): RunMeta | null {
  if (!isSafeRunId(runId)) return null;
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return null;
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return {
    id: runId,
    hook: run.hook as string | undefined,
    command: run.command as string | undefined,
    blueprint_id: run.blueprint_id as string | undefined,
    simulation: run.simulation,
  };
}

export function getCoverage(laminaRoot: string, runId: string) {
  if (!isSafeRunId(runId)) return { ok: false, runId, error: 'invalid run id' };
  return loadCoverageForRun(laminaRoot, runId, fs, {
    resolveRunPath,
    parseRunYaml,
  });
}

export function getRunScreens(laminaRoot: string, runId: string) {
  if (!isSafeRunId(runId)) return [];
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return [];
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  return (run.screens ?? []) as Array<{ id: string; title?: string; status?: string }>;
}

export function getRunArtifacts(laminaRoot: string, runId: string) {
  if (!isSafeRunId(runId)) return null;
  const runPath = resolveRunPath(laminaRoot, runId);
  if (!fs.existsSync(runPath)) return null;
  const runDir = path.dirname(runPath);
  const run = parseRunYaml(fs.readFileSync(runPath, 'utf8'));
  const index = (run.artifacts ?? []) as RunArtifactIndexEntry[];
  const documents: RunArtifactDocument[] = [];

  const addDoc = (
    kind: RunArtifactDocument['kind'],
    rel: string,
    meta: Partial<RunArtifactDocument> = {},
  ) => {
    const filePath = safeRunRelativePath(runDir, rel);
    if (!filePath) return;
    const stat = fs.lstatSync(filePath);
    if (stat.isSymbolicLink() || !stat.isFile()) return;
    const content = fs.readFileSync(filePath, 'utf8');
    documents.push({
      id: meta.id ?? rel.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '').toLowerCase(),
      title: meta.title ?? titleFromMarkdown(content, rel),
      path: rel,
      kind,
      pack: meta.pack,
      confidence: meta.confidence,
      evidenceMode: meta.evidenceMode,
      diagram: meta.diagram,
      content,
    });
  };

  addDoc('report', 'report.md', { id: 'report', title: 'Report' });
  addDoc('handoff', 'handoff.md', { id: 'handoff', title: 'Developer handoff', pack: 'handoff' });

  for (const item of index) {
    if (!item.path || item.path === 'report.md' || item.path === 'handoff.md') continue;
    addDoc('artifact', item.path, {
      id: item.id,
      pack: item.pack,
      confidence: item.confidence,
      evidenceMode: item.evidence_mode,
      diagram: item.diagram,
    });
  }

  return {
    runId,
    index,
    documents,
  };
}

export { loadScenariosFromRun, loadRunYaml };
