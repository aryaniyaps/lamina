# CLI release runbook

`@laminadev/cli` releases independently from the GitHub-installed skills.
Stable releases are published only by `.github/workflows/publish-cli.yml` from
a GitHub Release named `cli-v<packages/cli version>`.

## One-time bootstrap

The npm package must exist before npm can attach a trusted publisher. In a
clean temporary clone, use a manually authenticated npm account with package
write access and 2FA:

```bash
npm install -g npm@^11.15.0
npm login
npm version 0.1.0-beta.0 --prefix packages/cli --no-git-tag-version
npm pack ./packages/cli --json --pack-destination dist > cli-pack.json
node scripts/audit-cli-pack.mjs cli-pack.json
tarball="$(node -p "'dist/' + require('./cli-pack.json')[0].filename")"
npm publish "$tarball" --access public --tag bootstrap --provenance=false
```

Do not commit the temporary beta version change. Confirm
`npm view @laminadev/cli@bootstrap version` returns `0.1.0-beta.0`.
The bootstrap explicitly disables provenance because npm can only generate
provenance from a supported cloud CI runner; the stable OIDC release restores
the provenance requirement.

Create and protect a GitHub environment named `npm`, require maintainer review,
and restrict deployment tags to `cli-v*`. Then configure npm trust for the
exact repository, workflow filename, environment, and publish action:

```bash
npm trust github @laminadev/cli \
  --file publish-cli.yml \
  --repo aryaniyaps/lamina \
  --env npm \
  --allow-publish \
  --yes
```

The npm account must have 2FA enabled. The trust command requires npm 11.15.0
or newer and an already-published package.

## Stable release

1. Keep `packages/cli/package.json` at the intended stable version.
2. Ensure `main` is clean and all checks pass.
3. Create and publish a GitHub Release tagged `cli-v0.1.0`.
4. Approve the protected `npm` environment if its rules require approval.

The workflow verifies the tag/version match, installs from the frozen lockfile,
runs repository and compatibility tests, audits the exact tarball and size
ceiling, installs that tarball into a clean Git fixture, and publishes through
GitHub OIDC with public access and provenance.

## Registry verification

The workflow runs these gates after publication:

```bash
npm view @laminadev/cli@0.1.0 --json
node tests/cli_tarball_smoke_test.mjs --package @laminadev/cli@0.1.0
```

It also installs the registry package in a clean directory and runs
`npm audit signatures`, which verifies registry signatures and provenance
attestations. A manual clean-prefix check may be run without disturbing an
existing global install:

```bash
prefix="$(mktemp -d)"
npm install --global --prefix "$prefix" @laminadev/cli@0.1.0
"$prefix/bin/lamina" --version
"$prefix/bin/lamina" doctor --json
```
