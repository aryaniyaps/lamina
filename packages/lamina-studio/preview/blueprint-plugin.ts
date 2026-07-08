import fs from 'node:fs';
import path from 'node:path';
import { loadPersonas } from './personas.js';
import { loadScenarios } from './scenarios.js';
import { loadScreenMetaForFlow } from './screen-meta.js';
import { buildBlueprintState } from './preview-state.js';
import {
  blueprintExists,
  loadFlowGraphFromDisk,
} from './flow-graph-loader.js';
import {
  getCoverage,
  getRunMeta,
  getRunScreens,
  listRuns,
  loadRunFlowGraphByRunId,
  loadScenariosFromRun,
  resolveBlueprintId,
  resolveLaminaRoot,
  resolveRunId,
} from './run-api.js';

export { blueprintExists, listScreenIds, loadFlowGraph, loadFlowGraphFromDisk } from './flow-graph-loader.js';
export type { FlowGraphSource } from './flow-graph-loader.js';

function resolveBlueprintFile(blueprintRoot: string, rest: string): string | null {
  const filePath = path.resolve(blueprintRoot, rest);
  const root = path.resolve(blueprintRoot);
  if (!filePath.startsWith(root + path.sep) && filePath !== root) return null;
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

export function blueprintRootFromConfig(cfg: { root: string }) {
  return path.resolve(cfg.root);
}

export function resolveFirstPath(
  blueprintRoot: string,
  blueprintId: string,
  subpaths: string[],
): string | null {
  for (const subpath of subpaths) {
    const rest = `${blueprintId}/${subpath}`;
    const found = resolveBlueprintFile(blueprintRoot, rest);
    if (found) return found;
  }
  return null;
}

export function blueprintApiPlugin(blueprintRoot: string) {
  const root = path.resolve(blueprintRoot);
  const laminaRoot = resolveLaminaRoot(root);

  return {
    name: 'lamina-studio-api',
    configureServer(server: {
      middlewares: {
        use: (fn: (req: unknown, res: unknown, next: () => void) => void) => void;
      };
    }) {
      server.middlewares.use((req, res, next) => {
        const request = req as { url?: string; method?: string };
        const response = res as {
          statusCode: number;
          setHeader: (k: string, v: string) => void;
          end: (body: string) => void;
        };

        if (request.method !== 'GET' || !request.url?.startsWith('/__lamina/')) {
          return next();
        }

        const url = new URL(request.url, 'http://localhost');

        if (request.url.startsWith('/__lamina/runs')) {
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(listRuns(laminaRoot)));
          return;
        }

        if (request.url.startsWith('/__lamina/run')) {
          const runId = url.searchParams.get('run') ?? url.searchParams.get('id');
          if (!runId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing run' }));
            return;
          }
          const meta = getRunMeta(laminaRoot, runId);
          if (!meta) {
            response.statusCode = 404;
            response.end(JSON.stringify({ error: 'run not found', runId }));
            return;
          }
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify({
              ...meta,
              screens: getRunScreens(laminaRoot, runId),
            }),
          );
          return;
        }

        if (request.url.startsWith('/__lamina/coverage')) {
          const runId = url.searchParams.get('run') ?? url.searchParams.get('id');
          if (!runId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing run' }));
            return;
          }
          const coverage = getCoverage(laminaRoot, runId);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(coverage));
          return;
        }

        if (request.url.startsWith('/__lamina/resolve')) {
          const blueprintId = url.searchParams.get('id');
          const pathsParam = url.searchParams.get('paths') ?? '';

          if (!blueprintId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing id' }));
            return;
          }

          const subpaths = pathsParam.split(',').filter(Boolean);
          const resolved = resolveFirstPath(root, blueprintId, subpaths);

          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ path: resolved }));
          return;
        }

        if (request.url.startsWith('/__lamina/flow-graph')) {
          const runId = url.searchParams.get('run');
          const blueprintId = url.searchParams.get('id');

          if (runId) {
            const graph = loadRunFlowGraphByRunId(laminaRoot, runId);
            if (!graph) {
              response.statusCode = 404;
              response.end(JSON.stringify({ error: 'no flows in run', runId }));
              return;
            }
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ ...graph, source: 'run.yaml' }));
            return;
          }

          if (!blueprintId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing id or run' }));
            return;
          }
          if (!blueprintExists(root, blueprintId)) {
            response.statusCode = 404;
            response.end(JSON.stringify({ error: 'blueprint not found', id: blueprintId }));
            return;
          }
          const { graph, source } = loadFlowGraphFromDisk(root, blueprintId);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ ...graph, source }));
          return;
        }

        if (request.url.startsWith('/__lamina/scenarios')) {
          const runId = url.searchParams.get('run');
          const blueprintId = url.searchParams.get('id');

          if (runId) {
            const scenarios = loadScenariosFromRun(laminaRoot, runId);
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify(scenarios));
            return;
          }

          if (!blueprintId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing id or run' }));
            return;
          }
          const scenarios = loadScenarios(root, blueprintId);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(scenarios));
          return;
        }

        if (request.url.startsWith('/__lamina/personas')) {
          const blueprintId = url.searchParams.get('id');
          const runId = url.searchParams.get('run');
          const resolvedBlueprint =
            blueprintId ??
            (runId ? resolveBlueprintId(laminaRoot, runId) : null) ??
            undefined;
          if (!resolvedBlueprint && !fs.existsSync(path.join(laminaRoot, 'personas.yaml'))) {
            response.setHeader('Content-Type', 'application/json');
            response.end(JSON.stringify({ primary: null, personas: [] }));
            return;
          }
          const screenIds: string[] = [];
          if (runId) {
            for (const s of getRunScreens(laminaRoot, runId)) {
              screenIds.push(s.id);
            }
          } else if (resolvedBlueprint) {
            const { graph } = loadFlowGraphFromDisk(root, resolvedBlueprint);
            screenIds.push(...graph.screens);
          }
          const data = loadPersonas(root, screenIds, resolvedBlueprint);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(data ?? { primary: null, personas: [] }));
          return;
        }

        if (request.url.startsWith('/__lamina/screen-meta')) {
          const blueprintId = url.searchParams.get('id');
          const flowId = url.searchParams.get('flowId') ?? 'default';
          if (!blueprintId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing id' }));
            return;
          }
          const { graph } = loadFlowGraphFromDisk(root, blueprintId);
          const meta = loadScreenMetaForFlow(root, blueprintId, graph, flowId);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(meta));
          return;
        }

        if (request.url.startsWith('/__lamina/state')) {
          const blueprintId = url.searchParams.get('id');
          const flowId = url.searchParams.get('flowId') ?? 'default';
          if (!blueprintId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing id' }));
            return;
          }
          if (!blueprintExists(root, blueprintId)) {
            response.statusCode = 404;
            response.end(JSON.stringify({ error: 'blueprint not found', id: blueprintId }));
            return;
          }
          const state = buildBlueprintState(root, blueprintId, flowId);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify(state));
          return;
        }

        if (request.url.startsWith('/__lamina/screenshot')) {
          response.statusCode = 501;
          response.setHeader('Content-Type', 'application/json');
          response.end(
            JSON.stringify({
              error: 'screenshot_not_available',
              hint: 'Use GET /__lamina/state for file-based completeness. Visual screenshot requires a future headless renderer.',
            }),
          );
          return;
        }

        return next();
      });
    },
  };
}
