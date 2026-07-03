import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const ARTIFACT_FILES = [
  'current-state.md',
  'research-questions.md',
  'insights.md',
  'personas.md',
  'edge-cases.md',
  'requirements.md',
  'implementation-tasks.md',
  'decisions.md',
  'config.yml',
  'journeys/README.md',
];

const TITLES = {
  'current-state.md': 'Current State',
  'research-questions.md': 'Research Questions',
  'insights.md': 'Insights',
  'personas.md': 'Personas',
  'edge-cases.md': 'Edge Cases',
  'requirements.md': 'Requirements',
  'implementation-tasks.md': 'Implementation Tasks',
  'decisions.md': 'Decisions',
  'journeys/README.md': 'Journeys',
};

const SECTIONS = {
  'current-state.md': ['Project Summary', 'Detected Stack', 'Existing User Flows', 'Data Model Summary', 'API/Backend Summary', 'Permissions & Roles', 'Known Gaps', 'Assumptions'],
  'research-questions.md': ['Critical Questions', 'Nice-to-Know Questions', 'Questions Answered This Session', 'Questions Deferred'],
  'insights.md': ['Key Insights', 'Evidence', 'Assumptions', 'Confidence Levels', 'Reusable Insights'],
  'personas.md': ['Primary Users', 'Secondary Users', 'User Goals', 'Pain Points', 'Mental Models'],
  'edge-cases.md': ['P0 Edge Cases', 'P1 Edge Cases', 'P2 Edge Cases', 'Error States', 'Permission Issues', 'Empty States', 'Loading States', 'Recovery Paths'],
  'requirements.md': ['User Requirements', 'Functional UX Requirements', 'Non-Goals', 'Constraints', 'Interface-Specific Requirements', 'Accessibility Requirements', 'Analytics/Instrumentation Requirements', 'UX Requirements Block for UI Skills'],
  'implementation-tasks.md': ['Summary', 'P0 Tasks', 'P1 Tasks', 'P2 Tasks', 'Verification Checklist', 'Edge Cases to Test', 'What to Verify With Humans', 'Assumptions'],
  'decisions.md': ['Active Decisions', 'Superseded Decisions', 'Decision Log'],
  'journeys/README.md': ['Available Journeys'],
};

function artifactName(file) {
  return file.replace('journeys/README', 'journeys').replace(/\.md$/, '');
}

function frontmatter(file, now, sessionId) {
  return `---\nartifact: ${artifactName(file)}\nversion: 1\nupdated: ${now}\nsession_id: ${sessionId}\nstatus: draft\n---\n\n`;
}

function markdownTemplate(file, now, sessionId) {
  const body = [`# ${TITLES[file]}`, '', ...SECTIONS[file].flatMap((section) => [`## ${section}`, '', '- None recorded yet.', ''])].join('\n');
  return `${frontmatter(file, now, sessionId)}${body}`;
}

function configTemplate() {
  return `version: 1\n\nmode: guided\n\ndefault_interfaces:\n  - web\n\nenabled_discovery:\n  schema: true\n  routes: true\n  frontend_flows: true\n  permissions: true\n  analytics: false\n\nanalytics:\n  provider: null\n\noutput:\n  write_artifacts: true\n  require_confirmation: true\n\nboundaries:\n  allow_visual_design: false\n  allow_code_generation: false\n`;
}

export async function initArtifacts(projectRoot, options = {}) {
  const now = options.now ?? new Date().toISOString();
  const sessionId = options.sessionId ?? `lamina_${Date.now().toString(36)}`;
  const laminaRoot = join(projectRoot, '.lamina');
  const created = [];
  const existing = [];

  await mkdir(join(laminaRoot, 'journeys'), { recursive: true });

  for (const file of ARTIFACT_FILES) {
    const target = join(laminaRoot, file);
    if (existsSync(target)) {
      existing.push(file);
      continue;
    }
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, file === 'config.yml' ? configTemplate() : markdownTemplate(file, now, sessionId));
    created.push(file);
  }

  return { created, existing };
}

export async function writeArtifact(projectRoot, relativeFile, content) {
  const now = new Date().toISOString();
  const target = join(projectRoot, '.lamina', relativeFile);
  await mkdir(dirname(target), { recursive: true });
  const artifact = relativeFile.replace(/\.md$/, '');
  const body = content.startsWith('---\n')
    ? content
    : `---\nartifact: ${artifact}\nversion: 1\nupdated: ${now}\nstatus: draft\n---\n\n${content}`;
  await writeFile(target, body);
}
