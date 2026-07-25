# Deprecated (GitHub issue #18)

This host-seal Harbor patch is **disabled** for the Issue #18 RewardKit pilot.

- `run-three-arm.mjs` sets `LB6_HOST_SEAL=0` and no longer puts this directory on `PYTHONPATH`.
- Claim scoring is Harbor RewardKit LLM-as-judge under each task’s final `steps/*/tests/`.
- Prefer deleting this fork once no local experiments depend on it.
