#!/usr/bin/env node
/**
 * Lamina plugin structural checks for eval pre-flight.
 * Runs before agent-skill-eval suites; does NOT extend verify_lamina_bundle.mjs.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');

const errors = [];

function exists(rel) {
  return fs.existsSync(path.join(ROOT, rel));
}

function read(rel) {
  return fs.readFileSync(path.join(ROOT, rel), 'utf8');
}

function checkAuditProfiles() {
  const yaml = read('skills/lamina-orchestrator/audit-profiles.yaml');
  const skills = [...yaml.matchAll(/^\s+-\s+(lamina-[a-z-]+)\s*$/gm)].map((m) => m[1]);
  for (const skill of skills) {
    if (!exists(`skills/${skill}/SKILL.md`)) {
      errors.push(`audit-profiles references missing skill: skills/${skill}/SKILL.md`);
    }
  }
}

function checkProblemRouterLinks() {
  const core = read('skills/lamina-core/SKILL.md');
  const links = [...core.matchAll(/\]\(\.\.\/(lamina-[a-z-]+)\/SKILL\.md\)/g)].map((m) => m[1]);
  for (const skill of links) {
    if (!exists(`skills/${skill}/SKILL.md`)) {
      errors.push(`Problem Router link missing: skills/${skill}/SKILL.md`);
    }
  }
}

function checkCommandSkills() {
  const commandNames = ['lamina', 'lamina-init', 'lamina-design', 'lamina-audit'];
  for (const name of commandNames) {
    const skillPath = `skills/${name}/SKILL.md`;
    if (!exists(skillPath)) {
      errors.push(`Missing command skill: ${skillPath}`);
      continue;
    }
    const skill = read(skillPath);
    if (!skill.includes('disable-model-invocation: true')) {
      errors.push(`Command skill missing disable-model-invocation: ${skillPath}`);
    }
    if (!skill.includes('Writes: `.lamina/` only') || !skill.includes('Repo: read-only')) {
      errors.push(`Command skill missing write boundary guardrail: ${skillPath}`);
    }
    if (!/Do not create, edit, delete, format, or refactor/.test(skill)) {
      errors.push(`Command skill missing explicit source-edit refusal: ${skillPath}`);
    }
  }
}

function checkArtifactCatalog() {
  const catalogPath = 'skills/lamina-orchestrator/artifact-catalog.yaml';
  if (!exists(catalogPath)) {
    errors.push(`Missing artifact catalog: ${catalogPath}`);
    return;
  }
  const catalog = read(catalogPath);
  const allowedPacks = new Set(['research', 'ia', 'flow', 'journey', 'interaction', 'wireframe', 'validation', 'accessibility', 'strategy', 'handoff']);
  const allowedEvidenceModes = new Set(['evidence_required', 'assumption_allowed', 'simulation_or_evidence', 'run_yaml_required']);
  const allowedDiagrams = new Set(['flowchart', 'flowchart_with_subgraphs', 'journey', 'timeline', 'stateDiagram-v2', 'sequenceDiagram', 'classDiagram', 'quadrantChart', 'mindmap']);
  let inArtifacts = false;
  let artifactCount = 0;
  for (const [idx, line] of catalog.split('\n').entries()) {
    if (line.trim() === 'artifacts:') {
      inArtifacts = true;
      continue;
    }
    if (!inArtifacts || !line.trim() || line.trim().startsWith('#')) continue;
    const artifact = line.match(/^  ([a-z0-9_]+):\s+\{\s*pack:\s+([a-z_]+),\s+required_inputs:\s+\[[^\]]*\],\s+evidence_mode:\s+([a-z_]+),\s+skills:\s+\[[^\]]+\],\s+diagram:\s+([A-Za-z0-9_-]+)\s*\}\s*$/);
    if (!artifact) {
      errors.push(`artifact-catalog malformed artifact row at line ${idx + 1}: ${line}`);
      continue;
    }
    const [, artifactId, pack, evidenceMode, diagram] = artifact;
    if (!allowedPacks.has(pack)) errors.push(`artifact-catalog ${artifactId} invalid pack: ${pack}`);
    if (!allowedEvidenceModes.has(evidenceMode)) errors.push(`artifact-catalog ${artifactId} invalid evidence_mode: ${evidenceMode}`);
    if (!allowedDiagrams.has(diagram)) errors.push(`artifact-catalog ${artifactId} invalid diagram: ${diagram}`);
    artifactCount++;
  }
  if (artifactCount < 80) {
    errors.push(`artifact-catalog has too few artifacts: ${artifactCount}`);
  }
  for (const required of [
    'evidence_required',
    'assumption_allowed',
    'simulation_or_evidence',
    'run_yaml_required',
    'developer_handoff',
    'affinity_diagram',
    'user_journey_map',
    'accessibility_audit',
  ]) {
    if (!catalog.includes(required)) {
      errors.push(`artifact-catalog missing required entry: ${required}`);
    }
  }
  const skills = [...catalog.matchAll(/lamina-[a-z-]+/g)].map((m) => m[0]);
  for (const skill of new Set(skills)) {
    if (!exists(`skills/${skill}/SKILL.md`)) {
      errors.push(`artifact-catalog references missing skill: skills/${skill}/SKILL.md`);
    }
  }
}

function checkOutputContracts() {
  const contracts = {
    'skills/lamina-orchestrator/prompts/outputs/design.md': [
      'Problem framing',
      'Users and jobs',
      'Assumptions and evidence',
      'Journey and information architecture',
      'Flows',
      'Screens',
      'Interactions and copy',
      'Edge cases and recovery',
      'Risks and decisions',
      'Accessibility review',
      'Metrics and validation',
      'Artifact packs',
      'Developer handoff',
      'Persona simulation notes',
      'Open questions',
    ],
    'skills/lamina-orchestrator/prompts/outputs/audit.md': [
      'Executive summary',
      'Findings by flow',
      'Prioritized improvements',
      'Quick wins',
      'Strategic bets',
      'Persona simulation notes',
      'Artifact packs',
      'Open questions',
      'Coding handoff',
    ],
    'skills/lamina-orchestrator/prompts/outputs/init-blocked.md': [
      'Status',
      "What's missing",
      'Next step',
      'Do not',
    ],
    'skills/lamina-orchestrator/prompts/outputs/clarify.md': [
      'Status',
      'Clarifying questions',
      'Why these block the artifact',
      'How to proceed',
      'Do not',
    ],
  };

  for (const [file, headings] of Object.entries(contracts)) {
    const content = read(file);
    for (const heading of headings) {
      if (!content.includes(heading)) {
        errors.push(`Output contract ${file} missing heading: ${heading}`);
      }
    }
  }
}

function checkPromptManifest() {
  const manifest = read('skills/lamina-orchestrator/prompts/manifest.yaml');
  for (const id of ['outputs/clarify', 'outputs/artifact-template', 'outputs/artifact-pack', 'outputs/handoff']) {
    if (!manifest.includes(`${id}:`)) {
      errors.push(`Prompt manifest missing ${id}`);
    }
  }
}

function checkArtifactSubagents() {
  for (const rel of [
    'skills/lamina-orchestrator/patterns/artifact-subagents.md',
    'skills/lamina-orchestrator/agents/research-artifact-writer.md',
    'skills/lamina-orchestrator/agents/ia-artifact-writer.md',
    'skills/lamina-orchestrator/agents/journey-artifact-writer.md',
    'skills/lamina-orchestrator/agents/interaction-artifact-writer.md',
    'skills/lamina-orchestrator/agents/validation-artifact-writer.md',
    'skills/lamina-orchestrator/agents/strategy-artifact-writer.md',
    'skills/lamina-orchestrator/agents/handoff-compiler.md',
  ]) {
    if (!exists(rel)) errors.push(`Missing artifact subagent file: ${rel}`);
    else if (rel.includes('/agents/') && !read(rel).includes('readonly: true')) errors.push(`Artifact subagent must be readonly: ${rel}`);
  }
}

function checkMetadataAlignment() {
  const skillsDir = path.join(ROOT, 'skills');
  for (const entry of fs.readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory() || !entry.name.startsWith('lamina-')) continue;
    const skillPath = path.join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillPath)) continue;
    const content = fs.readFileSync(skillPath, 'utf8');
    if (!content.includes('metadata:') || !content.includes('lamina:')) continue;
    const idMatch = content.match(/^\s+id:\s*([a-z-]+)\s*$/m);
    if (!idMatch) continue;
    if (entry.name === 'lamina-studio' && idMatch[1] === 'blueprint') continue;
    const expectedFolder = `lamina-${idMatch[1]}`;
    if (entry.name !== expectedFolder) {
      errors.push(`metadata.lamina.id mismatch: folder ${entry.name} has id ${idMatch[1]}`);
    }
  }
}

checkAuditProfiles();
checkArtifactCatalog();
checkProblemRouterLinks();
checkCommandSkills();
checkOutputContracts();
checkPromptManifest();
checkArtifactSubagents();
checkMetadataAlignment();

if (errors.length) {
  console.error('Lamina plugin validation FAILED:\n');
  for (const e of errors) console.error(`  - ${e}`);
  process.exit(1);
}

console.log('OK — Lamina plugin validation passed');
process.exit(0);
