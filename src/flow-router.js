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
