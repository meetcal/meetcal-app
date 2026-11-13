#!/usr/bin/env bash
set -euo pipefail

BINARY_BUDGET_BYTES=7740000
TARBALL_BUDGET_BYTES=3530000

if [[ $# -lt 1 || $# -gt 2 ]]; then
  echo "Usage: $0 <release binary> [<release tarball>]" >&2
  exit 2
fi

binary="$1"
tarball="${2:-}"

if [[ -z "$tarball" ]]; then
  staging="$(mktemp -d)"
  trap 'rm -rf "$staging"' EXIT
  cp "$binary" "$staging/meetcal"
  tarball="$staging/meetcal.tar.gz"
  tar -czf "$tarball" -C "$staging" meetcal
fi

binary_bytes="$(wc -c < "$binary" | tr -d ' ')"
tarball_bytes="$(wc -c < "$tarball" | tr -d ' ')"
echo "Release binary: ${binary_bytes} bytes (budget ${BINARY_BUDGET_BYTES}); tarball: ${tarball_bytes} bytes (budget ${TARBALL_BUDGET_BYTES})"

over=0
if (( binary_bytes > BINARY_BUDGET_BYTES )); then
  echo "The release binary is ${binary_bytes} bytes, over its ${BINARY_BUDGET_BYTES}-byte budget." >&2
  over=1
fi
if (( tarball_bytes > TARBALL_BUDGET_BYTES )); then
  echo "The release tarball is ${tarball_bytes} bytes, over its ${TARBALL_BUDGET_BYTES}-byte budget." >&2
  over=1
fi
exit "$over"
