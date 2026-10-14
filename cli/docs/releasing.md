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

In `cli/`, set `version` in `Cargo.toml`, add the release to `CHANGELOG.md`, set the tag in
`README.md`'s `cargo install … --tag cli-vX.Y.Z` line, and run the checks:

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
`linux-x64`, each a `.tar.gz` holding one `meetcal` binary, and attaches them to the release with a
`SHA256SUMS` file of their checksums. `meetcal upgrade` refuses an archive that does not match it,
so a release without it cannot be installed that way. It does not mark the release as the
repository's latest; `meetcal upgrade` finds the newest `cli-v*` release itself.

The Linux binaries are built with `cargo zigbuild` against glibc 2.17, so they start on older
distributions than the runner (Ubuntu 22.04, Debian 12, RHEL 9, Amazon Linux 2023). A binary
built on the runner itself would need the runner's glibc and fail at its first run elsewhere with
``version `GLIBC_2.38' not found``. The workflow fails a build whose binary needs a newer glibc
than 2.17, and runs each one in a Debian 11 container before uploading it.

Verify:

```sh
gh release view cli-v2.1.0 --repo meetcal/meetcal-app
```

## 3. The Homebrew tap

The workflow's last job writes the tap's `Formula/meetcal.rb` from the release's `SHA256SUMS`
(`cli/scripts/homebrew-formula.sh`) and pushes it to `meetcal/homebrew-tap`, with a deploy key that
can write to the tap alone: its private half is this repository's `HOMEBREW_TAP_DEPLOY_KEY` Actions
secret, its public half the tap's "meetcal-app CLI release workflow" deploy key. Deploy keys must
stay enabled in the `meetcal` organization's settings for it to work.

Check the job's commit:

```sh
gh api repos/meetcal/homebrew-tap/commits -q '.[0].commit.message'   # Update meetcal to v2.1.0
```

If the job failed (a rotated key, say), write the formula by hand from a clone of the tap:

```sh
gh release download cli-v2.1.0 --repo meetcal/meetcal-app --pattern SHA256SUMS
/path/to/meetcal-app/cli/scripts/homebrew-formula.sh 2.1.0 SHA256SUMS > Formula/meetcal.rb
ruby -c Formula/meetcal.rb
git commit -am "Update meetcal to v2.1.0"
git push origin main
```

To replace the key, make a new pair, add the public half to the tap with write access, and store the
private half as the secret:

```sh
ssh-keygen -t ed25519 -N '' -f tap_key
gh repo deploy-key add tap_key.pub --repo meetcal/homebrew-tap --allow-write --title 'meetcal-app CLI release workflow'
gh secret set HOMEBREW_TAP_DEPLOY_KEY --repo meetcal/meetcal-app < tap_key
rm tap_key tap_key.pub
```

## 4. Verify the install

```sh
meetcal upgrade        # from 2.4.0 or earlier: brew update && brew upgrade meetcal
meetcal --version
```

On Linux, also check a binary on an older distribution than your own, for example:

```sh
curl -sL https://github.com/meetcal/meetcal-app/releases/download/cli-v2.1.0/linux-x64.tar.gz | tar -xz
docker run --rm -v "$PWD:/m" ubuntu:22.04 /m/meetcal --version
```
