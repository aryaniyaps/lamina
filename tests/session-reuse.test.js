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
