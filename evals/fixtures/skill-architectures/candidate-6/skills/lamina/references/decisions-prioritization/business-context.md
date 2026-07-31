# business context

> Migrated intact from `skills/lamina-business-context/SKILL.md` at `9a02ad51bbd294e3ee2ee1fd605f366297b9c43b`.

# Business Context

Establishes and maintains `.lamina/business-context.md` — the business foundation UX workflows read before ideating, specifying features, or optimizing flows.

**Guardrail:** UX artifacts only. Do not implement product code or visual styling specs.

Load artifacts.md for file contract, changelog rules, and downstream ownership.

---

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
| Problem statement | problem-framing, feature-discovery |
| Business goals | stakeholder-alignment, product-behavior |
| Success metrics | quantitative-validation, stakeholder-alignment |
| Scope | stakeholder-alignment, feature-prioritization |
| Users & market | competitive-analysis, user-modeling — prose in business-context; structured cast in `personas.json` during establish |
| Product posture | platform-posture, product-behavior |
| Constraints | research-scoping, stakeholder-alignment |
| Stakeholders | stakeholder-alignment |
| Risks & unknowns | feature-discovery, research-scoping |
| Research posture | problem-framing, research-scoping |
| Triad check | product-behavior |
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
| Problem statement (pivot) | personas, prior runs, requirements |

Never silently overwrite `personas.json` or `decisions.md`. Offer explicit refresh or append.

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
- **Large:** monorepo or corpus crowds context → bounded repo scan per field-research; summarize in `evidence.md`

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
**Skill:** lamina-problem-framing

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
