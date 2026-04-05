## 2026 Masters/Uni Start List Shape

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
