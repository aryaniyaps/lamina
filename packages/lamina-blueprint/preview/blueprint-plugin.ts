import fs from 'node:fs';
import path from 'node:path';
import {
  collectScreensFromTransitions,
  parseFlowsSource,
} from './flow-graph.js';

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

export function listScreenIds(blueprintRoot: string, blueprintId: string, diff = false): string[] {
  const base = path.join(path.resolve(blueprintRoot), blueprintId);
  const dirs = diff
    ? ['screens', 'baseline/screens', 'proposed/screens']
    : ['screens'];

  const ids = new Set<string>();
  for (const dir of dirs) {
    const full = path.join(base, dir);
    if (!fs.existsSync(full)) continue;
    for (const file of fs.readdirSync(full)) {
      if (file.endsWith('.tsx')) ids.add(file.replace(/\.tsx$/, ''));
    }
  }
  return [...ids].sort();
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

export function loadFlowGraph(blueprintRoot: string, blueprintId: string) {
  const flowsPath = path.join(path.resolve(blueprintRoot), blueprintId, 'flows.tsx');
  if (!fs.existsSync(flowsPath)) {
    return { flows: [], transitions: [], screens: listScreenIds(blueprintRoot, blueprintId) };
  }
  const source = fs.readFileSync(flowsPath, 'utf8');
  const parsed = parseFlowsSource(source);
  const screens = collectScreensFromTransitions(
    parsed.transitions,
    listScreenIds(blueprintRoot, blueprintId),
  );
  return { ...parsed, screens };
}

/** Screens where baseline and proposed files both exist and differ. */
export function listChangedScreens(blueprintRoot: string, blueprintId: string): string[] {
  const screens = listScreenIds(blueprintRoot, blueprintId, true);
  const changed: string[] = [];
  for (const screenId of screens) {
    const file = `screens/${screenId}.tsx`;
    const baseline = resolveFirstPath(blueprintRoot, blueprintId, [`baseline/${file}`]);
    const proposed = resolveFirstPath(blueprintRoot, blueprintId, [`proposed/${file}`]);
    if (baseline && proposed && baseline !== proposed) {
      changed.push(screenId);
    }
  }
  return changed;
}

export function blueprintApiPlugin(blueprintRoot: string) {
  const root = path.resolve(blueprintRoot);

  return {
    name: 'lamina-blueprint-api',
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
          const blueprintId = url.searchParams.get('id');
          if (!blueprintId) {
            response.statusCode = 400;
            response.end(JSON.stringify({ error: 'missing id' }));
            return;
          }
          const graph = loadFlowGraph(root, blueprintId);
          const changed = listChangedScreens(root, blueprintId);
          response.setHeader('Content-Type', 'application/json');
          response.end(JSON.stringify({ ...graph, changedScreens: changed }));
          return;
        }

        return next();
      });
    },
  };
}

