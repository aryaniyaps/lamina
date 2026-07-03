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
