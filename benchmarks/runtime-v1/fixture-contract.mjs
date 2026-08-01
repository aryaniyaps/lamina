import {
  FIXTURE_SCHEMA, LIFECYCLE_PHASES, WARM_MEASURED_PHASES,
} from './constants.mjs';

const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && same(Object.keys(value).sort(), [...keys].sort());
const nonNegativeInteger = (value) => Number.isSafeInteger(value) && value >= 0;

export function validateFixtureRecord(record, {
  mode,
  warmups = 0,
  warmSamples = 1,
  childProcesses = 1,
  fixtureMetadata = null,
} = {}) {
  const errors = [];
  const recordKeys = [
    'schema', 'mode', 'fixture_metadata', 'phase_order', 'observations', 'lifecycle_outer_phase_time_ns',
    'persistent_state_reused', 'persistent_state_identity', 'child_processes', 'state_removed',
  ];
  if (!exactKeys(record, recordKeys)) errors.push('fixture record has unknown or missing fields');
  if (record?.schema !== FIXTURE_SCHEMA || record?.mode !== mode) errors.push('fixture schema or mode is invalid');
  if (!same(record?.phase_order, LIFECYCLE_PHASES)) errors.push('fixture phase order is invalid');
  if (record?.state_removed !== true || record?.child_processes !== childProcesses) {
    errors.push('fixture cleanup or child-process count is invalid');
  }
  if (!fixtureMetadata || !same(record?.fixture_metadata, fixtureMetadata)) {
    errors.push('fixture metadata contradicts the bounded fixture source');
  }
  const observations = Array.isArray(record?.observations) ? record.observations : [];
  const outer = Array.isArray(record?.lifecycle_outer_phase_time_ns)
    ? record.lifecycle_outer_phase_time_ns : [];
  const warmIndexes = new Set(WARM_MEASURED_PHASES.map((name) => LIFECYCLE_PHASES.indexOf(name)));
  const observationShape = (sample, expectedClassification, expectedIndex, warm) => {
    if (!exactKeys(sample, ['index', 'classification', 'wall_time_ns', 'phase_time_ns'])
      || sample.index !== expectedIndex || sample.classification !== expectedClassification
      || !nonNegativeInteger(sample.wall_time_ns)
      || !Array.isArray(sample.phase_time_ns) || sample.phase_time_ns.length !== LIFECYCLE_PHASES.length
      || sample.phase_time_ns.some((value, index) => warm
        ? (warmIndexes.has(index) ? !nonNegativeInteger(value) : value !== null)
        : !nonNegativeInteger(value))) {
      return false;
    }
    return true;
  };
  if (mode === 'cold') {
    if (warmups !== 0 || warmSamples !== 1 || observations.length !== 1
      || !observationShape(observations[0], 'cold', 0, false)
      || outer.length !== LIFECYCLE_PHASES.length || outer.some((value) => value !== null)
      || record?.persistent_state_reused !== false || record?.persistent_state_identity !== null) {
      errors.push('cold fixture evidence is not one complete isolated lifecycle');
    }
  } else if (mode === 'warm') {
    const identity = record?.persistent_state_identity;
    const identityValid = exactKeys(identity, ['dev', 'ino'])
      && /^[0-9]+$/.test(identity.dev) && /^[0-9]+$/.test(identity.ino);
    const observationsValid = observations.length === warmups + warmSamples
      && observations.every((sample, index) => index < warmups
        ? observationShape(sample, 'warmup', index, true)
        : observationShape(sample, 'measured_warm', index - warmups, true));
    if (!observationsValid
      || outer.length !== LIFECYCLE_PHASES.length
      || outer.some((value, index) => warmIndexes.has(index) ? value !== null : !nonNegativeInteger(value))
      || record?.persistent_state_reused !== true || !identityValid) {
      errors.push('warm fixture evidence does not prove exact persistent-state reuse');
    }
  } else {
    errors.push('fixture mode must be cold or warm');
  }
  return { valid: errors.length === 0, errors };
}

export function assertValidFixtureRecord(record, options) {
  const validation = validateFixtureRecord(record, options);
  if (!validation.valid) throw new Error(`fixture record is invalid: ${validation.errors.join('; ')}`);
  return record;
}
