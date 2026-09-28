# Homebrew Release Steps

This project is distributed through the Homebrew tap at:

```sh
https://github.com/meetcal/homebrew-tap
```

Users install it with:

```sh
brew tap meetcal/tap
brew install meetcal
```

## 1. Prepare The Main Repo

Update the version in `Cargo.toml`.

Run checks:

```sh
cargo test
cargo build --release
```

## 2. Build Release Artifacts

Build for the current machine:

```sh
chmod +x scripts/build-release.sh
./scripts/build-release.sh
```

Expected output files:

```sh
dist/darwin-arm64.tar.gz
dist/darwin-x64.tar.gz
dist/linux-arm64.tar.gz
dist/linux-x64.tar.gz
```

Each archive contains a single `meetcal` binary.

Generate checksums:

```sh
shasum -a 256 dist/*.tar.gz
```

Smoke test the local build:

```sh
tar -xzf dist/darwin-arm64.tar.gz -C /tmp
/tmp/meetcal --help
```

For all four platforms, tag and push to trigger GitHub Actions:

```sh
git tag v1.0.0
git push origin master --tags
```

The workflow uploads all platform archives to the GitHub release and prints checksums in the job log.

## 3. Commit And Push

```sh
git add .
git commit -m "Release v1.0.0"
git push origin master
git tag v1.0.0
git push origin v1.0.0
```

## 4. Create Or Verify The GitHub Release

If you did not use the GitHub Actions workflow, upload manually:

```sh
gh release create v1.0.0 \
  dist/darwin-arm64.tar.gz \
  dist/darwin-x64.tar.gz \
  dist/linux-arm64.tar.gz \
  dist/linux-x64.tar.gz \
  --repo meetcal/meetcal-cli \
  --title "meetcal v1.0.0"
```

Verify:

```sh
gh release view v1.0.0 --repo meetcal/meetcal-cli
```

## 5. Update The Homebrew Tap

Open the tap repo:

```sh
cd ../homebrew-tap
```

Edit `Formula/meetcal.rb`:

- Set `version "1.0.0"`.
- Point URLs at `meetcal/meetcal-cli` release assets.
- Replace each `sha256` with the checksum from `shasum -a 256 dist/*.tar.gz`.
- Linux checksums come from the GitHub Actions release job log after pushing `v1.0.0`.

Validate Ruby syntax:

```sh
ruby -c Formula/meetcal.rb
```

Commit and push:

```sh
git add Formula/meetcal.rb
git commit -m "Update meetcal to v1.0.0"
git push origin main
```

## 6. Verify Homebrew Install

```sh
brew update
brew upgrade meetcal
meetcal --help
```

If testing from a dirty local Homebrew state:

```sh
brew uninstall meetcal
brew install meetcal
```
