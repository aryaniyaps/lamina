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

/**
 * @param {string} source
 */
export function parseSimulationYaml(source) {
  /** @type {Array<{ persona_id: string; outcome: string; blockers: Array<{ step: string; severity: string; quote: string; screenId?: string; flowId?: string }> }>} */
  const results = [];
  let current = null;
  let inBlockers = false;

  for (const line of source.split('\n')) {
    const resultItem = line.match(/^\s*-\s+persona_id:\s*(.+)$/);
    if (resultItem) {
      if (current) results.push(current);
      current = {
        persona_id: stripYamlScalar(resultItem[1]),
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
          continue;
        }
        const screenId = line.match(/^\s{6,}screen_id:\s*(.+)$/);
        if (screenId) {
          last.screenId = stripYamlScalar(screenId[1]);
          continue;
        }
        const screenIdCamel = line.match(/^\s{6,}screenId:\s*(.+)$/);
        if (screenIdCamel) {
          last.screenId = stripYamlScalar(screenIdCamel[1]);
          continue;
        }
        const flowId = line.match(/^\s{6,}flow_id:\s*(.+)$/);
        if (flowId) {
          last.flowId = stripYamlScalar(flowId[1]);
          continue;
        }
        const flowIdCamel = line.match(/^\s{6,}flowId:\s*(.+)$/);
        if (flowIdCamel) {
          last.flowId = stripYamlScalar(flowIdCamel[1]);
        }
      }
    }
  }

  if (current) results.push(current);
  return results;
}
