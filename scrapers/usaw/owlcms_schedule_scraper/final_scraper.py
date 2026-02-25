"""
Scrape OWLCMS final schedule PDFs and either export CSV (dry-run) or ingest to Convex.

Usage:
  python final_scraper.py dry-run
  python final_scraper.py dry-run --output final_schedule_preview.csv
  python final_scraper.py convex
  python final_scraper.py convex --url "https://...pdf" --meet "2026 VIRUS Weightlifting Series 1"
"""

from __future__ import annotations

import argparse
import csv
import os
import re
from dataclasses import dataclass
from datetime import date as date_cls
from datetime import datetime, time, timedelta
from io import BytesIO
from typing import List, Optional, Sequence, Tuple

import pdfplumber
import requests
from dotenv import load_dotenv

load_dotenv()

# ---------------------------
# Top-level scraper config
# ---------------------------
PDF_URL = (
    "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/"
    "blt13dbc5d1fae8c890/699f572f3b580eb65224ab05/2026_-_VWS1_-_FINAL_SCHEDULE_v2.pdf"
)
MEET_NAME = "2026 VIRUS Weightlifting Series 1"
START_ID = 123
DEFAULT_YEAR = 2026
WEIGH_IN_OFFSET_HOURS = 2
DEFAULT_OUTPUT_CSV = "final_schedule_preview.csv"
REQUEST_TIMEOUT_SECONDS = 45

PLATFORM_VALUES = {"RED", "WHITE", "BLUE", "STARS", "STRIPES", "ROGUE"}
CONVEX_INGEST_PATH = "scraperIngestion:ingestSessionSchedule"
PLATFORM_SORT_ORDER = {
    "Red": 0,
    "White": 1,
    "Blue": 2,
    "Stars": 3,
    "Stripes": 4,
    "Rogue": 5,
}


@dataclass
class ScheduleRow:
    id: int
    date: str
    session_id: float
    start_time: str
    weigh_in_time: str
    platform: str
    weight_class: str
    meet: str

    def to_csv_row(self) -> dict:
        session_value = int(self.session_id) if float(self.session_id).is_integer() else self.session_id
        return {
            "id": self.id,
            "date": self.date,
            "session_id": session_value,
            "start_time": self.start_time,
            "weigh_in_time": self.weigh_in_time,
            "platform": self.platform,
            "weight_class": self.weight_class,
            "meet": self.meet,
        }

    def to_convex_args(self, scraper_secret: str) -> dict:
        return {
            "scraperSecret": scraper_secret,
            "date": self.date,
            "sessionId": self.session_id,
            "startTime": self.start_time,
            "weighInTime": self.weigh_in_time,
            "platform": self.platform,
            "weightClass": self.weight_class,
            "meet": self.meet,
        }


def download_pdf(url: str) -> BytesIO:
    print(f"Downloading PDF: {url}")
    response = requests.get(url, timeout=REQUEST_TIMEOUT_SECONDS)
    response.raise_for_status()
    return BytesIO(response.content)


def normalize_cell(value: object) -> str:
    return re.sub(r"\s+", " ", str(value or "")).strip()


