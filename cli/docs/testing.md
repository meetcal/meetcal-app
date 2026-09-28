# Testing

Run from `cli/`:

```sh
just check-all        # cargo fmt --check, clippy -D warnings, cargo test
cargo test            # tests only
```

CI (`.github/workflows/cli.yml` at the repository root) runs the same checks with `--locked` on
every change to `cli/` or `convex/`.

## What the suites cover

- **Unit tests**, in a `#[cfg(test)] mod tests` at the bottom of each module: answer parsing
  (including rows missing optional fields), report arithmetic (Wrapped stats, make rates,
  comparisons and percentage changes), weight-class sorting, meet-name matching, the retry policy,
  and the Convex transport (`src/utils/backend.rs`: both answer forms, function errors, whole-number
  floats).
- **Integration tests** in `tests/`: one file per command for argument parsing and help text
  (`tests/help_options.rs` also pins `--version` to the crate), and `tests/api_retry.rs`, which
  runs the real HTTP client against a local server that serves scripted Convex answers, to check
  retries, the request body, the User-Agent, and error messages.

No test calls a real deployment. Put report logic in pure functions that take rows, so a test can
feed fixture rows instead of a network.

## Against real data

Unit tests use answer shapes written by hand; only a real deployment shows that a command still
parses what Convex sends and that a query's reads fit production's size. Before a release, and
after changing a command or the query it reads, run it:

```sh
MEETCAL_CONVEX_URL=https://utmost-retriever-826.convex.cloud cargo run -- <command> ...   # dev
cargo run --release -- <command> ...                                                     # production (reads only)
```

To compare two versions, build both and diff their output for the same arguments, as the move to
Convex did against 2.0.1: identical tables, or differences you can explain.
