import crypto from 'node:crypto';

const row = (id, workflowIds, surfaceIds, rationale, separateLexicalCategory = null) => ({
  id, workflow_ids: workflowIds, source_surface_ids: surfaceIds,
  separate_lexical_category: separateLexicalCategory, rationale,
});

const rows = [
  row('small.semantic.01-exact_source_identifier', ['small.route-completion'], ['small.surface.route-change-complete'],
    'The exact identifier is the route-completion Workflow trigger at its reviewed dashboard-layout surface.'),
  row('small.semantic.02-route', ['small.route-completion'], ['small.surface.route-change-complete'],
    'The route-completion surface is Workflow-relevant; the separately requested routes witness is independent lexical evidence and is not attached to that Workflow.', 'routes'),
  row('small.semantic.03-symbol', ['small.dashboard-navigation'], ['small.surface.side-navigation-item'],
    'The requested symbol is the reviewed side-navigation item contract used by Dashboard navigation.'),
  row('small.semantic.04-low_overlap_paraphrase', [], [],
    'The payroll-remittance request is intentionally absent from every public-seed Workflow and source surface.'),
  row('small.semantic.05-persona', [], [],
    'The modified-file adversary is unrelated to the product and must not inherit a Workflow or Persona source.'),
  row('small.semantic.06-permission', ['small.discussion-authorization'], ['small.surface.authorization-test'],
    'Permission semantics are tested by the dedicated Discussion authorization Workflow and its reviewed authorization test.'),
  row('small.semantic.07-role_boundary', ['small.discussion-authorization', 'small.dashboard-navigation'],
    ['small.surface.authorization-test', 'small.surface.side-navigation-item'],
    'A request to handle access to Discussions from the dashboard can mean authorization or navigation, so both exact Workflow-contract alternatives remain unselected.'),
  row('small.semantic.08-invariant', ['small.disclosure-state'], ['small.surface.use-disclosure'],
    'The open-or-closed invariant is defined by Disclosure state at the reviewed useDisclosure surface.'),
  row('small.semantic.09-failure_state', ['small.disclosure-state'], ['small.surface.use-disclosure'],
    'The missing-hook failure belongs to Disclosure state and is localized at its reviewed hook surface.'),
  row('small.semantic.10-entry_point', ['small.dashboard-navigation'], ['small.surface.side-navigation-item'],
    'The visible side-navigation item is the reviewed semantic entry surface for the Dashboard navigation Workflow.'),
  row('small.semantic.11-command', ['small.disclosure-state'], ['small.surface.use-disclosure'],
    'The disclosure operation supplies Workflow command semantics; the separately requested commands witness is independent lexical evidence, and the hook is not a package script.', 'commands'),
  row('small.semantic.12-transition', ['small.disclosure-state'], ['small.surface.use-disclosure'],
    'The closed-to-open transition is owned by Disclosure state and its reviewed hook.'),
  row('small.semantic.13-test', ['small.discussion-authorization'], ['small.surface.authorization-test'],
    'The test query ranks the dedicated authorization test that defines the Discussion authorization Workflow.'),
  row('small.semantic.14-dependency', ['small.dashboard-navigation', 'small.profile-entry'],
    ['small.surface.side-navigation-item', 'small.surface.entry-props'],
    'The linked-worktree dependency is explicitly between Dashboard navigation and Profile entry presentation, so each selected Workflow contributes its own reviewed surface.'),

  row('medium.semantic.01-exact_source_identifier', ['medium.api-key-actions'], ['medium.surface.api-key'],
    'The exact ApiKey identifier is the reviewed model reference that anchors API key actions.'),
  row('medium.semantic.02-handler', ['medium.menu-close-prevention'], ['medium.surface.prevent-close-handler'],
    'The requested handler is the prevent-close handler that owns the Menu close prevention Workflow.'),
  row('medium.semantic.03-entity', ['medium.api-key-actions'], ['medium.surface.api-key'],
    'The ApiKey entity is the reviewed entity contract used by API key actions.'),
  row('medium.semantic.04-low_overlap_paraphrase', [], [],
    'The payroll-remittance request is intentionally absent from every public-seed Workflow and source surface.'),
  row('medium.semantic.05-persona', [], [],
    'The modified-file adversary is unrelated to the product and must not inherit a Workflow or Persona source.'),
  row('medium.semantic.06-permission', ['medium.api-key-actions', 'medium.oidc-discovery-test'],
    ['medium.surface.api-key', 'medium.surface.oidc-body-type'],
    'A developer-authentication setup request can refer to API-key actions or OIDC discovery verification, so both actor-authority alternatives remain unselected.'),
  row('medium.semantic.07-invariant', ['medium.menu-close-prevention'], ['medium.surface.prevent-close-handler'],
    'The reviewed branch must preserve the prevent-close invariant at the Workflow handler that enforces it.'),
  row('medium.semantic.08-flag', ['medium.menu-close-prevention'], ['medium.surface.prevent-close-handler'],
    'Menu close prevention supplies the Workflow-relevant condition surface; a separately named feature-flag exemplar is requested only as independent lexical evidence.', 'feature_flags'),
  row('medium.semantic.09-schema_entity', ['medium.api-key-actions'], ['medium.surface.api-key'],
    'The reviewed ApiKey model reference is the schema/entity surface for API key actions.'),
  row('medium.semantic.10-event', ['medium.pwa-install-analytics'], ['medium.surface.appinstalled'],
    'The appinstalled event is the exact event that drives PWA install analytics.'),
  row('medium.semantic.11-test', ['medium.oidc-discovery-test'], ['medium.surface.oidc-body-type'],
    'The test query ranks oidcDiscovery.test.ts because that reviewed test defines OIDC discovery verification.'),
  row('medium.semantic.12-dependency', ['medium.developer-escape', 'medium.pwa-install-analytics'],
    ['medium.surface.developer-keydown', 'medium.surface.appinstalled'],
    'The linked-worktree dependency coordinates two event-driven Workflows and retains one reviewed source surface from each.'),
  row('medium.semantic.13-route', ['medium.oidc-discovery-test'], ['medium.surface.oidc-body-type'],
    'The OIDC response-contract test is Workflow-relevant; the separately requested routes witness is independent lexical evidence and is not attached to that Workflow.', 'routes'),
  row('medium.semantic.14-symbol', ['medium.developer-escape'], ['medium.surface.developer-keydown'],
    'The keydown symbol is the exact reviewed trigger surface for Developer escape handling.'),

  row('large.semantic.01-handler', ['large.authentication-error-family'], ['large.surface.auth-error-handler'],
    'The administrator authentication handler is the exact reviewed handler surface for the Authentication error family.'),
  row('large.semantic.02-entity', ['large.ai-configuration-form'], ['large.surface.ai-form-values'],
    'AIFormValues is the reviewed entity contract for the AI configuration form.'),
  row('large.semantic.03-role_boundary', ['large.ai-configuration-form', 'large.feature-preview-deployment'],
    ['large.surface.ai-form-values', 'large.surface.feature-preview-chart'],
    'An instance-feature preview request can mean AI configuration or preview deployment, which have distinct public-seed administrator and maintainer authority.'),
  row('large.semantic.04-docs_persona', ['large.decorated-controller-guidance'],
    ['large.surface.user-controller', 'large.surface.chat-controller'],
    'Both reviewed controller examples in packages/decorators/README.md define the maintainer guidance and its documentation Persona context.'),
  row('large.semantic.05-failure_state', [], [],
    'The rejected payroll-remittance failure is intentionally absent from every public-seed Workflow and source surface.'),
  row('large.semantic.06-entry_point', ['large.authentication-error-family'], ['large.surface.auth-error-handler'],
    'authErrorHandler is the reviewed semantic entry surface for handling the corresponding administrator authentication failure.'),
  row('large.semantic.07-command', ['large.feature-preview-deployment'], ['large.surface.feature-preview-chart'],
    'The Helm variable localizes the invocable Workflow but is not a repository command; the separately requested commands witness is independent lexical evidence.', 'commands'),
  row('large.semantic.08-transition', ['large.ai-configuration-form'], ['large.surface.ai-form-values'],
    'The hidden-to-visible configuration transition belongs to the AI form and its reviewed value contract.'),
  row('large.semantic.09-docs_persona', ['large.decorated-controller-guidance'], ['large.surface.user-controller'],
    'The maintainer Persona and documentation query belong to the reviewed decorated-controller README, not an unrelated API test README.'),
  row('large.semantic.10-flag', ['large.feature-preview-deployment'], ['large.surface.feature-preview-chart'],
    'The Helm variable is Workflow-relevant deployment configuration, not a literal flag; the separately requested feature-flags witness is independent lexical evidence.', 'feature_flags'),
  row('large.semantic.11-schema_entity', ['large.ai-configuration-form'], ['large.surface.ai-form-values'],
    'AIFormValues is the reviewed schema/entity contract for the AI configuration form.'),
  row('large.semantic.12-event', ['large.feature-preview-deployment'], ['large.surface.feature-preview-chart'],
    'The maintainer invocation supplies Workflow trigger semantics while the Helm variable only localizes it; the separate events witness is independent lexical evidence.', 'events'),
  row('large.semantic.13-persona', [], [],
    'The modified-file adversary is unrelated to the product and must not inherit a Workflow or Persona source.'),
  row('large.semantic.14-permission', ['large.ai-configuration-form', 'large.feature-preview-deployment'],
    ['large.surface.ai-form-values', 'large.surface.feature-preview-chart'],
    'The linked worktree coordinates two privileged public-seed Workflow contracts while preserving each actor-authority boundary.'),
];

