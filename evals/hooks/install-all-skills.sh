#!/usr/bin/env bash
# Copy every public Lamina skill into an eval agent workspace.
# Requires ASE_WORKSPACE_PATH and ASE_AGENT (mirrors agent_skill_eval SkillInstaller paths).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKSPACE="${ASE_WORKSPACE_PATH:?ASE_WORKSPACE_PATH is required}"
AGENT="${ASE_AGENT:-codex}"

agent_skill_dirs() {
  case "$AGENT" in
    codex) printf '%s\n' ".codex/skills" ".agents/skills" ;;
    fake) printf '%s\n' ".fake/skills" ;;
    claude-code) printf '%s\n' ".claude/skills" ;;
    opencode) printf '%s\n' ".opencode/skills" ".agents/skills" ;;
    cursor) printf '%s\n' ".cursor/skills" ".agents/skills" ;;
    gemini-cli) printf '%s\n' ".gemini/skills" ".agents/skills" ;;
    github-copilot) printf '%s\n' ".github/skills" ".agents/skills" ;;
    roo-code|roo) printf '%s\n' ".roo/skills" ".agents/skills" ;;
    *) printf '%s\n' ".agents/skills" ;;
  esac
}

copy_skill() {
  local src="$1"
  local dest_base="$2"
  local name dest base item

  [[ -f "$src/SKILL.md" ]] || return 0
  name="$(basename "$src")"
  dest="$dest_base/$name"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -a "$src/SKILL.md" "$dest/"

  shopt -s nullglob
  for item in "$src"/*; do
    base="$(basename "$item")"
    case "$base" in
      SKILL.md|evals|__pycache__|.git) continue ;;
    esac
    cp -a "$item" "$dest/"
  done
  shopt -u nullglob
}

while IFS= read -r rel; do
  dest_root="$WORKSPACE/$rel"
  mkdir -p "$dest_root"
  for skill_dir in "$ROOT/skills"/*; do
    [[ -d "$skill_dir" ]] || continue
    copy_skill "$skill_dir" "$dest_root"
  done
done < <(agent_skill_dirs)

# installed counts skills × agent roots; report unique skill names from first root.
first_root="$WORKSPACE/$(agent_skill_dirs | head -1)"
skill_count=0
if [[ -d "$first_root" ]]; then
  skill_count="$(find "$first_root" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
fi

# Keep the source CLI independently available from the skill copy for local
# evals. Public users install the checksum-verified GitHub Release executable;
# this source-only harness deliberately avoids pretending there is an npm CLI.
CLI_PREFIX="$WORKSPACE/.lamina/runtime-cli"
mkdir -p "$CLI_PREFIX/bin"
ln -sfn "$ROOT/packages/cli/bin/lamina.mjs" "$CLI_PREFIX/bin/lamina"

# graphd derives branch and source identity from Git. ASE workspaces are plain
# directories by default, so establish a deterministic clone boundary while
# excluding installed treatment/runtime files from the source snapshot.
if ! git -C "$WORKSPACE" rev-parse --git-dir >/dev/null 2>&1; then
  git -C "$WORKSPACE" init -b main >/dev/null
fi
if ! git -C "$WORKSPACE" rev-parse --verify HEAD >/dev/null 2>&1; then
  git -C "$WORKSPACE" config user.email eval@lamina.invalid
  git -C "$WORKSPACE" config user.name "Lamina Eval"
  {
    printf '.codex/\n'
    printf '.claude/\n'
    printf '.opencode/\n'
    printf '.agents/\n'
    printf 'node_modules/\n'
    printf '.lamina/runtime-cli/\n'
    printf '.lamina/runtime/\n'
  } >>"$WORKSPACE/.git/info/exclude"
  git -C "$WORKSPACE" add -A
  git -C "$WORKSPACE" commit --allow-empty -m "eval fixture" >/dev/null
fi

# Paid agents run with the eval harness's local-only write grant. Keep graphd in
# its production location under Git's common directory so runtime churn can
# never stale the source revision it is meant to describe.
mkdir -p "$WORKSPACE/.git/lamina"

# Reproduce the real post-install treatment: skills provide judgment and the
# managed provider rule makes ordinary product requests activate Lamina.
case "$AGENT" in
  codex) (cd "$WORKSPACE" && "$CLI_PREFIX/bin/lamina" setup --agent codex >/dev/null) ;;
  claude-code) (cd "$WORKSPACE" && "$CLI_PREFIX/bin/lamina" setup --agent claude-code >/dev/null) ;;
  cursor) (cd "$WORKSPACE" && "$CLI_PREFIX/bin/lamina" setup --agent cursor >/dev/null) ;;
esac

# Declare the real browser capability supplied by this paid harness. This is
# environment context, not a Lamina phase command: agents still own the audit
# plan and must attach distinct functional/visual/responsive/accessibility
# evidence before `lamina work verify` can succeed.
provider_file="$WORKSPACE/AGENTS.md"
if [[ "$AGENT" == "claude-code" ]]; then provider_file="$WORKSPACE/CLAUDE.md"; fi
if [[ -f "$provider_file" ]]; then
  {
    printf '\n## Eval browser capability\n\n'
    printf 'A real `playwright` CLI and cached Chromium are on PATH. Use them for live UI verification; do not recursively search the filesystem for a browser. Record distinct functional, visual, responsive, and accessibility artifacts.\n'
  } >>"$provider_file"
fi

# ASE's declared pre-run hook is suite-level and has no case workspace. The
# full-tree installer, however, runs after the fixture is staged for each case.
# Seed passive product context at this real lifecycle boundary.
eval_id="${ASE_EVAL_ID:-}"
if [[ -z "$eval_id" ]]; then
  workspace_name="$(basename "$WORKSPACE")"
  for candidate in \
    passive-feature-implementation \
    passive-ui-live-verification \
    passive-design-gap-before-edit; do
    if [[ "$workspace_name" == *"$candidate"* ]]; then
      eval_id="$candidate"
      break
    fi
  done
fi
case "$eval_id" in
  passive-feature-implementation|passive-ui-live-verification|passive-design-gap-before-edit)
    ASE_EVAL_ID="$eval_id" node "$ROOT/evals/scripts/seed-passive-context.mjs"
    ;;
esac

if [[ "$eval_id" == "passive-ui-live-verification" && -f "$provider_file" ]]; then
  {
    printf '\n## Live storefront fixture\n\n'
    printf 'The checkout audit has a deterministic local backend. Start it with `node scripts/lamina-eval-live-ui.mjs`, then audit `http://127.0.0.1:43111/product/recovery-test-product`. Before each desktop or mobile navigation, set a `cartId=gid://shopify/Cart/recovery-test` cookie for `127.0.0.1`; the deterministic backend then renders a populated cart and makes the checkout submission fail safely so recovery behavior can be exercised. Treat the server command as long-running and do not edit the fixture script.\n'
  } >>"$provider_file"
fi

echo "Installed $skill_count public Lamina skills for agent $AGENT → $WORKSPACE"
