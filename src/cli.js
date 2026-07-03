import { initArtifacts } from './artifacts.js';
import { formatDiscoverySummary, scanProject } from './discovery.js';

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

  io.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}
