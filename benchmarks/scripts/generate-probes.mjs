#!/usr/bin/env node
/**
 * Generate structural behavior probes from golden checklists.
 *   npm run bench:probes:generate
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'url';
import { readYamlSync } from './yaml.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const GOLDENS = path.join(ROOT, 'benchmarks/goldens');
const OUT = path.join(ROOT, 'benchmarks/probes');

const GUARD_WORDS = 'if|throw|assert|require|guard|validate|forbid|reject|cannot|must|ensure|check|deny|unauthorized|forbidden|invariant';
const TYPE_WORDS = 'type|interface|class|struct|model|schema|entity|record|enum|typedef';
const HANDLER_WORDS = 'catch|error|recover|retry|fallback|empty|offline|timeout|conflict|handler|onError|rescue';

function humanize(item) {
  return String(item).replace(/_/g, ' ');
}

function conceptRegex(item) {
  const words = humanize(item)
    .split(/\s+/)
    .filter((w) => w.length > 2)
    .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!words.length) return humanize(item).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return words.join('[\\s_-]*');
}

function yamlEscape(s) {
  if (/[:#{}[\],&*?|<>=!%@`]/.test(s) || s.includes('"')) {
    return `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
  }
  return s;
}

function buildProbes(taskId, golden) {
  const probes = [];

  for (const item of golden.required_invariants || []) {
    probes.push({
      id: `inv_${item}`,
      kind: 'code_guard',
      description: `Invariant "${humanize(item)}" with guard/validation`,
      weight: 2,
      patterns: [`(?is)(${conceptRegex(item)}).{0,120}(${GUARD_WORDS})|(?is)(${GUARD_WORDS}).{0,120}(${conceptRegex(item)})`],
    });
  }

  for (const item of golden.required_entities || []) {
    probes.push({
      id: `ent_${item}`,
      kind: 'entity_model',
      description: `Entity "${humanize(item)}" in type/model context`,
      weight: 1,
      patterns: [`(?is)(${TYPE_WORDS})[\\s\\w{:,<]*${conceptRegex(item)}|(?is)${conceptRegex(item)}[\\s\\w]*({|struct|class|interface|=)`],
    });
  }

  for (const item of [...(golden.required_scenarios || []), ...(golden.required_edge_cases || [])]) {
    const id = `scn_${item}`;
    if (probes.some((p) => p.id === id)) continue;
    probes.push({
      id,
      kind: 'scenario_handler',
      description: `Scenario/edge "${humanize(item)}" near error/recovery handling`,
      weight: 2,
      patterns: [`(?is)(${conceptRegex(item)}).{0,160}(${HANDLER_WORDS})|(?is)(${HANDLER_WORDS}).{0,160}(${conceptRegex(item)})`],
    });
  }

  probes.push({
    id: 'has_executable_implementation',
    kind: 'code_guard',
    description: 'Contains function/class/export definitions',
    weight: 1,
    patterns: ['\\b(export\\s+(async\\s+)?function|export\\s+class|def\\s+\\w+|function\\s+\\w+|class\\s+\\w+)\\b'],
  });

  return { task_id: taskId, version: '1.0.0', probes };
}

function toYaml(doc) {
  const lines = [`task_id: ${doc.task_id}`, `version: ${doc.version}`, 'probes:'];
  for (const p of doc.probes) {
    lines.push(`  - id: ${p.id}`);
    lines.push(`    kind: ${p.kind}`);
    lines.push(`    description: ${yamlEscape(p.description)}`);
    lines.push(`    weight: ${p.weight}`);
    lines.push('    patterns:');
    for (const pat of p.patterns) lines.push(`      - ${yamlEscape(pat)}`);
  }
  return lines.join('\n') + '\n';
}

function main() {
  fs.mkdirSync(OUT, { recursive: true });
  let n = 0;
  for (const dir of fs.readdirSync(GOLDENS)) {
    const goldenPath = path.join(GOLDENS, dir, 'golden.yaml');
    if (!fs.existsSync(goldenPath)) continue;
    const golden = readYamlSync(goldenPath);
    const taskId = golden.task_id || dir;
    const doc = buildProbes(taskId, golden);
    const outDir = path.join(OUT, taskId);
    fs.mkdirSync(outDir, { recursive: true });
    fs.writeFileSync(path.join(outDir, 'probes.yaml'), toYaml(doc));
    n++;
  }
  console.log(`Generated probes for ${n} tasks → ${OUT}/`);
}

main();
