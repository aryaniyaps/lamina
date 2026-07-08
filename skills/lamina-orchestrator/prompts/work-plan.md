```markdown
## Lamina work plan
**Workflow:** <command name or "orchestrated">
**Skills:** <lamina-* names>
**Order:** <sequential steps; mark parallel groups>
**Subagent:** <parallel review / persona panel / fresh context / inline only>
**Persona panel:** <persona ids or "skip"> | target: <flow/screen>
**Writes:** `.lamina/` only | **Repo:** read-only
**Blueprint:** off | <id> (draft|approved) | **Preview:** <url from .lamina/preview-state.yaml or "not started">
**Gaps:** <unknowns>
```

If any gap blocks responsible artifact generation, do not emit this work plan yet. Use `outputs/clarify` instead, ask one batched set of clarifying questions, and stop before creating `run.yaml` or writing artifacts. Use `**Gaps:**` only for deferred unknowns after the intake gate has passed or the user explicitly chose to proceed with unanswered questions.
