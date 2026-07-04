# Lamina Full Skill Bundle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement all `IMPLEMENTATION.md` requirements as a heavy-skill + command bundle, with Claude-first launch and **single-source skills distribution via `npx skills`**.

**Architecture:** Keep orchestration in skills and command prompts, not in CLI code. Build command wrappers (`commands/*.md`) that route to skill modules (`skills/*/SKILL.md`), produce full `.lamina/*` artifacts, publish one canonical skills source, and let the Skills CLI install to each agent-specific directory. No hand-maintained per-agent file trees.

**Tech Stack:** Markdown, Node.js (for lightweight verification scripts only), Python stdlib (`unittest`), git.

## Web-researched distribution model (locked)

Use **one canonical skills source** and let the Skills CLI place files for each agent:

- Canonical source: `skills/*/SKILL.md` in this repo
- Install command: `npx skills add <owner/repo>`
- Target agents: `-a claude-code -a cursor -a codex -a pi ...` (or `-a '*'`)
- Scope: project default, global via `-g`
- Method: symlink default, `--copy` when symlinks are unavailable

This replaces hand-written per-agent distribution files.

Verified from `vercel-labs/skills` docs:
- `skills add`, `skills list`, `skills update`, `skills remove`, `skills use`
- single-source SKILL format (`name` + `description` frontmatter)
- multi-agent install matrix (70+ agents, including Claude, Cursor, Codex, Pi, Roo, Windsurf, OpenCode, Continue, Copilot, Gemini CLI)

Coverage rule: when an agent supports Skills CLI, do not maintain dedicated format files for it. Use Skills CLI install instructions only.

## Global Constraints

- Implement all `IMPLEMENTATION.md` scope except analytics connector implementations.
- CLI is dashboard-only for visual verification; CLI must not become orchestrator.
- Keep outputs UX-only: no visual styling specs, no implementation code generation.
- Always include rationale, assumptions, confidence/gaps, edge cases, and human verification points.
- Keep skill behavior output-based and non-opinionated about internal mechanics.
- Preserve and reuse `.lamina/*` state across sessions.
- Add required checkpoints: framing, synthesis validation, task commit.
- Do not add/maintain agent-specific instruction/rules directories in-repo when Skills CLI support exists.

---

## File Structure

**Delete:**
- `ux-research-skill/` (entire legacy directory)

**Create:**
- `commands/lamina.md`
- `commands/lamina-ideate.md`
- `commands/lamina-optimize.md`
- `commands/lamina-feature.md`
- `skills/lamina-core/SKILL.md`
- `skills/lamina-context-discovery/SKILL.md`
- `skills/lamina-research-questions/SKILL.md`
- `skills/lamina-flow-ideate/SKILL.md`
- `skills/lamina-flow-optimize/SKILL.md`
- `skills/lamina-flow-feature/SKILL.md`
- `skills/lamina-synthesis/SKILL.md`
- `skills/lamina-insights/SKILL.md`
- `skills/lamina-personas/SKILL.md`
- `skills/lamina-journeys/SKILL.md`
- `skills/lamina-edge-cases/SKILL.md`
- `skills/lamina-requirements/SKILL.md`
- `skills/lamina-tasks/SKILL.md`
- `skills/lamina-handoff/SKILL.md`
- `skills/lamina-artifacts/SKILL.md`
- `skills/lamina-guardrails/SKILL.md`
- `docs/superpowers/distribution/skills-cli.md`
- `mcp/README.md`
- `mcp/schema.md`
- `dashboard/README.md`
- `dashboard/visual-verification.md`
- `tests/unit/test_contracts.py`
- `tests/integration/test_flows.md`
- `tests/golden/expected-artifacts.md`
- `tests/fixtures/minimal-nextjs/README.md`
- `tests/fixtures/mobile-app/README.md`
- `scripts/verify_lamina_bundle.py`

**Modify:**
- `README.md`
- `package.json`
- `docs/superpowers/specs/2026-07-04-lamina-claude-skill-plugin-design.md`

---

### Task 1: Remove legacy directory and scaffold new bundle root

**Files:**
- Delete: `ux-research-skill/`
- Create: `commands/.gitkeep`
- Create: `skills/.gitkeep`
- Create: `mcp/.gitkeep`
- Create: `dashboard/.gitkeep`
- Create: `scripts/verify_lamina_bundle.py`
- Create: `tests/unit/test_contracts.py`

**Interfaces:**
- Produces: `python scripts/verify_lamina_bundle.py --check structure`

- [ ] **Step 1: Write the failing test**

```python
# tests/unit/test_contracts.py
import subprocess
import unittest


class TestLaminaStructure(unittest.TestCase):
    def test_structure(self):
        result = subprocess.run(
            ["python", "scripts/verify_lamina_bundle.py", "--check", "structure"],
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, msg=result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m unittest tests/unit/test_contracts.py -v`  
Expected: FAIL (`verify_lamina_bundle.py` missing).