def parse_time_value(raw: str) -> Optional[time]:
    value = raw.strip()
    if not value:
        return None

    for fmt in ("%I:%M %p", "%I:%M%p", "%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(value.upper(), fmt).time()
        except ValueError:
            pass

    m = re.search(r"(\d{1,2}):(\d{2})\s*(AM|PM)?", value, re.IGNORECASE)
    if not m:
        return None

    hour = int(m.group(1))
    minute = int(m.group(2))
    suffix = (m.group(3) or "").upper()

    if suffix == "PM" and hour < 12:
        hour += 12
    if suffix == "AM" and hour == 12:
        hour = 0

    if hour > 23 or minute > 59:
        return None

    return time(hour=hour, minute=minute)


def parse_date_value(raw: str, default_year: int) -> Optional[str]:
    value = raw.replace("\n", " ").strip()
    if not value:
        return None

    # Already ISO date
    try:
        parsed = datetime.strptime(value, "%Y-%m-%d").date()
        return parsed.isoformat()
    except ValueError:
        pass

    # M/D[/YYYY]
    m = re.search(r"\b(\d{1,2})/(\d{1,2})(?:/(\d{2,4}))?\b", value)
    if m:
        month = int(m.group(1))
        day = int(m.group(2))
        year_text = m.group(3)
        year = default_year
        if year_text:
            year = int(year_text)
            if year < 100:
                year += 2000
        try:
            return date_cls(year, month, day).isoformat()
        except ValueError:
            return None

    # D-Mon or Mon-D or Mon D
    month_map = {
        "JAN": 1,
        "FEB": 2,
        "MAR": 3,
        "APR": 4,
        "MAY": 5,
        "JUN": 6,
        "JUL": 7,
        "AUG": 8,
        "SEP": 9,
        "OCT": 10,
        "NOV": 11,
        "DEC": 12,
    }

    m = re.search(r"\b(\d{1,2})[-\s]([A-Za-z]{3})\b", value)
    if m:
        day = int(m.group(1))
        month = month_map.get(m.group(2).upper())
        if month:
            try:
                return date_cls(default_year, month, day).isoformat()
            except ValueError:
                return None

    m = re.search(r"\b([A-Za-z]{3})[-\s](\d{1,2})\b", value)
    if m:
        month = month_map.get(m.group(1).upper())
        day = int(m.group(2))
        if month:
            try:
                return date_cls(default_year, month, day).isoformat()
            except ValueError:
                return None

    return None


def extract_platform(cells: Sequence[str]) -> Optional[str]:
    for cell in cells:
        up = cell.upper()
        if up in PLATFORM_VALUES:
            return up.title()
        for platform in PLATFORM_VALUES:
            if re.search(rf"\b{re.escape(platform)}\b", up):
                return platform.title()
    return None


def parse_session_value(value: str) -> Optional[float]:
    raw = value.strip()
    if re.fullmatch(r"\d+", raw):
        return float(int(raw))
    if re.fullmatch(r"\d+\.\d+", raw):
        return float(raw)
    return None


def extract_session_id(cells: Sequence[str], current_session: Optional[float]) -> Optional[float]:
    for cell in cells:
        parsed = parse_session_value(cell)
        if parsed is not None:
            return parsed

    # Also support cells like "S24"
    for cell in cells:
        m = re.search(r"\bS?(\d{1,3})\b", cell, re.IGNORECASE)
        if m and m.group(1).isdigit():
            return float(int(m.group(1)))

    return current_session


def extract_weight_class(cells: Sequence[str]) -> Optional[str]:
    candidates: List[str] = []

    for cell in cells:
        clean = cell.strip()
        if not clean:
            continue
        if re.search(r"\bkg\b", clean, re.IGNORECASE):
            return clean

    for cell in reversed(cells):
        clean = cell.strip()
        if not clean:
            continue
        if parse_time_value(clean):
            continue
        if parse_date_value(clean, DEFAULT_YEAR):
            continue
        if clean.upper() in PLATFORM_VALUES:
            continue
        if re.fullmatch(r"\d+", clean):
            continue
        if clean in {"#", "COMP TIME", "DAY", "SESSION", "PLATFORM"}:
            continue
        if any(marker in clean.upper() for marker in ("SESSION", "PLATFORM", "DAY", "TIME")):
            continue
        candidates.append(clean)

    if candidates:
        return candidates[0]

    return None


def extract_times(cells: Sequence[str]) -> Tuple[Optional[time], Optional[time]]:
    parsed = [parse_time_value(c) for c in cells]
    times = [t for t in parsed if t is not None]

    if len(times) >= 2:
        # In most tables this is [weigh-in, start] or [start, weigh-in],
        # use earliest as weigh-in and latest as start.
        ordered = sorted(times)
        return ordered[0], ordered[-1]

    if len(times) == 1:
        start = times[0]
        dt = datetime.combine(date_cls(2000, 1, 1), start) - timedelta(hours=WEIGH_IN_OFFSET_HOURS)
        return dt.time(), start

    return None, None


def is_header_row(cells: Sequence[str]) -> bool:
    joined = " ".join(c.upper() for c in cells)
    header_tokens = ("SESSION", "PLATFORM", "DAY", "COMP", "WEIGH", "START", "CATEGORY")
    return all(token in joined for token in ("SESSION", "PLATFORM")) or any(
        token in joined for token in header_tokens
    ) and "KG" not in joined


def parse_rows_from_table(
    table: Sequence[Sequence[object]],
    meet_name: str,
    current_date: Optional[str],
    current_session: Optional[float],
    current_platform: Optional[str],
) -> Tuple[List[dict], Optional[str], Optional[float], Optional[str]]:
    rows: List[dict] = []

    for raw_row in table:
        cells = [normalize_cell(c) for c in raw_row]
        cells = [c for c in cells if c]

        if not cells or is_header_row(cells):
            continue

        # Primary parser for this PDF layout:
        # Session | Platform | Day | Comp Time | #
        if len(cells) >= 5:
            session_value = parse_session_value(cells[0])
            platform_value = extract_platform([cells[1]])
            date_value = parse_date_value(cells[2], DEFAULT_YEAR) or current_date
            start_value = parse_time_value(cells[3])
            count_value = cells[4]

            if session_value is not None and platform_value and date_value and start_value:
                current_session = session_value
                current_platform = platform_value
                current_date = date_value
                weigh_value = (
                    datetime.combine(date_cls(2000, 1, 1), start_value)
                    - timedelta(hours=WEIGH_IN_OFFSET_HOURS)
                ).time()

                rows.append(
                    {
                        "date": current_date,
                        "session_id": current_session,
                        "start_time": start_value.strftime("%H:%M:%S"),
                        "weigh_in_time": weigh_value.strftime("%H:%M:%S"),
                        "platform": current_platform,
                        # No weight class exists in this source table yet.
                        "weight_class": "",
                        "meet": meet_name,
                    }
                )
                continue

        for cell in cells:
            parsed_date = parse_date_value(cell, DEFAULT_YEAR)
            if parsed_date:
                current_date = parsed_date
                break

        session_id = extract_session_id(cells, current_session)
        if session_id is not None:
            current_session = session_id

        platform = extract_platform(cells) or current_platform
        if platform is not None:
            current_platform = platform
        platform = current_platform
        weight_class = extract_weight_class(cells)
        weigh_in_time, start_time = extract_times(cells)

        if not (current_date and session_id and platform and weight_class and start_time and weigh_in_time):
            continue

        rows.append(
            {
                "date": current_date,
                "session_id": session_id,
                "start_time": start_time.strftime("%H:%M:%S"),
                "weigh_in_time": weigh_in_time.strftime("%H:%M:%S"),
                "platform": platform,
                "weight_class": weight_class,
                "meet": meet_name,
            }
        )

    return rows, current_date, current_session, current_platform


def dedupe_rows(rows: Sequence[dict]) -> List[dict]:
    unique = {}
    for row in rows:
        key = (row["meet"], row["date"], row["session_id"], row["platform"], row["weight_class"])
        unique[key] = row
    return list(unique.values())


def extract_schedule_data(pdf_file: BytesIO, meet_name: str) -> List[dict]:
    print("Extracting rows from PDF...")
    all_rows: List[dict] = []
    current_date: Optional[str] = None
    current_session: Optional[float] = None
    current_platform: Optional[str] = None

    with pdfplumber.open(pdf_file) as pdf:
        total_pages = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, 1):
            print(f"Processing page {idx}/{total_pages}")
            tables = page.extract_tables() or []
            for table in tables:
                if not table or len(table) < 2:
                    continue
                parsed, current_date, current_session, current_platform = parse_rows_from_table(
                    table=table,
                    meet_name=meet_name,
                    current_date=current_date,
                    current_session=current_session,
                    current_platform=current_platform,
                )
                all_rows.extend(parsed)

    deduped = dedupe_rows(all_rows)
    print(f"Extracted {len(deduped)} unique rows ({len(all_rows)} raw rows)")
    return deduped


