/**
 * Unattended-benchmark clarify detection and auto-reply for LaminaBench.
 *
 * When Lamina skills emit the clarify contract and STOP, the harness injects
 * one synthetic user reply synthesized from the task brief (eval-style
 * clarify-then-proceed, automated).
 */

export const UNATTENDED_BENCH_CONTRACT = [
  'Unattended benchmark run — the user cannot respond.',
  'Treat the task brief and fixture context as authoritative user input.',
  'If information is missing, proceed with labeled assumptions under Open questions — do not emit clarify and STOP.',
].join(' ');

/** @returns {string} */
export function withUnattendedContract(prompt) {
  return `${prompt.trim()}\n\n${UNATTENDED_BENCH_CONTRACT}`;
}

const CLARIFY_MARKERS = [
  /##\s*lamina:\s*clarification needed/i,
  /blocked before artifact generation/i,
  /###\s*clarifying questions/i,
  /clarification needed before artifact/i,
];

/** True when agent output matches Lamina's clarify output contract. */
export function isClarifyOutput(output) {
  if (!output || typeof output !== 'string') return false;
  const hits = CLARIFY_MARKERS.filter((re) => re.test(output)).length;
  return hits >= 2 || /##\s*lamina:\s*clarification needed/i.test(output);
}

/** Gate failed with no deliverables and output looks conversational / blocked. */
export function shouldAttemptClarifyRecovery(gateResult, output) {
  if (gateResult?.ok) return false;
  if (isClarifyOutput(output)) return true;
  if (!output) return false;
  return /clarif(y|ying|ication)/i.test(output) && /proceed|answer|question/i.test(output);
}

export function createInteractionTracker() {
  return {
    events: [],
    clarify_replied_phases: new Set(),
    clarify_stalled: false,
    stall_phase: null,
  };
}

export function recordClarifyEvent(tracker, phase, { detected, autoReplied }) {
  tracker.events.push({
    phase,
    clarify_detected: detected,
    auto_replied: autoReplied,
    timestamp: new Date().toISOString(),
  });
}

/** @param {ReturnType<typeof createInteractionTracker>} tracker */
export function summarizeInteraction(tracker) {
  if (!tracker || tracker.events.length === 0) {
    return {
      clarify_detected: false,
      auto_replied: false,
      clarify_stalled: false,
      stall_phase: null,
      events: [],
    };
  }
  return {
    clarify_detected: tracker.events.some((e) => e.clarify_detected),
    auto_replied: tracker.events.some((e) => e.auto_replied),
    clarify_stalled: tracker.clarify_stalled,
    stall_phase: tracker.stall_phase,
    events: tracker.events,
  };
}

/**
 * Synthetic user reply when the agent stalled on clarify.
 * @param {object} task
 * @param {string} brief — full description + context text
 */
export function buildClarifyAutoReply(task, brief) {
  return `Proceed without further user input. Answers are already in the project brief — treat it as authoritative.

Task scope:
${task.prompt}

Full project brief:
${brief}

Instructions:
- Do not emit a clarification-only response or STOP.
- If any detail is still unknown, document it under **Open questions** with labeled assumptions (confidence: low).
- Continue the current Lamina command and write all required deliverables to this workspace now.`;
}

/** @param {string} gateName e.g. treatment_init */
export function clarifyStallGateName(gateName) {
  return `${gateName}_clarify_stall`;
}
