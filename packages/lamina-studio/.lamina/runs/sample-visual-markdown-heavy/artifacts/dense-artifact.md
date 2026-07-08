# Dense Artifact

## Findings

- Finding A has **bold emphasis**.
- Finding B has `inline code`.
- Finding C includes a link-like reference: [Lamina](https://example.com).

| Scenario | Risk | Status |
| --- | --- | --- |
| Mermaid block | Rendered as source card | Expected |
| Long table | Horizontal fit | Expected |

```mermaid
journey
  title Reviewer reads artifact
  section Open
    Select run: 5: Reviewer
    Open artifacts: 4: Reviewer
  section Read
    Scan table: 4: Reviewer
    Inspect diagram source: 3: Reviewer
```