const deepFreeze = (value) => {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    Object.values(value).forEach(deepFreeze);
  }
  return value;
};
const canonical = (value) => Array.isArray(value) ? value.map(canonical)
  : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value;
const digest = (value) => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const exactKeys = (value, keys) => value && typeof value === 'object' && !Array.isArray(value)
  && JSON.stringify(Object.keys(value).sort()) === JSON.stringify([...keys].sort());

export const INDEPENDENT_LEXICAL_WITNESS_AUTHORITY = deepFreeze({
  'small.semantic.02-route': 'routes',
  'small.semantic.11-command': 'commands',
  'medium.semantic.08-flag': 'feature_flags',
  'medium.semantic.13-route': 'routes',
  'large.semantic.07-command': 'commands',
  'large.semantic.10-flag': 'feature_flags',
  'large.semantic.12-event': 'events',
});

export const SEMANTIC_CASE_MAPPING = deepFreeze({
  schema: 'lamina.real-repository-oracle-semantic-case-mapping/v1', version: 1, rows,
});
export const SEMANTIC_CASE_MAPPING_CANONICAL_SHA256 = '092cfbb1313ccdec0afd2064a37dd9c9e70fff2aafa7e9ae2cdb73f09d1a58d6';

export function validateSemanticCaseMapping(value) {
  const errors = [];
  if (!exactKeys(value, ['schema', 'version', 'rows'])
    || value?.schema !== 'lamina.real-repository-oracle-semantic-case-mapping/v1' || value.version !== 1
    || !Array.isArray(value.rows) || value.rows.length !== 42) {
    errors.push('semantic case mapping root must contain exactly 42 rows');
    return { valid: false, errors };
  }
  if (new Set(value.rows.map((item) => item.id)).size !== 42) errors.push('semantic case mapping ids must be unique');
  for (const item of value.rows) {
    if (!exactKeys(item, [
      'id', 'workflow_ids', 'source_surface_ids', 'separate_lexical_category', 'rationale',
    ]) || !/^(small|medium|large)\.semantic\.\d{2}-[a-z_]+$/.test(item.id)
      || !Array.isArray(item.workflow_ids) || new Set(item.workflow_ids).size !== item.workflow_ids.length
      || !Array.isArray(item.source_surface_ids)
      || new Set(item.source_surface_ids).size !== item.source_surface_ids.length
      || typeof item.rationale !== 'string' || item.rationale.length < 40
      || ![null, ...Object.values(INDEPENDENT_LEXICAL_WITNESS_AUTHORITY)]
        .includes(item.separate_lexical_category)) {
      errors.push(`${item.id || 'unknown'} semantic mapping row is malformed`);
    }
    if (!item.workflow_ids.length && item.source_surface_ids.length) {
      errors.push(`${item.id} cannot rank sources without a mapped Workflow`);
    }
  }
  const actualIndependent = Object.fromEntries(value.rows
    .filter((item) => item.separate_lexical_category !== null)
    .map((item) => [item.id, item.separate_lexical_category]));
  if (JSON.stringify(actualIndependent) !== JSON.stringify(INDEPENDENT_LEXICAL_WITNESS_AUTHORITY)
    || value.rows.some((item) => item.separate_lexical_category
      && !item.rationale.includes('independent lexical evidence'))) {
    errors.push('independent lexical witnesses must exactly match the reviewed row-to-category authority');
  }
  return { valid: errors.length === 0, errors };
}

const validation = validateSemanticCaseMapping(SEMANTIC_CASE_MAPPING);
if (!validation.valid) throw new Error(validation.errors.join('; '));
export const semanticCaseMappingDigest = () => digest(SEMANTIC_CASE_MAPPING);
if (semanticCaseMappingDigest() !== SEMANTIC_CASE_MAPPING_CANONICAL_SHA256) {
  throw new Error('semantic case mapping differs from its reviewed canonical identity');
}
