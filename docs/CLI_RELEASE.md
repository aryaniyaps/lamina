# CLI release runbook

The Lamina CLI is released as native standalone executables attached to the
`cli-v<version>` GitHub Release. It is not an npm package.

1. Update `packages/cli/package.json` and verify the tag matches:

   ```bash
   node scripts/check-cli-release-tag.mjs cli-v0.1.4
   corepack pnpm test:cli
   ```

2. Create and publish the `cli-v<version>` GitHub Release from the intended
   commit. The release workflow builds macOS arm64/x64, Linux glibc arm64/x64,
   and Windows x64 on their native runners, then attaches the executables,
   `SHA256SUMS`, `install.sh`, and `install.ps1`.

3. Download one asset per supported target. Verify its `SHA256SUMS` entry,
   run `lamina --version` and `lamina doctor --json` with no system Node/npm on
   `PATH`, and exercise a graph/session lifecycle plus daemon restart.

4. Confirm the release page exposes all five binaries and both installers.
   Do not publish, audit, or verify a registry package.

The skills remain independently installed through `npx skills add`; Node/npm
are a requirement for that command only.
