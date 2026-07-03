# Phase 0 Foundation MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build Lamina's minimum useful local CLI that initializes `.lamina/`, scans project context, runs a guided session, and writes UX-only implementation tasks.

**Architecture:** Use a dependency-free Node.js ESM CLI with small modules for CLI routing, artifact writing, discovery, flow routing, synthesis, and guided sessions. The stable product surface is `.lamina/` Markdown/YAML artifacts plus CLI text/JSON output; no SDK, MCP server, analytics connector, or native adapter is included in Phase 0.

**Tech Stack:** Node.js 20+, npm package scripts, ESM JavaScript, Node built-ins (`node:fs`, `node:path`, `node:readline/promises`, `node:test`, `node:assert`).

## Global Constraints

- Phase 0 only: `lamina init`, `lamina scan`, and `lamina start`.
- No runtime dependencies for Phase 0; use Node.js built-ins before adding packages.
- CLI and file artifacts are the integration surface; SDKs and native plugins are out of scope.
- Artifacts live under `.lamina/` and use Markdown with YAML frontmatter.
- Required artifacts for Phase 0: `current-state.md`, `research-questions.md`, `insights.md`, `personas.md`, `edge-cases.md`, `requirements.md`, `implementation-tasks.md`, `decisions.md`, `config.yml`, `journeys/README.md`.
- Discovery is heuristic and replaceable; output must include evidence, confidence, and gaps.
- Guided mode asks only 3-5 flow questions after the initial intent prompt.
- Supported Phase 0 interfaces: `web` and `mobile`.
- Output must include assumptions, edge cases, verification steps, and what to verify with humans.
- Output must not include visual styling directions, color choices, typography choices, pixel-level layout guidance, or component implementation code.
- Human checkpoints are required before artifact writes in `lamina start`.

---

## File Structure

- Create `package.json` — package metadata, CLI bin, and test scripts.
- Create `bin/lamina.js` — executable wrapper that calls the CLI router.
- Create `src/cli.js` — argument parsing and dispatch for `init`, `scan`, `start`, `tasks`, `doctor`, `--help`.
- Create `src/artifacts.js` — `.lamina/` directory creation, artifact templates, safe writes, existing artifact reads.
- Create `src/discovery.js` — dependency-free project scanner with package/framework/routes/schema/permission/artifact hints.
- Create `src/flow-router.js` — intent routing for `ideate`, `optimize`, `add-feature`.
- Create `src/synthesis.js` — deterministic UX requirements, edge cases, and implementation task Markdown generation.
- Create `src/session.js` — guided conversation orchestration and checkpoint handling.
- Create `src/guardrails.js` — UX-only output validation for banned visual-design/code-generation leakage.
- Modify `README.md` — Phase 0 install, usage, and integration notes.
- Create `tests/*.test.js` — Node test coverage for each module and CLI behavior.

---

### Task 1: Dependency-Free CLI Shell

**Files:**
- Create: `package.json`
- Create: `bin/lamina.js`
- Create: `src/cli.js`
- Test: `tests/cli.test.js`

**Interfaces:**
- Consumes: none.
- Produces: `runCli(argv: string[], io?: { stdout?: { write(text: string): void }, stderr?: { write(text: string): void } }): Promise<number>`.

- [ ] **Step 1: Write the failing CLI tests**

Create `tests/cli.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.js';

function captureIo() {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('prints help with no arguments', async () => {
  const { io, output } = captureIo();
  const code = await runCli([], io);
  assert.equal(code, 0);
  assert.match(output().stdout, /Usage: lamina <command>/);
  assert.match(output().stdout, /init/);
  assert.match(output().stdout, /scan/);
  assert.match(output().stdout, /start/);
});

test('prints help with --help', async () => {
  const { io, output } = captureIo();
  const code = await runCli(['--help'], io);
  assert.equal(code, 0);
  assert.match(output().stdout, /Usage: lamina <command>/);
});

test('unknown command exits with code 1', async () => {
  const { io, output } = captureIo();
  const code = await runCli(['wat'], io);
  assert.equal(code, 1);
  assert.match(output().stderr, /Unknown command: wat/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli.test.js`

Expected: FAIL with an import error for `../src/cli.js`.

- [ ] **Step 3: Write package metadata and minimal CLI implementation**

Create `package.json`:

```json
{
  "name": "lamina",
  "version": "0.1.0",
  "description": "UX context and implementation task artifacts for coding agents",
  "type": "module",
  "bin": {
    "lamina": "./bin/lamina.js"
  },
  "scripts": {
    "test": "node --test",
    "lamina": "node ./bin/lamina.js"
  },
  "engines": {
    "node": ">=20"
  },
  "license": "MIT"
}
```

Create `src/cli.js`:

```js
const HELP = `Usage: lamina <command> [options]

Commands:
  init      Create missing .lamina artifacts
  scan      Print a project context summary
  start     Run a guided Lamina session
  tasks     Print .lamina/implementation-tasks.md
  doctor    Check local Lamina setup

Options:
  --help    Show this help
  --json    Print machine-readable JSON where supported
`;

export async function runCli(argv, io = process) {
  const [command] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.stdout.write(HELP);
    return 0;
  }

  io.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}
```

Create `bin/lamina.js`:

```js
#!/usr/bin/env node
import { runCli } from '../src/cli.js';

const code = await runCli(process.argv.slice(2), process);
process.exitCode = code;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/cli.test.js`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add package.json bin/lamina.js src/cli.js tests/cli.test.js
git commit -m "feat: add lamina cli shell"
```

---

### Task 2: Artifact Manager and `lamina init`

**Files:**
- Create: `src/artifacts.js`
- Modify: `src/cli.js`
- Test: `tests/artifacts.test.js`
- Test: `tests/cli-init.test.js`

**Interfaces:**
- Consumes: `runCli(argv, io)` from Task 1.
- Produces: `ARTIFACT_FILES: string[]`, `initArtifacts(projectRoot: string, options?: { now?: string, sessionId?: string }): Promise<{ created: string[], existing: string[] }>`.

- [ ] **Step 1: Write the failing artifact tests**

Create `tests/artifacts.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ARTIFACT_FILES, initArtifacts } from '../src/artifacts.js';

