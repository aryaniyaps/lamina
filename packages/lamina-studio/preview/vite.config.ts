import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { blueprintApiPlugin, blueprintRootFromConfig } from './blueprint-plugin.js';
import { listScreenIds } from './flow-graph-loader.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');
const repoRoot = path.resolve(packageRoot, '../..');

function loadBlueprintConfig() {
  const configPath = process.env.LAMINA_BLUEPRINT_CONFIG;
  if (!configPath || !fs.existsSync(configPath)) {
    return {
      root: path.resolve(packageRoot, '.dev/blueprints'),
      id: '',
      runId: '',
    };
  }
  const cfg = JSON.parse(fs.readFileSync(configPath, 'utf8'));
  if (!cfg.runId && cfg.id) {
    const metaPath = path.join(cfg.root, cfg.id, 'meta.yaml');
    if (fs.existsSync(metaPath)) {
      const m = fs.readFileSync(metaPath, 'utf8').match(/^run_id:\s*(.+)$/m);
      if (m) cfg.runId = m[1].trim().replace(/^["']|["']$/g, '');
    }
  }
  return cfg;
}

export default defineConfig(() => {
  const cfg = loadBlueprintConfig();
  const blueprintRoot = blueprintRootFromConfig(cfg);
  const blueprintDir = path.resolve(cfg.root, cfg.id);

  return {
    root: __dirname,
    plugins: [
      react(),
      blueprintApiPlugin(blueprintRoot),
      {
        name: 'lamina-studio-config',
        configureServer(server) {
          server.middlewares.use('/__lamina/config', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(cfg));
          });

          server.middlewares.use('/__lamina/blueprints', (_req, res) => {
            if (!fs.existsSync(cfg.root)) {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify([]));
              return;
            }
            const entries = fs
              .readdirSync(cfg.root, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .map((d) => {
                const metaPath = path.join(cfg.root, d.name, 'meta.yaml');
                let title = d.name;
                let run_id: string | undefined;
                if (fs.existsSync(metaPath)) {
                  const meta = fs.readFileSync(metaPath, 'utf8');
                  const titleMatch = meta.match(/^title:\s*["']?(.+?)["']?\s*$/m);
                  if (titleMatch) title = titleMatch[1];
                  const runMatch = meta.match(/^run_id:\s*(.+)$/m);
                  if (runMatch) {
                    run_id = runMatch[1].trim().replace(/^["']|["']$/g, '');
                  }
                }
                return { id: d.name, title, run_id };
              });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(entries));
          });

          server.middlewares.use('/__lamina/brand/logo.svg', (_req, res) => {
            const logoPath = path.join(repoRoot, 'brand/logo.svg');
            if (!fs.existsSync(logoPath)) {
              res.statusCode = 404;
              res.end('brand logo not found');
              return;
            }
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end(fs.readFileSync(logoPath, 'utf8'));
          });

          server.middlewares.use('/__lamina/brand/favicon.svg', (_req, res) => {
            const faviconPath = path.join(repoRoot, 'brand/assets/favicon/favicon-16.svg');
            if (!fs.existsSync(faviconPath)) {
              res.statusCode = 404;
              res.end('brand favicon not found');
              return;
            }
            res.setHeader('Content-Type', 'image/svg+xml');
            res.end(fs.readFileSync(faviconPath, 'utf8'));
          });

          server.middlewares.use('/__lamina/screens', (req, res) => {
            const url = new URL(req.url ?? '', 'http://localhost');
            const blueprintId = url.searchParams.get('id') ?? cfg.id;
            const list = listScreenIds(blueprintRoot, blueprintId);
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(list));
          });
        },
      },
    ],
    define: {
      'import.meta.env.SUB_PREVIEW': JSON.stringify('1'),
    },
    resolve: {
      alias: {
        '@lamina/studio': path.resolve(packageRoot, 'src/index.ts'),
        '@blueprint': blueprintDir,
      },
    },
    server: {
      port: cfg.port ?? 5173,
      fs: {
        allow: [packageRoot, blueprintRoot],
      },
    },
  };
});
