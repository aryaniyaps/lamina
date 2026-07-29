# Preserve the operator's normal login environment, then put the eval wrappers
# back first because the user profile may replace PATH rather than extend it.
if [[ -f "${HOME}/.zprofile" ]]; then
  source "${HOME}/.zprofile"
fi
if [[ -n "${LAMINA_EVAL_BIN:-}" ]]; then
  export PATH="${LAMINA_EVAL_BIN}:${PATH}"
fi
