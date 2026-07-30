# CLI release runbook

The Lamina CLI is released as native standalone executables attached to the
`cli-v<version>` GitHub Release. It is not an npm package.

1. Update `packages/cli/package.json` and verify the tag matches:

   ```bash
   node scripts/check-cli-release-tag.mjs cli-v<version>
   node scripts/check-cli-version-discipline.mjs
   corepack pnpm test:cli
   ```

2. Create and publish the `cli-v<version>` GitHub Release from the intended
   commit. The release workflow builds macOS arm64/x64, Linux glibc arm64/x64,
   and Windows x64 on their native runners, then attaches five CLI executables,
   five matching private native CocoIndex workers, `SHA256SUMS`, `install.sh`,
   and `install.ps1`.

3. Download one asset per supported target. Verify its `SHA256SUMS` entry,
   run `lamina --version` and `lamina doctor --json` with no system Node/npm,
   Python, `uv`, or virtual environment on `PATH`, and exercise every newly
   documented public command through the native executable. The binary and
   staged-installer smoke tests must cover those commands before publication.
   Also exercise observation, graph/session lifecycle, and daemon restart.

4. Confirm the release page exposes all five CLI binaries, all five worker
   binaries, both installers, and the checksum manifest. Do not publish,
   audit, or verify a registry package.

5. Install through `releases/latest` in an isolated Git project and rerun the
   newly documented command. Do not consider source, tag, or workflow success
   sufficient until the public installer resolves to that command-capable
   release.

The skills remain independently installed through `npx skills add`; Node/npm
are a requirement for that command only.