- [ ] **Step 3: Write minimal implementation**

```python
# scripts/verify_lamina_bundle.py
from pathlib import Path
import argparse

ROOT = Path(__file__).resolve().parent.parent


def check_structure() -> None:
    required = ["commands", "skills", "mcp", "dashboard", "README.md"]
    missing = [p for p in required if not (ROOT / p).exists()]
    if missing:
        raise SystemExit("Missing:\n" + "\n".join(missing))
    if (ROOT / "ux-research-skill").exists():
        raise SystemExit("Legacy directory still exists: ux-research-skill")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", choices=["structure", "all"], required=True)
    args = parser.parse_args()
    check_structure()
    print("OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
```

```bash
rm -rf ux-research-skill
mkdir -p commands skills mcp dashboard tests/unit
touch commands/.gitkeep skills/.gitkeep mcp/.gitkeep dashboard/.gitkeep
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m unittest tests/unit/test_contracts.py -v`  
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove ux-research-skill and scaffold lamina bundle"
```

---

### Task 2: Add command wrappers

**Files:**
- Create: `commands/lamina.md`
- Create: `commands/lamina-ideate.md`
- Create: `commands/lamina-optimize.md`
- Create: `commands/lamina-feature.md`
- Modify: `scripts/verify_lamina_bundle.py`

**Interfaces:**
- Produces: `/lamina`, `/lamina-ideate`, `/lamina-optimize`, `/lamina-feature`

- [ ] **Step 1: Write failing test**

Add heading checks for all command files in `verify_lamina_bundle.py`.

- [ ] **Step 2: Run to fail**

Run: `python scripts/verify_lamina_bundle.py --check all`  
Expected: FAIL missing command files.

- [ ] **Step 3: Write minimal implementation**

Each command file must include:
- frontmatter `description`
- call flow intent
- references to skills (`lamina-core`, `lamina-artifacts`, plus specific flow skill)
- checkpoint reminder before writes

- [ ] **Step 4: Re-run checks**

Run: `python scripts/verify_lamina_bundle.py --check all`  
Expected: PASS command checks.

- [ ] **Step 5: Commit**

```bash
git add commands scripts/verify_lamina_bundle.py
git commit -m "feat: add lamina command wrappers"
```

---

### Task 3: Implement core/guardrail/artifact skills

**Files:**
- Create: `skills/lamina-core/SKILL.md`
- Create: `skills/lamina-guardrails/SKILL.md`
- Create: `skills/lamina-artifacts/SKILL.md`
- Modify: `scripts/verify_lamina_bundle.py`

**Interfaces:**
- Consumes: command wrappers
- Produces: output contract + banned-output rules + artifact write policy

- [ ] **Step 1:** Add failing checks for required sections in these three skills.
- [ ] **Step 2:** Run verifier and confirm fail.
- [ ] **Step 3:** Add SKILL content with required sections:
  - name/description frontmatter
  - when-to-use
  - required outputs
  - checkpoint behavior
  - artifact schema mapping
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 4: Implement discovery + research + flow skills

**Files:**
- Create: `skills/lamina-context-discovery/SKILL.md`
- Create: `skills/lamina-research-questions/SKILL.md`
- Create: `skills/lamina-flow-ideate/SKILL.md`
- Create: `skills/lamina-flow-optimize/SKILL.md`
- Create: `skills/lamina-flow-feature/SKILL.md`

**Interfaces:**
- Produces: discovery summary, confidence/gaps, flow-specific question sets

- [ ] **Step 1:** Add failing verifier checks for headings and required bullets.
- [ ] **Step 2:** Run verifier to fail.
- [ ] **Step 3:** Write all 5 skills with minimal-question guided mode + expert mode.
- [ ] **Step 4:** Run verifier.
- [ ] **Step 5:** Commit.

---

### Task 5: Implement synthesis/personas/insights/journeys skills

**Files:**
- Create: `skills/lamina-synthesis/SKILL.md`
- Create: `skills/lamina-insights/SKILL.md`
- Create: `skills/lamina-personas/SKILL.md`
- Create: `skills/lamina-journeys/SKILL.md`

**Interfaces:**
- Produces: `.lamina/insights.md`, `.lamina/personas.md`, `.lamina/journeys/*.md`, `.lamina/user-journeys.md`

- [ ] **Step 1:** Add failing verifier checks.
- [ ] **Step 2:** Run verifier to fail.
- [ ] **Step 3:** Write skills with exact required sections from spec.
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 6: Implement edge-cases/requirements/tasks/handoff skills

**Files:**
- Create: `skills/lamina-edge-cases/SKILL.md`
- Create: `skills/lamina-requirements/SKILL.md`
- Create: `skills/lamina-tasks/SKILL.md`
- Create: `skills/lamina-handoff/SKILL.md`

**Interfaces:**
- Produces: `.lamina/edge-cases.md`, `.lamina/requirements.md`, `.lamina/ux-requirements.md`, `.lamina/implementation-tasks.md`

- [ ] **Step 1:** Add failing checks.
- [ ] **Step 2:** Run verifier to fail.
- [ ] **Step 3:** Write skill files with P0/P1/P2 task format and verification sections.
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 7: Add Skills CLI distribution docs (single-source install)

**Files:**
- Create: `docs/superpowers/distribution/skills-cli.md`
- Modify: `README.md`
- Modify: `scripts/verify_lamina_bundle.py`

**Interfaces:**
- Produces: one canonical skills source + copy/paste install commands for multi-agent install via `npx skills add`

- [ ] **Step 1:** Add failing checks for:
  - presence of `docs/superpowers/distribution/skills-cli.md`
  - README includes `npx skills add <repo>` flow
  - README includes at least one targeted example (`-a claude-code -a cursor -a codex -a pi`)
- [ ] **Step 2:** Run verifier and fail.
- [ ] **Step 3:** Write minimal distribution doc with:
  - install commands (`add`, `list`, `update`, `remove`)
  - project vs global (`-g`) guidance
  - symlink vs `--copy` guidance
  - non-interactive CI example (`-y`)
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 8: Add MCP contract docs

**Files:**
- Create: `mcp/README.md`
- Create: `mcp/schema.md`

**Interfaces:**
- Produces: provider-neutral MCP mapping to Lamina artifact outputs

- [ ] **Step 1:** Add failing check for required JSON shape example.
- [ ] **Step 2:** Run verifier and fail.
- [ ] **Step 3:** Write docs with stable fields:
  - `summary`
  - `artifactsChanged`
  - `implementationTasksPath`
  - `nextAction`
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 9: Add dashboard-only CLI docs (no orchestration)

**Files:**
- Create: `dashboard/README.md`
- Create: `dashboard/visual-verification.md`

**Interfaces:**
- Produces: explicit dashboard purpose and forbidden orchestration role

- [ ] **Step 1:** Add failing verifier check for phrase `verification-only` and `not orchestrator`.
- [ ] **Step 2:** Run verifier and fail.
- [ ] **Step 3:** Write docs and examples for artifact diff/quality views.
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 10: Add fixture/golden/integration tests

**Files:**
- Create: `tests/integration/test_flows.md`
- Create: `tests/golden/expected-artifacts.md`
- Create: `tests/fixtures/minimal-nextjs/README.md`
- Create: `tests/fixtures/mobile-app/README.md`
- Modify: `scripts/verify_lamina_bundle.py`

**Interfaces:**
- Produces: reproducible verification matrix

- [ ] **Step 1:** Add failing check for required test docs.
- [ ] **Step 2:** Run verifier and fail.
- [ ] **Step 3:** Add the docs with explicit commands and expected outputs.
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 11: Update top-level docs and package metadata

**Files:**
- Modify: `README.md`
- Modify: `package.json`

**Interfaces:**
- Produces: accurate install/use docs for command + skills + Skills CLI distribution flow

- [ ] **Step 1:** Add failing check that README contains `/lamina` command list and artifact list.
- [ ] **Step 2:** Run verifier and fail.
- [ ] **Step 3:** Update README and package metadata (`keywords`, scripts if needed for verification only).
- [ ] **Step 4:** Re-run verifier.
- [ ] **Step 5:** Commit.

---

### Task 12: Final verification and completion gate

**Files:**
- Modify: `scripts/verify_lamina_bundle.py`

**Interfaces:**
- Produces: one command `python scripts/verify_lamina_bundle.py --check all`

- [ ] **Step 1:** Run full check.

Run: `python scripts/verify_lamina_bundle.py --check all`  
Expected: `OK`

- [ ] **Step 2:** Run unit test.

Run: `python -m unittest tests/unit/test_contracts.py -v`  
Expected: PASS

- [ ] **Step 3:** Commit.

```bash
git add -A
git commit -m "chore: finalize lamina full skill bundle plan outputs"
```

---

## Self-Review

1. **Spec coverage:** This plan includes full scope from `IMPLEMENTATION.md` except analytics connector implementation (explicitly deferred).
2. **Placeholder scan:** No `TBD`/`TODO` placeholders.
3. **Type/interface consistency:** Commands/skills plus Skills CLI distribution flow are consistent with researched docs.

---

Plan complete and saved to `docs/superpowers/plans/2026-07-04-ux-research-skill-v1.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?