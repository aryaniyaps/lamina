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
  const prior = input.priorContext ?? { activeDecisions: [], priorInsights: [], priorRequirements: [] };
  const hasPrior = prior.activeDecisions.length || prior.priorInsights.length || prior.priorRequirements.length;

  const currentState = `# Current State\n\n## Project Summary\n\n- Session intent: ${input.intent}\n- Flow: ${input.flow}\n- Interface: ${input.interfaceType}\n\n## Detected Stack\n\n${bullets(input.context.frameworks)}\n\n## Existing User Flows\n\n${bullets(routes)}\n\n## Known Gaps\n\n${bullets(input.context.gaps)}\n\n## Assumptions\n\n${bullets(assumptions)}${hasPrior ? `\n\n## Reused Context\n\n### Prior Insights\n\n${bullets(prior.priorInsights)}\n\n### Active Decisions\n\n${bullets(prior.activeDecisions)}\n\n### Prior Requirements\n\n${bullets(prior.priorRequirements)}` : ''}\n`;

  const insights = `# Insights\n\n## Key Insights\n\n### Insight\n\n#### What this means\n\n${feature} should stay focused on the user's stated goal: ${goal}.\n\n#### Why this matters\n\n${user} need a predictable path with clear success, failure, and recovery states.\n\n#### Evidence\n\n- User intent: ${input.intent}\n- Discovery confidence: ${input.context.confidence}\n\n#### Assumptions\n\n${bullets(assumptions)}\n\n#### What to verify\n\n- Confirm the task scope with a human before implementation.\n`;

  const edgeCasesMarkdown = `# Edge Cases\n\n## P0 Edge Cases\n\n${bullets(edgeCases.slice(0, 4))}\n\n## P1 Edge Cases\n\n${bullets(edgeCases.slice(4))}\n\n## Error States\n\n- Explain what failed and how the user can recover.\n\n## Permission Issues\n\n- Block unauthorized users without exposing sensitive account details.\n\n## Empty States\n\n- Explain the first useful action.\n\n## Loading States\n\n- Preserve user confidence while work is in progress.\n\n## Recovery Paths\n\n- Let the user retry without losing entered information.\n`;

  const requirements = `# Requirements\n\n## User Requirements\n\n- ${user} can complete: ${goal}.\n\n## Functional UX Requirements\n\n- Show success, loading, empty, error, and permission states.\n- Preserve entered information when recovery is possible.\n- State assumptions and what humans should verify before implementation.\n\n## Non-Goals\n\n- Visual design generation.\n- Component code generation.\n- Provider-specific analytics querying.\n\n## Constraints\n\n${bullets(assumptions)}${prior.priorRequirements.length ? `\n\n## Prior Requirements Reused\n\n${bullets(prior.priorRequirements)}` : ''}\n\n## Interface-Specific Requirements\n\n- Interface: ${input.interfaceType}\n- Edge cases: ${edgeCases.join('; ')}\n\n## Accessibility Requirements\n\n- The flow can be completed with keyboard or platform assistive technology.\n- Error messages identify the failed field or action in plain language.\n\n## Analytics/Instrumentation Requirements\n\n- Record only aggregate event needs unless a human confirms analytics evidence can be used.\n\n## UX Requirements Block for UI Skills\n\n\`\`\`yaml\nfeature: ${JSON.stringify(feature)}\ninterface: ${input.interfaceType}\nusers:\n  - ${JSON.stringify(user)}\ngoals:\n  - ${JSON.stringify(goal)}\nstates:\n  empty:\n    required: true\n  loading:\n    required: true\n  error:\n    required: true\n  success:\n    required: true\nedge_cases:\n${edgeCases.map((item) => `  - ${JSON.stringify(item)}`).join('\n')}\nnon_goals:\n  - visual design\n  - component implementation\n\`\`\`\n`;

  const reusedTaskContext = [
    ...prior.priorInsights.map((value) => `Prior insight: ${value}`),
    ...prior.activeDecisions.map((value) => `Active decision: ${value}`),
    ...prior.priorRequirements.map((value) => `Prior requirement: ${value}`),
  ];

  const implementationTasks = `# Implementation Tasks\n\n## Summary\n\nGenerate the smallest implementation that lets ${user} complete: ${goal}.\n\n## P0 Tasks\n\n### P0-01: Implement ${feature} UX path\n\n**User rationale:** ${user} need a clear path to ${goal}.\n\n**Description:** Implement the product behavior needed for the stated goal while preserving loading, empty, error, permission, and success states.\n\n**Acceptance criteria:**\n\n- The user can complete the stated goal.\n- The user receives clear feedback for success and failure.\n- Unauthorized users are blocked safely.\n- The behavior is covered by at least one runnable verification.\n\n**Edge cases:**\n\n${bullets(edgeCases.slice(0, 4))}\n\n**Likely files affected:**\n\n${bullets(routes.length ? routes : ['Discovery did not identify likely files.'])}\n\n**Verification steps:**\n\n- Complete the happy path.\n- Trigger each P0 edge case.\n- Confirm unauthorized access is blocked.\n- Confirm no visual design or component code was generated by Lamina.\n\n## P1 Tasks\n\n### P1-01: Add recovery coverage for secondary states\n\n**User rationale:** Users need to recover from interrupted or failed attempts.\n\n**Description:** Add recoverability for lower-priority edge cases after P0 behavior works.\n\n**Acceptance criteria:**\n\n- Retry paths preserve safe user input.\n- Secondary edge cases have manual or automated verification steps.\n\n**Edge cases:**\n\n${bullets(edgeCases.slice(4))}\n\n**Verification steps:**\n\n- Trigger interruption and retry flows.\n- Confirm recovery copy is understandable without UX jargon.\n\n## P2 Tasks\n\n- None for Phase 0 output unless a human adds scope.\n\n## Verification Checklist\n\n- [ ] Happy path works.\n- [ ] P0 edge cases are covered.\n- [ ] Permission behavior is verified.\n- [ ] Accessibility basics are verified.\n\n## Edge Cases to Test\n\n${bullets(edgeCases)}\n\n## What to Verify With Humans\n\n- Confirm the problem framing.\n- Confirm the likely files before implementation if discovery confidence is not high.\n- Confirm analytics evidence before using analytics data.${reusedTaskContext.length ? `\n\n## Reused Context\n\n${bullets(reusedTaskContext)}` : ''}\n\n## Assumptions\n\n${bullets(assumptions)}\n`;

  const artifacts = { currentState, insights, edgeCases: edgeCasesMarkdown, requirements, implementationTasks };
  assertUxOnly(Object.values(artifacts).join('\n'));
  return artifacts;
}
