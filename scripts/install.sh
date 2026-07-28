#!/usr/bin/env sh
set -eu
repo="aryaniyaps/lamina"
os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$os/$arch" in
  darwin/arm64) target=darwin-arm64 ;; darwin/x86_64) target=darwin-x64 ;;
  linux/x86_64) target=linux-x64 ;; linux/aarch64|linux/arm64) target=linux-arm64 ;;
  *) echo "Lamina does not support $os/$arch. Supported: macOS arm64/x64 and Linux glibc arm64/x64." >&2; exit 1 ;;
esac
base="${LAMINA_RELEASE_BASE:-https://github.com/$repo/releases/latest/download}"
destination="${LAMINA_INSTALL_DIR:-$HOME/.local/bin}"
mkdir -p "$destination"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
curl --fail --location --silent --show-error "$base/lamina-$target" -o "$tmp/lamina"
curl --fail --location --silent --show-error "$base/lamina-cocoindex-worker-$target" -o "$tmp/cocoindex-worker"
curl --fail --location --silent --show-error "$base/SHA256SUMS" -o "$tmp/SHA256SUMS"
expected="$(grep "  lamina-$target$" "$tmp/SHA256SUMS" | awk '{print $1}')"
[ -n "$expected" ] || { echo "No checksum published for lamina-$target." >&2; exit 1; }
runtime_expected="$(grep "  lamina-cocoindex-worker-$target$" "$tmp/SHA256SUMS" | awk '{print $1}')"
[ -n "$runtime_expected" ] || { echo "No managed CocoIndex worker published for $target." >&2; exit 1; }
checksum() { if command -v sha256sum >/dev/null 2>&1; then sha256sum "$1" | awk '{print $1}'; else shasum -a 256 "$1" | awk '{print $1}'; fi; }
[ "$(checksum "$tmp/lamina")" = "$expected" ] || { echo "Checksum verification failed for lamina-$target." >&2; exit 1; }
[ "$(checksum "$tmp/cocoindex-worker")" = "$runtime_expected" ] || { echo "Checksum verification failed for managed CocoIndex worker." >&2; exit 1; }
install -m 0755 "$tmp/lamina" "$destination/lamina"
version="$($destination/lamina --version)"
cache_base="${XDG_CACHE_HOME:-$HOME/.cache}"
runtime_dir="$cache_base/lamina/runtime/$version/$target/app/observation-runtime"
mkdir -p "$runtime_dir"
install -m 0755 "$tmp/cocoindex-worker" "$runtime_dir/cocoindex-worker"
case ":$PATH:" in *":$destination:"*) ;; *) echo "Installed to $destination/lamina. Add $destination to PATH, then run: lamina doctor --json" >&2 ;; esac
