# Releasing

The CLI is distributed through the Homebrew tap at https://github.com/meetcal/homebrew-tap.
Users install it with:

```sh
brew tap meetcal/tap
brew install meetcal
```

Releases are published from this repository (`meetcal/meetcal-app`) as `cli-vX.Y.Z`, by
`.github/workflows/cli-release.yml`. The tag must match the version in `cli/Cargo.toml`, or the
workflow fails before building.

## 1. Bump the version

In `cli/`, set `version` in `Cargo.toml`, add the release to `CHANGELOG.md`, and run the checks:

```sh
mise run check-all
cargo build --release
```

Merge the change to `master` through a pull request.

## 2. Tag the release

From an up-to-date `master`:

```sh
git tag cli-v2.1.0
git push origin cli-v2.1.0
```

The workflow first runs the tests and `cargo audit` on the tagged commit; a failure stops the
release before anything is built. It then builds `darwin-arm64`, `darwin-x64`, `linux-arm64` and
`linux-x64`, each a `.tar.gz` holding one `meetcal` binary, and attaches them to the release. It
does not mark the release as the repository's latest.

The Linux binaries are built with `cargo zigbuild` against glibc 2.17, so they start on older
distributions than the runner (Ubuntu 22.04, Debian 12, RHEL 9, Amazon Linux 2023). A binary
built on the runner itself would need the runner's glibc and fail at its first run elsewhere with
``version `GLIBC_2.38' not found``. The workflow fails a build whose binary needs a newer glibc
than 2.17, and runs each one in a Debian 11 container before uploading it.

Verify:

```sh
gh release view cli-v2.1.0 --repo meetcal/meetcal-app
```

## 3. Update the Homebrew tap

Take each archive's checksum from the release:

```sh
for a in darwin-arm64 darwin-x64 linux-arm64 linux-x64; do
  curl -sL "https://github.com/meetcal/meetcal-app/releases/download/cli-v2.1.0/$a.tar.gz" | shasum -a 256
done
```

In the tap's `Formula/meetcal.rb`, set `version`, point each `url` at
`https://github.com/meetcal/meetcal-app/releases/download/cli-vX.Y.Z/<artifact>.tar.gz`, and
replace each `sha256`. Then:

```sh
ruby -c Formula/meetcal.rb
git commit -am "Update meetcal to vX.Y.Z"
git push origin main
```

## 4. Verify the install

```sh
brew update
brew upgrade meetcal   # or: brew install meetcal/tap/meetcal
meetcal --version
```

On Linux, also check a binary on an older distribution than your own, for example:

```sh
curl -sL https://github.com/meetcal/meetcal-app/releases/download/cli-v2.1.0/linux-x64.tar.gz | tar -xz
docker run --rm -v "$PWD:/m" ubuntu:22.04 /m/meetcal --version
```
