import fs from 'node:fs';
import path from 'node:path';
import { repositoryContext } from './graph-runtime/util.mjs';

const START = '<!-- lamina:managed-agent-rules:start -->';
const END = '<!-- lamina:managed-agent-rules:end -->';
const RULES = `${START}
## Lamina product context

After the one-time explicit \`/lamina-init\`, use Lamina passively for requests
that add or change product behavior, user flows, permissions, states, failures,
or UI. Skip this workflow for purely mechanical build fixes, formatting,
dependency maintenance, or tests that do not change product behavior.

For an explicit \`/lamina\` request or a focused product question that asks for
guidance, critique, explanation, or planning without asking to change files,
do not enter the graph/implementation workflow. Read the installed
\`lamina/SKILL.md\`, choose one primary capability, read that capability's
\`SKILL.md\`, then use a filesystem read tool on the smallest exact topic set.
Naming a topic from an index is not the same as loading it. Begin the response with
\`Using <capability>: <topic path(s)>\`. Do not answer a focused product question
from generic knowledge when the installed reference is available.

Before editing application source:
1. Put the user's request in a temporary text file outside the working tree (or under \`.git/lamina/work\`).
2. First run \`lamina work prepare --request-file <file> --output <packet.json>\` so Lamina selects relevant workflows from the request and graph. Do not invent a workflow name. Use \`--workflow <exact-ref>\` only to narrow a genuinely ambiguous result after querying the graph.
3. If Lamina reports design gaps, seed only a minimal proposed Workflow when the feature is new, then run \`lamina design prepare-walk\` for every active Persona. Give each task to a separate subagent when supported, or a separate isolated context otherwise, and publish its result with \`lamina design record-walk\`. Each walk covers every proposed operation node, including denied and inapplicable nodes, and independently analyzes intent, permission, inputs, state coverage, Scenarios, invariant probes, transitions, and all required edge-case axes. It returns explicit discovery arrays for Personas, Actors, Operations, Scenarios, Invariants, Surfaces, branches, and open decisions. The parent agent unions discoveries into the graph. Any non-empty discovery matrix blocks implementation; rerun every Persona after expansion until a current full round returns empty arrays. Lamina compiles Experience Cases directly from the graph-resident walks; do not author a second Experience Contract. This applies even when no implementation exists.
4. Run \`lamina work map --packet <packet.json> --output <work-map.json>\` to mechanically create one unresolved row for every obligation and Persona-bound Experience Case. Resolve each row to \`already_satisfied|change_required|blocked\` and map it to files. Each file declares \`action: modify|create\` and \`role: implementation|test\`. \`modify\` must already resolve to a regular file inside the repository; \`create\` must be absent and have an existing in-repository ancestor. Every changed obligation needs an implementation file and every changed case needs a test file. Run \`lamina work check --packet <packet.json> --map <work-map.json>\`; the checked map is immutable.
5. Implement the mapped work.
6. Run the one-shot \`lamina graph observe\` (never foreground \`--live\`, which is a persistent operator watcher), compile and run every active graph-backed Persona Mission against the built product, then publish each Run session. Rebase a later Run session before publishing when an earlier independent Run advanced the branch. Every compiled Experience Case needs one passing oracle event with a structured observation and reproducible artifact. For UI surfaces, emit all four live audit classes with distinct real artifacts scoped to a Mission surface and concrete state.
7. Run \`lamina work verify\` with the unchanged checked map. Fix failures and repeat until it passes.

Treat the exact graph closure and its current Persona walks as product authority. Source retrieval only localizes code; it cannot override the graph, and absent source does not excuse a missing design-time Persona walk for a new feature. A workflow is not implementation-ready until every active product Persona has independently traversed every operation node and permissions, inputs, requiredness, relationship identity/cardinality, duplicate and self-reference behavior, visible states, Scenarios, recovery, transitions, invariant probes, and required edge-case axes compile into Persona-bound deterministic Experience Cases. For UI work, verification must include functional, visual, responsive, and accessibility evidence. Missing browser or audit capability blocks verification.

Do not tell the user to invoke \`/lamina-design\` or \`/lamina-verify\` in normal flow. Those are advanced source-read-only overrides when the user explicitly wants only that phase.
${END}`;

function target(agent, root) {
  if (agent === 'codex') return path.join(root, 'AGENTS.md');
  if (agent === 'claude-code') return path.join(root, 'CLAUDE.md');
  if (agent === 'opencode') return path.join(root, 'AGENTS.md');
  if (agent === 'cursor') return path.join(root, '.cursor', 'rules', 'lamina.mdc');
  const error = new Error('--agent must be codex, claude-code, opencode, or cursor.');
  error.code = 'LAMINA_BAD_REQUEST';
  throw error;
}

function contentFor(agent) {
  if (agent !== 'cursor') return RULES;
  return `---
description: Passive Lamina product context for implementation work
alwaysApply: true
---

${RULES}`;
}

export function setupAgent({ agent, check = false, remove = false }, cwd = process.cwd()) {
  const root = repositoryContext(cwd).root;
  const file = target(agent, root);
  const existing = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
  const start = existing.indexOf(START);
  const end = existing.indexOf(END);
  const installed = start !== -1 && end > start;
  if (check) return { agent, file, installed, managed: installed };
  if (remove) {
    if (!installed) return { agent, file, removed: false };
    if (agent === 'cursor') {
      fs.unlinkSync(file);
      return { agent, file, removed: true };
    }
    const next = `${existing.slice(0, start)}${existing.slice(end + END.length)}`.trim();
    if (next) fs.writeFileSync(file, `${next}\n`);
    else fs.unlinkSync(file);
    return { agent, file, removed: true };
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const block = agent === 'cursor' && installed ? RULES : contentFor(agent);
  let next;
  if (installed) next = `${existing.slice(0, start)}${block}${existing.slice(end + END.length)}`;
  else next = existing.trim() ? `${existing.trimEnd()}\n\n${block}\n` : `${block}\n`;
  fs.writeFileSync(file, next);
  return { agent, file, installed: true, updated: installed };
}
