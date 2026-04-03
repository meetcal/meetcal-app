## 2026 Masters/Uni Start List Shape

- Header is `WSO | Lot | First Name | Last Name | Nationality | Year | Age | Club Name | COMPETITIONS | Entry | Group | Sess. | Platform | Day | Comp Time`.
- The most reliable tail anchor is `entry total + group + session + platform + day + comp time`, for example `160 B 1 STARS 9-Apr 9:00 AM`.
- The most reliable middle anchor is `nationality? + birth year + age`. The nationality token is usually a 3-letter code, but OCR can split or drop it.
- The head of the row is `wso + lot + athlete name`. `wso` is free text and can be multiword or hyphenated.

## Competition Variants Seen

- Masters rows look like `W65 53 / / / /` or `M75 79 / / / /`.
- University rows start with `UNI`, for example `UNI W 53 / / / /` and `UNI M 71 / / / /`.
- WSO overlays appear before the age category, for example `WSO JR W 58`, `WSO JR M 65`, and `WSO OPEN M 79`.
- Military overlays appear as `MIL W 69` or `MIL M 88`.
- Adaptive rows are expected to start with `ADAP`.

## OCR Failure Modes Observed

- Words split across letters: `Cind y`, `Frumke r`, `Weightliftin g`, `Athletic s`.
- State abbreviations inside school names split across letters: `F L`, `N H`, `V T`, `C A`, `T X`.
- Weight classes can split digits: `W 5 8`, `W60 8 6`.
- Missing club values can show up as `0` immediately before `UNI`, so rows like `0 UNI W 53 ...` should be treated as no club.
- Some names appear in all caps or all lowercase.
- `UNI`, `WSO`, `MIL`, `JR`, `OPEN`, and the gender/age category tokens can all mark the start of the competition segment.

## Parsing Notes For Future Files

- Treat `UNI` as a competition marker, not part of the school name.
- Parse and keep `wso`; it is present in this document and maps cleanly to the Convex `wso` field.
- Default missing clubs to `Unaffiliated`.
- Keep the parser anchored on the tail and the `year + age` pair, because those have been more stable than the club and competition columns.
