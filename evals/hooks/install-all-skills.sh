#!/usr/bin/env bash
# Copy the full Lamina skills tree into an eval agent workspace.
# Requires ASE_WORKSPACE_PATH and ASE_AGENT (mirrors agent_skill_eval SkillInstaller paths).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
WORKSPACE="${ASE_WORKSPACE_PATH:?ASE_WORKSPACE_PATH is required}"
AGENT="${ASE_AGENT:-codex}"

agent_skill_dirs() {
  case "$AGENT" in
    codex) printf '%s\n' ".codex/skills" ".agents/skills" ;;
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

installed=0
while IFS= read -r rel; do
  dest_root="$WORKSPACE/$rel"
  mkdir -p "$dest_root"
  for skill_dir in "$ROOT/skills"/*; do
    [[ -d "$skill_dir" ]] || continue
    copy_skill "$skill_dir" "$dest_root"
    installed=$((installed + 1))
  done
done < <(agent_skill_dirs)

# installed counts skills × agent roots; report unique skill names from first root.
first_root="$WORKSPACE/$(agent_skill_dirs | head -1)"
skill_count=0
if [[ -d "$first_root" ]]; then
  skill_count="$(find "$first_root" -mindepth 1 -maxdepth 1 -type d | wc -l | tr -d ' ')"
fi
echo "Installed $skill_count Lamina skills for agent $AGENT → $WORKSPACE"