def add_ids(rows: Sequence[dict], start_id: int) -> List[ScheduleRow]:
    sorted_rows = sorted(
        rows,
        key=lambda r: (
            r["date"],
            r["session_id"],
            PLATFORM_SORT_ORDER.get(r["platform"], 99),
            r["platform"],
        ),
    )
    result: List[ScheduleRow] = []
    next_id = start_id

    for row in sorted_rows:
        result.append(
            ScheduleRow(
                id=next_id,
                date=row["date"],
                session_id=row["session_id"],
                start_time=row["start_time"],
                weigh_in_time=row["weigh_in_time"],
                platform=row["platform"],
                weight_class=row["weight_class"],
                meet=row["meet"],
            )
        )
        next_id += 1

    return result


def export_csv(rows: Sequence[ScheduleRow], output_path: str) -> None:
    if not rows:
        raise ValueError("No rows parsed; CSV was not written")

    print(f"Writing CSV: {output_path}")
    with open(output_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(
            handle,
            fieldnames=[
                "id",
                "date",
                "session_id",
                "start_time",
                "weigh_in_time",
                "platform",
                "weight_class",
                "meet",
            ],
        )
        writer.writeheader()
        for row in rows:
            writer.writerow(row.to_csv_row())


def ingest_to_convex(rows: Sequence[ScheduleRow]) -> dict:
    convex_url = os.getenv("CONVEX_URL")
    scraper_secret = os.getenv("SCRAPER_SECRET")

    if not convex_url or not scraper_secret:
        raise ValueError("CONVEX_URL and SCRAPER_SECRET are required for convex mode")

    endpoint = f"{convex_url.rstrip('/')}/api/action"
    inserted = 0
    updated = 0
    failed = 0

    for row in rows:
        payload = {
            "path": CONVEX_INGEST_PATH,
            "args": row.to_convex_args(scraper_secret=scraper_secret),
        }
        try:
            response = requests.post(endpoint, json=payload, timeout=REQUEST_TIMEOUT_SECONDS)
            if not response.ok:
                failed += 1
                print(f"HTTP {response.status_code} for session {row.session_id} {row.platform}: {response.text}")
                continue

            data = response.json()
            value = data.get("value", {}) if isinstance(data, dict) else {}
            if value.get("wasInsert") is True:
                inserted += 1
            else:
                updated += 1
        except Exception as exc:  # noqa: BLE001
            failed += 1
            print(f"Convex error for session {row.session_id} {row.platform}: {exc}")

    return {
        "total": len(rows),
        "inserted": inserted,
        "updated": updated,
        "failed": failed,
    }


def run(mode: str, url: str, meet_name: str, output_path: str, start_id: int) -> None:
    pdf_file = download_pdf(url)
    parsed_rows = extract_schedule_data(pdf_file=pdf_file, meet_name=meet_name)
    rows_with_ids = add_ids(parsed_rows, start_id=start_id)

    if mode == "dry-run":
        export_csv(rows_with_ids, output_path)
        print(f"Dry run complete. Parsed {len(rows_with_ids)} rows.")
        print(f"Preview file: {output_path}")
        return

    stats = ingest_to_convex(rows_with_ids)
    print("Convex ingest complete:")
    print(stats)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scrape OWLCMS final schedule PDF")
    parser.add_argument("mode", choices=["dry-run", "convex"], help="dry-run writes CSV, convex uploads")
    parser.add_argument("--url", default=PDF_URL, help="PDF URL (defaults to top-level PDF_URL)")
    parser.add_argument("--meet", default=MEET_NAME, help="Meet name (defaults to top-level MEET_NAME)")
    parser.add_argument(
        "--start-id",
        type=int,
        default=START_ID,
        help="Starting ID for CSV rows (defaults to top-level START_ID)",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_CSV,
        help="CSV output path for dry-run mode",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run(
        mode=args.mode,
        url=args.url,
        meet_name=args.meet,
        output_path=args.output,
        start_id=args.start_id,
    )


if __name__ == "__main__":
    main()
