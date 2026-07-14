/**
 * First-class reachability graph for run.yaml `domain.dependencies[]`.
 *
 * Kate rule: if A depends on B and B is unmet, A must be unreachable, degraded,
 * blocked in UI, or recover — never a silent happy path.
 */

/** @typedef {'unreachable' | 'degraded' | 'blocked_ui' | 'recover'} DependencyMode */

/** @typedef {{
 *   id: string;
 *   from?: string;
 *   requires?: string;
 *   in_state?: string;
 *   mode?: string;
 *   failure?: string;
 *   degraded_surfaces?: string[];
 *   recovery?: string;
 *   scenario_ref?: string;
 *   na?: string;
 * }} DependencyEdge */

export const DEPENDENCY_MODES = new Set([
  'unreachable',
  'degraded',
  'blocked_ui',
  'recover',
]);

/** Legacy `failure` values accepted as aliases for `mode`. */
export const FAILURE_ALIASES = {
  unreachable: 'unreachable',
  blocked_ui: 'blocked_ui',
  recover: 'recover',
  degraded: 'degraded',
};

/**
 * Resolve effective mode from `mode` or legacy `failure`.
 * @param {DependencyEdge} edge
 * @returns {string | undefined}
 */
export function resolveDependencyMode(edge) {
  const raw = edge.mode || edge.failure;
  if (!raw) return undefined;
  return FAILURE_ALIASES[raw] || raw;
}

/**
 * Parse `workflow.foo` / `entity.bar` / `actor.baz` / `screen.qux` refs.
 * @param {string} ref
 * @returns {{ kind: string; id: string } | null}
 */
export function parseContractRef(ref) {
  if (!ref || typeof ref !== 'string') return null;
  const m = ref.trim().match(/^(workflow|entity|actor|screen)\.([A-Za-z0-9_-]+)$/);
  if (!m) return null;
  return { kind: m[1], id: m[2] };
}

/**
 * @param {DependencyEdge} edge
 * @param {string} [rel]
 * @returns {string[]}
 */
export function validateDependencyEdgeFields(edge, rel = 'run.yaml') {
  /** @type {string[]} */
  const errors = [];
  const label = edge.id ? `"${edge.id}"` : '(missing id)';

  if (!edge.id) errors.push(`${rel}: dependency missing id`);
  if (!edge.from) errors.push(`${rel}: dependency ${label} missing from`);
  if (!edge.requires) errors.push(`${rel}: dependency ${label} missing requires`);

  const mode = resolveDependencyMode(edge);
  if (!mode) {
    errors.push(
      `${rel}: dependency ${label} missing mode (or legacy failure): expected ${[...DEPENDENCY_MODES].join('|')}`,
    );
  } else if (!DEPENDENCY_MODES.has(mode)) {
    errors.push(
      `${rel}: dependency ${label} invalid mode "${mode}" (expected: ${[...DEPENDENCY_MODES].join(', ')})`,
    );
  }

  if (mode === 'degraded') {
    const surfaces = edge.degraded_surfaces ?? [];
    if (!surfaces.length) {
      errors.push(
        `${rel}: dependency ${label} mode=degraded requires degraded_surfaces[] (screens still available)`,
      );
    }
  }

  if (mode === 'recover' || mode === 'blocked_ui') {
    if (!edge.recovery) {
      errors.push(
        `${rel}: dependency ${label} mode=${mode} requires recovery (workflow.<id> or screen.<id>)`,
      );
    }
  }

  if (edge.from && !parseContractRef(edge.from)) {
    errors.push(
      `${rel}: dependency ${label} from must be workflow.<id> or entity.<id> (got "${edge.from}")`,
    );
  }
  if (edge.requires && !parseContractRef(edge.requires)) {
    errors.push(
      `${rel}: dependency ${label} requires must be entity.<id>, workflow.<id>, or actor.<id> (got "${edge.requires}")`,
    );
  }
  if (edge.recovery) {
    const rec = parseContractRef(edge.recovery);
    if (!rec || (rec.kind !== 'workflow' && rec.kind !== 'screen')) {
      errors.push(
        `${rel}: dependency ${label} recovery must be workflow.<id> or screen.<id> (got "${edge.recovery}")`,
      );
    }
  }

  return errors;
}

/**
 * Graph integrity against workflows, entities, screens, scenarios.
 * @param {Record<string, unknown>} run
 * @param {string} [rel]
 * @returns {string[]}
 */
