#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { graphRequest } from '../lib/graph-runtime/client.mjs';
import { CLI_VERSION, doctorReport } from '../lib/doctor.mjs';
import { runObservation } from '../lib/observe.mjs';
import { contextCatalog } from '../lib/context-index.mjs';
import { checkWork, prepareWork, verifyWork } from '../lib/work-context.mjs';
import { setupAgent } from '../lib/agent-setup.mjs';

const argv = process.argv.slice(2);
const [domain, command, ...rawArgs] = argv;

const HELP = Object.freeze({
  root: `Usage: lamina <command> [options]

Commands:
  doctor --json                 Check CLI, graph, Git, and observation readiness
  graph <command>               Query or mutate the transactional product graph
  context catalog               Describe graph and source-context retrieval
  work <command>                Prepare, map, and verify implementation work
  setup --agent AGENT           Install passive provider rules
  session <command>             Manage explicit graph mutation sessions
  mission <command>             Compile or run graph-backed missions

Options:
  --help, -h                    Show help
  --version, -v                 Print the CLI version

Run "lamina graph --help", "lamina work --help", "lamina session --help", or "lamina mission --help" for command details.`,
  graph: `Usage: lamina graph <command> [options]

Read commands:
  status
  query [--at VIEW] [--subject RESOURCE] [--predicate IRI] [--kind KIND] [--alias ALIAS]
  validate [--at VIEW] [--scope RESOURCE]
  diff [--base VIEW] [--head VIEW]

Mutation commands:
  propose --input FILE [--session SESSION]   FILE is one Resource or Statement JSON object
  patch SUBJECT --input FILE [--session SESSION]
                                             FILE must contain predicate and exactly one of object or literal
  link SUBJECT OBJECT --as PREDICATE [--session SESSION]
  retire RESOURCE [--session SESSION]
  retire STATEMENT --statement [--session SESSION]
  backup [--output FILE]
  restore --input FILE                       FILE is a Lamina graph backup JSON document

Observation commands:
  observe [--live]
  discover --brownfield
  rebuild-observations`,
  session: `Usage: lamina session <command> [arguments]

Commands:
  start [--id SESSION]
  query SESSION
  publish SESSION
  rebase SESSION
  abort SESSION`,
  mission: `Usage: lamina mission <command> [arguments]

Commands:
  compile --workflow WORKFLOW [--persona PERSONA] [--adapter MANIFEST] [--session SESSION]
  run MISSION [--events FILE]

--workflow and MISSION are required. --events FILE must contain a JSON array of runtime event objects.`,
  work: `Usage: lamina work <command> [arguments]

Commands:
  prepare --request-file FILE [--workflow REF ...] [--output FILE]
  check --packet FILE --map FILE
  verify --packet FILE --map FILE

prepare fails closed when the graph slice is not implementation-ready. check must
pass before source edits. verify requires current graph state and passing artifacts
for every obligation; UI obligations require functional, visual, responsive, and
accessibility evidence.`,
});

function plain(value) {
  return { plain: value };
}

function options(args) {
  const parsed = { _: [] };
  for (let index = 0; index < args.length; index += 1) {
    const item = args[index];
    if (!item.startsWith('--')) parsed._.push(item);
    else {
      const [name, inline] = item.slice(2).split(/=(.*)/s);
      if (inline !== undefined) parsed[name] = inline;
      else if (args[index + 1] && !args[index + 1].startsWith('--')) parsed[name] = args[++index];
      else parsed[name] = true;
    }
  }
  return parsed;
}

function readInput(file) {
  if (!file) throw Object.assign(new Error('--input is required.'), { code: 'LAMINA_BAD_REQUEST' });
  return JSON.parse(fs.readFileSync(path.resolve(file), 'utf8'));
}

async function implicitMutation(kind, input, method) {
  const session = await graphRequest('session.start');
  try {
    const staged = await graphRequest(method, { session: session.id, [kind]: input });
    const published = await graphRequest('session.publish', { id: session.id });
    return { ...published, mutation: staged };
  } catch (error) {
    try { await graphRequest('session.abort', { id: session.id }); } catch {}
    throw error;
  }
}

async function graphMutation(kind, input, method, sessionId = null) {
  if (!sessionId) return implicitMutation(kind, input, method);
  const staged = await graphRequest(method, { session: sessionId, [kind]: input });
  return { session: sessionId, mutation: staged, status: 'staged' };
}

