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
npm install -g @laminadev/cli@latest
```

Never invoke the runtime through `npx`, never install it automatically, and
never fall back to copied or embedded runtime scripts.
