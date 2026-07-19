#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const V2_ROOT = path.resolve(HERE, '..');

function selected(values, requested) {
  if (!requested || requested === 'all') return values;
  const wanted = new Set(requested.split(',').map((value) => value.trim()).filter(Boolean));
  return values.filter((value) => wanted.has(typeof value === 'string' ? value : value.id));
}

export function compileMatrix(release, corpus, options = {}) {
  const mode = options.mode || 'development';
  if (!['development', 'publication'].includes(mode)) throw new Error(`Unknown matrix mode: ${mode}`);
  const tasks = selected(corpus[mode] || [], options.task);
  const arms = selected(release.arms, options.arm);
  const tracks = selected(release.tracks, options.track);
  const cohorts = selected(release.cohorts, options.cohort);
  const repeats = options.repeat ? [Number(options.repeat)] : Array.from({ length: release.runs_per_cell }, (_, index) => index + 1);
  if (![tasks, arms, tracks, cohorts].every((items) => items.length)) throw new Error('Matrix filters selected zero cells');
  if (repeats.some((repeat) => !Number.isInteger(repeat) || repeat < 1 || repeat > release.runs_per_cell)) throw new Error(`Repeat must be an integer from 1 to ${release.runs_per_cell}`);

  const cells = [];
  for (const task of tasks) {
    for (const arm of arms) {
      for (const track of tracks) {
        for (const cohort of cohorts) {
          if (mode === 'publication' && !task.sealed_sha256) throw new Error(`Publication task ${task.id} has no sealed package hash`);
          if (mode === 'publication' && !cohort.resolved_model) throw new Error(`Publication cohort ${cohort.id} is not pinned to a resolved model`);
          const model = cohort.resolved_model || cohort.model || cohort.model_alias;
          if (!model) throw new Error(`Cohort ${cohort.id} has no runnable model`);
          for (const repeat of repeats) {
            cells.push({
              id: [task.id, arm, track, cohort.id, `r${repeat}`].join('__'),
              mode,
              task_id: task.id,
              task_package: task.package || task.id,
              task_kind: task.kind,
              fixture_ref: task.fixture_ref || null,
              sealed_sha256: task.sealed_sha256 || null,
              arm,
              track,
              cohort_id: cohort.id,
              provider: cohort.provider,
              model,
              resolved_model: cohort.resolved_model || null,
              repeat,
            });
          }
        }
      }
    }
  }
  return cells;
}

function parseArgs(argv) {
  const options = {};
  for (let index = 2; index < argv.length; index += 1) {
    if (!argv[index].startsWith('--')) continue;
    const key = argv[index].slice(2);
    if (key === 'json') options.json = true;
    else options[key] = argv[++index];
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv);
  const release = JSON.parse(fs.readFileSync(path.join(V2_ROOT, 'release.json'), 'utf8'));
  const corpus = JSON.parse(fs.readFileSync(path.join(V2_ROOT, 'corpus', 'manifest.json'), 'utf8'));
  const cells = compileMatrix(release, corpus, options);
  const document = { protocol_version: release.protocol_version, generated_at: new Date().toISOString(), cell_count: cells.length, cells };
  if (options.output) fs.writeFileSync(path.resolve(options.output), `${JSON.stringify(document, null, 2)}\n`);
  else console.log(options.json ? JSON.stringify(document) : JSON.stringify(document, null, 2));
}
