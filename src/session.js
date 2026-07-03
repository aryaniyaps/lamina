import { initArtifacts, readArtifacts, writeArtifact } from './artifacts.js';
import { formatDiscoverySummary, scanProject } from './discovery.js';
import { questionsForFlow, routeFlow } from './flow-router.js';
import { buildPriorContext } from './prior-context.js';
import { generateSessionArtifacts } from './synthesis.js';

function yes(value) {
  return /^(y|yes|1)$/i.test((value ?? '').trim());
}

function showOnly(value) {
  return /show only|don.t write|do not write|3/i.test((value ?? '').trim());
}

function normalizeInterface(answer, fallback) {
  if (/mobile/i.test(answer ?? '')) return 'mobile';
  if (/web/i.test(answer ?? '')) return 'web';
  return fallback === 'mobile' ? 'mobile' : 'web';
}

export async function startGuidedSession(projectRoot, io) {
  await initArtifacts(projectRoot);
  const context = await scanProject(projectRoot);
  const priorContext = buildPriorContext(await readArtifacts(projectRoot));
  io.stdout.write(`${formatDiscoverySummary(context)}\n`);

  const intent = await io.ask('What are you working on? ');
  let flow = routeFlow(intent);
  if (!flow) {
    const choice = await io.ask('Is this primarily about: 1. Defining a new product/flow 2. Improving something that already exists 3. Adding a specific new capability ');
    flow = choice.trim() === '1' ? 'ideate' : choice.trim() === '2' ? 'optimize' : 'add-feature';
  }

  const answers = {};
  for (const question of questionsForFlow(flow)) {
    answers[question] = await io.ask(`${question} `);
  }

  const interfaceQuestion = Object.entries(answers).find(([question]) => question.includes('interface'));
  const interfaceType = normalizeInterface(interfaceQuestion?.[1], context.projectType);
  const framing = `Flow: ${flow}\nIntent: ${intent}\nInterface: ${interfaceType}`;
  io.stdout.write(`\nHere is how I understand the problem:\n\n${framing}\n\n`);

  if (!yes(await io.ask('Is this accurate? 1. Yes 2. Mostly, but I want to edit 3. No, restart framing '))) {
    return { artifactsChanged: [], implementationTasksPath: '.lamina/implementation-tasks.md', nextAction: 'Restart Lamina with revised framing.' };
  }

  const artifacts = generateSessionArtifacts({ flow, intent, answers, interfaceType, context, priorContext });
  io.stdout.write(`\nHere are the main UX insights and assumptions:\n\n${artifacts.insights}\n`);

  if (!yes(await io.ask('Do these feel accurate enough to generate tasks? '))) {
    return { artifactsChanged: [], implementationTasksPath: '.lamina/implementation-tasks.md', nextAction: 'Revise inputs before generating tasks.' };
  }

  io.stdout.write(`\n${artifacts.implementationTasks}\n`);
  const writeChoice = await io.ask('I generated implementation tasks. Should I write these to .lamina/implementation-tasks.md? 1. Yes 2. Edit first 3. Show only, don’t write ');
  if (showOnly(writeChoice) || !yes(writeChoice)) {
    return { artifactsChanged: [], implementationTasksPath: '.lamina/implementation-tasks.md', nextAction: 'Shown only; no artifacts were changed.' };
  }

  const writes = [
    ['current-state.md', artifacts.currentState],
    ['insights.md', artifacts.insights],
    ['edge-cases.md', artifacts.edgeCases],
    ['requirements.md', artifacts.requirements],
    ['implementation-tasks.md', artifacts.implementationTasks],
  ];
  for (const [file, content] of writes) await writeArtifact(projectRoot, file, content);

  io.stdout.write('Generated implementation tasks at .lamina/implementation-tasks.md\n');
  return {
    artifactsChanged: writes.map(([file]) => `.lamina/${file}`),
    implementationTasksPath: '.lamina/implementation-tasks.md',
    nextAction: 'Ask your coding tool to implement the P0 tasks.',
  };
}
