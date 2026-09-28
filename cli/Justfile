# No args auto runs CLI list of options
default: 
    @just --choose

# Cargo run
run:
    cargo run

# Cargo fmt and clippy
lint:
    cargo fmt --all -- --check
    cargo clippy --all-targets --locked -- -D warnings

# Cargo fmt and test
test:
    cargo fmt --all -- --check
    cargo test

# Cargo build
build:
    cargo build

# Audit third-party dependencies for known vulnerabilities
audit:
    cargo audit

# Scrub all cargo build objects and Trunk generation files
clean:
    cargo clean
    rm -rf dist

# Check formatting, run lints, and execute tests locally
check-all:
    cargo fmt --all -- --check
    cargo clippy --all-targets --locked -- -D warnings
    cargo test
