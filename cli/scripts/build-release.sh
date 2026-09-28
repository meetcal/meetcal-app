#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DIST="$ROOT/dist"
VERSION="${1:-$(awk -F'"' '/^version = / { print $2; exit }' "$ROOT/Cargo.toml")}"

mkdir -p "$DIST"

build_target() {
  local artifact="$1"
  local target="$2"

  echo "Building $artifact ($target)"
  rustup target add "$target" >/dev/null 2>&1 || true
  cargo build --release --manifest-path "$ROOT/Cargo.toml" --target "$target"

  local staging="$DIST/$artifact"
  rm -rf "$staging"
  mkdir -p "$staging"
  cp "$ROOT/target/$target/release/meetcal" "$staging/meetcal"
  tar -czf "$DIST/$artifact.tar.gz" -C "$staging" meetcal
  shasum -a 256 "$DIST/$artifact.tar.gz"
}

if [[ "${BUILD_ALL:-}" == "1" ]]; then
  build_target darwin-arm64 aarch64-apple-darwin
  build_target darwin-x64 x86_64-apple-darwin
  build_target linux-arm64 aarch64-unknown-linux-gnu || echo "Skipped linux-arm64 (use GitHub Actions release build)"
  build_target linux-x64 x86_64-unknown-linux-gnu || echo "Skipped linux-x64 (use GitHub Actions release build)"
else
  case "$(uname -s)-$(uname -m)" in
    Darwin-arm64) build_target darwin-arm64 aarch64-apple-darwin ;;
    Darwin-x86_64) build_target darwin-x64 x86_64-apple-darwin ;;
    Linux-aarch64) build_target linux-arm64 aarch64-unknown-linux-gnu ;;
    Linux-x86_64) build_target linux-x64 x86_64-unknown-linux-gnu ;;
    *)
      echo "Unsupported host. Set BUILD_ALL=1 to build all cross targets."
      exit 1
      ;;
  esac
fi

echo
echo "Release artifacts for v$VERSION:"
ls -1 "$DIST"/*.tar.gz
echo
echo "Upload with:"
echo "  gh release create v$VERSION dist/*.tar.gz --repo meetcal/meetcal-cli --title \"meetcal v$VERSION\""
