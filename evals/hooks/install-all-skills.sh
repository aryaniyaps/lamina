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

# Codex workspace-write intentionally mounts .git read-only. Keep graphd's
# required clone-local logical path while resolving its eval-only storage into
# the writable .lamina namespace used by Lamina command artifacts.
mkdir -p "$WORKSPACE/.lamina/runtime"
if [[ ! -e "$WORKSPACE/.git/lamina" ]]; then
  case "$(uname -s)" in
    MINGW*|MSYS*|CYGWIN*) mkdir -p "$WORKSPACE/.git/lamina" ;;
    *) ln -s ../.lamina/runtime "$WORKSPACE/.git/lamina" ;;
  esac
fi

# The agent starts graphd on first use. Starting it in this hook is unsafe
# because some eval harnesses reap hook descendants, leaving Ladybug's native
# lock behind without a live socket.
echo "Installed $skill_count public Lamina skills for agent $AGENT → $WORKSPACE"
