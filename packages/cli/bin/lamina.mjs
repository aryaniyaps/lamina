#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { graphRequest } from '../lib/graph-runtime/client.mjs';
import { CLI_VERSION, doctorReport } from '../lib/doctor.mjs';
import { runObservation } from '../lib/observe.mjs';

const argv = process.argv.slice(2);
const [domain, command, ...rawArgs] = argv;

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
  if (domain === 'doctor') return doctorReport();
  const opt = options(rawArgs);
  if (domain === 'graph') {
    if (command === 'status') return graphRequest('status');
    if (command === 'query') return graphRequest('graph.query', {
      at: opt.at || 'HEAD',
      subject: opt.workflow || opt.subject,
      predicate: opt.predicate,
      kind: opt.kind,
      alias: opt.alias || (opt.workflow ? `workflow.${opt.workflow}` : undefined),
    });
    if (command === 'validate') return graphRequest('graph.validate', { at: opt.at || opt.scope || 'HEAD' });
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
    const id = opt._[0];
    if (command === 'start') return graphRequest('session.start', { id: opt.id });
    if (command === 'query') return graphRequest('session.query', { id });
    if (command === 'publish') return graphRequest('session.publish', { id });
    if (command === 'rebase') return graphRequest('session.rebase', { id });
    if (command === 'abort') return graphRequest('session.abort', { id });
  }
  if (domain === 'mission') {
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
  throw Object.assign(new Error('Usage: lamina --version | lamina doctor --json | lamina graph <query|propose|patch|link|retire|validate|diff|status|backup|restore|observe|rebuild-observations> | lamina session <start|query|publish|rebase|abort> | lamina mission <compile|run>'), { code: 'LAMINA_BAD_REQUEST' });
}

try {
  const result = await run();
  if (result?.plain !== undefined) process.stdout.write(`${result.plain}\n`);
  else process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({ ok: false, error: { code: error.code || 'LAMINA_INTERNAL', message: error.message, details: error.details || {} } }, null, 2)}\n`);
  process.exitCode = 1;
}
