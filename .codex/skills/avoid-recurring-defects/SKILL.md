---
name: avoid-recurring-defects
description: The defects a four-surface audit of MeetCal found more than once, in the app, Convex, the website and the CLI, each with the check that catches it. Use before writing or changing code in src/, convex/, web/ or cli/, when drafting the source map, and when reviewing a diff.
---

# Avoid Recurring Defects

[DEFECTS.md](DEFECTS.md) lists the kinds of defect that turned up in more than one place when all four surfaces were audited together. Each entry says what the defect looks like in this repository, what to do instead, and a search that finds it.

## When Writing Code

1. Read the entries of [DEFECTS.md](DEFECTS.md) for the kind of code you are about to write: a helper, a parser or mapper, a storage read, a Convex query, a screen or page, a CLI command.
2. While drafting the source map (AGENTS.md, Workflow step 4), run the entry's search for each rule you are about to add. A hit is a twin: read from it, or generalize it, in the same pull request.
3. Before `finish-work`, run the searches again over your diff. A new hit in code you wrote is a defect to fix, not a note for the pull request.

## When Reviewing

Treat each entry as a question to ask of the diff. Report a match as a finding with the file, the line and the input that triggers it, as `review-diff` describes.

## Keeping The List

Add an entry only for a defect seen in at least two places, with the search that finds it. Remove an entry when a lint rule, a type or a test makes the defect impossible, and say which in the pull request.
