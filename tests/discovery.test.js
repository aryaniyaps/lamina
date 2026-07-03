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
