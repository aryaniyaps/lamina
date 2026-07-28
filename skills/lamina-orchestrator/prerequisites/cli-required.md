# CLI prerequisite

This skill bundle does not contain an executable runtime. Before the first
graph read or mutation in `/lamina`, `/lamina-init`, `/lamina-design`, or
`/lamina-verify`, run:

```bash
lamina doctor --json
```

The prerequisite passes only when the command succeeds, `ok` is `true`, and
`cli.api_version` is exactly `1`. CLI API 1 is the compatibility boundary;
do not require an exact CLI patch version.

If `lamina` is missing, the doctor command fails, or the reported CLI API is
not 1, stop before any graph or evidence mutation and print this exact
installation instruction:

```text
Install the standalone Lamina CLI from https://github.com/aryaniyaps/lamina/releases/latest, then run lamina doctor --json.
```

Never invoke the runtime through `npx`, never install it automatically, and
never fall back to copied or embedded runtime scripts.

If the doctor report has `git.is_project: false`, `/lamina-init` bootstraps the
project with `git init -b main`, then reruns `lamina doctor --json`. This creates
Git metadata only: never stage files, create a commit, or edit application
source. An unborn `main` branch is a supported Lamina graph context.
