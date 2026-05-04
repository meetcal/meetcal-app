# OWLCMS Final Schedule Scraper

`final_scraper.py` downloads an OWLCMS final schedule PDF, extracts session rows, and either writes dry-run TypeScript rows or ingests rows into Convex.

## Usage

```sh
scrapers/usaw/owlcms_schedule_scraper/venv/bin/python scrapers/usaw/owlcms_schedule_scraper/final_scraper.py dry-run
scrapers/usaw/owlcms_schedule_scraper/venv/bin/python scrapers/usaw/owlcms_schedule_scraper/final_scraper.py dry-run --output /tmp/final_schedule_preview.ts
scrapers/usaw/owlcms_schedule_scraper/venv/bin/python scrapers/usaw/owlcms_schedule_scraper/final_scraper.py convex
```

Override the source PDF or meet name with:

```sh
scrapers/usaw/owlcms_schedule_scraper/venv/bin/python scrapers/usaw/owlcms_schedule_scraper/final_scraper.py dry-run \
  --url "https://example.com/final-schedule.pdf" \
  --meet "2026 Example Meet"
```

## Output Shape

Dry-run TypeScript output is an array of session objects. Each object represents one session/platform/time slot and is normalized to the Convex `session_schedule` shape:

```ts
[
  { date: "2026-05-28", meet: "2026 Pan American Masters", platform: "Red", sessionId: 1, startTime: "09:00:00", weighInTime: "07:00:00", weightClass: "M75, M80 All" },
]
```

Times are emitted as `HH:MM:SS`. Dates are emitted as `YYYY-MM-DD`. Session IDs are numeric. When a session contains multiple age/category groups, they are combined into one comma-separated `weightClass` value.

The fields match this Convex table:

```ts
session_schedule: defineTable({
  date: v.string(),
  meet: v.string(),
  platform: v.string(),
  sessionId: v.float64(),
  startTime: v.string(),
  weighInTime: v.string(),
  weightClass: v.string(),
})
```

If the dry-run `--output` path ends in `.csv`, the scraper writes the older CSV shape instead.

## Supported Structures

The scraper intentionally handles more than one final schedule format. It tries table extraction first and only falls back to OCR when the PDF has no extractable table rows.

### 1. Basic Session Table

This is the simplest table structure:

```text
Session | Platform | Day | Comp Time | #
```

Example row:

```text
4 | Red | May 28 | 3:00 PM | 13
```

Behavior:

- `Session` becomes `session_id`.
- `Platform` is normalized with known platform aliases.
- `Day` is parsed using `DEFAULT_YEAR`.
- `Comp Time` becomes `start_time`.
- `weigh_in_time` is calculated as two hours before `start_time`.
- `weight_class` is left blank because this source table does not include class details.

### 2. Detailed Text/Table Schedule

This handles extracted tables where a row may include some combination of:

```text
date, session, platform, weigh-in time, start time, weight class
```

The parser is flexible about column order. It scans row cells for:

- A date, such as `5/28`, `May 28`, `May28`, `28-May`, or `2026-05-28`.
- A session ID, such as `12`, `12.1`, or `S12`.
- A platform name, such as `Red`, `White`, `Blue`, `Stars`, `Stripes`, or `Rogue`.
- One or two times. If there are two times, the earlier one is treated as weigh-in and the later one as start. If there is one time, it is treated as start and weigh-in is calculated from the configured offset.
- A weight class cell, usually a cell containing `kg` or the last non-header text cell.

Current date, session, and platform carry forward between rows when a table omits repeated values.

### 3. Image-Only OCR Schedule

Some PDFs are scanned/image-only and have no extractable text or tables. For those, the scraper renders each PDF page to an image and runs `tesseract` OCR.

This structure is currently supported:

```text
Date | Sess | Pfm | Weigh-in | Start | Sex | Age Group | Weight Cat. | # Lifters
```

Example source:

```text
May28 3 A 10:30 AM 12:30PM m M70 60-110+ 6
```

Behavior:

- `Sess` becomes `session_id`.
- `Pfm` is normalized through platform aliases.
- `A` maps to `Red`, `B` maps to `White`, and `C` maps to `Blue`.
- `Weigh-in` and `Start` are read directly from the OCR row.
- Dates are inferred from the first detected date and incremented when session start times roll over to the next day.
- Age group and category are combined into `weight_class`, such as `M70 60-110+`.
- If session totals and class lifter counts are available, classes are assigned sequentially to sessions using those totals. If counts are not available, the fallback assigns classes to the nearest session row by vertical position.
- Multiple age/category rows for the same session are collapsed into one output row. Full-category ranges are shortened to `All`, such as `M75, M80 All`.

OCR support requires the `tesseract` executable to be installed and available on `PATH`.

## Platform Normalization

Known platform values:

```text
Red, White, Blue, Stars, Stripes, Rogue
```

Aliases:

```text
A -> Red
B -> White
C -> Blue
```

## Dates And Weigh-Ins

- `DEFAULT_YEAR` controls the year used for dates that do not include a year.
- `WEIGH_IN_OFFSET_HOURS` controls calculated weigh-in times when the source only includes a start time.
- The default offset is `2` hours.

## Convex Mode

Convex ingestion requires these environment variables:

```sh
CONVEX_URL=...
SCRAPER_SECRET=...
```

Rows are sent to:

```text
scraperIngestion:ingestSessionSchedule
```

## Troubleshooting

- `No rows parsed`: the PDF likely uses an unsupported layout, OCR is unavailable, or OCR confidence was too poor to recover the schedule columns.
- `Install the tesseract executable`: install Tesseract locally and ensure `tesseract` is available on `PATH`.
- Wrong dates in an OCR PDF: check the first visible schedule date and confirm `DEFAULT_YEAR` is correct.
- Wrong platform names: add the platform or alias to `PLATFORM_VALUES` / `PLATFORM_ALIASES`.
