#!/usr/bin/env bash
# Prints the Homebrew formula (meetcal/homebrew-tap's Formula/meetcal.rb) for a release, from its
# version and its SHA256SUMS file. The release workflow writes the tap's formula with it.
#
#   cli/scripts/homebrew-formula.sh 3.0.0 dist/SHA256SUMS > Formula/meetcal.rb
set -euo pipefail

if [ "$#" -ne 2 ]; then
  echo "usage: $0 <version> <SHA256SUMS>" >&2
  exit 2
fi
version="$1"
sums="$2"

if ! [[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
  echo "version must be MAJOR.MINOR.PATCH, not ${version}" >&2
  exit 2
fi

sha() {
  local hash
  hash="$(awk -v file="$1.tar.gz" '{ name = $2; sub(/^\*/, "", name) } name == file { print $1 }' "$sums")"
  if ! [[ "$hash" =~ ^[0-9a-f]{64}$ ]]; then
    echo "${sums} has no SHA-256 for $1.tar.gz" >&2
    exit 1
  fi
  echo "$hash"
}

url="https://github.com/meetcal/meetcal-app/releases/download/cli-v${version}"
darwin_arm64="$(sha darwin-arm64)"
darwin_x64="$(sha darwin-x64)"
linux_arm64="$(sha linux-arm64)"
linux_x64="$(sha linux-x64)"

cat <<EOF
class Meetcal < Formula
  desc "CLI for querying MeetCal lifting data"
  homepage "https://github.com/meetcal/meetcal-app/tree/master/cli"
  version "${version}"

  on_macos do
    if Hardware::CPU.arm?
      url "${url}/darwin-arm64.tar.gz"
      sha256 "${darwin_arm64}"
    else
      url "${url}/darwin-x64.tar.gz"
      sha256 "${darwin_x64}"
    end
  end

  on_linux do
    if Hardware::CPU.arm?
      url "${url}/linux-arm64.tar.gz"
      sha256 "${linux_arm64}"
    else
      url "${url}/linux-x64.tar.gz"
      sha256 "${linux_x64}"
    end
  end

  def install
    bin.install "meetcal"
  end

  test do
    system bin/"meetcal", "--help"
  end
end
EOF
