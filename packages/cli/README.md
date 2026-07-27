# `@laminadev/cli`

The Lamina CLI is the standalone Node.js runtime for Lamina's transactional
product graph. It installs the `lamina` command and can be used independently
of the Lamina agent skills.

## Install

```bash
npm install -g @laminadev/cli
lamina --version
lamina doctor --json
```

Node.js 20 or newer is required. Core graph, session, and mission commands are
Node-only. Source observation additionally requires `uv`; the package carries
its pinned CocoIndex Python project.

npm 12 blocks dependency install scripts by default. Ladybug needs its native
installer, so npm 12 users should install with the narrow approval:

```bash
npm install -g --allow-scripts=@ladybugdb/core @laminadev/cli
```

Install the skills independently from GitHub:

```bash
npx skills add aryaniyaps/lamina --all -y
```

For the complete setup:

```bash
npm install -g @laminadev/cli
npx skills add aryaniyaps/lamina --all -y
```

## Observation

```bash
lamina graph observe
lamina graph observe --live
lamina graph discover --brownfield
lamina graph rebuild-observations
```

`rebuild-observations` invalidates the current observation generation and then
performs a complete observation pass. CocoIndex assets are always resolved
from this installed package, not from the target repository.

`discover --brownfield` returns deterministic coverage signals for entry
points, commands, routes, handlers, schemas/entities, state transitions,
permissions, events, tests, documentation/personas, feature flags, and
dependencies. These are source observations, not proof of runtime behavior.

## Existing installations

If the old repository package was globally linked, unlink it, install this
package, and reinstall the skills:

```bash
npm unlink -g lamina
npm install -g @laminadev/cli
npx skills add aryaniyaps/lamina --all -y
```

The graph remains in the Git common directory at `.git/lamina`; the migration
does not rewrite or relocate `graph.lbdb`.

See the [complete CLI reference](https://lamina.dev/docs/commands) for every
command, option, input schema, output shape, and stable error code.

License: Apache-2.0.