test('initArtifacts creates the complete .lamina artifact set', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-artifacts-'));
  try {
    const result = await initArtifacts(root, {
      now: '2026-07-03T00:00:00.000Z',
      sessionId: 'lamina_test',
    });

    for (const file of ARTIFACT_FILES) {
      assert.equal(existsSync(join(root, '.lamina', file)), true, `${file} should exist`);
    }

    assert.deepEqual(result.existing, []);
    assert.equal(result.created.includes('implementation-tasks.md'), true);

    const tasks = await readFile(join(root, '.lamina', 'implementation-tasks.md'), 'utf8');
    assert.match(tasks, /artifact: implementation-tasks/);
    assert.match(tasks, /# Implementation Tasks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('initArtifacts is idempotent and does not overwrite existing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-artifacts-'));
  try {
    await initArtifacts(root, {
      now: '2026-07-03T00:00:00.000Z',
      sessionId: 'lamina_test',
    });
    await writeFile(join(root, '.lamina', 'decisions.md'), 'keep me');

    const result = await initArtifacts(root, {
      now: '2026-07-03T00:00:00.000Z',
      sessionId: 'lamina_test',
    });

    assert.equal(await readFile(join(root, '.lamina', 'decisions.md'), 'utf8'), 'keep me');
    assert.equal(result.existing.includes('decisions.md'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

Create `tests/cli-init.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

function captureIo(cwd) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      cwd: () => cwd,
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('lamina init creates .lamina in the current directory', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-cli-init-'));
  try {
    const { io, output } = captureIo(root);
    const code = await runCli(['init'], io);
    assert.equal(code, 0);
    assert.equal(existsSync(join(root, '.lamina', 'config.yml')), true);
    assert.match(output().stdout, /Created .lamina/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/artifacts.test.js tests/cli-init.test.js`

Expected: FAIL with an import error for `../src/artifacts.js` and/or unknown command `init`.

- [ ] **Step 3: Implement artifact manager and wire `init`**

Create `src/artifacts.js`:

```js
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

export const ARTIFACT_FILES = [
  'current-state.md',
  'research-questions.md',
  'insights.md',
  'personas.md',
  'edge-cases.md',
  'requirements.md',
  'implementation-tasks.md',
  'decisions.md',
  'config.yml',
  'journeys/README.md',
];

const TITLES = {
  'current-state.md': 'Current State',
  'research-questions.md': 'Research Questions',
  'insights.md': 'Insights',
  'personas.md': 'Personas',
  'edge-cases.md': 'Edge Cases',
  'requirements.md': 'Requirements',
  'implementation-tasks.md': 'Implementation Tasks',
  'decisions.md': 'Decisions',
  'journeys/README.md': 'Journeys',
};

const SECTIONS = {
  'current-state.md': ['Project Summary', 'Detected Stack', 'Existing User Flows', 'Data Model Summary', 'API/Backend Summary', 'Permissions & Roles', 'Known Gaps', 'Assumptions'],
  'research-questions.md': ['Critical Questions', 'Nice-to-Know Questions', 'Questions Answered This Session', 'Questions Deferred'],
  'insights.md': ['Key Insights', 'Evidence', 'Assumptions', 'Confidence Levels', 'Reusable Insights'],
  'personas.md': ['Primary Users', 'Secondary Users', 'User Goals', 'Pain Points', 'Mental Models'],
  'edge-cases.md': ['P0 Edge Cases', 'P1 Edge Cases', 'P2 Edge Cases', 'Error States', 'Permission Issues', 'Empty States', 'Loading States', 'Recovery Paths'],
  'requirements.md': ['User Requirements', 'Functional UX Requirements', 'Non-Goals', 'Constraints', 'Interface-Specific Requirements', 'Accessibility Requirements', 'Analytics/Instrumentation Requirements', 'UX Requirements Block for UI Skills'],
  'implementation-tasks.md': ['Summary', 'P0 Tasks', 'P1 Tasks', 'P2 Tasks', 'Verification Checklist', 'Edge Cases to Test', 'What to Verify With Humans', 'Assumptions'],
  'decisions.md': ['Active Decisions', 'Superseded Decisions', 'Decision Log'],
  'journeys/README.md': ['Available Journeys'],
};

function artifactName(file) {
  return file.replace('journeys/README', 'journeys').replace(/\.md$/, '');
}

function frontmatter(file, now, sessionId) {
  return `---\nartifact: ${artifactName(file)}\nversion: 1\nupdated: ${now}\nsession_id: ${sessionId}\nstatus: draft\n---\n\n`;
}

function markdownTemplate(file, now, sessionId) {
  const body = [`# ${TITLES[file]}`, '', ...SECTIONS[file].flatMap((section) => [`## ${section}`, '', '- None recorded yet.', ''])].join('\n');
  return `${frontmatter(file, now, sessionId)}${body}`;
}

function configTemplate() {
  return `version: 1\n\nmode: guided\n\ndefault_interfaces:\n  - web\n\nenabled_discovery:\n  schema: true\n  routes: true\n  frontend_flows: true\n  permissions: true\n  analytics: false\n\nanalytics:\n  provider: null\n\noutput:\n  write_artifacts: true\n  require_confirmation: true\n\nboundaries:\n  allow_visual_design: false\n  allow_code_generation: false\n`;
}

export async function initArtifacts(projectRoot, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const sessionId = options.sessionId ?? `lamina_${Date.now().toString(36)}`;
  const laminaRoot = join(projectRoot, '.lamina');
  const created = [];
  const existing = [];

  await mkdir(join(laminaRoot, 'journeys'), { recursive: true });

  for (const file of ARTIFACT_FILES) {
    const target = join(laminaRoot, file);
    if (existsSync(target)) {
      existing.push(file);
      continue;
    }
    await mkdir(join(target, '..'), { recursive: true });
    await writeFile(target, file === 'config.yml' ? configTemplate() : markdownTemplate(file, now, sessionId));
    created.push(file);
  }

  return { created, existing };
}
```

Modify `src/cli.js`:

```js
import { initArtifacts } from './artifacts.js';

const HELP = `Usage: lamina <command> [options]

Commands:
  init      Create missing .lamina artifacts
  scan      Print a project context summary
  start     Run a guided Lamina session
  tasks     Print .lamina/implementation-tasks.md
  doctor    Check local Lamina setup

Options:
  --help    Show this help
  --json    Print machine-readable JSON where supported
`;

export async function runCli(argv, io = process) {
  const [command] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.stdout.write(HELP);
    return 0;
  }

  if (command === 'init') {
    const root = io.cwd ? io.cwd() : process.cwd();
    const result = await initArtifacts(root);
    io.stdout.write(`Created .lamina (${result.created.length} new, ${result.existing.length} existing)\n`);
    return 0;
  }

  io.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/artifacts.test.js tests/cli-init.test.js tests/cli.test.js`

Expected: PASS with all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/artifacts.js src/cli.js tests/artifacts.test.js tests/cli-init.test.js
git commit -m "feat: initialize lamina artifacts"
```

---

### Task 3: Basic Context Discovery and `lamina scan`

**Files:**
- Create: `src/discovery.js`
- Modify: `src/cli.js`
- Test: `tests/discovery.test.js`
- Test: `tests/cli-scan.test.js`

**Interfaces:**
- Consumes: no earlier domain interfaces.
- Produces: `scanProject(projectRoot: string): Promise<DiscoveredContext>` and `formatDiscoverySummary(context: DiscoveredContext): string`.

- [ ] **Step 1: Write failing discovery tests**

Create `tests/discovery.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { scanProject, formatDiscoverySummary } from '../src/discovery.js';

test('scanProject detects package manager, frameworks, routes, schemas, permissions, and artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-scan-'));
  try {
    await mkdir(join(root, 'app', 'settings', 'team'), { recursive: true });
    await mkdir(join(root, 'app', 'api', 'invitations'), { recursive: true });
    await mkdir(join(root, 'prisma'), { recursive: true });
    await mkdir(join(root, 'src'), { recursive: true });
    await mkdir(join(root, '.lamina'), { recursive: true });
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0', react: '19.0.0', '@prisma/client': '6.0.0' } }));
    await writeFile(join(root, 'pnpm-lock.yaml'), 'lockfileVersion: 9');
    await writeFile(join(root, 'app', 'settings', 'team', 'page.tsx'), 'export default function Page() {}');
    await writeFile(join(root, 'app', 'api', 'invitations', 'route.ts'), 'export function POST() {}');
    await writeFile(join(root, 'prisma', 'schema.prisma'), 'model User { id String @id }');
    await writeFile(join(root, 'src', 'auth.ts'), 'export const requireAuth = () => true;');
    await writeFile(join(root, '.lamina', 'requirements.md'), '# Requirements');

    const context = await scanProject(root);

    assert.equal(context.packageManager, 'pnpm');
    assert.deepEqual(context.frameworks.sort(), ['Next.js', 'Prisma', 'React'].sort());
    assert.equal(context.routes.some((route) => route.path === '/settings/team'), true);
    assert.equal(context.routes.some((route) => route.path === '/api/invitations'), true);
    assert.equal(context.schemas.some((schema) => schema.file === 'prisma/schema.prisma'), true);
    assert.equal(context.permissions.some((permission) => permission.file === 'src/auth.ts'), true);
    assert.equal(context.existingArtifacts.includes('requirements.md'), true);
    assert.equal(context.confidence, 'high');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('formatDiscoverySummary includes confidence and gaps', async () => {
  const summary = formatDiscoverySummary({
    projectType: null,
    frameworks: [],
    packageManager: null,
    schemas: [],
    routes: [],
    permissions: [],
    existingArtifacts: [],
    confidence: 'low',
    gaps: ['No package.json found.'],
  });

  assert.match(summary, /## What I found/);
  assert.match(summary, /Confidence/);
  assert.match(summary, /No package.json found/);
});
```

Create `tests/cli-scan.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

function captureIo(cwd) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      cwd: () => cwd,
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('lamina scan prints markdown summary', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-cli-scan-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { express: '5.0.0' } }));
    const { io, output } = captureIo(root);
    const code = await runCli(['scan'], io);
    assert.equal(code, 0);
    assert.match(output().stdout, /## What I found/);
    assert.match(output().stdout, /Express/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lamina scan --json prints context json', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-cli-scan-json-'));
  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { react: '19.0.0' } }));
    const { io, output } = captureIo(root);
    const code = await runCli(['scan', '--json'], io);
    assert.equal(code, 0);
    const parsed = JSON.parse(output().stdout);
    assert.equal(parsed.frameworks.includes('React'), true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/discovery.test.js tests/cli-scan.test.js`

Expected: FAIL with an import error for `../src/discovery.js` and/or unknown command `scan`.

- [ ] **Step 3: Implement scanner and wire `scan`**

Create `src/discovery.js`:

```js
import { readdir, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const IGNORED_DIRS = new Set(['.git', 'node_modules', 'dist', 'build', 'coverage', '.next', '.nuxt', '.cache', 'vendor']);
const PERMISSION_RE = /\b(role|roles|permission|permissions|canAccess|authorize|requireAuth|middleware|isAdmin|ownerId|tenantId|organizationId)\b/i;

async function walk(root, dir = root, out = []) {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return out;
  }

  for (const entry of entries) {
    if (entry.isDirectory() && IGNORED_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) await walk(root, full, out);
    else out.push(relative(root, full).split(sep).join('/'));
  }
  return out;
}

async function readJson(file) {
  try {
    return JSON.parse(await readFile(file, 'utf8'));
  } catch {
    return null;
  }
}

function detectPackageManager(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  if (existsSync(join(root, 'bun.lockb'))) return 'bun';
  if (existsSync(join(root, 'package-lock.json'))) return 'npm';
  return null;
}

function detectFrameworks(pkg) {
  const deps = { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}) };
  const names = new Set();
  if (deps.next) names.add('Next.js');
  if (deps.react) names.add('React');
  if (deps['react-native']) names.add('React Native');
  if (deps.express) names.add('Express');
  if (deps.fastify) names.add('Fastify');
  if (deps['@prisma/client'] || deps.prisma) names.add('Prisma');
  if (deps['drizzle-orm']) names.add('Drizzle');
  return [...names];
}

function routeFromFile(file) {
  if (/^app\/.+\/page\.(t|j)sx?$/.test(file)) return { path: '/' + file.replace(/^app\//, '').replace(/\/page\.(t|j)sx?$/, ''), file, kind: 'page' };
  if (/^app\/.+\/route\.(t|j)s$/.test(file)) return { path: '/' + file.replace(/^app\//, '').replace(/\/route\.(t|j)s$/, ''), file, kind: 'api' };
  if (/^pages\/.+\.(t|j)sx?$/.test(file) && !file.startsWith('pages/api/')) return { path: '/' + file.replace(/^pages\//, '').replace(/\.(t|j)sx?$/, '').replace(/\/index$/, ''), file, kind: 'page' };
  if (/^pages\/api\/.+\.(t|j)s$/.test(file)) return { path: '/api/' + file.replace(/^pages\/api\//, '').replace(/\.(t|j)s$/, ''), file, kind: 'api' };
  return null;
}

async function scanPermissions(root, files) {
  const matches = [];
  for (const file of files.filter((name) => /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(name))) {
    try {
      const text = await readFile(join(root, file), 'utf8');
      if (PERMISSION_RE.test(text)) matches.push({ file, evidence: text.match(PERMISSION_RE)[0] });
    } catch {
      continue;
    }
  }
  return matches.slice(0, 20);
}

export async function scanProject(projectRoot) {
  const files = await walk(projectRoot);
  const pkg = await readJson(join(projectRoot, 'package.json'));
  const packageManager = detectPackageManager(projectRoot);
  const frameworks = detectFrameworks(pkg);
  const routes = files.map(routeFromFile).filter(Boolean);
  const schemas = files.filter((file) => /(^|\/)(schema\.prisma|.*schema.*\.(ts|js)|.*\.sql)$/.test(file)).map((file) => ({ file }));
  const permissions = await scanPermissions(projectRoot, files);
  const existingArtifacts = files.filter((file) => file.startsWith('.lamina/')).map((file) => file.replace('.lamina/', ''));
  const gaps = [];

  if (!pkg) gaps.push('No package.json found.');
  if (frameworks.length === 0) gaps.push('No known framework detected.');
  if (routes.length === 0) gaps.push('No route files detected.');
  if (schemas.length === 0) gaps.push('No schema/model files detected.');
  if (permissions.length === 0) gaps.push('No permission/auth hints detected.');

  const evidenceCount = [pkg, frameworks.length, routes.length, schemas.length, permissions.length].filter(Boolean).length;
  const confidence = evidenceCount >= 4 ? 'high' : evidenceCount >= 2 ? 'medium' : 'low';

  return {
    projectType: frameworks.includes('Next.js') || frameworks.includes('React') ? 'web' : frameworks.includes('React Native') ? 'mobile' : null,
    frameworks,
    packageManager,
    schemas,
    routes,
    permissions,
    existingArtifacts,
    confidence,
    gaps,
  };
}

export function formatDiscoverySummary(context) {
  const lines = ['## What I found', ''];
  lines.push(`- Project type: ${context.projectType ?? 'unknown'}`);
  lines.push(`- Package manager: ${context.packageManager ?? 'unknown'}`);
  lines.push(`- Frameworks: ${context.frameworks.length ? context.frameworks.join(', ') : 'none detected'}`);
  lines.push(`- Routes: ${context.routes.length ? context.routes.map((route) => `${route.path} (${route.file})`).join(', ') : 'none detected'}`);
  lines.push(`- Schemas/models: ${context.schemas.length ? context.schemas.map((schema) => schema.file).join(', ') : 'none detected'}`);
  lines.push(`- Permission hints: ${context.permissions.length ? context.permissions.map((permission) => `${permission.file} (${permission.evidence})`).join(', ') : 'none detected'}`);
  lines.push(`- Existing Lamina artifacts: ${context.existingArtifacts.length ? context.existingArtifacts.join(', ') : 'none detected'}`);
  lines.push('', '## Confidence', '', context.confidence, '', '## Gaps', '');
  lines.push(...(context.gaps.length ? context.gaps.map((gap) => `- ${gap}`) : ['- None detected.']));
  lines.push('');
  return lines.join('\n');
}
```

Modify `src/cli.js`:

```js
import { initArtifacts } from './artifacts.js';
import { formatDiscoverySummary, scanProject } from './discovery.js';

const HELP = `Usage: lamina <command> [options]

Commands:
  init      Create missing .lamina artifacts
  scan      Print a project context summary
  start     Run a guided Lamina session
  tasks     Print .lamina/implementation-tasks.md
  doctor    Check local Lamina setup

Options:
  --help    Show this help
  --json    Print machine-readable JSON where supported
`;

export async function runCli(argv, io = process) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.stdout.write(HELP);
    return 0;
  }

  const root = io.cwd ? io.cwd() : process.cwd();

  if (command === 'init') {
    const result = await initArtifacts(root);
    io.stdout.write(`Created .lamina (${result.created.length} new, ${result.existing.length} existing)\n`);
    return 0;
  }

  if (command === 'scan') {
    const context = await scanProject(root);
    io.stdout.write(args.includes('--json') ? `${JSON.stringify(context, null, 2)}\n` : formatDiscoverySummary(context));
    return 0;
  }

  io.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/discovery.test.js tests/cli-scan.test.js tests/cli.test.js tests/cli-init.test.js tests/artifacts.test.js`

Expected: PASS with all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/discovery.js src/cli.js tests/discovery.test.js tests/cli-scan.test.js
git commit -m "feat: scan project context"
```

---

### Task 4: Flow Router and Guided Question Sets

**Files:**
- Create: `src/flow-router.js`
- Test: `tests/flow-router.test.js`

**Interfaces:**
- Consumes: no earlier domain interfaces.
- Produces: `routeFlow(input: string): 'ideate' | 'optimize' | 'add-feature' | null`, `questionsForFlow(flow: string, mode?: 'guided' | 'expert'): string[]`.

- [ ] **Step 1: Write failing flow-router tests**

Create `tests/flow-router.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { questionsForFlow, routeFlow } from '../src/flow-router.js';

test('routeFlow detects ideation intent', () => {
  assert.equal(routeFlow('I have an idea for a new habit tracker'), 'ideate');
  assert.equal(routeFlow('Help me define a product flow'), 'ideate');
});

test('routeFlow detects optimization intent', () => {
  assert.equal(routeFlow('Improve checkout because users are dropping off'), 'optimize');
  assert.equal(routeFlow('This onboarding flow is confusing'), 'optimize');
});

test('routeFlow detects add-feature intent', () => {
  assert.equal(routeFlow('Add team invites'), 'add-feature');
  assert.equal(routeFlow('Build notification preferences'), 'add-feature');
});

test('routeFlow returns null when uncertain', () => {
  assert.equal(routeFlow('team stuff'), null);
});

test('guided questions stay within the Phase 0 question cap', () => {
  assert.equal(questionsForFlow('ideate').length <= 5, true);
  assert.equal(questionsForFlow('optimize').length <= 5, true);
  assert.equal(questionsForFlow('add-feature').length <= 5, true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/flow-router.test.js`

Expected: FAIL with an import error for `../src/flow-router.js`.

- [ ] **Step 3: Implement flow routing and questions**

Create `src/flow-router.js`:

```js
const FLOW_PATTERNS = {
  ideate: [/\bidea\b/i, /explore/i, /not sure what to build/i, /help me define/i, /from scratch/i],
  optimize: [/improve/i, /optimi[sz]e/i, /dropping off/i, /confusing/i, /make .* better/i, /friction/i],
  'add-feature': [/\badd\b/i, /\bbuild\b/i, /implement/i, /create/i, /feature/i],
};

const QUESTIONS = {
  ideate: [
    'Who is this for?',
    'What problem are they trying to solve?',
    'What should users be able to do when this is done?',
    'Which interface is this for: web or mobile?',
    'What constraints should Lamina preserve?',
  ],
  optimize: [
    'Which existing flow should we optimize?',
    'What problem are users experiencing?',
    'What evidence do you have: analytics, support tickets, anecdotes, or none?',
    'What outcome should improve?',
    'What technical constraints should Lamina preserve?',
  ],
  'add-feature': [
    'What feature are you adding?',
    'Who will use it?',
    'Where should it fit into the current product?',
    'What must the user be able to do?',
    'Which interface is this for: web or mobile?',
  ],
};

export function routeFlow(input) {
  const text = input ?? '';
  for (const [flow, patterns] of Object.entries(FLOW_PATTERNS)) {
    if (patterns.some((pattern) => pattern.test(text))) return flow;
  }
  return null;
}

export function questionsForFlow(flow) {
  return QUESTIONS[flow] ? [...QUESTIONS[flow]] : [];
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/flow-router.test.js`

Expected: PASS with 5 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/flow-router.js tests/flow-router.test.js
git commit -m "feat: route guided lamina flows"
```

---

### Task 5: UX-Only Synthesis and Task Generation

**Files:**
- Create: `src/guardrails.js`
- Create: `src/synthesis.js`
- Test: `tests/synthesis.test.js`

**Interfaces:**
- Consumes: `DiscoveredContext` from `scanProject()`, flow names from `routeFlow()`.
- Produces: `generateSessionArtifacts(input: { flow: string, intent: string, answers: Record<string,string>, interfaceType: 'web' | 'mobile', context: DiscoveredContext }): { requirements: string, edgeCases: string, implementationTasks: string, currentState: string, insights: string }`, `assertUxOnly(text: string): void`.

- [ ] **Step 1: Write failing synthesis tests**

Create `tests/synthesis.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { assertUxOnly } from '../src/guardrails.js';
import { generateSessionArtifacts } from '../src/synthesis.js';

const context = {
  projectType: 'web',
  frameworks: ['Next.js'],
  packageManager: 'pnpm',
  schemas: [{ file: 'prisma/schema.prisma' }],
  routes: [{ path: '/settings/team', file: 'app/settings/team/page.tsx', kind: 'page' }],
  permissions: [{ file: 'src/auth.ts', evidence: 'requireAuth' }],
  existingArtifacts: [],
  confidence: 'high',
  gaps: [],
};

test('generateSessionArtifacts creates implementation-ready UX task output', () => {
  const artifacts = generateSessionArtifacts({
    flow: 'add-feature',
    intent: 'Add team invites',
    interfaceType: 'web',
    context,
    answers: {
      'What feature are you adding?': 'Team invitations',
      'Who will use it?': 'Workspace admins',
      'Where should it fit into the current product?': 'Settings team page',
      'What must the user be able to do?': 'Invite a teammate by email and see whether it worked',
      'Which interface is this for: web or mobile?': 'web',
    },
  });

  assert.match(artifacts.implementationTasks, /# Implementation Tasks/);
  assert.match(artifacts.implementationTasks, /User rationale/);
  assert.match(artifacts.implementationTasks, /Acceptance criteria/);
  assert.match(artifacts.implementationTasks, /Edge cases/);
  assert.match(artifacts.implementationTasks, /Verification steps/);
  assert.match(artifacts.requirements, /UX Requirements Block/);
  assert.match(artifacts.edgeCases, /duplicate action/i);
  assert.doesNotThrow(() => assertUxOnly(Object.values(artifacts).join('\n')));
});

test('mobile sessions include mobile-specific edge cases', () => {
  const artifacts = generateSessionArtifacts({
    flow: 'ideate',
    intent: 'I have an idea for mobile habit tracking',
    interfaceType: 'mobile',
    context: { ...context, projectType: 'mobile', frameworks: ['React Native'] },
    answers: {
      'Who is this for?': 'People building habits',
      'What problem are they trying to solve?': 'Remembering daily actions',
      'What should users be able to do when this is done?': 'Track completion',
      'Which interface is this for: web or mobile?': 'mobile',
      'What constraints should Lamina preserve?': 'Works during intermittent connectivity',
    },
  });

  assert.match(artifacts.edgeCases, /intermittent connectivity/i);
});

test('assertUxOnly rejects visual design leakage', () => {
  assert.throws(() => assertUxOnly('Use a blue button with 16px rounded corners.'), /visual design leakage/i);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/synthesis.test.js`

Expected: FAIL with import errors for `../src/guardrails.js` and `../src/synthesis.js`.

- [ ] **Step 3: Implement guardrails and synthesis templates**

Create `src/guardrails.js`:

```js
const BANNED_PATTERNS = [
  /\b(color|colour|blue|red|green|purple|gradient)\b/i,
  /\btypography|font|typeface\b/i,
  /\bpx\b|pixel-level|rounded corners/i,
  /\bReact component\b|implementation code|copy this code/i,
];

export function assertUxOnly(text) {
  const hit = BANNED_PATTERNS.find((pattern) => pattern.test(text));
  if (hit) throw new Error(`UX-only guardrail failed: visual design leakage matched ${hit}`);
}
```

Create `src/synthesis.js`:

```js
import { assertUxOnly } from './guardrails.js';

function bullets(items) {
  return items.length ? items.map((item) => `- ${item}`).join('\n') : '- None recorded.';
}

function answer(answers, startsWith) {
  const key = Object.keys(answers).find((candidate) => candidate.startsWith(startsWith));
  return key ? answers[key] : 'Not specified';
}

function titleFor(input) {
  if (input.flow === 'add-feature') return answer(input.answers, 'What feature are you adding');
  if (input.flow === 'optimize') return answer(input.answers, 'Which existing flow');
  return input.intent;
}

function interfaceEdgeCases(interfaceType) {
  if (interfaceType === 'mobile') {
    return ['Intermittent connectivity during the flow', 'Permission prompt is denied or delayed', 'User resumes after the app was backgrounded'];
  }
  return ['Empty state before any user data exists', 'Loading state while saving or fetching data', 'Keyboard-only and screen-reader completion path'];
}

function commonEdgeCases() {
  return ['Validation failure for required user input', 'Permission denied for an unauthorized user', 'Duplicate action from a double-submit or retry', 'Recoverable server or network error'];
}

export function generateSessionArtifacts(input) {
  const feature = titleFor(input);
  const user = answer(input.answers, input.flow === 'add-feature' ? 'Who will use it' : 'Who is this for');
  const goal = answer(input.answers, input.flow === 'optimize' ? 'What outcome should improve' : 'What must the user be able to do');
  const routes = input.context.routes.map((route) => `${route.path} (${route.file})`);
  const edgeCases = [...commonEdgeCases(), ...interfaceEdgeCases(input.interfaceType)];
  const assumptions = [
    `Primary interface is ${input.interfaceType}.`,
    `Discovery confidence is ${input.context.confidence}.`,
    ...input.context.gaps.map((gap) => `Unverified context: ${gap}`),
  ];

  const currentState = `# Current State\n\n## Project Summary\n\n- Session intent: ${input.intent}\n- Flow: ${input.flow}\n- Interface: ${input.interfaceType}\n\n## Detected Stack\n\n${bullets(input.context.frameworks)}\n\n## Existing User Flows\n\n${bullets(routes)}\n\n## Known Gaps\n\n${bullets(input.context.gaps)}\n\n## Assumptions\n\n${bullets(assumptions)}\n`;

  const insights = `# Insights\n\n## Key Insights\n\n### Insight\n\n#### What this means\n\n${feature} should stay focused on the user's stated goal: ${goal}.\n\n#### Why this matters\n\n${user} need a predictable path with clear success, failure, and recovery states.\n\n#### Evidence\n\n- User intent: ${input.intent}\n- Discovery confidence: ${input.context.confidence}\n\n#### Assumptions\n\n${bullets(assumptions)}\n\n#### What to verify\n\n- Confirm the task scope with a human before implementation.\n`;

  const edgeCasesMarkdown = `# Edge Cases\n\n## P0 Edge Cases\n\n${bullets(edgeCases.slice(0, 4))}\n\n## P1 Edge Cases\n\n${bullets(edgeCases.slice(4))}\n\n## Error States\n\n- Explain what failed and how the user can recover.\n\n## Permission Issues\n\n- Block unauthorized users without exposing sensitive account details.\n\n## Empty States\n\n- Explain the first useful action.\n\n## Loading States\n\n- Preserve user confidence while work is in progress.\n\n## Recovery Paths\n\n- Let the user retry without losing entered information.\n`;

  const requirements = `# Requirements\n\n## User Requirements\n\n- ${user} can complete: ${goal}.\n\n## Functional UX Requirements\n\n- Show success, loading, empty, error, and permission states.\n- Preserve entered information when recovery is possible.\n- State assumptions and what humans should verify before implementation.\n\n## Non-Goals\n\n- Visual design generation.\n- Component code generation.\n- Provider-specific analytics querying.\n\n## Constraints\n\n${bullets(assumptions)}\n\n## Interface-Specific Requirements\n\n- Interface: ${input.interfaceType}\n- Edge cases: ${edgeCases.join('; ')}\n\n## Accessibility Requirements\n\n- The flow can be completed with keyboard or platform assistive technology.\n- Error messages identify the failed field or action in plain language.\n\n## Analytics/Instrumentation Requirements\n\n- Record only aggregate event needs unless a human confirms analytics evidence can be used.\n\n## UX Requirements Block for UI Skills\n\n\`\`\`yaml\nfeature: ${JSON.stringify(feature)}\ninterface: ${input.interfaceType}\nusers:\n  - ${JSON.stringify(user)}\ngoals:\n  - ${JSON.stringify(goal)}\nstates:\n  empty:\n    required: true\n  loading:\n    required: true\n  error:\n    required: true\n  success:\n    required: true\nedge_cases:\n${edgeCases.map((item) => `  - ${JSON.stringify(item)}`).join('\n')}\nnon_goals:\n  - visual design\n  - component implementation\n\`\`\`\n`;

  const implementationTasks = `# Implementation Tasks\n\n## Summary\n\nGenerate the smallest implementation that lets ${user} complete: ${goal}.\n\n## P0 Tasks\n\n### P0-01: Implement ${feature} UX path\n\n**User rationale:** ${user} need a clear path to ${goal}.\n\n**Description:** Implement the product behavior needed for the stated goal while preserving loading, empty, error, permission, and success states.\n\n**Acceptance criteria:**\n\n- The user can complete the stated goal.\n- The user receives clear feedback for success and failure.\n- Unauthorized users are blocked safely.\n- The behavior is covered by at least one runnable verification.\n\n**Edge cases:**\n\n${bullets(edgeCases.slice(0, 4))}\n\n**Likely files affected:**\n\n${bullets(routes.length ? routes : ['Discovery did not identify likely files.'])}\n\n**Verification steps:**\n\n- Complete the happy path.\n- Trigger each P0 edge case.\n- Confirm unauthorized access is blocked.\n- Confirm no visual design or component code was generated by Lamina.\n\n## P1 Tasks\n\n### P1-01: Add recovery coverage for secondary states\n\n**User rationale:** Users need to recover from interrupted or failed attempts.\n\n**Description:** Add recoverability for lower-priority edge cases after P0 behavior works.\n\n**Acceptance criteria:**\n\n- Retry paths preserve safe user input.\n- Secondary edge cases have manual or automated verification steps.\n\n**Edge cases:**\n\n${bullets(edgeCases.slice(4))}\n\n**Verification steps:**\n\n- Trigger interruption and retry flows.\n- Confirm recovery copy is understandable without UX jargon.\n\n## P2 Tasks\n\n- None for Phase 0 output unless a human adds scope.\n\n## Verification Checklist\n\n- [ ] Happy path works.\n- [ ] P0 edge cases are covered.\n- [ ] Permission behavior is verified.\n- [ ] Accessibility basics are verified.\n\n## Edge Cases to Test\n\n${bullets(edgeCases)}\n\n## What to Verify With Humans\n\n- Confirm the problem framing.\n- Confirm the likely files before implementation if discovery confidence is not high.\n- Confirm analytics evidence before using analytics data.\n\n## Assumptions\n\n${bullets(assumptions)}\n`;

  const artifacts = { currentState, insights, edgeCases: edgeCasesMarkdown, requirements, implementationTasks };
  assertUxOnly(Object.values(artifacts).join('\n'));
  return artifacts;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/synthesis.test.js`

Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit**

```bash
git add src/guardrails.js src/synthesis.js tests/synthesis.test.js
git commit -m "feat: generate ux-only lamina artifacts"
```

---

### Task 6: Guided `lamina start` Session With Checkpoints

**Files:**
- Create: `src/session.js`
- Modify: `src/cli.js`
- Modify: `src/artifacts.js`
- Test: `tests/session.test.js`
- Test: `tests/cli-start.test.js`

**Interfaces:**
- Consumes: `initArtifacts()`, `scanProject()`, `routeFlow()`, `questionsForFlow()`, `generateSessionArtifacts()`.
- Produces: `startGuidedSession(projectRoot: string, io: { ask(question: string): Promise<string>, stdout: { write(text: string): void } }): Promise<{ artifactsChanged: string[], implementationTasksPath: string, nextAction: string }>`.

- [ ] **Step 1: Write failing session tests**

Create `tests/session.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startGuidedSession } from '../src/session.js';

test('startGuidedSession asks checkpoint questions and writes artifacts after approval', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-session-'));
  const answers = [
    'Add team invites',
    'Team invitations',
    'Workspace admins',
    'Settings team page',
    'Invite a teammate by email and see whether it worked',
    'web',
    'yes',
    'yes',
    'yes',
  ];
  const asked = [];
  let stdout = '';

  try {
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));
    const result = await startGuidedSession(root, {
      ask: async (question) => {
        asked.push(question);
        return answers.shift();
      },
      stdout: { write: (text) => { stdout += text; } },
    });

    assert.equal(result.implementationTasksPath, '.lamina/implementation-tasks.md');
    assert.equal(result.artifactsChanged.includes('.lamina/implementation-tasks.md'), true);
    assert.equal(asked.some((question) => question.includes('Is this accurate')), true);
    assert.equal(asked.some((question) => question.includes('generate tasks')), true);
    assert.equal(asked.some((question) => question.includes('write these')), true);
    assert.match(stdout, /Generated implementation tasks/);

    const tasks = await readFile(join(root, '.lamina', 'implementation-tasks.md'), 'utf8');
    assert.match(tasks, /Team invitations/);
    assert.match(tasks, /Acceptance criteria/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('startGuidedSession can show only without writing artifacts', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-session-show-'));
  const answers = ['Add team invites', 'Team invitations', 'Admins', 'Settings', 'Invite by email', 'web', 'yes', 'yes', 'show only'];
  try {
    const result = await startGuidedSession(root, {
      ask: async () => answers.shift(),
      stdout: { write: () => {} },
    });
    assert.deepEqual(result.artifactsChanged, []);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

Create `tests/cli-start.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { runCli } from '../src/cli.js';

test('lamina start requires interactive ask support in tests and adapters', async () => {
  let stderr = '';
  const code = await runCli(['start'], {
    cwd: () => process.cwd(),
    stdout: { write: () => {} },
    stderr: { write: (text) => { stderr += text; } },
  });

  assert.equal(code, 1);
  assert.match(stderr, /Interactive input is required/);
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `node --test tests/session.test.js tests/cli-start.test.js`

Expected: FAIL with an import error for `../src/session.js` and/or unknown command `start`.

- [ ] **Step 3: Add artifact write helper, session orchestration, and CLI start wiring**

Append this export to `src/artifacts.js`:

```js
export async function writeArtifact(projectRoot, relativeFile, content) {
  const now = new Date().toISOString();
  const target = join(projectRoot, '.lamina', relativeFile);
  await mkdir(join(target, '..'), { recursive: true });
  const artifact = relativeFile.replace(/\.md$/, '');
  const body = content.startsWith('---\n')
    ? content
    : `---\nartifact: ${artifact}\nversion: 1\nupdated: ${now}\nstatus: draft\n---\n\n${content}`;
  await writeFile(target, body);
}
```

Create `src/session.js`:

```js
import { initArtifacts, writeArtifact } from './artifacts.js';
import { formatDiscoverySummary, scanProject } from './discovery.js';
import { questionsForFlow, routeFlow } from './flow-router.js';
import { generateSessionArtifacts } from './synthesis.js';

function yes(value) {
  return /^(y|yes|1)$/i.test((value ?? '').trim());
}

function showOnly(value) {
  return /show only|don.t write|do not write|3/i.test((value ?? '').trim());
}

function normalizeInterface(answer, fallback) {
  if (/mobile/i.test(answer ?? '')) return 'mobile';
  if (/web/i.test(answer ?? '')) return 'web';
  return fallback === 'mobile' ? 'mobile' : 'web';
}

export async function startGuidedSession(projectRoot, io) {
  await initArtifacts(projectRoot);
  const context = await scanProject(projectRoot);
  io.stdout.write(`${formatDiscoverySummary(context)}\n`);

  const intent = await io.ask('What are you working on? ');
  let flow = routeFlow(intent);
  if (!flow) {
    const choice = await io.ask('Is this primarily about: 1. Defining a new product/flow 2. Improving something that already exists 3. Adding a specific new capability ');
    flow = choice.trim() === '1' ? 'ideate' : choice.trim() === '2' ? 'optimize' : 'add-feature';
  }

  const answers = {};
  for (const question of questionsForFlow(flow)) {
    answers[question] = await io.ask(`${question} `);
  }

  const interfaceQuestion = Object.entries(answers).find(([question]) => question.includes('interface'));
  const interfaceType = normalizeInterface(interfaceQuestion?.[1], context.projectType);
  const framing = `Flow: ${flow}\nIntent: ${intent}\nInterface: ${interfaceType}`;
  io.stdout.write(`\nHere is how I understand the problem:\n\n${framing}\n\n`);

  if (!yes(await io.ask('Is this accurate? 1. Yes 2. Mostly, but I want to edit 3. No, restart framing '))) {
    return { artifactsChanged: [], implementationTasksPath: '.lamina/implementation-tasks.md', nextAction: 'Restart Lamina with revised framing.' };
  }

  const artifacts = generateSessionArtifacts({ flow, intent, answers, interfaceType, context });
  io.stdout.write(`\nHere are the main UX insights and assumptions:\n\n${artifacts.insights}\n`);

  if (!yes(await io.ask('Do these feel accurate enough to generate tasks? '))) {
    return { artifactsChanged: [], implementationTasksPath: '.lamina/implementation-tasks.md', nextAction: 'Revise inputs before generating tasks.' };
  }

  io.stdout.write(`\n${artifacts.implementationTasks}\n`);
  const writeChoice = await io.ask('I generated implementation tasks. Should I write these to .lamina/implementation-tasks.md? 1. Yes 2. Edit first 3. Show only, don’t write ');
  if (showOnly(writeChoice) || !yes(writeChoice)) {
    return { artifactsChanged: [], implementationTasksPath: '.lamina/implementation-tasks.md', nextAction: 'Shown only; no artifacts were changed.' };
  }

  const writes = [
    ['current-state.md', artifacts.currentState],
    ['insights.md', artifacts.insights],
    ['edge-cases.md', artifacts.edgeCases],
    ['requirements.md', artifacts.requirements],
    ['implementation-tasks.md', artifacts.implementationTasks],
  ];
  for (const [file, content] of writes) await writeArtifact(projectRoot, file, content);

  io.stdout.write('Generated implementation tasks at .lamina/implementation-tasks.md\n');
  return {
    artifactsChanged: writes.map(([file]) => `.lamina/${file}`),
    implementationTasksPath: '.lamina/implementation-tasks.md',
    nextAction: 'Ask your coding tool to implement the P0 tasks.',
  };
}
```

Modify `src/cli.js`:

```js
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { initArtifacts } from './artifacts.js';
import { formatDiscoverySummary, scanProject } from './discovery.js';
import { startGuidedSession } from './session.js';

const HELP = `Usage: lamina <command> [options]

Commands:
  init      Create missing .lamina artifacts
  scan      Print a project context summary
  start     Run a guided Lamina session
  tasks     Print .lamina/implementation-tasks.md
  doctor    Check local Lamina setup

Options:
  --help    Show this help
  --json    Print machine-readable JSON where supported
`;

function interactiveIo(io) {
  if (io.ask) return io;
  if (io !== process) return null;
  const rl = createInterface({ input, output });
  return {
    ...io,
    ask: async (question) => rl.question(question),
    close: () => rl.close(),
  };
}

export async function runCli(argv, io = process) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.stdout.write(HELP);
    return 0;
  }

  const root = io.cwd ? io.cwd() : process.cwd();

  if (command === 'init') {
    const result = await initArtifacts(root);
    io.stdout.write(`Created .lamina (${result.created.length} new, ${result.existing.length} existing)\n`);
    return 0;
  }

  if (command === 'scan') {
    const context = await scanProject(root);
    io.stdout.write(args.includes('--json') ? `${JSON.stringify(context, null, 2)}\n` : formatDiscoverySummary(context));
    return 0;
  }

  if (command === 'start') {
    const sessionIo = interactiveIo(io);
    if (!sessionIo) {
      io.stderr.write('Interactive input is required for lamina start.\n');
      return 1;
    }
    try {
      const result = await startGuidedSession(root, sessionIo);
      if (args.includes('--json')) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } finally {
      if (sessionIo.close) sessionIo.close();
    }
  }

  io.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test tests/session.test.js tests/cli-start.test.js tests/synthesis.test.js tests/flow-router.test.js tests/discovery.test.js tests/artifacts.test.js tests/cli.test.js tests/cli-init.test.js tests/cli-scan.test.js`

Expected: PASS with all tests passing.

- [ ] **Step 5: Commit**

```bash
git add src/session.js src/cli.js src/artifacts.js tests/session.test.js tests/cli-start.test.js
git commit -m "feat: run guided lamina sessions"
```

---

### Task 7: `tasks`, `doctor`, README, and Phase 0 Verification

**Files:**
- Modify: `src/cli.js`
- Modify: `README.md`
- Test: `tests/cli-tasks-doctor.test.js`

**Interfaces:**
- Consumes: `.lamina/implementation-tasks.md` created by Task 2 or Task 6.
- Produces: `lamina tasks`, `lamina tasks --print`, and `lamina doctor` CLI behavior.

- [ ] **Step 1: Write failing CLI tests for `tasks` and `doctor`**

Create `tests/cli-tasks-doctor.test.js`:

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { runCli } from '../src/cli.js';

function captureIo(cwd) {
  let stdout = '';
  let stderr = '';
  return {
    io: {
      cwd: () => cwd,
      stdout: { write: (text) => { stdout += text; } },
      stderr: { write: (text) => { stderr += text; } },
    },
    output: () => ({ stdout, stderr }),
  };
}

test('lamina tasks prints implementation task artifact', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-tasks-'));
  try {
    await mkdir(join(root, '.lamina'), { recursive: true });
    await writeFile(join(root, '.lamina', 'implementation-tasks.md'), '# Implementation Tasks\n\n## P0 Tasks\n');
    const { io, output } = captureIo(root);
    const code = await runCli(['tasks'], io);
    assert.equal(code, 0);
    assert.match(output().stdout, /# Implementation Tasks/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lamina tasks returns code 1 when tasks artifact is missing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-tasks-missing-'));
  try {
    const { io, output } = captureIo(root);
    const code = await runCli(['tasks'], io);
    assert.equal(code, 1);
    assert.match(output().stderr, /Run `lamina init` or `lamina start` first/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('lamina doctor reports setup status', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-doctor-'));
  try {
    const { io, output } = captureIo(root);
    const code = await runCli(['doctor'], io);
    assert.equal(code, 0);
    assert.match(output().stdout, /Lamina doctor/);
    assert.match(output().stdout, /.lamina artifacts/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/cli-tasks-doctor.test.js`

Expected: FAIL with unknown command `tasks` and `doctor`.

- [ ] **Step 3: Implement `tasks`, `doctor`, and README usage**

Modify `src/cli.js` by adding these imports:

```js
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
```

Then add these command branches before the unknown-command branch:

```js
  if (command === 'tasks') {
    const target = join(root, '.lamina', 'implementation-tasks.md');
    if (!existsSync(target)) {
      io.stderr.write('No implementation tasks found. Run `lamina init` or `lamina start` first.\n');
      return 1;
    }
    io.stdout.write(await readFile(target, 'utf8'));
    return 0;
  }

  if (command === 'doctor') {
    const hasArtifacts = existsSync(join(root, '.lamina'));
    const context = await scanProject(root);
    io.stdout.write(`Lamina doctor\n\n- .lamina artifacts: ${hasArtifacts ? 'present' : 'missing'}\n- Discovery confidence: ${context.confidence}\n- Frameworks: ${context.frameworks.length ? context.frameworks.join(', ') : 'none detected'}\n`);
    return 0;
  }
```

Replace `README.md` with:

```md
# lamina

Lamina creates UX context artifacts and implementation-ready task lists for coding agents.

## Phase 0 commands

```bash
npm install
npm test
npm run lamina -- init
npm run lamina -- scan
npm run lamina -- start
npm run lamina -- tasks
npm run lamina -- doctor
```

## What Phase 0 builds

- `.lamina/` Markdown/YAML artifacts
- Basic project context discovery with confidence and gaps
- Guided flows for ideation, optimization, and adding a feature
- Web and mobile UX edge-case coverage
- UX-only implementation tasks in `.lamina/implementation-tasks.md`

## Boundaries

Phase 0 does not generate visual design, component code, analytics queries, MCP servers, SDKs, or native editor plugins.

## Agent handoff

After `lamina start`, ask your coding tool to implement the P0 tasks from:

```text
.lamina/implementation-tasks.md
```

Keep Lamina artifacts as UX requirements and task evidence. Do not overwrite them with implementation code.
```

- [ ] **Step 4: Run all tests to verify Phase 0 passes**

Run: `npm test`

Expected: PASS with every `tests/*.test.js` passing.

- [ ] **Step 5: Manual smoke test the executable CLI**

Run:

```bash
chmod +x bin/lamina.js
npm run lamina -- init
npm run lamina -- scan
npm run lamina -- doctor
npm run lamina -- tasks
```

Expected:

- `init` creates `.lamina/` without overwriting existing artifacts.
- `scan` prints `## What I found`, `## Confidence`, and `## Gaps`.
- `doctor` prints setup status.
- `tasks` prints `.lamina/implementation-tasks.md`.

- [ ] **Step 6: Commit**

```bash
git add src/cli.js README.md tests/cli-tasks-doctor.test.js bin/lamina.js
git commit -m "feat: finish phase 0 cli commands"
```

---

## Self-Review

### Spec coverage

- CLI entrypoint: Task 1, Task 2, Task 3, Task 6, Task 7.
- Artifact manager: Task 2 and Task 6.
- Basic context discovery: Task 3.
- Guided conversation: Task 4 and Task 6.
- Flow routing: Task 4.
- Task generation: Task 5.
- Edge case generation: Task 5.
- Artifact writing: Task 6.
- Web and mobile support: Task 5 and Task 6.
- Human checkpoints: Task 6.
- UX-only boundaries: Task 5.
- Phase 0 acceptance criteria: Task 7 smoke test and `npm test`.

### Placeholder scan

No placeholder markers or vague implementation instructions are present. Each code-producing step includes concrete file content or exact code to add.

### Type consistency

The plan consistently uses ESM JavaScript and these stable interfaces: `runCli`, `initArtifacts`, `writeArtifact`, `scanProject`, `formatDiscoverySummary`, `routeFlow`, `questionsForFlow`, `generateSessionArtifacts`, `assertUxOnly`, and `startGuidedSession`.
