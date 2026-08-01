const REPOSITORY_OUTPUT_ENTRYPOINTS = Object.freeze([
  'scripts/build-standalone-cli.mjs',
  'scripts/fetch-retrieval-model.mjs',
  'scripts/prepare-retrieval-assets.mjs',
  'evals/hooks/compatibility-matrix.sh',
  'evals/scripts/run-suite.mjs',
  'evals/scripts/run-reference-matrix.mjs',
  'evals/scripts/vendor-nextjs-fixture.mjs',
  'evals/scripts/vendor-payload-fixture.mjs',
  'evals/scripts/vendor-plane-fixture.mjs',
  'evals/scripts/vendor-outline-fixture.mjs',
]);

const BASE_REASON = 'is refused because atomic repository-output publication requires same-filesystem stage/old authority under a proven hard quota, while the payload hard temp quota is a different private tmpfs; add a reviewed owning-leaf output contract before enabling this entrypoint';

export const REPOSITORY_OUTPUT_REFUSALS = Object.freeze(Object.fromEntries(
  REPOSITORY_OUTPUT_ENTRYPOINTS.map((entrypoint) => [entrypoint,
    entrypoint === 'evals/scripts/run-suite.mjs'
      || entrypoint === 'evals/scripts/run-reference-matrix.mjs'
      ? `${entrypoint} is refused because its ignored .venv-eval runtime and generated repository workspace outputs have neither sealed nor same-filesystem hard-quota authority; add a reviewed owning-leaf runtime and output contract before enabling this entrypoint`
      : `${entrypoint} ${BASE_REASON}`]),
));

export function repositoryOutputRefusal(entrypoint) {
  return REPOSITORY_OUTPUT_REFUSALS[entrypoint] || null;
}
