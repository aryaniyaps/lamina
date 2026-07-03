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
