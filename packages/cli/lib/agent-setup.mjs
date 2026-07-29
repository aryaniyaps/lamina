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

Before editing application source:
1. Put the user's request in a temporary text file outside the working tree (or under \`.git/lamina/work\`).
2. Run \`lamina work prepare --request-file <file> --workflow <relevant-workflow> --output <packet.json>\`.
3. If Lamina reports design gaps, complete and publish the missing product design first, then prepare again. Do not edit source while the packet is blocked.
4. Create a \`lamina.work-map/v1\` mapping every obligation to current evidence, intended code targets, and verification. Run \`lamina work check --packet <packet.json> --map <work-map.json>\`.
5. Implement the mapped work.
6. Run \`lamina graph observe\`, compile and run the relevant graph-backed Missions against the built product, and collect real artifacts. For UI surfaces, run all four live audit classes.
7. Update the map with passing artifact paths and run \`lamina work verify\`. Fix failures and repeat until it passes.

Treat the exact graph closure as product authority. Source retrieval only localizes code; it cannot override the graph. For UI work, verification must include functional, visual, responsive, and accessibility evidence. Missing browser or audit capability blocks verification.

Do not tell the user to invoke \`/lamina-design\` or \`/lamina-verify\` in normal flow. Those are advanced source-read-only overrides when the user explicitly wants only that phase.
${END}`;

function target(agent, root) {
  if (agent === 'codex') return path.join(root, 'AGENTS.md');
  if (agent === 'claude-code') return path.join(root, 'CLAUDE.md');
  if (agent === 'cursor') return path.join(root, '.cursor', 'rules', 'lamina.mdc');
  const error = new Error('--agent must be codex, claude-code, or cursor.');
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
