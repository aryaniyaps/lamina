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


def check_planning() -> None:
    assert_exists([
        "ux-research-skill/planning/research-plan-template.md",
        "ux-research-skill/planning/business-need-to-rq.md",
        "ux-research-skill/planning/stakeholder-alignment.md",
    ])
    assert_headings(
        "ux-research-skill/planning/research-plan-template.md",
        [
            "# Research Plan Template",
            "## 1) Business problem or opportunity",
            "## 2) Research objectives and prioritized falsifiable questions",
            "## Assumption mapping",
            "## Jobs-to-be-Done framing",
            "## Stakeholder alignment checklist",
        ],
    )


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
    assert_headings(
        "ux-research-skill/methods/catalog.md",
        [
            "# Methods Catalog",
            "## Method Entry Standard",
            "## Core Methods",
            "In-depth interviewing",
            "Analytics triangulation",
            "Focus groups (with caveats)",
        ],
    )


def check_analysis() -> None:
    assert_exists([
        "ux-research-skill/analysis-synthesis/analysis-tagging.md",
        "ux-research-skill/analysis-synthesis/synthesis-affinity-clustering.md",
        "ux-research-skill/analysis-synthesis/frameworks.md",
        "ux-research-skill/analysis-synthesis/topline-report-template.md",
    ])
    assert_headings(
        "ux-research-skill/analysis-synthesis/analysis-tagging.md",
        ["# Analysis Tagging", "Behaviors", "Goals", "Workarounds", "Mental model signals"],
    )


def check_impact() -> None:
    assert_exists([
        "ux-research-skill/impact-delivery/recommendations-tracker.md",
        "ux-research-skill/impact-delivery/stakeholder-engagement.md",
        "ux-research-skill/impact-delivery/research-ops.md",
        "ux-research-skill/impact-delivery/maturity-model.md",
    ])
    assert_headings(
        "ux-research-skill/impact-delivery/recommendations-tracker.md",
        ["# Recommendations Tracker", "Finding", "Evidence source", "Business metric impacted"],
    )


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


def check_prompts() -> None:
    assert_exists([
        "ux-research-skill/prompts/grok-integration.md",
        "ux-research-skill/references/key-quotes.md",
        "ux-research-skill/references/book-summaries.md",
        "ux-research-skill/references/external-resources.md",
    ])
    assert_headings(
        "ux-research-skill/prompts/grok-integration.md",
        [
            "# Grok Integration Prompts",
            "Convert stakeholder asks into micro or macro plans",
            "Diagnose middle-range risk",
            "Map findings to business metrics",
        ],
    )


def check_examples() -> None:
    assert_exists([
        "ux-research-skill/examples/micro-case.md",
        "ux-research-skill/examples/macro-case.md",
        "ux-research-skill/CHANGELOG.md",
    ])


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--check",
        required=True,
        choices=["structure", "core", "planning", "methods", "analysis", "impact", "templates", "prompts", "all"],
    )
    args = parser.parse_args()

    if args.check in {"structure", "all"}:
        check_structure()
    if args.check in {"core", "all"}:
        check_core()
    if args.check in {"planning", "all"}:
        check_planning()
    if args.check in {"methods", "all"}:
        check_methods()
    if args.check in {"analysis", "all"}:
        check_analysis()
    if args.check in {"impact", "all"}:
        check_impact()
    if args.check in {"templates", "all"}:
        check_templates()
    if args.check in {"prompts", "all"}:
        check_prompts()
    if args.check in {"all"}:
        check_examples()

    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
