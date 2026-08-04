import {
  fixturesForProfile,
  INDEX_SCHEMA,
  loadManifest,
  MANIFEST_SCHEMA,
  profileById,
  QUALIFICATION_SCHEMA,
} from './contract.mjs';

const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export function validateQualificationIndex(index) {
  const errors = [];
  const { manifest } = loadManifest();
  if (!exactKeys(index, [
    'schema', 'generated_at', 'lamina_commit', 'manifest_digest', 'baseline_manifest_digest',
    'host', 'profile', 'mode', 'cells', 'oracle_results', 'deferred', 'install_footprint',
  ]) || index.schema !== INDEX_SCHEMA) {
    errors.push('qualification index has an invalid top-level shape');
  }
  if (!profileById(index.profile)) errors.push('qualification profile is unknown');
  if (!['presubmit', 'full'].includes(index.mode)) errors.push('qualification mode is invalid');

  for (const cell of index.cells || []) {
    if (!fixturesForProfile(index.profile).includes(cell.fixture)) {
      errors.push(`cell fixture ${cell.fixture} is outside profile ${index.profile}`);
    }
    if (!Array.isArray(cell.scenario_results)) {
      errors.push(`cell ${cell.fixture} lacks scenario_results`);
    }
  }

  const oracleIds = new Set(manifest.oracle_suites.map((suite) => suite.id));
  for (const result of index.oracle_results || []) {
    if (!oracleIds.has(result.id)) errors.push(`unknown oracle suite ${result.id}`);
    if (!result.skipped && typeof result.exit_code !== 'number') {
      errors.push(`oracle suite ${result.id} lacks exit_code`);
    }
  }

  if (index.install_footprint
    && index.install_footprint.schema !== 'lamina.linux-install-footprint/v1') {
    errors.push('install footprint schema is invalid');
  }

  return { valid: errors.length === 0, errors };
}

export function validateQualificationResult(result) {
  const errors = [];
  if (!exactKeys(result, ['schema', 'generated_at', 'index', 'evaluation'])
    || result.schema !== QUALIFICATION_SCHEMA) {
    errors.push('qualification result has an invalid top-level shape');
  }
  const indexValidation = validateQualificationIndex(result.index);
  errors.push(...indexValidation.errors);
  if (!result.evaluation?.summary || typeof result.evaluation.summary.overall_pass !== 'boolean') {
    errors.push('qualification evaluation summary is incomplete');
  }
  return { valid: errors.length === 0, errors };
}

export function validateManifestFile(manifest) {
  const errors = [];
  if (manifest.schema !== MANIFEST_SCHEMA || manifest.version !== 1) {
    errors.push('manifest schema/version is invalid');
  }
  if (!Array.isArray(manifest.profiles) || manifest.profiles.length !== 2) {
    errors.push('manifest profiles are invalid');
  }
  if (!Array.isArray(manifest.scenario_coverage) || manifest.scenario_coverage.length < 10) {
    errors.push('manifest scenario coverage is incomplete');
  }
  return { valid: errors.length === 0, errors };
}
