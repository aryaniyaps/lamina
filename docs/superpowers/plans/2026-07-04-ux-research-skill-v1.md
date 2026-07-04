# UX Research Skill/Plugin V1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a self-contained, markdown-native UX research skill/plugin bundle that reliably produces decision-ready micro/macro research outputs with falsification framing and business-metric linkage.

**Architecture:** Implement one content bundle at `ux-research-skill/` plus one tiny stdlib-only verification harness in `scripts/` + `tests/`. Build in vertical slices: philosophy/classification first, then planning/methods/synthesis/delivery/templates/prompts/references. Each slice lands with a failing test first, then minimal markdown to pass.

**Tech Stack:** Markdown, Python 3 standard library (`unittest`, `pathlib`, `re`, `subprocess`), git.

## Global Constraints

- This is a markdown-first skill. The product is the content, structure, and linked guidance.
- Any runtime wrapper is optional and must remain thin. The skill must remain fully usable as plain markdown without executable dependencies.
- All core behavior, logic, and quality standards must be explicit in markdown files.
- The skill defines what outcomes must be produced, not rigid procedural logic.
- Disallowed as primary strategy: Hardcoded logic trees; Regex-led decision routing; Generic descriptive outputs without decision tie-in; Output quantity used as proxy for impact.
- Adopt a falsification mindset: Do not validate assumptions. Design studies to potentially prove assumptions wrong.
- Prioritize: Micro research (usability/task-level product impact) and Macro research (strategic/business-level decision frameworks).
- De-emphasize middle-range descriptive work unless it is reframed into decision-ready micro or macro outcomes.
- Primary success metric: outputs must change decisions, falsify assumptions, and tie to business outcomes such as engagement, conversion, retention, churn, and strategy quality.

---

## File Structure (locked before tasking)

### Create
- `ux-research-skill/README.md`
- `ux-research-skill/philosophy-principles.md`
- `ux-research-skill/research-classification.md`
- `ux-research-skill/planning/research-plan-template.md`
- `ux-research-skill/planning/business-need-to-rq.md`
- `ux-research-skill/planning/stakeholder-alignment.md`
- `ux-research-skill/methods/catalog.md`
- `ux-research-skill/methods/interviewing/best-practices.md`
- `ux-research-skill/methods/interviewing/question-craft.md`
- `ux-research-skill/methods/interviewing/contextual-techniques.md`
- `ux-research-skill/methods/interviewing/remote-optimization.md`
- `ux-research-skill/methods/evaluative/usability-testing.md`
- `ux-research-skill/methods/evaluative/heuristic-evaluation.md`
- `ux-research-skill/methods/generative/README.md`
- `ux-research-skill/methods/quantitative-metrics.md`
- `ux-research-skill/methods/advanced/jtbd-mental-models.md`
- `ux-research-skill/analysis-synthesis/analysis-tagging.md`
- `ux-research-skill/analysis-synthesis/synthesis-affinity-clustering.md`
- `ux-research-skill/analysis-synthesis/frameworks.md`
- `ux-research-skill/analysis-synthesis/topline-report-template.md`
- `ux-research-skill/impact-delivery/recommendations-tracker.md`
- `ux-research-skill/impact-delivery/stakeholder-engagement.md`
- `ux-research-skill/impact-delivery/research-ops.md`
- `ux-research-skill/impact-delivery/maturity-model.md`
- `ux-research-skill/templates/research-plan.md`
- `ux-research-skill/templates/screener.md`
- `ux-research-skill/templates/interview-guide.md`
- `ux-research-skill/templates/consent-release.md`
- `ux-research-skill/templates/topline-report.md`
- `ux-research-skill/templates/findings-recommendations-tracker.md`
- `ux-research-skill/templates/photo-video-shot-list.md`
- `ux-research-skill/checklists/study-execution.md`
- `ux-research-skill/checklists/bias-mitigation.md`
- `ux-research-skill/checklists/ethics-safety-inclusion.md`
- `ux-research-skill/checklists/accessibility-wcag-aligned.md`
- `ux-research-skill/checklists/falsification-quality.md`
- `ux-research-skill/checklists/remote-setup-quality.md`
- `ux-research-skill/checklists/listening-rapport-self-score.md`
- `ux-research-skill/prompts/grok-integration.md`
- `ux-research-skill/references/key-quotes.md`
- `ux-research-skill/references/book-summaries.md`
- `ux-research-skill/references/external-resources.md`
- `scripts/verify_skill_bundle.py`
- `tests/test_skill_bundle.py`

### Notes
- Keep this as a single markdown bundle (no runtime deps, no plugin codegen).
- Verification stays intentionally tiny: one script + one unittest file.

---

### Task 1: Scaffold bundle + verification harness

**Files:**
- Create: `ux-research-skill/README.md`
- Create: `scripts/verify_skill_bundle.py`
- Create: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: none
- Produces:
  - `python scripts/verify_skill_bundle.py --check structure -> exit code 0|1`
  - `def assert_exists(paths: list[str]) -> None`
  - `def assert_headings(path: str, headings: list[str]) -> None`

