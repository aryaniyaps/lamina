/**
 * Extract domain / actors / scope lists from run.yaml source.
 * Complements the section-oriented parseRunYaml for nested domain graphs.
 */

function stripYamlScalar(raw) {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === 'null') return undefined;
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function parseInlineArray(raw) {
  const inner = raw.trim().replace(/^\[/, '').replace(/\]$/, '');
  if (!inner.trim()) return [];
  return inner.split(',').map((s) => stripYamlScalar(s.trim())).filter(Boolean);
}

/**
 * @param {string} source
 * @returns {{
 *   domain: { entities: {id:string}[]; invariants: {id:string; rule?: string}[]; dependencies: Record<string, unknown>[] };
 *   actors: Record<string, unknown>[];
 *   out_of_scope: string[];
 *   forbidden_content: string[];
 *   tradeoffs: Record<string, unknown>[];
 *   seed: Record<string, unknown> | null;
 *   freestyle: { edge_cases: boolean; preconditions: boolean; illegal_states: boolean };
 * }}
 */
export function extractContractExtras(source) {
  /** @type {{ id: string }[]} */
  const entities = [];
  /** @type {{ id: string; rule?: string }[]} */
  const invariants = [];
  /** @type {Record<string, unknown>[]} */
  const dependencies = [];
  /** @type {Record<string, unknown>[]} */
  const actors = [];
  /** @type {string[]} */
  const out_of_scope = [];
  /** @type {string[]} */
  const forbidden_content = [];
  /** @type {Record<string, unknown>[]} */
  const tradeoffs = [];
  /** @type {Record<string, unknown> | null} */
  let seed = null;

  const freestyle = {
    edge_cases: /^edge_cases:\s*$/m.test(source) || /^\s+edge_cases:\s*$/m.test(source),
    preconditions: /^\s+preconditions:\s*$/m.test(source) || /^\s+preconditions:\s*\[/m.test(source),
    illegal_states: /^illegal_states:\s*$/m.test(source) || /^\s+illegal_states:\s*$/m.test(source),
  };

  let zone = 'root'; // root | domain | actors | out_of_scope | forbidden_content | tradeoffs | seed
  let domainSub = ''; // entities | invariants | dependencies | ''
  /** @type {Record<string, unknown> | null} */
  let currentDep = null;
  /** @type {Record<string, unknown> | null} */
  let currentActor = null;
  /** @type {{ id: string } | null} */
  let currentEntity = null;
  /** @type {{ id: string; rule?: string } | null} */
  let currentInvariant = null;
  /** @type {Record<string, unknown> | null} */
  let currentTradeoff = null;
  let inDepSurfaces = false;
  let inActorPerms = false;
  let inActorFilters = false;

  const flushDep = () => {
    if (currentDep) {
      dependencies.push(currentDep);
      currentDep = null;
    }
    inDepSurfaces = false;
  };
  const flushTradeoff = () => {
    if (currentTradeoff) {
      tradeoffs.push(currentTradeoff);
      currentTradeoff = null;
    }
  };
  const flushActor = () => {
    if (currentActor) {
      actors.push(currentActor);
      currentActor = null;
    }
    inActorPerms = false;
    inActorFilters = false;
  };
  const flushEntity = () => {
    if (currentEntity) {
      entities.push(currentEntity);
      currentEntity = null;
    }
  };
  const flushInvariant = () => {
    if (currentInvariant) {
      invariants.push(currentInvariant);
      currentInvariant = null;
    }
  };

  for (const line of source.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    // Top-level section switches (column 0 keys)
    if (/^[a-z_]+:\s*$/i.test(line) || /^[a-z_]+:\s+\S/i.test(line)) {
      const top = line.match(/^([a-z_]+):/i);
      if (top) {
        const key = top[1];
        if (key === 'domain') {
          flushDep();
          flushEntity();
          flushInvariant();
          flushActor();
          zone = 'domain';
          domainSub = '';
          continue;
        }
        if (key === 'actors') {
          flushDep();
          flushEntity();
          flushInvariant();
          flushActor();
          zone = 'actors';
          continue;
        }
        if (key === 'out_of_scope') {
          flushActor();
          flushTradeoff();
          zone = 'out_of_scope';
          continue;
        }
        if (key === 'forbidden_content') {
          flushActor();
          flushTradeoff();
          zone = 'forbidden_content';
          continue;
        }
        if (key === 'tradeoffs') {
          flushActor();
          flushTradeoff();
          zone = 'tradeoffs';
          continue;
        }
        if (key === 'seed') {
          flushActor();
          flushTradeoff();
          zone = 'seed';
          seed = seed || { summary: stripYamlScalar(line.slice(line.indexOf(':') + 1)) || undefined };
          continue;
        }
        if (
          ['workflows', 'flows', 'screens', 'scenarios', 'checklist', 'findings', 'evidence'].includes(
            key,
          )
        ) {
          flushDep();
          flushEntity();
          flushInvariant();
          flushActor();
          flushTradeoff();
          zone = 'other';
          domainSub = '';
          continue;
        }
        if (zone === 'domain' && !/^\s/.test(line)) {
          // leaving domain for another top-level
          flushDep();
          flushEntity();
          flushInvariant();
          zone = 'other';
          domainSub = '';
        }
      }
    }

    if (zone === 'domain') {
      if (/^\s{2}entities:\s*$/.test(line)) {
        flushDep();
        flushInvariant();
        domainSub = 'entities';
        continue;
      }
      if (/^\s{2}invariants:\s*$/.test(line)) {
        flushDep();
        flushEntity();
        domainSub = 'invariants';
        continue;
      }
      if (/^\s{2}dependencies:\s*$/.test(line)) {
        flushEntity();
        flushInvariant();
        domainSub = 'dependencies';
        continue;
      }

      if (domainSub === 'entities') {
        const item = line.match(/^\s{4}-\s+id:\s*(.+)$/);
        if (item) {
          flushEntity();
          currentEntity = { id: stripYamlScalar(item[1]) };
          continue;
        }
      }

      if (domainSub === 'invariants') {
        const item = line.match(/^\s{4}-\s+id:\s*(.+)$/);
        if (item) {
          flushInvariant();
          currentInvariant = { id: stripYamlScalar(item[1]) };
          continue;
        }
        if (currentInvariant) {
          const rule = line.match(/^\s{6}rule:\s*(.+)$/);
          if (rule) currentInvariant.rule = stripYamlScalar(rule[1]);
        }
      }

      if (domainSub === 'dependencies') {
        const item = line.match(/^\s{4}-\s+id:\s*(.+)$/);
        if (item) {
          flushDep();
          currentDep = { id: stripYamlScalar(item[1]) };
          continue;
        }
        if (!currentDep) continue;

        if (/^\s{6}degraded_surfaces:\s*$/.test(line)) {
          inDepSurfaces = true;
          currentDep.degraded_surfaces = [];
          continue;
        }
        if (inDepSurfaces) {
          const listItem = line.match(/^\s{8}-\s+(.+)$/);
          if (listItem) {
            /** @type {string[]} */ (currentDep.degraded_surfaces).push(
              stripYamlScalar(listItem[1]),
            );
            continue;
          }
          if (/^\s{6}\w+:/.test(line)) inDepSurfaces = false;
          else if (!/^\s{8}/.test(line)) inDepSurfaces = false;
        }

        const inlineSurfaces = line.match(/^\s{6}degraded_surfaces:\s*\[(.*)\]\s*$/);
        if (inlineSurfaces) {
          currentDep.degraded_surfaces = parseInlineArray(inlineSurfaces[1]);
          continue;
        }

        const kv = line.match(/^\s{6}(\w+):\s*(.*)$/);
        if (kv) {
          const val = stripYamlScalar(kv[2]);
          if (val !== undefined) currentDep[kv[1]] = val;
        }
      }
      continue;
    }

    if (zone === 'actors') {
      const item = line.match(/^\s{2}-\s+id:\s*(.+)$/);
      if (item) {
        flushActor();
        currentActor = { id: stripYamlScalar(item[1]) };
        continue;
      }
      if (!currentActor) continue;

      const permsInline = line.match(/^\s{4}permissions:\s*\[(.*)\]\s*$/);
      if (permsInline) {
        currentActor.permissions = parseInlineArray(permsInline[1]);
        continue;
      }
      if (/^\s{4}permissions:\s*$/.test(line)) {
        inActorPerms = true;
        currentActor.permissions = [];
        continue;
      }
      if (inActorPerms) {
        const p = line.match(/^\s{6}-\s+(.+)$/);
        if (p) {
          /** @type {string[]} */ (currentActor.permissions).push(stripYamlScalar(p[1]));
          continue;
        }
        inActorPerms = false;
      }

      if (/^\s{4}resource_filters:\s*$/.test(line)) {
        inActorFilters = true;
        currentActor.resource_filters = [];
        continue;
      }
      if (inActorFilters) {
        const fItem = line.match(/^\s{6}-\s+resource:\s*(.+)$/);
        if (fItem) {
          /** @type {Record<string, unknown>[]} */ (currentActor.resource_filters).push({
            resource: stripYamlScalar(fItem[1]),
          });
          continue;
        }
        const filters = /** @type {Record<string, unknown>[]} */ (
          currentActor.resource_filters ?? []
        );
        const cur = filters[filters.length - 1];
        const filterKv = line.match(/^\s{8}filter:\s*(.+)$/);
        if (cur && filterKv) {
          cur.filter = stripYamlScalar(filterKv[1]);
          continue;
        }
        if (/^\s{4}\w+:/.test(line)) inActorFilters = false;
      }

      const kv = line.match(/^\s{4}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val !== undefined) currentActor[kv[1]] = val;
      }
      continue;
    }

    if (zone === 'out_of_scope') {
      const item = line.match(/^\s{2}-\s+(.+)$/);
      if (item) out_of_scope.push(stripYamlScalar(item[1]));
      continue;
    }

    if (zone === 'forbidden_content') {
      const item = line.match(/^\s{2}-\s+(.+)$/);
      if (item) forbidden_content.push(stripYamlScalar(item[1]));
      continue;
    }

    if (zone === 'tradeoffs') {
      const item = line.match(/^\s{2}-\s+id:\s*(.+)$/);
      if (item) {
        flushTradeoff();
        currentTradeoff = { id: stripYamlScalar(item[1]) };
        continue;
      }
      if (!currentTradeoff) continue;
      const surfaces = line.match(/^\s{4}surfaces:\s*\[(.*)\]\s*$/);
      if (surfaces) {
        currentTradeoff.surfaces = parseInlineArray(surfaces[1]);
        continue;
      }
      const kv = line.match(/^\s{4}(\w+):\s*(.*)$/);
      if (kv) {
        const val = stripYamlScalar(kv[2]);
        if (val) currentTradeoff[kv[1]] = val;
      }
      continue;
    }

    if (zone === 'seed') {
      const summary = line.match(/^\s{2}summary:\s*(.+)$/);
      if (summary) {
        seed = { ...(seed || {}), summary: stripYamlScalar(summary[1]) };
        continue;
      }
      const item = line.match(/^\s{2}-\s+(.+)$/);
      if (item) {
        seed = seed || {};
        if (!seed.fixtures) seed.fixtures = [];
        /** @type {string[]} */ (seed.fixtures).push(stripYamlScalar(item[1]));
      }
    }
  }

  flushDep();
  flushEntity();
  flushInvariant();
  flushActor();
  flushTradeoff();

  return {
    domain: { entities, invariants, dependencies },
    actors,
    out_of_scope,
    forbidden_content,
    tradeoffs,
    seed,
    freestyle,
  };
}
