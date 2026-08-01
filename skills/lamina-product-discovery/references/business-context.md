# Business Context

Establishes and maintains `.lamina/business-context.md` — the business foundation UX workflows read before ideating, specifying features, or optimizing flows.

**Guardrail:** UX artifacts only. Do not implement product code or visual styling specs.

Load [artifacts.md](../../lamina/orchestrator/artifacts.md) for file contract, changelog rules, and downstream ownership.

---

## Contents

- [Modes](#modes)
- [Section to topic mapping](#section--skill-mapping)
- [Question bank](#question-bank-establish)
- [Confidence rubric](#confidence-rubric)
- [Staleness rules](#staleness-rules-update-mode)
- [Brownfield scan protocol](#brownfield-scan-protocol)
- [Artifact template](#artifact-template)
- [Passive continuation](#passive-continuation-output-only)

## Modes

| Mode | Trigger | Behavior |
|---|---|---|
| **Establish** | No `business-context.md`, or user requests fresh bootstrap | Frame gate → Evidence (brownfield) → Write → Cast |
| **Update** | `/lamina-init update`, or explicit pivot/scope-change language | Read existing → re-run changed sections → merge + changelog |

---

## Section → skill mapping

Apply the linked capability skill's frameworks when writing each section.

| Section | Skills |
|---|---|
| Problem statement | [problem-framing](./problem-framing.md), [feature-discovery](./feature-discovery.md) |
| Business goals | [stakeholder-alignment](./stakeholder-alignment.md), [product-behavior](../../lamina-product-behavior/references/product-behavior.md) |
| Success metrics | [quantitative-validation](../../lamina-evaluation/references/quantitative-validation.md), [stakeholder-alignment](./stakeholder-alignment.md) |
| Scope | [stakeholder-alignment](./stakeholder-alignment.md), [feature-prioritization](./feature-prioritization.md) |
| Users & market | [competitive-analysis](../../lamina-research/references/competitive-analysis.md), [user-modeling](../../lamina-research/references/user-modeling.md) — prose in business-context; structured cast in `personas.json` during establish |
| Product posture | [platform-posture](../../lamina-product-behavior/references/platform-posture.md), [product-behavior](../../lamina-product-behavior/references/product-behavior.md) |
| Constraints | [research-scoping](../../lamina-research/references/research-scoping.md), [stakeholder-alignment](./stakeholder-alignment.md) |
| Stakeholders | [stakeholder-alignment](./stakeholder-alignment.md) |
| Risks & unknowns | [feature-discovery](./feature-discovery.md), [research-scoping](../../lamina-research/references/research-scoping.md) |
| Research posture | [problem-framing](./problem-framing.md), [research-scoping](../../lamina-research/references/research-scoping.md) |
| Triad check | [product-behavior](../../lamina-product-behavior/references/product-behavior.md) |
| Inferred context (brownfield only) | scan protocol below |

---

## Question bank (establish)

Ask **one batch** of clarifying questions for empty sections — not a multi-step wizard.

Before writing `.lamina/business-context.md` or `.lamina/personas.json`, require enough non-placeholder input for Problem statement, Scope, Users & market, Product posture, and Constraints. If any of those core sections are empty or too vague to support downstream UX work, use the clarify output contract and **STOP**. Only carry unanswered items into **Open questions** when the user explicitly refuses, skips, or asks to proceed without answering.

### Problem statement
- What user or business problem are we solving?
- For whom? Why now?
- Are we building the right thing or validating something we already decided?

### Business goals
- What does organizational success look like in 6–12 months?
- What would make stakeholders say this project succeeded?

### Success metrics
- Which measurable outcomes matter most (conversion, retention, support volume, task success)?
- What is the baseline today, if known?

### Scope
- What is explicitly in and out?
- What would scope creep look like for this project?

### Users & market
- Who are we serving? Who are we explicitly not serving?
- What alternatives or inertia do users face today?

### Product posture
- Platform (web, mobile, desktop, embedded)?
- Sovereign vs transient vs daemonic role in users' workflow?

### Constraints
- Time, budget, regulatory, technical, or organizational limits?

### Stakeholders
- Who must support this? Known objections or mandates?

### Risks & unknowns
- What assumptions, if wrong, hurt us in six months?
- What do we not know yet?

### Research posture
- Generative (find direction) vs evaluative (test solutions)?
- Which decisions must evidence inform before we build?

### Triad check
- Capability / viability / desirability — which pillar is weakest?

---

## Confidence rubric

| Level | Meaning |
|---|---|
| **high** | Direct stakeholder input, recent validated research, or strong doc evidence |
| **medium** | Reasonable inference from docs or codebase; not yet validated with users |
| **low** | Assumption — flag `assumption — needs validation`; note in Open questions |

Do not present low-confidence assumptions as high confidence.

---

## Staleness rules (update mode)

When a section changes, flag downstream artifacts that may need refresh:

| Changed section | May stale |
|---|---|
| Users & market | `personas.json` — re-run `/lamina-design` discovery and cast update |
| Scope | active GraphVersion workflows outside new scope; design sessions in flight |
| Business goals, success metrics | audit prioritization; design workflow metrics sections |
| Product posture, constraints | design workflow IA and interaction sections |
| Problem statement (pivot) | Persona evidence, active GraphVersion facts, Missions, and projections |

Never silently overwrite `.lamina/personas.json`, stable graph Resources, or
historical Statements. Offer an explicit evidence refresh or propose new facts
that preserve graph history and surface Contradictions.

---

## Brownfield scan protocol

Use when shipped UI or product docs exist. Informs business answers, **Inferred context** section, and provisional persona cast.

### Read order
1. README, `docs/`, PRDs, pitch decks, marketing copy
2. Package manifest / stack signals (framework, app structure)
3. User-facing routes, pages, layouts, error copy, onboarding — skip tests, build config, unrelated backend unless it affects user behavior

### Size heuristics (internal — do not persist)
- **Small:** single app, few surfaces → inline read
- **Medium:** multiple feature areas, research folders → bounded inline read
- **Large:** monorepo or corpus crowds context → bounded repo scan per [field-research](../../lamina-research/references/field-research.md); summarize in `evidence.md`

### Evidence tagging
Every inferred claim cites `@path` or states `insufficient detail — cannot verify`.

### Greenfield
Skip scan. Rely on user input and any attached PRD/README.

---

## Artifact template

The section names in the Section → skill mapping are the canonical artifact contract. Write each as its own level-two heading exactly: `Problem statement`, `Business goals`, `Success metrics`, `Scope`, `Users & market`, `Product posture`, `Constraints`, `Stakeholders`, `Risks & unknowns`, `Research posture`, and `Triad check`. Additional sections may follow, but must not replace, rename, or combine these headings. Before returning success, validate every canonical section has a non-placeholder `**Answer:**` line.

```markdown
---
lamina:
  maturity: brownfield    # greenfield | brownfield
  platform: [web]
  last_updated: 2026-07-06
---

# Business context

## Problem statement
**Answer:** …
**Confidence:** medium
**Evidence:** user input
**Topic:** lamina-product-discovery/references/problem-framing.md

## Business goals
…

## Changelog
### YYYY-MM-DD — short label
- Changed: …
- Trigger: …
- Stale: …
```

---

## Passive continuation (output only)

| Signal | Continue automatically |
|---|---|
| Problem unclear, early exploration | complete the required graph design |
| Specific capability to specify | prepare its implementation packet |
| Shipped UI, known pain, clear goals | run graph-backed live verification |
| Business context incomplete | finish open questions before other commands |

Do not recommend another slash command.
