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
  const [command] = argv;

  if (!command || command === '--help' || command === '-h') {
    io.stdout.write(HELP);
    return 0;
  }

  io.stderr.write(`Unknown command: ${command}\n`);
  return 1;
}
