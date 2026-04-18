---
name: wso-meet-summary-scraper
description: Use when running or updating `scrapers/wso/meet_summary_scraper/` to summarize a meet's WSO cohort from Convex, inspect make-rate math, validate PR counting logic, or troubleshoot missing meet/WSO/result data.
---
# WSO Meet Summary Scraper

## Run Command

```bash
bun scrapers/wso/meet_summary_scraper/scraper.ts --meet "Meet Name" --wso "WSO Name"
```

## Purpose

Use this scraper to print a plain-text summary for one WSO inside one meet using Convex data.

It answers:

- How many athletes from that WSO are in the meet
- Snatch make rate
- Clean & jerk make rate
- Total make rate, computed as the average of snatch and clean & jerk make rates
- Total weight lifted from all successful attempts
- PR counts for snatch, clean & jerk, and total

Primary files:

- `scrapers/wso/meet_summary_scraper/scraper.ts`
- `convex/athletes.ts`
- `convex/liftingResults.ts`
- `convex/meets.ts`
- `convex/schema.ts`

## Inputs

The scraper takes two required CLI inputs:

1. `meet`
2. `wso`

Supported forms:

```bash
bun scrapers/wso/meet_summary_scraper/scraper.ts --meet "Meet Name" --wso "WSO Name"
bun scrapers/wso/meet_summary_scraper/scraper.ts -m "Meet Name" -w "WSO Name"
bun scrapers/wso/meet_summary_scraper/scraper.ts "Meet Name" "WSO Name"
```

## Required Environment

One of these env vars must be available:

- `CONVEX_URL`
- `EXPO_PUBLIC_CONVEX_URL`

The scraper reads Convex directly over HTTP and does not require `SCRAPER_SECRET`.

## Data Flow

The scraper follows this order:

1. Validate that the meet exists with `meets.getByName`.
2. Fetch all athletes in the meet with `athletes.getByMeet`.
3. Filter those athletes in memory to the requested `wso`.
4. Collect unique athlete names from that filtered list.
5. Fetch all `lifting_results` history for those names with `liftingResults.getByNames`.
6. Split each athlete's rows into:
   - current meet rows
   - prior-history rows
7. Aggregate make rates, total lifted volume, and PR counts.
8. Print the summary to the terminal.

## Meet Name Alias Support

The scraper supports athlete-meet names that do not exactly match result-meet names.

Current special case:

- Athlete meet:
  - `2026 Masters National Championships & National University Championships`
- Result meets:
  - `The 2026 National University Championships`
  - `The 2026 USA Weightlifting Masters National Championships Powered by Rogue Fitness`

For that input meet, the scraper treats both result meet names as the current meet when:

- locating current-meet result rows
- excluding those rows from prior-history PR comparisons

If another combined-meet naming mismatch appears later, extend the alias map in:

- `scrapers/wso/meet_summary_scraper/scraper.ts`

## Structure

The script is organized into four parts:

1. CLI parsing
   - accepts `--meet` / `--wso`
   - also supports positional args
   - prints usage on invalid input

2. Utility helpers
   - string normalization
   - number/percent formatting
   - best-lift derivation
   - PR comparison helpers

3. Convex fetch phase
   - validates meet existence
   - fetches meet athletes
   - fetches lifting history for the filtered athlete names

4. Aggregation and output
   - resolves any configured athlete-meet to result-meet aliases
   - computes attempt success rates
   - sums positive-attempt kilos
   - computes athlete-level PR counts
   - prints missing-result names if any athletes have no current meet result

## Calculation Rules

These rules are important to preserve when editing the scraper:

- A recorded attempt is any numeric value that is not `0`.
- A successful attempt is any numeric value greater than `0`.
- Misses are negative numbers.
- `null` and `0` are treated as not-recorded attempts.
- Total lifted volume is the sum of all positive values from:
  - `snatch1`
  - `snatch2`
  - `snatch3`
  - `cj1`
  - `cj2`
  - `cj3`
- `snatchBest` falls back to the max positive snatch attempt if the stored best is missing.
- `cjBest` falls back to the max positive clean & jerk attempt if the stored best is missing.
- `total` falls back to `snatchBest + cjBest` if the stored total is missing.

## PR Counting Rules

PR counts are athlete-level, not row-level.

For each athlete in the filtered WSO:

1. Gather all rows for the requested meet.
2. Gather all rows from every other meet as prior history.
3. Compute the athlete's best current:
   - snatch
   - clean & jerk
   - total
4. Compute the athlete's prior max for:
   - snatch
   - clean & jerk
   - total
5. Count a PR if the current value is greater than the prior max.

Important behavior:

- If the athlete has no prior history but has a valid current value, that counts as a PR.
- If the athlete has no current meet result row, they are listed under `Missing Results` and do not contribute to PR counts or make-rate math.
- If the input meet maps to multiple result meet names, all of those result rows are treated as current-meet rows for PR and make-rate calculations.

## Terminal Output

Expected output sections:

- Meet metadata
- athlete counts
- `Make Rates`
- `Volume`
- `PR Counts`

The output is intended for terminal reading only and is not written to a file.

## Failure Modes

When output looks wrong, check these first:

- `Meet not found`
  - The meet name must match Convex meet data.
  - The scraper will print close matches when possible.
- `No athletes found for WSO`
  - The WSO string must match the athlete rows for that meet.
  - The scraper will print available WSOs from that meet.
- High missing-results count
  - Athletes exist in the meet table but do not have matching `lifting_results` rows for that meet.
  - Check whether the athlete meet name needs a result-meet alias mapping.
- PR counts look too high
  - Check whether the athlete has no prior history, which counts as a PR baseline.
- Make rates look off
  - Confirm the attempt fields use the expected conventions:
    - positive = make
    - negative = miss
    - `0`/`null` = not recorded

## Recommended Update Workflow

When changing this scraper:

1. Keep the CLI interface stable unless there is a clear reason to change it.
2. Preserve Convex as the data source.
3. Keep calculations aligned with existing app semantics for attempt success.
4. Verify with:

```bash
bun scrapers/wso/meet_summary_scraper/scraper.ts --help
bunx tsc --noEmit --pretty false --target esnext --module esnext --moduleResolution bundler --skipLibCheck scrapers/wso/meet_summary_scraper/scraper.ts
```

## Output Checklist

- [ ] accepts `meet` and `wso` from CLI
- [ ] validates meet existence
- [ ] filters athletes by `wso`
- [ ] fetches athlete history from Convex
- [ ] computes snatch make rate
- [ ] computes clean & jerk make rate
- [ ] computes average of the two make rates
- [ ] computes total positive-attempt kilos
- [ ] computes athlete-level snatch PR count
- [ ] computes athlete-level clean & jerk PR count
- [ ] computes athlete-level total PR count
- [ ] prints missing-result athletes when applicable
