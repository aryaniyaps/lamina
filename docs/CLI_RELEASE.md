# CLI release runbook

The Lamina CLI is released as native standalone executables attached to the
`cli-v<version>` GitHub Release. It is not an npm package.

1. Update `packages/cli/package.json` and verify the tag matches:

   ```bash
   node scripts/check-cli-release-tag.mjs cli-v<version>
   node scripts/check-cli-version-discipline.mjs
   corepack pnpm test:cli
   ```

2. Confirm the local, tracking, remote, and GitHub API commit SHAs are
   identical. Create and push the annotated `cli-v<version>` tag at that exact
   commit. Do not create a GitHub Release manually. The tag workflow builds
   macOS arm64/x64, Linux glibc arm64/x64, and Windows x64 on native runners;
   runs retrieval, durability, packet, and installer gates; and creates the
   public Release only after all five targets pass. It attaches five CLI
   executables, five matching private native CocoIndex workers, the shared
   `lamina-retrieval-model-int8-v1.onnx`, `SHA256SUMS`, `install.sh`, and
   `install.ps1`.

3. Download one asset per supported target. Verify its `SHA256SUMS` entry,
   run `lamina --version` and `lamina doctor --json` with no system Node/npm,
   Python, `uv`, or virtual environment on `PATH`, and exercise every newly
   documented public command through the native executable. The binary and
   staged-installer smoke tests must cover those commands before publication.
   Also exercise observation, graph/session lifecycle, daemon restart,
   `context status`, `context rebuild`, offline inference, and missing/corrupt
   model and extension failures. The held-out retrieval benchmark, graph
   durability suites, packet-v5 cutover, and expected-count activation tests
   must pass before publication.

4. Confirm the release page exposes all five CLI binaries, all five worker
   binaries, the model asset, both installers, and the checksum manifest. Do not publish,
   audit, or verify a registry package.

5. Install through `releases/latest` in an isolated Git project and rerun the
   newly documented command. Do not consider source, tag, or workflow success
   sufficient until the public installer resolves to that command-capable
   release.

The skills remain independently installed through `npx skills add`; Node/npm
are a requirement for that command only.
