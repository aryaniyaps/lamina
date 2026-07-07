#!/usr/bin/env bash
# Weekly install compatibility matrix for agentskills.io clients.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
OUT="$ROOT/evals/reports/compatibility-matrix.json"
mkdir -p "$(dirname "$OUT")"

# shellcheck source=skills-sandbox.sh
source "$ROOT/evals/hooks/skills-sandbox.sh"

AGENTS=(
  cursor
  claude-code
  codex
  opencode
  gemini-cli
  github-copilot
  roo
  windsurf
  cline
  amp
  goose
  antigravity
  pi
)

npm run sync:commands >/dev/null 2>&1 || true

results=()
passed=0
failed=0

for agent in "${AGENTS[@]}"; do
  if skills_dry_run -a "$agent" -y --dry-run 2>/dev/null; then
    results+=("{\"agent\":\"$agent\",\"status\":\"pass\"}")
    ((passed++)) || true
  else
    results+=("{\"agent\":\"$agent\",\"status\":\"fail\"}")
    ((failed++)) || true
  fi
done

timestamp="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
cat >"$OUT" <<EOF
{
  "timestamp": "$timestamp",
  "passed": $passed,
  "failed": $failed,
  "agents": [$(IFS=,; echo "${results[*]}")]
}
EOF

echo "Compatibility matrix: $passed passed, $failed failed → $OUT"
exit $failed
