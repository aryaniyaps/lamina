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
