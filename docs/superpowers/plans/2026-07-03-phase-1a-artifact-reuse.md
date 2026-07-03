# Phase 1A Artifact Reuse Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `lamina start` reuse prior `.lamina` insights, decisions, and requirements so new sessions produce context-aware artifacts.

**Architecture:** Add a tiny read layer in `src/artifacts.js`, a focused parser/normalizer in `src/prior-context.js`, then thread normalized prior context into synthesis and session orchestration. Keep behavior deterministic, dependency-free, and fail-soft when artifacts are missing or malformed. Extend tests first (TDD) for each seam.

**Tech Stack:** Node.js >=20, ESM JavaScript, built-in `node:test`, `fs/promises`, no third-party dependencies.

## Global Constraints

- Keep runtime dependency-free (Node built-ins only).
- Keep ESM JS (`"type": "module"`) and existing CLI shape.
- Preserve UX-only boundary: no visual design or component code generation.
- Missing or malformed `.lamina/*.md` must not crash sessions (fail soft).
- Use TDD for each task: failing test → minimal code → passing test.
- Keep diffs small and commit after each task.

---

## File Structure (Phase 1A)

- `src/artifacts.js` (modify): add artifact-read capability for known reusable artifact files.
- `src/prior-context.js` (create): parse markdown sections and normalize reusable bullets.
- `src/synthesis.js` (modify): accept `priorContext` input and include reused context in generated artifacts.
- `src/session.js` (modify): load artifacts, build prior context, pass into synthesis.
- `tests/artifacts-read.test.js` (create): covers `readArtifacts()` fail-soft behavior.
- `tests/prior-context.test.js` (create): covers markdown section parsing + normalization rules.
- `tests/synthesis-prior-context.test.js` (create): verifies generated artifacts include reused context.
- `tests/session-reuse.test.js` (create): integration-level proof that prior decisions/requirements appear in generated output.
- `README.md` (modify): note that Lamina now reuses previous `.lamina` knowledge in new sessions.

---

### Task 1: Add artifact read API (`readArtifacts`)

**Files:**
- Create: `tests/artifacts-read.test.js`
- Modify: `src/artifacts.js`

**Interfaces:**
- Consumes: `ARTIFACT_FILES` in `src/artifacts.js`
- Produces: `readArtifacts(projectRoot: string): Promise<{ insights: string, decisions: string, requirements: string }>`

- [ ] **Step 1: Write the failing test**

```js
// tests/artifacts-read.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { readArtifacts } from '../src/artifacts.js';

test('readArtifacts returns existing artifact text and empty string for missing files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-artifacts-read-'));
  try {
    await mkdir(join(root, '.lamina'), { recursive: true });
    await writeFile(join(root, '.lamina', 'insights.md'), '# Insights\n\n## Key Insights\n\n- Reuse this insight\n');
    await writeFile(join(root, '.lamina', 'decisions.md'), '# Decisions\n\n## Active Decisions\n\n- Keep invite flow single-step\n');

    const result = await readArtifacts(root);

    assert.match(result.insights, /Reuse this insight/);
    assert.match(result.decisions, /single-step/);
    assert.equal(result.requirements, '');
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/artifacts-read.test.js`
Expected: FAIL with `readArtifacts is not exported` or `not a function`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/artifacts.js (add imports)
import { mkdir, writeFile, readFile } from 'node:fs/promises';

