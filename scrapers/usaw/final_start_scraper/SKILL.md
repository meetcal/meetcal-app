---
name: usaw-final-start-list-workflow
description: Maintain the USAW final start list PDF scraper and verifier for shifting PDF formats. Use when updating `scrapers/usaw/final_start_scraper/` outputs, debugging missing sessions or bad athlete rows, regenerating `mnats_26.ts`, verifying parser coverage, or documenting new table/layout variants.
---
# USAW Final Start List Workflow

## Purpose

Use this workflow when a USAW final start list PDF changes shape and the scraper or verifier in `scrapers/usaw/final_start_scraper/` needs to be updated.

Primary files:

- `scrapers/usaw/final_start_scraper/scraper.py`
- `scrapers/usaw/final_start_scraper/mnats_26.ts`
- `scrapers/usaw/final_start_scraper/verify_ao1_26.py`
- `scrapers/usaw/final_start_scraper/verify_ao1_26_report.txt`
- `scrapers/usaw/final_start_scraper/format_notes.md`
- `scrapers/usaw/owlcms_schedule_scraper/prelim/mnats.ts`

## Standard Workflow

1. Inspect the live PDF before changing parser logic.
2. Identify the actual line structure and all row variants.
3. Update `scraper.py` to support the new shape without breaking older shapes already seen.
4. Regenerate `mnats_26.ts`.
5. Run `verify_ao1_26.py` and inspect the saved report.
6. Update `format_notes.md` with any new structure or OCR pattern discovered.

## How To Inspect The PDF

Preferred goal: understand the raw row shape, not just the rendered table.

Check for:

- Header columns.
- Tail shape.
- Whether `Group` is present or omitted.
- Whether rows wrap across PDF lines.
- Whether `WSO`, `UNI`, `MIL`, `OPEN`, or age buckets are fused together.
- Whether weight classes split as `11 0`, `86 +`, or `W 5 8`.
- Whether school/state abbreviations split as `F L`, `N C`, `M O`, `T X`.
- Whether nationality leaks into names as fragments like `Nz L` or `Po L`.

## Stable Parsing Anchors

Prefer these anchors, in this order:

1. Tail:
   - `entry total + optional group + session + platform + day + comp time`
   - Examples:
     - `160 B 1 STARS 9-Apr 9:00 AM`
     - `170 25 RED 12-Apr 4:00 PM`
2. Middle:
   - `nationality? + birth year + age`
3. Head:
   - `wso + lot + athlete name`

Do not assume:

- `Group` always exists.
- Rows fit on one PDF line.
- Clubs are present.
- Competition tokens are always separated cleanly.

## Parser Rules To Preserve

- Output must stay in Convex shape:
  - `memberId`
  - `name`
  - `age`
  - `club`
  - `wso`
  - `gender`
  - `weightClass`
  - `entryTotal`
  - `sessionNumber`
  - `sessionPlatform`
  - `meet`
  - `adaptive`
- Missing clubs should normalize to `Unaffiliated`.
- `wso` should be preserved whenever present.
- `sessionNumber` should be numeric.
- `sessionPlatform` should normalize to title case platform names.
- `weightClass` should normalize to values like `53`, `86`, `86+`, `110+`.

## Common Failure Modes

When output is wrong, check these first:

- Empty session/platform buckets:
  - Usually caused by tail parsing assuming a group letter exists.
- Rows assigned to the wrong session/platform:
  - Usually caused by bad wrapped-line joining.
- `weightClass` becomes `11` or `35`:
  - Usually caused by split weight tokens like `11 0` or fused age/weight OCR.
- Clubs contain competition text:
  - Usually caused by bad competition-start detection.
- Name contains nationality fragments:
  - Usually caused by OCR splitting `NZL`, `POL`, `CRC`, etc.
- Clubs truncated at the end:
  - Common for schools and long clubs.
- WSO truncated:
  - Example families:
    - `California North Cent`
    - `Hawaii and Internatio`
    - `Pennsylvania-West V`

## Regeneration

Run the scraper directly and let it write beside itself:

```bash
python3 "scrapers/usaw/final_start_scraper/scraper.py"
```

Expected output:

- `scrapers/usaw/final_start_scraper/mnats_26.ts`

The script should write using a path anchored to `__file__`, not the current shell directory.

## Verification

Run:

```bash
python3 "scrapers/usaw/final_start_scraper/verify_ao1_26.py"
```

This must refresh:

- `scrapers/usaw/final_start_scraper/verify_ao1_26_report.txt`

Review these sections in the report:

- `Output rows`
- `Parser rows`
- `Output matches parser`
- `Missing sessions from schedule`
- `Missing session/platform combos from schedule`
- `sessionCoverage`
- `names`
- `clubs`
- `wsos`
- `weightClasses`
- `genders`
- `sessions`
- `memberIds`
- `meets`
- `checksToDo`

## Verification Success Criteria

Do not consider the scraper done until all of these are true:

- `Output matches parser: True`
- `Missing sessions from schedule: 0`
- `Missing session/platform combos from schedule: 0`
- No bogus structural categories:
  - `weightClasses: 0`
  - `genders: 0`
  - `sessions: 0`
  - `memberIds: 0`
  - `meets: 0`

If `names` or `clubs` are nonzero, treat them as OCR cleanup candidates, not necessarily parser failures.

## How To Handle New PDF Structure Variants

Whenever a new layout or OCR quirk appears:

1. Add support in `scraper.py`.
2. Regenerate `mnats_26.ts`.
3. Run `verify_ao1_26.py`.
4. Append the new variant to `format_notes.md`.

Document each new variant in `format_notes.md` with:

- What changed.
- A concrete example line.
- Which parser anchor still works.
- Whether it affects:
  - tail shape
  - year/age anchor
  - competition markers
  - wrapped lines
  - weight token reconstruction
  - name cleanup
  - club cleanup
  - WSO normalization

## Structure Types To Track In Notes

Keep one running list of all known structure families:

- Tail with group letter.
- Tail without group letter.
- Rogue-specific tail.
- Single-line rows.
- Wrapped rows split across two PDF lines.
- WSO overlay rows:
  - `WSO JR W 58`
  - `WSO OPEN M 79`
  - `WSO MM35 79`
  - `WSO WW35 69`
  - `WSO WM40 71`
- University rows starting with `UNI`.
- Military rows using `MIL`.
- Split weight rows:
  - `11 0`
  - `86 +`
  - `W 5 8`
- OCR-truncated school/club rows.
- OCR-truncated WSO rows.
- Nationality-fragment name rows.

## Recommended Debug Order

If output looks wrong:

1. Check `verify_ao1_26_report.txt`.
2. If a session/platform is empty, inspect the PDF rows for that exact bucket.
3. If rows are shifted, inspect wrapped lines around the boundary.
4. If clubs are dirty, inspect where competition parsing begins.
5. If `weightClass` is wrong, inspect split weight token handling.
6. If names are dirty, inspect nationality leakage and split surname handling.
7. Update `format_notes.md` with the new case before finishing.

## Output Checklist

- [ ] `scraper.py` updated if needed
- [ ] `mnats_26.ts` regenerated
- [ ] `verify_ao1_26.py` run
- [ ] `verify_ao1_26_report.txt` regenerated
- [ ] session coverage is complete
- [ ] structural fields are clean
- [ ] new PDF/table variants added to `format_notes.md`
