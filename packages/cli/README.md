# Lamina standalone CLI

The Lamina CLI is the standalone Node.js runtime for Lamina's transactional
product graph. It installs the `lamina` command and can be used independently
of the Lamina agent skills.

## Install

```bash
curl -fsSL https://github.com/aryaniyaps/lamina/releases/latest/download/install.sh | sh
lamina --version
lamina doctor --json
```

The standalone release includes its own Node runtime and downloads a
checksum-verified, platform-native CocoIndex worker into its private versioned
runtime cache. Observation needs no host Python, `uv`, venv, npm, or first-run
dependency download. The worker submits observations to graphd; it never opens
Ladybug directly.

Install the skills independently from GitHub:

```bash
npx skills add aryaniyaps/lamina --skill '*' -a <active-agent> -y
```

For the complete setup:

```bash
curl -fsSL https://github.com/aryaniyaps/lamina/releases/latest/download/install.sh | sh
npx skills add aryaniyaps/lamina --skill '*' -a <active-agent> -y
```

## Observation

```bash
lamina graph observe
lamina graph observe --live
lamina graph discover --brownfield
lamina graph rebuild-observations
```

`rebuild-observations` invalidates the current observation generation and then
performs a complete observation pass. Runtime state is private to the Git
common directory at `.git/lamina/cocoindex`; the observer only sends
authenticated batches to graphd and never opens Ladybug directly.

`discover --brownfield` returns deterministic coverage signals for entry
points, commands, routes, handlers, schemas/entities, state transitions,
permissions, events, tests, documentation/personas, feature flags, and
dependencies. These are source observations, not proof of runtime behavior.

## Existing installations

If the old repository package was globally linked, unlink it, install this
package, and reinstall the skills:

```bash
npm unlink -g lamina
curl -fsSL https://github.com/aryaniyaps/lamina/releases/latest/download/install.sh | sh
npx skills add aryaniyaps/lamina --skill '*' -a <active-agent> -y
```

The graph remains in the Git common directory at `.git/lamina`; the migration
does not rewrite or relocate `graph.lbdb`.

License: Apache-2.0.
