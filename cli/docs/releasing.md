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
just check-all
cargo build --release
```

Merge the change to `master` through a pull request.

## 2. Tag the release

From an up-to-date `master`:

```sh
git tag cli-v2.1.0
git push origin cli-v2.1.0
```

The workflow builds `darwin-arm64`, `darwin-x64`, `linux-arm64` and `linux-x64`, each a
`.tar.gz` holding one `meetcal` binary, and attaches them to the release. It does not mark the
release as the repository's latest.

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
