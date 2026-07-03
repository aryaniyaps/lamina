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