export function validateDependencyGraph(run, rel = 'run.yaml') {
  /** @type {string[]} */
  const errors = [];
  const domain = /** @type {Record<string, unknown>} */ (run.domain ?? {});
  const deps = /** @type {DependencyEdge[]} */ (domain.dependencies ?? []);
  const workflows = /** @type {Record<string, unknown>[]} */ (run.workflows ?? []);
  const screens = /** @type {{ id?: string }[]} */ (run.screens ?? []);
  const scenarios = /** @type {{ id?: string; dependency_ref?: string; trigger?: { when?: string } }[]} */ (
    run.scenarios ?? []
  );
  const entities = /** @type {{ id?: string }[]} */ (domain.entities ?? []);
  const actors = /** @type {{ id?: string }[]} */ (run.actors ?? []);

  const workflowIds = new Set(workflows.map((w) => String(w.id)).filter(Boolean));
  const entityIds = new Set(entities.map((e) => String(e.id)).filter(Boolean));
  const actorIds = new Set(actors.map((a) => String(a.id)).filter(Boolean));
  const screenIds = new Set(screens.map((s) => String(s.id)).filter(Boolean));
  const depIds = new Set();

  for (const edge of deps) {
    errors.push(...validateDependencyEdgeFields(edge, rel));
    if (edge.id) {
      if (depIds.has(edge.id)) {
        errors.push(`${rel}: duplicate dependency id "${edge.id}"`);
      }
      depIds.add(edge.id);
    }

    const from = parseContractRef(edge.from || '');
    if (from?.kind === 'workflow' && workflowIds.size && !workflowIds.has(from.id)) {
      errors.push(`${rel}: dependency "${edge.id}" from unknown workflow.${from.id}`);
    }
    if (from?.kind === 'entity' && entityIds.size && !entityIds.has(from.id)) {
      errors.push(`${rel}: dependency "${edge.id}" from unknown entity.${from.id}`);
    }

    const req = parseContractRef(edge.requires || '');
    if (req?.kind === 'entity' && entityIds.size && !entityIds.has(req.id)) {
      errors.push(`${rel}: dependency "${edge.id}" requires unknown entity.${req.id}`);
    }
    if (req?.kind === 'workflow' && workflowIds.size && !workflowIds.has(req.id)) {
      errors.push(`${rel}: dependency "${edge.id}" requires unknown workflow.${req.id}`);
    }
    if (req?.kind === 'actor' && actorIds.size && !actorIds.has(req.id)) {
      errors.push(`${rel}: dependency "${edge.id}" requires unknown actor.${req.id}`);
    }

    for (const sid of edge.degraded_surfaces ?? []) {
      if (screenIds.size && !screenIds.has(sid) && !sid.startsWith('screen.')) {
        // allow screen.foo or bare id
        const bare = sid.replace(/^screen\./, '');
        if (!screenIds.has(bare) && !screenIds.has(sid)) {
          errors.push(
            `${rel}: dependency "${edge.id}" degraded_surfaces unknown screen "${sid}"`,
          );
        }
      } else if (sid.startsWith('screen.')) {
        const bare = sid.slice('screen.'.length);
        if (screenIds.size && !screenIds.has(bare)) {
          errors.push(
            `${rel}: dependency "${edge.id}" degraded_surfaces unknown screen "${sid}"`,
          );
        }
      }
    }

    const recovery = parseContractRef(edge.recovery || '');
    if (recovery?.kind === 'workflow' && workflowIds.size && !workflowIds.has(recovery.id)) {
      errors.push(`${rel}: dependency "${edge.id}" recovery unknown workflow.${recovery.id}`);
    }
    if (recovery?.kind === 'screen' && screenIds.size && !screenIds.has(recovery.id)) {
      errors.push(`${rel}: dependency "${edge.id}" recovery unknown screen.${recovery.id}`);
    }
  }

  // workflows[].requires must resolve
  for (const wf of workflows) {
    const reqs = /** @type {string[]} */ (wf.requires ?? []);
    for (const rid of reqs) {
      if (deps.length && !depIds.has(rid)) {
        errors.push(
          `${rel}: workflow "${wf.id}" requires unknown dependency id "${rid}"`,
        );
      }
    }
    if (Object.prototype.hasOwnProperty.call(wf, 'preconditions')) {
      errors.push(
        `${rel}: workflow "${wf.id}" has free-text preconditions — use domain.dependencies[] + requires`,
      );
    }
  }

  // Every dependency must be referenced by a workflow.requires OR have scenario coverage
  if (workflows.length) {
    for (const edge of deps) {
      if (!edge.id) continue;
      const referenced = workflows.some((w) =>
        (/** @type {string[]} */ (w.requires ?? [])).includes(edge.id),
      );
      if (!referenced && edge.na !== 'orphan') {
        errors.push(
          `${rel}: dependency "${edge.id}" is orphan — reference it from workflows[].requires (or set na: orphan with rationale in report)`,
        );
      }
    }
  }

  // Scenario coverage for unmet deps (strict when scenarios exist or status ready_to_build)
  const status = String(run.status || '');
  const requireScenarioCoverage =
    status === 'ready_to_build' || status === 'verifying' || status === 'complete';

  if (requireScenarioCoverage) {
    for (const edge of deps) {
      if (!edge.id || edge.na === 'true' || edge.na === 'explicit') continue;
      const linked = scenarios.filter((s) => s.dependency_ref === edge.id);
      if (edge.scenario_ref) {
        const byId = scenarios.find((s) => s.id === edge.scenario_ref);
        if (!byId) {
          errors.push(
            `${rel}: dependency "${edge.id}" scenario_ref "${edge.scenario_ref}" not found in scenarios[]`,
          );
        }
      }
      if (!linked.length && !edge.scenario_ref) {
        errors.push(
          `${rel}: dependency "${edge.id}" missing scenarios[] with dependency_ref (and trigger.when: dependency_unmet)`,
        );
      } else {
        const unmet = linked.some((s) => s.trigger?.when === 'dependency_unmet');
        const viaRef = edge.scenario_ref
          ? scenarios.find((s) => s.id === edge.scenario_ref)
          : null;
        const viaRefOk = viaRef?.trigger?.when === 'dependency_unmet';
        if (!unmet && !viaRefOk && linked.length) {
          errors.push(
            `${rel}: dependency "${edge.id}" linked scenario must use trigger.when: dependency_unmet`,
          );
        }
      }
    }
  }

  // Mutating / non-standalone workflows should declare requires when graph exists
  if (requireScenarioCoverage && deps.length) {
    for (const wf of workflows) {
      const reqs = /** @type {string[]} */ (wf.requires ?? []);
      const standalone = wf.standalone === true || wf.standalone === 'true';
      if (!standalone && !reqs.length) {
        errors.push(
          `${rel}: workflow "${wf.id}" has empty requires — set requires: [dep ids] or standalone: true for root setup flows`,
        );
      }
    }
  }

  return errors;
}

