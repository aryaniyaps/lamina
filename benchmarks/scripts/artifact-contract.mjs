/**
 * Shared helpers: extract a fixed scoring artifact for both arms.
 * Prevents treatment from winning via .lamina/ volume dump.
 */
import fs from 'node:fs';
import path from 'node:path';

const PREFERRED_FILES = [
  'implement.md',
  'run.yaml',
  'report.md',
  'design.md',
  'brief.md',
];

const MAX_ARTIFACT_CHARS = 48_000;

/**
 * Prefer a single product-behavior brief over dumping the whole tree.
 * Order: preferred .lamina files → agent stdout → truncated .lamina leftovers.
 */
export function captureScoringArtifact(workspace, agentOutput) {
  const parts = [];
  const laminaDir = path.join(workspace, '.lamina');
  const preferred = [];

  if (fs.existsSync(laminaDir)) {
    collectPreferred(laminaDir, '', preferred);
  }

  if (preferred.length) {
    for (const { rel, text } of preferred) {
      parts.push(`--- ${rel} ---\n${text}`);
    }
  } else if (agentOutput?.trim()) {
    parts.push(agentOutput.trim());
  }

  // If still empty and .lamina exists, take a small sample of other files
  if (!parts.length && fs.existsSync(laminaDir)) {
    const extras = [];
    walkFiles(laminaDir, '', extras);
    for (const { rel, text } of extras.slice(0, 3)) {
      parts.push(`--- ${rel} ---\n${text}`);
    }
  }

  // Always include stdout if preferred files were found but stdout has unique content
  if (preferred.length && agentOutput?.trim() && agentOutput.trim().length > 200) {
    const stdout = agentOutput.trim();
    if (!parts.some((p) => p.includes(stdout.slice(0, 120)))) {
      parts.unshift(`--- agent_stdout ---\n${stdout.slice(0, 12_000)}`);
    }
  }

  let out = parts.join('\n\n');
  if (out.length > MAX_ARTIFACT_CHARS) {
    out = out.slice(0, MAX_ARTIFACT_CHARS) + '\n\n[truncated for scoring]';
  }
  return out;
}

function collectPreferred(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      collectPreferred(abs, rel, out);
      continue;
    }
    const base = entry.name.toLowerCase();
    if (PREFERRED_FILES.includes(base) || base.endsWith('implement.md')) {
      try {
        out.push({ rel: `.lamina/${rel}`, text: fs.readFileSync(abs, 'utf8') });
      } catch {
        /* skip */
      }
    }
  }
}

function walkFiles(dir, prefix, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(abs, rel, out);
      continue;
    }
    if (!/\.(md|ya?ml|txt)$/i.test(entry.name)) continue;
    try {
      out.push({ rel: `.lamina/${rel}`, text: fs.readFileSync(abs, 'utf8') });
    } catch {
      /* skip */
    }
  }
}

/** Shared output contract appended to every task prompt (both arms). */
export const OUTPUT_CONTRACT = `## Required output

Produce a **product-behavior design brief** (markdown). Cover:

1. **Domain model** — entities and relationships
2. **Illegal states / invariants** — what must never happen; how it is guarded
3. **Actors and permissions** — who can do what
4. **Workflows** — key journeys with decision points
5. **Scenarios** — violation attempts, failures, and recovery paths
6. **Trade-offs** — named competing goals and the choice you recommend
7. **Implementation brief** — concrete build guidance for a coding agent

Do not invent interviews, analytics, SUS scores, or workshop theater.
Score is based on product-behavior reasoning depth, not document format or section titles.`;
