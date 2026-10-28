#!/usr/bin/env bash

set -euo pipefail

export PATH="$HOME/.cargo/bin:$PATH"
unset NO_COLOR

# The Rust in web/mise.toml, so the deployed site is built with the release
# the checks ran on.
rust_toolchain="1.99.1"

if ! command -v rustup >/dev/null 2>&1; then
  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain "${rust_toolchain}"
fi

rustup toolchain install "${rust_toolchain}" --profile minimal
rustup default "${rust_toolchain}"

rustup target add wasm32-unknown-unknown
cargo install trunk --version 0.21.14 --locked

posthog_api_key="${POSTHOG_API_KEY:-${EXPO_PUBLIC_POSTHOG_API_KEY:-}}"
posthog_host="${POSTHOG_HOST:-${EXPO_PUBLIC_POSTHOG_HOST:-https://us.i.posthog.com}}"

cat > public/posthog-env.js <<EOF
window.__MEETCAL_POSTHOG_CONFIG__ = {
  apiKey: "${posthog_api_key}",
  apiHost: "${posthog_host}"
};
EOF

trunk build --release
