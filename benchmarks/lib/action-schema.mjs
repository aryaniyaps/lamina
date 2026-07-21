export function buildActionSchema(golden) {
  const types = new Set();
  const examples = new Map();
  for (const sequence of golden.sequences ?? []) {
    for (const action of sequence.actions ?? []) {
      if (!action?.type) continue;
      types.add(action.type);
      if (!examples.has(action.type)) examples.set(action.type, action);
    }
  }
  const lines = ['All arms must implement `reduce(state, action)` accepting these action types:', ''];
  for (const type of [...types].sort()) {
    const sample = examples.get(type);
    lines.push(`- \`${type}\`: payload shape example: \`${JSON.stringify(sample)}\``);
  }
  lines.push(
    '',
    '`project(state, actorId)` must return JSON-serializable actor-scoped views used by the behavior grader.',
    '',
    'Implementation pressure (honest — not graded substrings):',
    '- Lifecycle actions must leave distinct inspectable statuses (open vs completed vs overdue/missed with follow-up).',
    '- Private/sensitive notes must stay distinguishable in the owning actor view.',
    '- Revoke/expire/deny must change the affected actor projection (access ended / denied), not only UI copy.'
  );
  return lines.join('\n');
}