- [ ] **Step 1: Write the failing test**

```python
# tests/test_skill_bundle.py
import subprocess
import unittest


class TestSkillBundle(unittest.TestCase):
    def test_structure_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "structure"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with `can't open file 'scripts/verify_skill_bundle.py'` or non-zero return code.

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/verify_skill_bundle.py
from __future__ import annotations

import argparse
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


def assert_exists(paths: list[str]) -> None:
    missing = [p for p in paths if not (ROOT / p).exists()]
    if missing:
        raise SystemExit("Missing files:\n" + "\n".join(missing))


def assert_headings(path: str, headings: list[str]) -> None:
    text = (ROOT / path).read_text(encoding="utf-8")
    missing = [h for h in headings if h not in text]
    if missing:
        raise SystemExit(f"Missing headings in {path}: {missing}")


def check_structure() -> None:
    assert_exists([
        "ux-research-skill/README.md",
        "ux-research-skill/philosophy-principles.md",
        "ux-research-skill/research-classification.md",
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", required=True, choices=["structure", "core", "planning", "methods", "analysis", "impact", "templates", "prompts", "all"])
    args = parser.parse_args()

    if args.check in {"structure", "all"}:
        check_structure()

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

```markdown
<!-- ux-research-skill/README.md -->
# UX Research Skill

## Purpose
Provide a markdown-native UX research skill/plugin bundle for decision-ready outcomes.

## Usage Order
1. `philosophy-principles.md`
2. `research-classification.md`
3. Relevant planning/method modules

## Output Standard
Every output must include decision target, falsifiable assumptions, evidence traceability, and business metric linkage.
```

```markdown
<!-- ux-research-skill/philosophy-principles.md -->
# Philosophy and Principles

## Non-Negotiables
- Research exists to inform decisions by revealing behavior and context.
- Falsification mindset over validation theater.
- Impact over craft performance.
```

```markdown
<!-- ux-research-skill/research-classification.md -->
# Research Classification

## Classes
- Micro
- Middle-range
- Macro

## Rule
Map every incoming request to micro or macro first; reframe middle-range asks.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/README.md ux-research-skill/philosophy-principles.md ux-research-skill/research-classification.md
git commit -m "feat: scaffold ux research skill bundle with verification harness"
```

---

### Task 2: Complete philosophy + classification contracts

**Files:**
- Modify: `ux-research-skill/philosophy-principles.md`
- Modify: `ux-research-skill/research-classification.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: `assert_headings(path: str, headings: list[str]) -> None`
- Produces:
  - `python scripts/verify_skill_bundle.py --check core -> exit code 0|1`
  - Core required headings/phrases contract for philosophy/classification docs

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_core_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "core"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with missing headings/phrases in `philosophy-principles.md` or `research-classification.md`.

- [ ] **Step 3: Write minimal implementation**

```python
# add to scripts/verify_skill_bundle.py

def check_core() -> None:
    assert_headings(
        "ux-research-skill/philosophy-principles.md",
        [
            "# Philosophy and Principles",
            "## Non-Negotiables",
            "## Red Flags",
            "Falsification mindset over validation theater",
            "Mixed methods rigor with explicit triangulation",
        ],
    )
    assert_headings(
        "ux-research-skill/research-classification.md",
        [
            "# Research Classification System",
            "## Primary Lens",
            "## Operating Rule",
            "## Supporting Taxonomy",
            "If middle-range, reframe into decision-ready micro or macro outputs",
        ],
    )
```

```python
# in main() add:
    if args.check in {"core", "all"}:
        check_core()
```

```markdown
<!-- replace ux-research-skill/philosophy-principles.md -->
# Philosophy and Principles

## Non-Negotiables
- Research exists to inform decisions by revealing how people behave and why in context.
- Falsification mindset over validation theater.
- Business fluency and early partnership with product and leadership.
- Context and depth over shallow breadth.
- Impact over craft performance.
- Humane, ethical, and inclusive research practice.
- Mixed methods rigor with explicit triangulation.
- Pragmatic and lean research effort allocation.
- Foundational design principles integrated into interpretation.
- Continuous infrastructure via ResearchOps.

## Red Flags
- Middle-range requests that stop at descriptive attitude reporting.
- NPS used as sole or dominant success metric without behavior linkage.
- Dogfooding used without context mismatch checks.
- Hindsight and narrative fallacy in interpretation.
- Late-stage quick validation used as decision theater.
```

```markdown
<!-- replace ux-research-skill/research-classification.md -->
# Research Classification System

## Primary Lens
- **Micro:** interaction and task-level improvements tied to measurable product metrics.
- **Middle-range:** broad descriptive attitudes and pain points that often fail to drive action.
- **Macro:** strategic business and executive-level insight frameworks.

## Operating Rule
Map every incoming request to micro or macro first.

If middle-range, reframe into decision-ready micro or macro outputs:
1. Diagnose why the ask is weak.
2. Rewrite as falsifiable decision questions.
3. Route to micro or macro deliverables with metric linkage.

## Supporting Taxonomy
- Attitudinal vs behavioral
- Generative vs evaluative
- Qualitative vs quantitative
- Contextual vs lab/centralized
- Inclusivity, accessibility, remote optimization, and lean constraints
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/philosophy-principles.md ux-research-skill/research-classification.md
git commit -m "feat: add core philosophy and classification contracts"
```

---

### Task 3: Add planning layer (plan template + business-need translator + stakeholder alignment)

**Files:**
- Create: `ux-research-skill/planning/research-plan-template.md`
- Create: `ux-research-skill/planning/business-need-to-rq.md`
- Create: `ux-research-skill/planning/stakeholder-alignment.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: `python scripts/verify_skill_bundle.py --check core`
- Produces:
  - `python scripts/verify_skill_bundle.py --check planning`
  - Planning doc contract required by downstream methods/prompts

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_planning_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "planning"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with missing planning files/headings.

- [ ] **Step 3: Write minimal implementation**

```python
# add to scripts/verify_skill_bundle.py

def check_planning() -> None:
    assert_exists([
        "ux-research-skill/planning/research-plan-template.md",
        "ux-research-skill/planning/business-need-to-rq.md",
        "ux-research-skill/planning/stakeholder-alignment.md",
    ])
    assert_headings("ux-research-skill/planning/research-plan-template.md", [
        "# Research Plan Template",
        "## 1) Business problem or opportunity",
        "## 2) Research objectives and prioritized falsifiable questions",
        "## Assumption mapping",
        "## Jobs-to-be-Done framing",
        "## Stakeholder alignment checklist",
    ])
```

```python
# in main() add:
    if args.check in {"planning", "all"}:
        check_planning()
```

```markdown
<!-- ux-research-skill/planning/research-plan-template.md -->
# Research Plan Template

## 1) Business problem or opportunity
- Decision to support:
- Business outcome target (engagement/conversion/retention/churn/strategy quality):

## 2) Research objectives and prioritized falsifiable questions
- Objective 1:
- Falsifiable question 1:
- Disconfirming evidence threshold:

## 3) Participants and sampling logic
- Segments:
- Inclusion/exclusion:
- Accessibility and inclusion accommodations:

## 4) Method mix and ROI rationale
- Method:
- Why this method now:
- Why not alternatives:

## 5) Logistics and team operations
- Timeline:
- Roles:
- Recording and consent handling:

## 6) Timeline and resourcing
- Week-by-week checkpoints:
- Time budget:

## 7) Success criteria for this research effort
- Decision changed:
- Assumption falsified/confirmed:

## 8) Risks and mitigations
- Risk:
- Mitigation:

## Assumption mapping
- Assumption:
- Evidence needed to falsify:

## Jobs-to-be-Done framing
- Situation:
- Motivation:
- Desired outcome:

## Stakeholder alignment checklist
- Decision owner identified
- Checkpoint calendar agreed
- Evidence bar agreed
```

```markdown
<!-- ux-research-skill/planning/business-need-to-rq.md -->
# Business Need to Research Questions

## Translation Workflow
1. Write the business need in one sentence.
2. Name the decision owner and deadline.
3. Convert need into a falsifiable question.
4. Define the metric movement expected if the assumption is wrong.
5. Pick micro or macro route.

## Example
Business need: "Activation dropped in onboarding."
Research question: "Which onboarding step creates the highest task failure for new users, and does fixing it increase day-1 activation by >=5%?"
```

```markdown
<!-- ux-research-skill/planning/stakeholder-alignment.md -->
# Stakeholder Alignment

## Intake Clarification
- What decision is pending?
- What happens if we do nothing?

## Decision Ownership
- Single accountable owner:
- Approvers:

## Evidence Expectations
- Minimum evidence needed:
- Confidence threshold:

## Decision Checkpoint Timeline
- Kickoff:
- Midpoint readout:
- Final decision review:
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/planning/*.md
git commit -m "feat: add planning layer docs and verification"
```

---

### Task 4: Add methods catalog + interviewing + evaluative foundations

**Files:**
- Create: `ux-research-skill/methods/catalog.md`
- Create: `ux-research-skill/methods/interviewing/best-practices.md`
- Create: `ux-research-skill/methods/interviewing/question-craft.md`
- Create: `ux-research-skill/methods/interviewing/contextual-techniques.md`
- Create: `ux-research-skill/methods/interviewing/remote-optimization.md`
- Create: `ux-research-skill/methods/evaluative/usability-testing.md`
- Create: `ux-research-skill/methods/evaluative/heuristic-evaluation.md`
- Create: `ux-research-skill/methods/generative/README.md`
- Create: `ux-research-skill/methods/quantitative-metrics.md`
- Create: `ux-research-skill/methods/advanced/jtbd-mental-models.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: planning docs from Task 3
- Produces:
  - `python scripts/verify_skill_bundle.py --check methods`
  - Method-entry contract used by synthesis and prompts

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_methods_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "methods"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with missing methods files/headings.

- [ ] **Step 3: Write minimal implementation**

```python
# add to scripts/verify_skill_bundle.py

def check_methods() -> None:
    assert_exists([
        "ux-research-skill/methods/catalog.md",
        "ux-research-skill/methods/interviewing/best-practices.md",
        "ux-research-skill/methods/interviewing/question-craft.md",
        "ux-research-skill/methods/interviewing/contextual-techniques.md",
        "ux-research-skill/methods/interviewing/remote-optimization.md",
        "ux-research-skill/methods/evaluative/usability-testing.md",
        "ux-research-skill/methods/evaluative/heuristic-evaluation.md",
        "ux-research-skill/methods/generative/README.md",
        "ux-research-skill/methods/quantitative-metrics.md",
        "ux-research-skill/methods/advanced/jtbd-mental-models.md",
    ])
    assert_headings("ux-research-skill/methods/catalog.md", [
        "# Methods Catalog",
        "## Method Entry Standard",
        "## Core Methods",
        "In-depth interviewing",
        "Analytics triangulation",
        "Focus groups (with caveats)",
    ])
```

```python
# in main() add:
    if args.check in {"methods", "all"}:
        check_methods()
```

```markdown
<!-- ux-research-skill/methods/catalog.md -->
# Methods Catalog

## Method Entry Standard
Each method includes: description, when to use, micro/macro fit, strengths/limits, ROI notes, stepwise execution, good/bad examples, remote adaptations, combinations, accessibility/inclusion notes, links to templates/checklists.

## Core Methods
- In-depth interviewing
- Contextual inquiry
- Usability testing
- Heuristic evaluation and cognitive walkthrough
- Surveys and questionnaires with measurement rigor
- Card sorting and tree testing
- Experimentation and A/B framing basics
- Diary and longitudinal studies
- Jobs-to-be-Done interviewing
- Mental model elicitation and mapping
- Analytics triangulation
- Competitive teardown through user lens
- Participatory and co-design workshops
- Focus groups (with caveats)

## Decision Aids
- Broad attitudinal ask -> reframe to measurable decision questions.
- High strategic risk -> macro framework synthesis.
- Measurable task friction -> micro evaluative methods first.
```

```markdown
<!-- ux-research-skill/methods/interviewing/best-practices.md -->
# Interviewing Best Practices

## Researcher Setup
- Run a worldview reset before session.
- Enter with falsification intent.

## In-Session Behaviors
- Ask open prompts first.
- Use silence deliberately.
- Mirror participant language.
- Avoid leading questions.

## Documentation Standard
- Notes are supplemental.
- Audio is primary record when permitted.
- Video captures interaction context when appropriate.
- Run immediate post-session debrief.
```

```markdown
<!-- ux-research-skill/methods/interviewing/question-craft.md -->
# Interview Question Craft

## Question Types
- Context openers
- Story prompts
- Task walk-through prompts
- Reflection prompts

## Good vs Poor
- Good: "Tell me about the last time you did X."
- Poor: "You liked feature X, right?"

## Flow Choreography
Broad context -> concrete story -> artifact/task -> reflection -> soft close.
```

```markdown
<!-- ux-research-skill/methods/interviewing/contextual-techniques.md -->
# Contextual Techniques

- Show-and-tell artifacts
- Participant-created maps/visuals
- Activity-based elicitation
- Observation and shadowing
```

```markdown
<!-- ux-research-skill/methods/interviewing/remote-optimization.md -->
# Remote Interview Optimization

- Preflight tech checks
- Observer role assignment
- Cue compensation (verbalize uncertainty checks)
- Debrief ritual within 15 minutes
```

```markdown
<!-- ux-research-skill/methods/evaluative/usability-testing.md -->
# Usability Testing

## When to Use
Task-level friction, flow confusion, completion failure risk.

## KPI Linkage
Completion rate, time-on-task, error rate, downstream conversion/retention.
```

```markdown
<!-- ux-research-skill/methods/evaluative/heuristic-evaluation.md -->
# Heuristic Evaluation and Cognitive Walkthrough

## When to Use
Fast expert diagnosis before participant sessions.

## Guardrail
Never use as sole evidence for product decisions with high risk.
```

```markdown
<!-- ux-research-skill/methods/generative/README.md -->
# Generative Methods

Use for opportunity discovery and strategy inputs; always connect outputs to decision owners and macro hypotheses.
```

```markdown
<!-- ux-research-skill/methods/quantitative-metrics.md -->
# Quantitative Metrics Guidance

- Never treat NPS as sole decision metric.
- Tie survey constructs to behavior.
- Use triangulation with qualitative evidence.
```

```markdown
<!-- ux-research-skill/methods/advanced/jtbd-mental-models.md -->
# JTBD and Mental Models

- Capture situation, motivation, desired outcome.
- Build decision-useful model slices, not exhaustive diagrams.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/methods
git commit -m "feat: add methods catalog with interviewing and evaluative foundations"
```

---

### Task 5: Add analysis and synthesis workflow docs

**Files:**
- Create: `ux-research-skill/analysis-synthesis/analysis-tagging.md`
- Create: `ux-research-skill/analysis-synthesis/synthesis-affinity-clustering.md`
- Create: `ux-research-skill/analysis-synthesis/frameworks.md`
- Create: `ux-research-skill/analysis-synthesis/topline-report-template.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: methods output schema from Task 4
- Produces:
  - `python scripts/verify_skill_bundle.py --check analysis`
  - Synthesis artifacts consumed by impact-delivery docs (Task 6)

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_analysis_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "analysis"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with missing analysis/synthesis files.

- [ ] **Step 3: Write minimal implementation**

```python
# add to scripts/verify_skill_bundle.py

def check_analysis() -> None:
    assert_exists([
        "ux-research-skill/analysis-synthesis/analysis-tagging.md",
        "ux-research-skill/analysis-synthesis/synthesis-affinity-clustering.md",
        "ux-research-skill/analysis-synthesis/frameworks.md",
        "ux-research-skill/analysis-synthesis/topline-report-template.md",
    ])
    assert_headings("ux-research-skill/analysis-synthesis/analysis-tagging.md", [
        "# Analysis Tagging",
        "Behaviors",
        "Goals",
        "Workarounds",
        "Mental model signals",
    ])
```

```python
# in main() add:
    if args.check in {"analysis", "all"}:
        check_analysis()
```

```markdown
<!-- ux-research-skill/analysis-synthesis/analysis-tagging.md -->
# Analysis Tagging

Tag evidence units across:
- Behaviors
- Goals
- Workarounds
- Emotions
- Constraints
- Principles
- Jobs
- Mental model signals
```

```markdown
<!-- ux-research-skill/analysis-synthesis/synthesis-affinity-clustering.md -->
# Synthesis via Affinity Clustering

1. Excerpt evidence.
2. Group opportunistically.
3. Regroup and abstract.
4. Label insights.
5. Frame opportunities.
6. Derive recommendations linked to business metrics.
```

```markdown
<!-- ux-research-skill/analysis-synthesis/frameworks.md -->
# Synthesis Framework Build Guides

- Empathy maps
- Goal-directed personas
- Journey/experience maps
- Mental model diagrams
- Service blueprints
- Opportunity and How-Might-We maps
```

```markdown
<!-- ux-research-skill/analysis-synthesis/topline-report-template.md -->
# Topline Report Template

## Decision Summary
## Key Findings with Evidence Trace
## Recommendation and Owner
## Metric Impact Expectation
## Immediate Next Decision
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/analysis-synthesis
git commit -m "feat: add analysis and synthesis workflow docs"
```

---

### Task 6: Add impact-delivery + ResearchOps docs

**Files:**
- Create: `ux-research-skill/impact-delivery/recommendations-tracker.md`
- Create: `ux-research-skill/impact-delivery/stakeholder-engagement.md`
- Create: `ux-research-skill/impact-delivery/research-ops.md`
- Create: `ux-research-skill/impact-delivery/maturity-model.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: synthesis outputs from Task 5
- Produces:
  - `python scripts/verify_skill_bundle.py --check impact`
  - Delivery contracts for templates/prompts (Tasks 7-8)

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_impact_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "impact"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with missing impact-delivery files.

- [ ] **Step 3: Write minimal implementation**

```python
# add to scripts/verify_skill_bundle.py

def check_impact() -> None:
    assert_exists([
        "ux-research-skill/impact-delivery/recommendations-tracker.md",
        "ux-research-skill/impact-delivery/stakeholder-engagement.md",
        "ux-research-skill/impact-delivery/research-ops.md",
        "ux-research-skill/impact-delivery/maturity-model.md",
    ])
    assert_headings("ux-research-skill/impact-delivery/recommendations-tracker.md", [
        "# Recommendations Tracker",
        "Finding",
        "Evidence source",
        "Business metric impacted",
    ])
```

```python
# in main() add:
    if args.check in {"impact", "all"}:
        check_impact()
```

```markdown
<!-- ux-research-skill/impact-delivery/recommendations-tracker.md -->
# Recommendations Tracker

| Finding | Evidence source | Implication | Recommendation | Priority | Owner | Status | Business metric impacted |
|---|---|---|---|---|---|---|---|
| Onboarding drop at step 3 | Session recordings + analytics | Users miss value framing | Rewrite step 3 copy and progress cue | High | PM | Planned | Activation |
```

```markdown
<!-- ux-research-skill/impact-delivery/stakeholder-engagement.md -->
# Stakeholder Engagement

## Executive Delivery
Macro framework summary, strategic risk, and decision pathways.

## Product/Design Delivery
Micro action packets with owner, scope, and metric impact.

## Prioritization
Segment requests by decision urgency and business risk.
```

```markdown
<!-- ux-research-skill/impact-delivery/research-ops.md -->
# ResearchOps

- Intake and prioritization tiers
- Repository and retrieval practices
- Participant management basics
- Rolling research cadence
```

```markdown
<!-- ux-research-skill/impact-delivery/maturity-model.md -->
# Research Maturity Model

1. Ad hoc
2. Project-scoped repeatability
3. Standardized practices
4. Portfolio decision integration
5. Strategic operating system
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/impact-delivery
git commit -m "feat: add impact delivery and researchops docs"
```

---

### Task 7: Add templates + checklists bundle

**Files:**
- Create: `ux-research-skill/templates/research-plan.md`
- Create: `ux-research-skill/templates/screener.md`
- Create: `ux-research-skill/templates/interview-guide.md`
- Create: `ux-research-skill/templates/consent-release.md`
- Create: `ux-research-skill/templates/topline-report.md`
- Create: `ux-research-skill/templates/findings-recommendations-tracker.md`
- Create: `ux-research-skill/templates/photo-video-shot-list.md`
- Create: `ux-research-skill/checklists/study-execution.md`
- Create: `ux-research-skill/checklists/bias-mitigation.md`
- Create: `ux-research-skill/checklists/ethics-safety-inclusion.md`
- Create: `ux-research-skill/checklists/accessibility-wcag-aligned.md`
- Create: `ux-research-skill/checklists/falsification-quality.md`
- Create: `ux-research-skill/checklists/remote-setup-quality.md`
- Create: `ux-research-skill/checklists/listening-rapport-self-score.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: impact delivery contract from Task 6
- Produces:
  - `python scripts/verify_skill_bundle.py --check templates`
  - Reusable execution assets for prompts and pilots

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_templates_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "templates"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with missing template/checklist files.

- [ ] **Step 3: Write minimal implementation**

```python
# add to scripts/verify_skill_bundle.py

def check_templates() -> None:
    assert_exists([
        "ux-research-skill/templates/research-plan.md",
        "ux-research-skill/templates/screener.md",
        "ux-research-skill/templates/interview-guide.md",
        "ux-research-skill/templates/consent-release.md",
        "ux-research-skill/templates/topline-report.md",
        "ux-research-skill/templates/findings-recommendations-tracker.md",
        "ux-research-skill/templates/photo-video-shot-list.md",
        "ux-research-skill/checklists/study-execution.md",
        "ux-research-skill/checklists/bias-mitigation.md",
        "ux-research-skill/checklists/ethics-safety-inclusion.md",
        "ux-research-skill/checklists/accessibility-wcag-aligned.md",
        "ux-research-skill/checklists/falsification-quality.md",
        "ux-research-skill/checklists/remote-setup-quality.md",
        "ux-research-skill/checklists/listening-rapport-self-score.md",
    ])
```

```python
# in main() add:
    if args.check in {"templates", "all"}:
        check_templates()
```

```markdown
<!-- ux-research-skill/templates/research-plan.md -->
# Research Plan Template (Copy/Paste)
- Business problem:
- Decision owner:
- Falsifiable questions:
- Method mix + ROI:
- Metric linkage:
```

```markdown
<!-- ux-research-skill/templates/screener.md -->
# Participant Screener Template
- Target segment criteria
- Exclusion criteria
- Accessibility accommodations
```

```markdown
<!-- ux-research-skill/templates/interview-guide.md -->
# Interview Guide Template
- Context opener
- Recent-story prompt
- Task walk-through
- Reflection close
```

```markdown
<!-- ux-research-skill/templates/consent-release.md -->
# Consent and Release Template
- Study purpose
- Recording consent options
- Data retention statement
```

```markdown
<!-- ux-research-skill/templates/topline-report.md -->
# Topline Report Template
- Decision summary
- Top findings
- Recommendation + owner
- Metric impact
```

```markdown
<!-- ux-research-skill/templates/findings-recommendations-tracker.md -->
# Findings to Recommendations Tracker Template
| Finding | Evidence | Recommendation | Owner | Priority | Metric |
|---|---|---|---|---|---|
```

```markdown
<!-- ux-research-skill/templates/photo-video-shot-list.md -->
# Photo/Video Shot List Template
- Workspace context
- Artifact interactions
- Key failure/success moments
```

```markdown
<!-- ux-research-skill/checklists/study-execution.md -->
# Study Execution Checklist
## Pre
## During
## Post
```

```markdown
<!-- ux-research-skill/checklists/bias-mitigation.md -->
# Bias Mitigation Checklist
- Leading-question scan
- Confirmation-bias scan
- Sampling-bias scan
```

```markdown
<!-- ux-research-skill/checklists/ethics-safety-inclusion.md -->
# Ethics, Safety, and Inclusion Checklist
- Informed consent confirmed
- Sensitive-topic protocol in place
- Inclusion safeguards applied
```

```markdown
<!-- ux-research-skill/checklists/accessibility-wcag-aligned.md -->
# Accessibility (WCAG-Aligned) Checklist
- Participant accommodations planned
- Materials readability checked
- Assistive-tech compatibility checked
```

```markdown
<!-- ux-research-skill/checklists/falsification-quality.md -->
# Falsification Quality Checklist
- Assumption explicitly stated
- Disconfirming evidence threshold stated
- Alternative explanation considered
```

```markdown
<!-- ux-research-skill/checklists/remote-setup-quality.md -->
# Remote Setup Quality Checklist
- Connectivity preflight completed
- Recording backup prepared
- Observer roles assigned
```

```markdown
<!-- ux-research-skill/checklists/listening-rapport-self-score.md -->
# Listening and Rapport Self-Score
Rate 1-5:
- Interruptions minimized
- Participant vocabulary mirrored
- Silence used effectively
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/templates ux-research-skill/checklists
git commit -m "feat: add reusable templates and quality checklists"
```

---

### Task 8: Add prompts + references + cross-linking and full verification

**Files:**
- Create: `ux-research-skill/prompts/grok-integration.md`
- Create: `ux-research-skill/references/key-quotes.md`
- Create: `ux-research-skill/references/book-summaries.md`
- Create: `ux-research-skill/references/external-resources.md`
- Modify: `ux-research-skill/README.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: all previous module docs
- Produces:
  - `python scripts/verify_skill_bundle.py --check prompts`
  - `python scripts/verify_skill_bundle.py --check all`
  - Release-ready bundle navigation and prompt workflows

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_prompts_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "prompts"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_all_check_passes(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "all"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL with missing prompt/reference files and/or incomplete README cross-links.

- [ ] **Step 3: Write minimal implementation**

```python
# add to scripts/verify_skill_bundle.py

def check_prompts() -> None:
    assert_exists([
        "ux-research-skill/prompts/grok-integration.md",
        "ux-research-skill/references/key-quotes.md",
        "ux-research-skill/references/book-summaries.md",
        "ux-research-skill/references/external-resources.md",
    ])
    assert_headings("ux-research-skill/prompts/grok-integration.md", [
        "# Grok Integration Prompts",
        "Convert stakeholder asks into micro or macro plans",
        "Diagnose middle-range risk",
        "Map findings to business metrics",
    ])
```

```python
# in main() ensure all checks run for --check all
    if args.check in {"all"}:
        check_structure()
        check_core()
        check_planning()
        check_methods()
        check_analysis()
        check_impact()
        check_templates()
        check_prompts()
```

```python
# tests/test_skill_bundle.py final file
import subprocess
import unittest


class TestSkillBundle(unittest.TestCase):
    def run_check(self, check_name: str):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", check_name],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)

    def test_structure_check_passes(self):
        self.run_check("structure")

    def test_core_check_passes(self):
        self.run_check("core")

    def test_planning_check_passes(self):
        self.run_check("planning")

    def test_methods_check_passes(self):
        self.run_check("methods")

    def test_analysis_check_passes(self):
        self.run_check("analysis")

    def test_impact_check_passes(self):
        self.run_check("impact")

    def test_templates_check_passes(self):
        self.run_check("templates")

    def test_prompts_check_passes(self):
        self.run_check("prompts")

    def test_all_check_passes(self):
        self.run_check("all")


if __name__ == "__main__":
    unittest.main()
```

```markdown
<!-- ux-research-skill/prompts/grok-integration.md -->
# Grok Integration Prompts

## Convert stakeholder asks into micro or macro plans
"Classify this request as micro, middle-range, or macro. If middle-range, reframe it to decision-ready micro or macro outputs with falsifiable questions and metric linkage."

## Diagnose middle-range risk
"Identify why this request is descriptive-only and rewrite it into a decision-targeted plan with owner, timeline, and disconfirming evidence threshold."

## Generate falsification-oriented interview guide
"Produce an interview guide that can disprove our assumption, not just validate it. Include disconfirming probes and behavior-first prompts."

## Tag and cluster findings
"Tag this evidence by behavior, goal, workaround, emotion, and constraint, then cluster into insights and opportunities."

## Map findings to business metrics
"For each recommendation, map expected movement in engagement/conversion/retention/churn and name owner + decision checkpoint."

## Prioritize research queue
"Prioritize these research requests by decision urgency, business risk, and expected ROI."
```

```markdown
<!-- ux-research-skill/references/key-quotes.md -->
# Key Quotes

- "Research is useful only when it changes a decision."
- "Validation theater hides risk; falsification reveals it."
```

```markdown
<!-- ux-research-skill/references/book-summaries.md -->
# Book Summaries

## Interviewing Users (Portigal)
Focus on better conversations, active listening, and contextual understanding.

## Don’t Make Me Think (Krug)
Prioritize clarity and task flow; reduce friction visible in usability sessions.

## Lean UX
Ship learning loops that tie evidence to product decisions quickly.
```

```markdown
<!-- ux-research-skill/references/external-resources.md -->
# External Resources

- Nielsen Norman Group
- Interaction Design Foundation
- WCAG guidance
```

```markdown
<!-- replace ux-research-skill/README.md -->
# UX Research Skill

## Quick Start
1. Read `philosophy-principles.md`
2. Read `research-classification.md`
3. Pick planning docs in `planning/`
4. Select methods in `methods/`
5. Synthesize using `analysis-synthesis/`
6. Deliver via `impact-delivery/`
7. Reuse `templates/` and `checklists/`
8. Run prompts from `prompts/grok-integration.md`

## Bundle Map
- Core: philosophy + classification
- Planning: plan template + business translation + alignment
- Methods: interviewing, evaluative, generative, quantitative, advanced
- Synthesis: tagging, clustering, frameworks, topline
- Delivery: tracker, stakeholder engagement, ops, maturity
- Assets: templates, checklists, prompts, references

## Verification
Run `python -m unittest tests/test_skill_bundle.py -v`
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS with 9 passing tests.

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/README.md ux-research-skill/prompts ux-research-skill/references
git commit -m "feat: add prompt integrations references and full bundle verification"
```

---

### Task 9: Dry-run validation for one micro and one macro case + release note

**Files:**
- Modify: `ux-research-skill/README.md`
- Create: `ux-research-skill/examples/micro-case.md`
- Create: `ux-research-skill/examples/macro-case.md`
- Create: `ux-research-skill/CHANGELOG.md`
- Modify: `scripts/verify_skill_bundle.py`
- Modify: `tests/test_skill_bundle.py`

**Interfaces:**
- Consumes: full bundle from Tasks 1-8
- Produces:
  - `python scripts/verify_skill_bundle.py --check all`
  - documented proof of end-to-end micro/macro usage

- [ ] **Step 1: Write the failing test**

```python
# add to tests/test_skill_bundle.py
    def test_examples_exist_for_micro_and_macro(self):
        result = subprocess.run(
            ["python", "scripts/verify_skill_bundle.py", "--check", "all"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: FAIL because example/changelog files are not included in current verification rules.

- [ ] **Step 3: Write minimal implementation**

```python
# extend check_prompts() or add check_examples() in scripts/verify_skill_bundle.py

def check_examples() -> None:
    assert_exists([
        "ux-research-skill/examples/micro-case.md",
        "ux-research-skill/examples/macro-case.md",
        "ux-research-skill/CHANGELOG.md",
    ])

# in main():
    if args.check in {"all"}:
        check_examples()
```

```markdown
<!-- ux-research-skill/examples/micro-case.md -->
# Micro Case Dry Run

## Input
"Users abandon onboarding at profile setup."

## Classification
Micro

## Output Summary
- Falsifiable question: Is profile setup complexity the primary drop-off driver?
- Method: usability testing + analytics triangulation
- Recommendation: simplify profile step and measure activation delta
```

```markdown
<!-- ux-research-skill/examples/macro-case.md -->
# Macro Case Dry Run

## Input
"Which enterprise segment should we prioritize next year?"

## Classification
Macro

## Output Summary
- Falsifiable question: Does segment A show stronger unmet high-value jobs than segment B?
- Method: strategic interviews + market signal triangulation
- Recommendation: prioritize segment with highest strategic fit and retention potential
```

```markdown
<!-- ux-research-skill/CHANGELOG.md -->
# Changelog

## 1.0.0
- Initial markdown-native UX research skill/plugin bundle
- Includes philosophy, classification, planning, methods, synthesis, delivery, templates, checklists, prompts, references, and dry-run examples
```

```markdown
<!-- append to ux-research-skill/README.md -->
## Examples
- `examples/micro-case.md`
- `examples/macro-case.md`

## Versioning
See `CHANGELOG.md`.
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/test_skill_bundle.py -v`
Expected: PASS (`OK`).

- [ ] **Step 5: Commit**

```bash
git add tests/test_skill_bundle.py scripts/verify_skill_bundle.py ux-research-skill/examples ux-research-skill/CHANGELOG.md ux-research-skill/README.md
git commit -m "docs: add micro/macro dry-run examples and v1 changelog"
```

---

## Self-Review (completed)

### 1) Spec coverage check
- Philosophy/non-negotiables/red flags: Task 2
- Classification lens + middle-range reframing: Task 2
- Planning assets: Task 3
- Methods catalog + interviewing deep dive + evaluative/generative/quant/advanced: Task 4
- Analysis/synthesis + frameworks + topline: Task 5
- Impact delivery + ResearchOps + maturity: Task 6
- Templates/checklists: Task 7
- Prompt integration + references: Task 8
- End-to-end dry run (micro + macro) and rollout proof: Task 9
- Gaps found: none

### 2) Placeholder scan
- No `TBD`, `TODO`, or deferred placeholders in plan steps.
- All code-changing steps include concrete code blocks and exact commands.

### 3) Type/signature consistency
- `scripts/verify_skill_bundle.py --check <name>` used consistently across tasks.
- Reused interfaces (`assert_exists`, `assert_headings`) remain unchanged.

