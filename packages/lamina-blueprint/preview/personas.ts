import fs from 'node:fs';
import path from 'node:path';

export interface PersonaBlocker {
  step: string;
  severity: string;
  quote: string;
  screenId?: string;
}

export interface PersonaSimulation {
  outcome: 'success' | 'partial_fail' | 'abandon';
  blockers: PersonaBlocker[];
}

export interface PersonaEntry {
  id: string;
  displayName: string;
  type: string;
  flow?: string;
  goals: { experience: string[]; end: string[] };
  frustrations: string[];
  simulation?: PersonaSimulation;
}

export interface PersonaPreviewData {
  primary: string | null;
  personas: PersonaEntry[];
}

function stripYamlScalar(raw: string): string | undefined {
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

export function personaDisplayName(id: string): string {
  const slug = id.split('-').pop() ?? id;
  return slug.charAt(0).toUpperCase() + slug.slice(1);
}

function parseInlineStringArray(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('[')) return [];
  try {
    const parsed = JSON.parse(trimmed.replace(/'/g, '"')) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is string => typeof v === 'string');
  } catch {
    const inner = trimmed.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map((s) => stripYamlScalar(s.trim()) ?? '').filter(Boolean);
  }
}

function parseStringListItem(line: string): string | undefined {
  const m = line.match(/^\s+-\s+(.+)$/);
  if (!m) return undefined;
  return stripYamlScalar(m[1]);
}

interface RawPersona {
  id: string;
  type: string;
  flow?: string;
  goals: { experience: string[]; end: string[] };
  frustrations: string[];
}

export function parsePersonasYaml(source: string): { primary: string | null; personas: RawPersona[] } {
  let primary: string | null = null;
  const personas: RawPersona[] = [];
  let current: RawPersona | null = null;
  let goalsSection: 'experience' | 'end' | null = null;
  let listKey: 'frustrations' | null = null;

  for (const line of source.split('\n')) {
    const primaryMatch = line.match(/^primary:\s*(.+)$/);
    if (primaryMatch) {
      primary = stripYamlScalar(primaryMatch[1]) ?? null;
      continue;
    }

    const item = line.match(/^\s*-\s+id:\s*(.+)$/);
    if (item) {
      if (current) personas.push(current);
      current = {
        id: stripYamlScalar(item[1])!,
        type: '',
        goals: { experience: [], end: [] },
        frustrations: [],
      };
      goalsSection = null;
      listKey = null;
      continue;
    }

    if (!current) continue;

    const goalsOpen = line.match(/^\s{2,}goals:\s*$/);
    if (goalsOpen) {
      goalsSection = null;
      listKey = null;
      continue;
    }

    const goalInline = line.match(/^\s{4,}(experience|end):\s*(.+)$/);
    if (goalInline && current) {
      current.goals[goalInline[1] as 'experience' | 'end'] = parseInlineStringArray(goalInline[2]);
      continue;
    }

    const goalSection = line.match(/^\s{4,}(experience|end):\s*$/);
    if (goalSection) {
      goalsSection = goalSection[1] as 'experience' | 'end';
      listKey = null;
      continue;
    }

    if (goalsSection) {
      const val = parseStringListItem(line);
      if (val) {
        current.goals[goalsSection].push(val);
        continue;
      }
    }

    const frustrationsOpen = line.match(/^\s{2,}frustrations:\s*$/);
    if (frustrationsOpen) {
      listKey = 'frustrations';
      goalsSection = null;
      continue;
    }

    const frustrationsInline = line.match(/^\s{2,}frustrations:\s*(.+)$/);
    if (frustrationsInline && current) {
      current.frustrations = parseInlineStringArray(frustrationsInline[1]);
      continue;
    }

    if (listKey === 'frustrations') {
      const val = parseStringListItem(line);
      if (val) {
        current.frustrations.push(val);
        continue;
      }
      if (line.trim() && !line.match(/^\s+-/)) listKey = null;
    }

    const kv = line.match(/^\s{2,}(\w+):\s*(.*)$/);
    if (kv) {
      const val = stripYamlScalar(kv[2]);
      if (!val) continue;
      if (kv[1] === 'type') current.type = val;
      if (kv[1] === 'flow') current.flow = val;
      listKey = null;
      goalsSection = null;
    }
  }

  if (current) personas.push(current);
  return { primary, personas };
}

interface SimulationResult {
  persona_id: string;
  outcome: PersonaSimulation['outcome'];
  blockers: PersonaBlocker[];
}

export function parseSimulationYaml(source: string): SimulationResult[] {
  const results: SimulationResult[] = [];
  let current: SimulationResult | null = null;
  let inBlockers = false;

  for (const line of source.split('\n')) {
    const resultItem = line.match(/^\s*-\s+persona_id:\s*(.+)$/);
    if (resultItem) {
      if (current) results.push(current);
      current = {
        persona_id: stripYamlScalar(resultItem[1])!,
        outcome: 'success',
        blockers: [],
      };
      inBlockers = false;
      continue;
    }

    if (!current) continue;

    const outcome = line.match(/^\s{2,}outcome:\s*(.+)$/);
    if (outcome) {
      const val = stripYamlScalar(outcome[1]);
      if (val === 'success' || val === 'partial_fail' || val === 'abandon') {
        current.outcome = val;
      }
      continue;
    }

    const blockersOpen = line.match(/^\s{2,}blockers:\s*$/);
    if (blockersOpen) {
      inBlockers = true;
      continue;
    }

    if (inBlockers) {
      const blockerItem = line.match(/^\s{4,}-\s+step:\s*(.+)$/);
      if (blockerItem) {
        current.blockers.push({
          step: stripYamlScalar(blockerItem[1]) ?? '',
          severity: 'medium',
          quote: '',
        });
        continue;
      }
      const step = line.match(/^\s{6,}step:\s*(.+)$/);
      if (step) {
        current.blockers.push({
          step: stripYamlScalar(step[1]) ?? '',
          severity: 'medium',
          quote: '',
        });
        continue;
      }
      const last = current.blockers[current.blockers.length - 1];
      if (last) {
        const severity = line.match(/^\s{6,}severity:\s*(.+)$/);
        if (severity) {
          last.severity = stripYamlScalar(severity[1]) ?? 'medium';
          continue;
        }
        const quote = line.match(/^\s{6,}quote:\s*(.+)$/);
        if (quote) {
          last.quote = stripYamlScalar(quote[1]) ?? '';
        }
      }
    }
  }

  if (current) results.push(current);
  return results;
}

function listSimulationFiles(simulationsDir: string): string[] {
  if (!fs.existsSync(simulationsDir)) return [];
  return fs
    .readdirSync(simulationsDir)
    .filter((f) => f.endsWith('.yaml') || f.endsWith('.yml'))
    .map((f) => path.join(simulationsDir, f))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
}

function loadLatestSimulations(simulationsDir: string): Map<string, PersonaSimulation> {
  const byPersona = new Map<string, PersonaSimulation>();
  for (const file of listSimulationFiles(simulationsDir)) {
    const results = parseSimulationYaml(fs.readFileSync(file, 'utf8'));
    for (const r of results) {
      if (!byPersona.has(r.persona_id)) {
        byPersona.set(r.persona_id, {
          outcome: r.outcome,
          blockers: r.blockers,
        });
      }
    }
  }
  return byPersona;
}

export function attachScreenIds(blockers: PersonaBlocker[], screenIds: string[]): PersonaBlocker[] {
  const ids = new Set(screenIds);
  return blockers.map((b) => ({
    ...b,
    screenId: ids.has(b.step) ? b.step : undefined,
  }));
}

export function loadPersonas(
  blueprintRoot: string,
  screenIds: string[] = [],
): PersonaPreviewData | null {
  const laminaRoot = path.resolve(blueprintRoot, '..');
  const personasFile = path.join(laminaRoot, 'personas.yaml');
  if (!fs.existsSync(personasFile)) return null;

  const { primary, personas: raw } = parsePersonasYaml(fs.readFileSync(personasFile, 'utf8'));
  const simulations = loadLatestSimulations(path.join(laminaRoot, 'personas', 'simulations'));

  const personas: PersonaEntry[] = raw.map((p) => {
    const sim = simulations.get(p.id);
    return {
      id: p.id,
      displayName: personaDisplayName(p.id),
      type: p.type,
      flow: p.flow,
      goals: p.goals,
      frustrations: p.frustrations,
      simulation: sim
        ? {
            outcome: sim.outcome,
            blockers: attachScreenIds(sim.blockers, screenIds),
          }
        : undefined,
    };
  });

  return { primary, personas };
}

export function blockersForScreen(
  simulation: PersonaSimulation | undefined,
  screenId: string,
): PersonaBlocker[] {
  if (!simulation) return [];
  return simulation.blockers.filter((b) => b.screenId === screenId);
}

export function blockerScreens(simulation: PersonaSimulation | undefined): Set<string> {
  const screens = new Set<string>();
  if (!simulation) return screens;
  for (const b of simulation.blockers) {
    if (b.screenId) screens.add(b.screenId);
  }
  return screens;
}
