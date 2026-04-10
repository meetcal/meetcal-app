## Masters/Uni Inline-Tail Shape

- Header is `WSO | Lot | First Name | Last Name | Nationality | Year | Age | Club Name | COMPETITIONS | Entry | Group | Sess. | Platform | Day | Comp Time`.
- The most reliable tail anchor is `entry total + optional group + session + platform + day + comp time`, for example `160 B 1 STARS 9-Apr 9:00 AM` and `170 25 RED 12-Apr 4:00 PM`.
- The most reliable middle anchor is `nationality? + birth year + age`. The nationality token is usually a 3-letter code, but OCR can split or drop it.
- The head of the row is `wso + lot + athlete name`. `wso` is free text and can be multiword or hyphenated.

## Competition Variants Seen

- Masters rows look like `W65 53 / / / /` or `M75 79 / / / /`.
- University rows start with `UNI`, for example `UNI W 53 / / / /` and `UNI M 71 / / / /`.
- WSO overlays appear before the age category, for example `WSO JR W 58`, `WSO JR M 65`, and `WSO OPEN M 79`.
- Some WSO overlays fuse the gender and age bucket, for example `WSO MM35 79`, `WSO WW35 69`, and `WSO WM40 71`.
- Military overlays appear as `MIL W 69` or `MIL M 88`.
- Adaptive rows are expected to start with `ADAP`.

## OCR Failure Modes Observed

- Words split across letters: `Cind y`, `Frumke r`, `Weightliftin g`, `Athletic s`.
- State abbreviations inside school names split across letters: `F L`, `N H`, `V T`, `C A`, `T X`.
- Weight classes can split digits: `W 5 8`, `W60 8 6`, `M35 11 0`.
- Superheavy classes can split the plus sign into its own token: `86 +`.
- Missing club values can show up as `0` immediately before `UNI`, so rows like `0 UNI W 53 ...` should be treated as no club.
- Rows can hard-wrap across PDF lines, including inside clubs, schools, or the weight class itself.
- Some names appear in all caps or all lowercase.
- Nationality can leak into the name when OCR splits it badly, e.g. `Nz L` or `Po L`.
- `UNI`, `WSO`, `MIL`, `JR`, `OPEN`, and the gender/age category tokens can all mark the start of the competition segment.

## Parsing Notes For Future Files

- Treat `UNI` as a competition marker, not part of the school name.
- Parse and keep `wso`; it is present in this document and maps cleanly to the Convex `wso` field.
- Default missing clubs to `Unaffiliated`.
- Keep the parser anchored on the tail and the `year + age` pair, because those have been more stable than the club and competition columns.
- Keep output paths anchored to the script directory so reruns do not write files into the repo root when invoked from elsewhere.

## Verification Notes

- Post-parse checks should scan for truncated WSOs like `Hawaii and Internatio` and `California North Cent`.
- Post-parse checks should scan for truncated clubs and school names like `University of California, Los Angel`, `East Tennessee State University -`, `University of California, Santa Bar`, and `Rowan-Cabarrus Community Colle`.
- Post-parse checks should scan for split surname patterns like `Mc Hugh`, `Mc Henry`, `Mc Cauley`, and nationality fragments in names like `Nz L` or `Po L`.

## OWLCMS Block-Session Shape

- Source documents can contain `owlcms` footer text and the repeated header `Session Date Gndr Group Cat Lot Age Name Total Team Comps`.
- The cleanest extraction path for this layout is `pdfplumber.extract_tables()`, not the flat `PyPDF2` text stream. In table extraction, the stable tail is usually the last six cells: `lot | age | LAST, First | total | team | comps`.
- Session context is stored in the leading cells of the first row in a block:
  - session/platform like `1 RED`, `32 BLUE`, `48 RED`
  - schedule text in one cell like `Sat / Jun 21 / Weigh In ... / Start ...`
  - gender in a dedicated cell or mixed into nearby text
  - category-to-weight cells like `U11 | 36`, `U23 | 86`, `Open | 110+`
- Continuation rows often omit the leading context cells entirely and only keep the last six athlete cells.
- Some page starts also drop the first session row in the table extract, so the parser needs page-level context recovery from the raw page text for missing leading groups.
- Some page ends can merge the next platform block into the previous explicit group; page-level context must be used to split those trailing rows back out, for example `48 RED` female `86+` rows followed by `48 BLUE` male `110+` rows.

## OWLCMS Variants Seen

- Youth and teen rows commonly look like `lot age LAST, First total team U11, U13` with the active category/weight coming from the row prefix or surrounding session block.
- Rows can promote a new category/weight without repeating session/gender, for example:
  - `None | None | None | U13 | 36 | 3 | 13 | STEWART, Makenna | 36 | ... | U13`
  - `None | None | None | None | 63+ | 775 | 12 | PRESLEY, Anna | 83 | ... | U13`
- Open and adaptive rows can appear as:
  - `ADAP | 86+ | 891 | 33 | COLLAZO, Ashley | 109 | ... | ADAP`
  - `Open | 110+ | 1207 | 26 | SCHULMAN, Kyle | 350 | ... | Open`
- `wso` is optional in this format. Current observed files do not expose it in the parsed table rows, but the scraper should preserve it when a future export includes a dedicated WSO/region column.

## OWLCMS Flat-Text Failure Modes

- Raw page text can interleave session metadata and athlete rows on the same line, for example `48 RED F Open 86+ 142 20 ENEMOR, Chealsea 210 ...`.
- Session metadata can also be split across several lines with athlete rows in between:
  - `3 RED F`
  - `Weigh In 9:20 AM 12 13 HIPPELHEUSER, Sophia ...`
  - `U13 48`
- Page starts can begin with athlete rows before the first visible session line in table extraction.
- Page ends can continue into the next session block before the next header appears in the raw text.

## OWLCMS Parsing Notes

- Prefer the table row’s own category/weight cells when present.
- When a row omits those cells, derive `weightClass` by matching the athlete’s `comps` tokens against the current page/session category-to-weight mapping.
- Use page-text session recovery only to repair missing table context; do not replace the table parser with raw text parsing for the whole document.
- Convert `LAST, First` names into `First Last` output while preserving normal cleanup and title casing.
- Keep `sessionPlatform` normalized to title case (`Red`, `White`, `Blue`, ...), matching the existing TypeScript shape.

## OWLCMS Verification Notes

- Verify that expected session/platform buckets are populated when the source actually contains athletes for them.
- Verify that continuation pages do not leave athletes attached to the previous platform block.
- Spot-check boundary cases where a page starts or ends mid-session.
- Treat missing `wso` as acceptable when the source format does not expose it.