async function run() {
  if (domain === '--version' || domain === '-v') return { plain: CLI_VERSION };
  if (!domain || domain === '--help' || domain === '-h' || domain === 'help') return plain(HELP.root);
  if (domain === 'doctor') return doctorReport();
  const opt = options(rawArgs);
  if (domain === 'context') {
    if (command === 'catalog') return contextCatalog();
    throw Object.assign(new Error('Usage: lamina context catalog'), { code: 'LAMINA_BAD_REQUEST' });
  }
  if (domain === 'setup') {
    const setupOptions = options([command, ...rawArgs].filter(Boolean));
    if (!setupOptions.agent) {
      throw Object.assign(new Error('Usage: lamina setup --agent <codex|claude-code|cursor> [--check|--remove]'), { code: 'LAMINA_BAD_REQUEST' });
    }
    return setupAgent({
      agent: setupOptions.agent,
      check: Boolean(setupOptions.check),
      remove: Boolean(setupOptions.remove),
    });
  }
  if (domain === 'work') {
    if (command === '--help' || command === '-h' || command === 'help') return plain(HELP.work);
    if (command === 'prepare') {
      const workflows = [];
      for (let index = 0; index < rawArgs.length; index += 1) {
        if (rawArgs[index] === '--workflow' && rawArgs[index + 1]) workflows.push(rawArgs[++index]);
        else if (rawArgs[index].startsWith('--workflow=')) workflows.push(rawArgs[index].slice('--workflow='.length));
      }
      if (!opt['request-file']) {
        throw Object.assign(new Error('--request-file is required.'), { code: 'LAMINA_BAD_REQUEST' });
      }
      return prepareWork({
        requestFile: opt['request-file'],
        workflows,
        output: opt.output,
      });
    }
    if (command === 'check') return checkWork({ packetFile: opt.packet, mapFile: opt.map });
    if (command === 'verify') return verifyWork({ packetFile: opt.packet, mapFile: opt.map });
  }
  if (domain === 'graph') {
    if (command === '--help' || command === '-h' || command === 'help') return plain(HELP.graph);
    if (command === 'status') return graphRequest('status');
    if (command === 'query') return graphRequest('graph.query', {
      at: opt.at || 'HEAD',
      subject: opt.workflow || opt.subject,
      predicate: opt.predicate,
      kind: opt.kind,
      alias: opt.alias || (opt.workflow ? `workflow.${opt.workflow}` : undefined),
    });
    if (command === 'validate') return graphRequest('graph.validate', {
      at: opt.at || 'HEAD',
      scope: opt.scope || null,
    });
    if (command === 'diff') return graphRequest('graph.diff', { base: opt.base || 'main', head: opt.head || 'HEAD' });
    if (command === 'backup') {
      const output = opt.output || path.join(process.cwd(), `lamina-graph-${Date.now()}.backup.json`);
      return graphRequest('graph.backup', { output });
    }
    if (command === 'restore') {
      if (!opt.input) throw Object.assign(new Error('--input is required.'), { code: 'LAMINA_BAD_REQUEST' });
      return graphRequest('graph.restore', { input: path.resolve(opt.input) });
    }
    if (command === 'observe') {
      return runObservation({ live: Boolean(opt.live) });
    }
    if (command === 'discover') {
      if (!opt.brownfield) {
        throw Object.assign(new Error('graph discover currently requires --brownfield.'), { code: 'LAMINA_BAD_REQUEST' });
      }
      return runObservation({ discover: true });
    }
    if (command === 'propose') {
      const input = readInput(opt.input);
      if (input.subject) return graphMutation('statement', input, 'statement.propose', opt.session);
      return graphMutation('resource', input, 'resource.propose', opt.session);
    }
    if (command === 'patch') {
      const input = readInput(opt.input);
      const subject = input.subject || opt._[0];
      if (!subject || !input.predicate) {
        throw Object.assign(new Error('patch input must contain predicate and object or literal.'), { code: 'LAMINA_BAD_REQUEST' });
      }
      return graphMutation('statement', { ...input, subject }, 'statement.propose', opt.session);
    }
    if (command === 'link') {
      const [subject, object] = opt._;
      if (!subject || !object || !opt.as) throw Object.assign(new Error('link requires SUBJECT OBJECT --as PREDICATE'), { code: 'LAMINA_BAD_REQUEST' });
      return graphMutation('statement', { subject, object, predicate: opt.as }, 'statement.propose', opt.session);
    }
    if (command === 'retire') {
      const id = opt._[0];
      if (!id) throw Object.assign(new Error('retire requires a Resource reference or Statement id.'), { code: 'LAMINA_BAD_REQUEST' });
      return graphMutation(
        opt.statement ? 'id' : 'ref',
        id,
        opt.statement ? 'statement.retire' : 'resource.retire',
        opt.session,
      );
    }
    if (command === 'rebuild-observations') {
      return runObservation({ invalidate: true });
    }
  }
  if (domain === 'session') {
    if (command === '--help' || command === '-h' || command === 'help') return plain(HELP.session);
    const id = opt._[0];
    if (command === 'start') return graphRequest('session.start', { id: opt.id });
    if (command === 'query') return graphRequest('session.query', { id });
    if (command === 'publish') return graphRequest('session.publish', { id });
    if (command === 'rebase') return graphRequest('session.rebase', { id });
    if (command === 'abort') return graphRequest('session.abort', { id });
  }
  if (domain === 'mission') {
    if (command === '--help' || command === '-h' || command === 'help') return plain(HELP.mission);
    if (command === 'compile') {
      if (!opt.workflow) throw Object.assign(new Error('--workflow is required.'), { code: 'LAMINA_BAD_REQUEST' });
      return graphRequest('mission.compile', {
        workflow: opt.workflow,
        persona: opt.persona,
        adapter: opt.adapter,
        session: opt.session,
      });
    }
    if (command === 'run') {
      const mission = opt._[0];
      if (!mission) throw Object.assign(new Error('mission run requires a mission id.'), { code: 'LAMINA_BAD_REQUEST' });
      const events = opt.events ? readInput(opt.events) : [];
      return graphRequest('mission.run', { mission, events });
    }
  }
  throw Object.assign(new Error('Usage: lamina <doctor|graph|context|work|setup|session|mission>'), { code: 'LAMINA_BAD_REQUEST' });
}

try {
  const result = await run();
  if (result?.plain !== undefined) process.stdout.write(`${result.plain}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code || 'LAMINA_INTERNAL', message: error.message, details: error.details || {} } }, null, 2)}\n`);
  process.exitCode = 1;
}
