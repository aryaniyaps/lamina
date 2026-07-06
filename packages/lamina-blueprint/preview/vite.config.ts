import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { blueprintApiPlugin, blueprintRootFromConfig, listScreenIds } from './blueprint-plugin.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, '..');

function loadBlueprintConfig() {
  const configPath = process.env.LAMINA_BLUEPRINT_CONFIG;
  if (!configPath || !fs.existsSync(configPath)) {
    return {
      root: path.resolve(packageRoot, '../../examples/minimal-blueprint/.lamina/blueprints'),
      id: 'demo',
    };
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
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
        name: 'lamina-blueprint-config',
        configureServer(server) {
          server.middlewares.use('/__lamina/config', (_req, res) => {
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(cfg));
          });

          server.middlewares.use('/__lamina/blueprints', (_req, res) => {
            const entries = fs
              .readdirSync(cfg.root, { withFileTypes: true })
              .filter((d) => d.isDirectory())
              .map((d) => {
                const metaPath = path.join(cfg.root, d.name, 'meta.yaml');
                let title = d.name;
                if (fs.existsSync(metaPath)) {
                  const meta = fs.readFileSync(metaPath, 'utf8');
                  const m = meta.match(/^title:\s*["']?(.+?)["']?\s*$/m);
                  if (m) title = m[1];
                }
                return { id: d.name, title };
              });
            res.setHeader('Content-Type', 'application/json');
            res.end(JSON.stringify(entries));
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
        '@lamina/blueprint': path.resolve(packageRoot, 'src/index.ts'),
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