// src/artifacts.js (add function near bottom)
export async function readArtifacts(projectRoot) {
  const names = ['insights.md', 'decisions.md', 'requirements.md'];
  const out = { insights: '', decisions: '', requirements: '' };

  for (const name of names) {
    try {
      const text = await readFile(join(projectRoot, '.lamina', name), 'utf8');
      out[name.replace('.md', '')] = text;
    } catch {
      // ponytail: fail-soft reuse; missing/invalid artifact should not block sessions
      out[name.replace('.md', '')] = '';
    }
  }

  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/artifacts-read.test.js`
Expected: PASS (1 test, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add tests/artifacts-read.test.js src/artifacts.js
git commit -m "feat: add reusable artifact read api"
```

---

### Task 2: Parse and normalize prior context

**Files:**
- Create: `src/prior-context.js`
- Create: `tests/prior-context.test.js`

**Interfaces:**
- Consumes: `readArtifacts()` output shape `{ insights, decisions, requirements }`
- Produces:
  - `parseMarkdownSections(markdown: string): Record<string, string>`
  - `extractBulletLines(text: string): string[]`
  - `buildPriorContext(artifacts: { insights: string, decisions: string, requirements: string }): { activeDecisions: string[], priorInsights: string[], priorRequirements: string[] }`

- [ ] **Step 1: Write the failing test**

```js
// tests/prior-context.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseMarkdownSections, buildPriorContext } from '../src/prior-context.js';

test('parseMarkdownSections extracts ## sections by heading name', () => {
  const markdown = '# Decisions\n\n## Active Decisions\n\n- Keep flow short\n\n## Decision Log\n\n- Added checkpoint';
  const sections = parseMarkdownSections(markdown);
  assert.match(sections['Active Decisions'], /Keep flow short/);
  assert.match(sections['Decision Log'], /Added checkpoint/);
});

test('buildPriorContext extracts non-placeholder bullets from key sections', () => {
  const prior = buildPriorContext({
    insights: '# Insights\n\n## Key Insights\n\n- Ask less, decide faster\n',
    decisions: '# Decisions\n\n## Active Decisions\n\n- Keep invite flow single-step\n- None recorded yet.\n',
    requirements: '# Requirements\n\n## User Requirements\n\n- Admin can invite by email\n',
  });

  assert.deepEqual(prior.activeDecisions, ['Keep invite flow single-step']);
  assert.deepEqual(prior.priorInsights, ['Ask less, decide faster']);
  assert.deepEqual(prior.priorRequirements, ['Admin can invite by email']);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/prior-context.test.js`
Expected: FAIL with `Cannot find module '../src/prior-context.js'`.

- [ ] **Step 3: Write minimal implementation**

```js
// src/prior-context.js
function cleanBullet(line) {
  return line.replace(/^\s*-\s*/, '').trim();
}

export function parseMarkdownSections(markdown) {
  const out = {};
  const lines = (markdown ?? '').split('\n');
  let current = null;

  for (const line of lines) {
    const heading = line.match(/^##\s+(.+)$/);
    if (heading) {
      current = heading[1].trim();
      if (!out[current]) out[current] = '';
      continue;
    }
    if (current) out[current] += `${line}\n`;
  }

  return out;
}

export function extractBulletLines(text) {
  return (text ?? '')
    .split('\n')
    .filter((line) => /^\s*-\s+/.test(line))
    .map(cleanBullet)
    .filter((line) => line && line.toLowerCase() !== 'none recorded yet.');
}

export function buildPriorContext(artifacts) {
  const insightsSections = parseMarkdownSections(artifacts.insights);
  const decisionsSections = parseMarkdownSections(artifacts.decisions);
  const requirementsSections = parseMarkdownSections(artifacts.requirements);

  return {
    activeDecisions: extractBulletLines(decisionsSections['Active Decisions'] ?? ''),
    priorInsights: extractBulletLines(insightsSections['Key Insights'] ?? ''),
    priorRequirements: extractBulletLines(requirementsSections['User Requirements'] ?? ''),
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/prior-context.test.js`
Expected: PASS (2 tests, 0 failures).

- [ ] **Step 5: Commit**

```bash
git add src/prior-context.js tests/prior-context.test.js
git commit -m "feat: parse reusable prior lamina context"
```

---

### Task 3: Include prior context in synthesized artifacts

**Files:**
- Create: `tests/synthesis-prior-context.test.js`
- Modify: `src/synthesis.js`

**Interfaces:**
- Consumes: `generateSessionArtifacts(input)` existing input + `input.priorContext`
- Produces: generated fields include reused context text when lists are non-empty:
  - `artifacts.currentState`
  - `artifacts.requirements`
  - `artifacts.implementationTasks`

- [ ] **Step 1: Write the failing test**

```js
// tests/synthesis-prior-context.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { generateSessionArtifacts } from '../src/synthesis.js';

test('generateSessionArtifacts includes reused context when priorContext is provided', () => {
  const artifacts = generateSessionArtifacts({
    flow: 'add-feature',
    intent: 'Add team invites',
    interfaceType: 'web',
    context: { projectType: 'web', frameworks: ['Next.js'], packageManager: 'pnpm', schemas: [], routes: [], permissions: [], existingArtifacts: [], confidence: 'high', gaps: [] },
    answers: {
      'What feature are you adding?': 'Team invitations',
      'Who will use it?': 'Workspace admins',
      'Where should it fit into the current product?': 'Settings',
      'What must the user be able to do?': 'Invite by email',
      'Which interface is this for: web or mobile?': 'web',
    },
    priorContext: {
      activeDecisions: ['Keep invite flow single-step'],
      priorInsights: ['Users abandon long setup flows'],
      priorRequirements: ['Admin can invite teammates by email'],
    },
  });

  assert.match(artifacts.currentState, /## Reused Context/);
  assert.match(artifacts.currentState, /Users abandon long setup flows/);
  assert.match(artifacts.requirements, /## Prior Requirements Reused/);
  assert.match(artifacts.implementationTasks, /Keep invite flow single-step/);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/synthesis-prior-context.test.js`
Expected: FAIL because reused context headings/text are absent.

- [ ] **Step 3: Write minimal implementation**

```js
// src/synthesis.js (inside generateSessionArtifacts)
const prior = input.priorContext ?? { activeDecisions: [], priorInsights: [], priorRequirements: [] };

const reusedCurrentState =
  prior.activeDecisions.length || prior.priorInsights.length || prior.priorRequirements.length
    ? `\n## Reused Context\n\n### Prior Insights\n\n${bullets(prior.priorInsights)}\n\n### Active Decisions\n\n${bullets(prior.activeDecisions)}\n\n### Prior Requirements\n\n${bullets(prior.priorRequirements)}\n`
    : '';

// append to currentState template
// ...existing sections...
// ${reusedCurrentState}

const reusedRequirements =
  prior.priorRequirements.length
    ? `\n## Prior Requirements Reused\n\n${bullets(prior.priorRequirements)}\n`
    : '';

// append to requirements template
// ...existing sections...
// ${reusedRequirements}

const reusedTaskContext = [
  ...prior.priorInsights.map((x) => `Prior insight: ${x}`),
  ...prior.activeDecisions.map((x) => `Active decision: ${x}`),
  ...prior.priorRequirements.map((x) => `Prior requirement: ${x}`),
];

const reusedTaskSection = reusedTaskContext.length
  ? `\n## Reused Context\n\n${bullets(reusedTaskContext)}\n`
  : '';

// append to implementationTasks template before assumptions
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/synthesis-prior-context.test.js tests/synthesis.test.js`
Expected: PASS (new reuse test + existing synthesis tests).

- [ ] **Step 5: Commit**

```bash
git add tests/synthesis-prior-context.test.js src/synthesis.js
git commit -m "feat: include prior context in synthesized artifacts"
```

---

### Task 4: Wire reuse into guided session and document behavior

**Files:**
- Create: `tests/session-reuse.test.js`
- Modify: `src/session.js`
- Modify: `README.md`

**Interfaces:**
- Consumes:
  - `readArtifacts(projectRoot)` from `src/artifacts.js`
  - `buildPriorContext(artifacts)` from `src/prior-context.js`
- Produces:
  - `startGuidedSession()` passes `priorContext` into `generateSessionArtifacts()`
  - Session output task artifact includes reused context when available

- [ ] **Step 1: Write the failing test**

```js
// tests/session-reuse.test.js
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { startGuidedSession } from '../src/session.js';

test('startGuidedSession reuses prior decisions in generated implementation tasks', async () => {
  const root = await mkdtemp(join(tmpdir(), 'lamina-session-reuse-'));
  try {
    await mkdir(join(root, '.lamina'), { recursive: true });
    await writeFile(join(root, '.lamina', 'decisions.md'), '# Decisions\n\n## Active Decisions\n\n- Keep invite flow single-step\n');
    await writeFile(join(root, '.lamina', 'insights.md'), '# Insights\n\n## Key Insights\n\n- Users drop off during long setup\n');
    await writeFile(join(root, '.lamina', 'requirements.md'), '# Requirements\n\n## User Requirements\n\n- Admin can invite teammates by email\n');
    await writeFile(join(root, 'package.json'), JSON.stringify({ dependencies: { next: '15.0.0' } }));

    const answers = [
      'Add team invites',
      'Team invitations',
      'Workspace admins',
      'Settings team page',
      'Invite by email',
      'web',
      'yes',
      'yes',
      'yes',
    ];

    await startGuidedSession(root, {
      ask: async () => answers.shift(),
      stdout: { write: () => {} },
    });

    const tasks = await readFile(join(root, '.lamina', 'implementation-tasks.md'), 'utf8');
    assert.match(tasks, /Keep invite flow single-step/);
    assert.match(tasks, /Users drop off during long setup/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/session-reuse.test.js`
Expected: FAIL because prior context is not yet loaded/passed.

- [ ] **Step 3: Write minimal implementation**

```js
// src/session.js (imports)
import { initArtifacts, readArtifacts, writeArtifact } from './artifacts.js';
import { buildPriorContext } from './prior-context.js';

// src/session.js (inside startGuidedSession)
await initArtifacts(projectRoot);
const context = await scanProject(projectRoot);
const priorArtifacts = await readArtifacts(projectRoot);
const priorContext = buildPriorContext(priorArtifacts);

// pass into synthesis
const artifacts = generateSessionArtifacts({ flow, intent, answers, interfaceType, context, priorContext });
```

```md
<!-- README.md: update Phase 0 section title and add one bullet -->
## What Lamina currently builds

- Reuse of prior `.lamina` insights, decisions, and requirements in new sessions
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/session-reuse.test.js tests/session.test.js tests/synthesis-prior-context.test.js`
Expected: PASS (reuse and existing guided session behavior both pass).

Then run full suite:

Run: `npm test`
Expected: PASS (all tests green).

- [ ] **Step 5: Commit**

```bash
git add tests/session-reuse.test.js src/session.js README.md
git commit -m "feat: reuse prior lamina context during guided sessions"
```

---

## Final Verification Checklist

- [ ] `node --test tests/artifacts-read.test.js`
- [ ] `node --test tests/prior-context.test.js`
- [ ] `node --test tests/synthesis-prior-context.test.js`
- [ ] `node --test tests/session-reuse.test.js`
- [ ] `npm test`
- [ ] Manual smoke check:

```bash
npm run lamina -- init
npm run lamina -- start
npm run lamina -- tasks
```

Expected manual result: generated `.lamina/implementation-tasks.md` includes a `## Reused Context` block when prior artifact bullets exist.

## Spec Coverage Self-Review

- Covered: artifact reuse from existing `insights.md`, `decisions.md`, `requirements.md`.
- Covered: fail-soft handling for missing/malformed files.
- Covered: reused context inclusion in generated artifacts and task output.
- Covered: tests at unit + guided-session integration layers.
- Not in scope by design (intentional): expert mode, analytics adapter, adapter recipes, compaction.

## Placeholder Scan Self-Review

- Searched for: `TODO`, `TBD`, `implement later`, `fill in details`, `similar to task`.
- Result: none present.

## Type/Interface Consistency Self-Review

- `readArtifacts(projectRoot)` output keys match `buildPriorContext(artifacts)` input keys.
- `buildPriorContext()` output key names match `generateSessionArtifacts({ priorContext })` usage.
- `startGuidedSession()` passes the same `priorContext` shape expected by synthesis.
