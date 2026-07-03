import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { initArtifacts } from './artifacts.js';
import { formatDiscoverySummary, scanProject } from './discovery.js';
import { startGuidedSession } from './session.js';

const HELP = `Usage: lamina <command> [options]

Commands:
  init      Create missing .lamina artifacts
  scan      Print a project context summary
  start     Run a guided Lamina session
  tasks     Print .lamina/implementation-tasks.md
  doctor    Check local Lamina setup

Options:
  --help    Show this help
  --json    Print machine-readable JSON where supported
`;

function interactiveIo(io) {
  if (io.ask) return io;
  if (io !== process) return null;
  const rl = createInterface({ input, output });
  return {
    ...io,
    ask: async (question) => rl.question(question),
    close: () => rl.close(),
  };
}

export async function runCli(argv, io = process) {
  const [command, ...args] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.stdout.write(HELP);
    return 0;
  }

  const root = io.cwd ? io.cwd() : process.cwd();

  if (command === 'init') {
    const result = await initArtifacts(root);
    io.stdout.write(`Created .lamina (${result.created.length} new, ${result.existing.length} existing)\n`);
    return 0;
  }

  if (command === 'scan') {
    const context = await scanProject(root);
    io.stdout.write(args.includes('--json') ? `${JSON.stringify(context, null, 2)}\n` : formatDiscoverySummary(context));
    return 0;
  }

  if (command === 'start') {
    const sessionIo = interactiveIo(io);
    if (!sessionIo) {
      io.stderr.write('Interactive input is required for lamina start.\n');
      return 1;
    }
    try {
      const result = await startGuidedSession(root, sessionIo);
      if (args.includes('--json')) io.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return 0;
    } finally {
      if (sessionIo.close) sessionIo.close();
    }
  }

  if (command === 'tasks') {
    const target = join(root, '.lamina', 'implementation-tasks.md');
    if (!existsSync(target)) {
      io.stderr.write('No implementation tasks found. Run `lamina init` or `lamina start` first.\n');
      return 1;
    }
    io.stdout.write(await readFile(target, 'utf8'));
    return 0;
  }

  if (command === 'doctor') {
    const hasArtifacts = existsSync(join(root, '.lamina'));
    const context = await scanProject(root);
    io.stdout.write(`Lamina doctor\n\n- .lamina artifacts: ${hasArtifacts ? 'present' : 'missing'}\n- Discovery confidence: ${context.confidence}\n- Frameworks: ${context.frameworks.length ? context.frameworks.join(', ') : 'none detected'}\n`);
    return 0;
  }

  io.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}
