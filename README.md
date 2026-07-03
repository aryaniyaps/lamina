# lamina

Lamina creates UX context artifacts and implementation-ready task lists for coding agents.

## Phase 0 commands

```bash
npm install
npm test
npm run lamina -- init
npm run lamina -- scan
npm run lamina -- start
npm run lamina -- tasks
npm run lamina -- doctor
```

## What Lamina currently builds

- `.lamina/` Markdown/YAML artifacts
- Basic project context discovery with confidence and gaps
- Guided flows for ideation, optimization, and adding a feature
- Web and mobile UX edge-case coverage
- UX-only implementation tasks in `.lamina/implementation-tasks.md`
- Reuse of prior `.lamina` insights, decisions, and requirements in new sessions

## Boundaries

Phase 0 does not generate visual design, component code, analytics queries, MCP servers, SDKs, or native editor plugins.

## Agent handoff

After `lamina start`, ask your coding tool to implement the P0 tasks from:

```text
.lamina/implementation-tasks.md
```

Keep Lamina artifacts as UX requirements and task evidence. Do not overwrite them with implementation code.