/**
 * Topological build hints: workflows that provide entities before dependents.
 * @param {Record<string, unknown>} run
 * @returns {string[]} workflow ids in suggested build order (best-effort)
 */
export function buildOrderFromDependencies(run) {
  const workflows = /** @type {Record<string, unknown>[]} */ (run.workflows ?? []);
  const domain = /** @type {Record<string, unknown>} */ (run.domain ?? {});
  const deps = /** @type {DependencyEdge[]} */ (domain.dependencies ?? []);

  /** @type {Map<string, Set<string>>} */
  const blockers = new Map();
  for (const wf of workflows) {
    blockers.set(String(wf.id), new Set());
  }

  for (const edge of deps) {
    const from = parseContractRef(edge.from || '');
    const req = parseContractRef(edge.requires || '');
    if (from?.kind !== 'workflow') continue;
    if (req?.kind === 'workflow') {
      blockers.get(from.id)?.add(req.id);
    }
    // entity deps: prefer workflows that list provides: [entity.x]
    if (req?.kind === 'entity') {
      for (const wf of workflows) {
        const provides = /** @type {string[]} */ (wf.provides ?? []);
        if (provides.includes(`entity.${req.id}`) || provides.includes(req.id)) {
          blockers.get(from.id)?.add(String(wf.id));
        }
      }
    }
  }

  /** @type {string[]} */
  const ordered = [];
  const remaining = new Set(workflows.map((w) => String(w.id)));
  while (remaining.size) {
    let progressed = false;
    for (const id of [...remaining]) {
      const depsOn = [...(blockers.get(id) ?? [])].filter((d) => remaining.has(d));
      if (!depsOn.length) {
        ordered.push(id);
        remaining.delete(id);
        progressed = true;
      }
    }
    if (!progressed) {
      // cycle — append rest
      ordered.push(...remaining);
      break;
    }
  }
  return ordered;
}
