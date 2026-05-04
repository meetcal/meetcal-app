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
import json
import os
import re
import shutil
import subprocess
import tempfile
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
PDF_URL = "https://storage.googleapis.com/production-ipower-v1-0-4/354/1018354/vixoE8Rk/8fbeb85a8fc44ab1b15023ee7d0f0494?fileName=2026%20Pan%20Am%20Masters%20-%20Final%20Lifting%20Schedule.pdf"
MEET_NAME = "2026 Pan American Masters"
START_ID = 123
DEFAULT_YEAR = 2026
WEIGH_IN_OFFSET_HOURS = 2
DEFAULT_OUTPUT_PATH = "final_schedule_preview.ts"
REQUEST_TIMEOUT_SECONDS = 45
OCR_RENDER_RESOLUTION = 300

PLATFORM_VALUES = {
    "A",
    "B",
    "C",
    "RED",
    "WHITE",
    "BLUE",
    "STARS",
    "STRIPES",
    "ROGUE",
}
CONVEX_INGEST_PATH = "scraperIngestion:ingestSessionSchedule"
PLATFORM_SORT_ORDER = {
    "Red": 0,
    "White": 1,
    "Blue": 2,
    "Stars": 3,
    "Stripes": 4,
    "Rogue": 5,
}
PLATFORM_ALIASES = {
    "A": "RED",
    "B": "WHITE",
    "C": "BLUE",
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
        session_value = (
            int(self.session_id)
            if float(self.session_id).is_integer()
            else self.session_id
        )
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

    def to_ts_object(self) -> dict:
        return {
            "date": self.date,
            "meet": self.meet,
            "platform": self.platform,
            "sessionId": self.session_id,
            "startTime": self.start_time,
            "weighInTime": self.weigh_in_time,
            "weightClass": self.weight_class,
        }


@dataclass
class OcrLine:
    top: int
    words: List[dict]

    @property
    def text(self) -> str:
        return " ".join(str(word["text"]) for word in self.words)


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

    m = re.search(r"\b(\d{1,2})[-\s]?([A-Za-z]{3,9})\b", value)
    if m:
        day = int(m.group(1))
        month = month_map.get(m.group(2)[:3].upper())
        if month:
            try:
                return date_cls(default_year, month, day).isoformat()
            except ValueError:
                return None

    m = re.search(r"\b([A-Za-z]{3,9})[-\s]?(\d{1,2})\b", value)
    if m:
        month = month_map.get(m.group(1)[:3].upper())
        day = int(m.group(2))
        if month:
            try:
                return date_cls(default_year, month, day).isoformat()
            except ValueError:
                return None

    return None


def normalize_ocr_token(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip().strip("'\"`‘’.,")


def normalize_ocr_group(value: str) -> Optional[str]:
    token = normalize_ocr_token(value).upper().replace("O", "0")
    sex = None
    if "W" in token:
        sex = "W"
    elif "M" in token:
        sex = "M"

    if sex is None:
        return None

    digits = "".join(re.findall(r"\d", token))
    if len(digits) >= 3 and digits[1:] == "00":
        digits = f"{digits[0]}0"
    elif len(digits) > 2:
        digits = digits[:2]

    if len(digits) != 2:
        return None

    return f"{sex}{digits}"


def normalize_ocr_weight_category(value: str) -> Optional[str]:
    token = normalize_ocr_token(value)
    token = token.replace("—", "-").replace("–", "-").replace("~", "")
    token = token.replace("=", "").strip()
    token = re.sub(r"^[^\d+]+", "", token)
    token = re.sub(r"[^0-9+\-]", "", token)
    token = token.strip("-")

    if not token:
        return None

    # OCR occasionally drops the dash in ranges like 95-110.
    if re.fullmatch(r"\d{5}", token):
        token = f"{token[:2]}-{token[2:]}"

    if not re.search(r"\d", token):
        return None

    return token


def normalize_ocr_count(value: str) -> Optional[int]:
    token = normalize_ocr_token(value)
    token = re.sub(r"\D", "", token)
    if not token:
        return None
    return int(token)


def parse_ocr_tsv(tsv: str) -> List[OcrLine]:
    reader = csv.DictReader(tsv.splitlines(), delimiter="\t")
    grouped: dict[tuple[str, str, str, str], List[dict]] = {}

    for row in reader:
        if row.get("level") != "5":
            continue
        text = normalize_ocr_token(row.get("text", ""))
        if not text:
            continue

        try:
            word = {
                "text": text,
                "left": int(row["left"]),
                "top": int(row["top"]),
                "width": int(row["width"]),
                "height": int(row["height"]),
            }
        except (KeyError, TypeError, ValueError):
            continue

        key = (
            row.get("page_num", ""),
            row.get("block_num", ""),
            row.get("par_num", ""),
            row.get("line_num", ""),
        )
        grouped.setdefault(key, []).append(word)

    lines = []
    for words in grouped.values():
        words.sort(key=lambda word: word["left"])
        lines.append(OcrLine(top=min(word["top"] for word in words), words=words))

    return sorted(lines, key=lambda line: line.top)


def ocr_page_lines(page: pdfplumber.page.Page) -> List[OcrLine]:
    if not shutil.which("tesseract"):
        raise RuntimeError(
            "This PDF appears to be image-only. Install the `tesseract` executable "
            "to enable OCR fallback parsing."
        )

    temp_path = ""
    try:
        with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as handle:
            temp_path = handle.name

        image = page.to_image(resolution=OCR_RENDER_RESOLUTION).original
        image.save(temp_path)
        result = subprocess.run(
            ["tesseract", temp_path, "stdout", "--psm", "6", "tsv"],
            check=True,
            capture_output=True,
            text=True,
        )
        return parse_ocr_tsv(result.stdout)
    finally:
        if temp_path:
            try:
                os.unlink(temp_path)
            except OSError:
                pass


def extract_ocr_session_candidate(line: OcrLine) -> Optional[dict]:
    words = line.words
    session_word = next(
        (
            word
            for word in words
            if 600 <= word["left"] <= 720 and re.fullmatch(r"\d{1,3}", word["text"])
        ),
        None,
    )
    if session_word is None:
        return None

    platform = extract_platform(
        [word["text"] for word in words if 760 <= word["left"] <= 850]
    )
    times = []
    index = 0
    while index < len(words):
        word = words[index]
        text = word["text"]
        if index + 1 < len(words) and re.fullmatch(r"\d{1,2}:\d{2}", text):
            next_text = words[index + 1]["text"]
            if re.fullmatch(r"(?i)AM|PM", next_text):
                text = f"{text} {next_text}"
                index += 1
        parsed = parse_time_value(text)
        if parsed is not None and 880 <= word["left"] <= 1320:
            times.append(parsed)
        index += 1

    if not platform or len(times) < 2:
        return None

    session_total = None
    for word in words:
        if 2100 <= word["left"] <= 2185:
            session_total = normalize_ocr_count(word["text"])
            if session_total is not None:
                break

    return {
        "top": line.top,
        "session_id": float(int(session_word["text"])),
        "platform": platform,
        "weigh_in_time": times[0],
        "start_time": times[1],
        "session_total": session_total,
    }


def extract_ocr_weight_class_candidate(
    line: OcrLine,
) -> Optional[Tuple[int, str, Optional[int]]]:
    group = None
    category_parts = []
    lifter_count = None

    for word in line.words:
        left = word["left"]
        text = word["text"]
        if 1440 <= left <= 1595:
            group = normalize_ocr_group(text) or group
        if 1580 <= left <= 1810:
            category = normalize_ocr_weight_category(text)
            if category:
                category_parts.append(category)
        if 1970 <= left <= 2055:
            lifter_count = normalize_ocr_count(text) or lifter_count

    if not group or not category_parts:
        return None

    category = "-".join(category_parts)
    category = re.sub(r"-{2,}", "-", category).strip("-")
    category = normalize_ocr_weight_category(category)
    if not category:
        return None

    return line.top, f"{group} {category}", lifter_count


def extract_rows_from_ocr_lines(lines: Sequence[OcrLine], meet_name: str) -> List[dict]:
    session_candidates = [
        candidate
        for line in lines
        if (candidate := extract_ocr_session_candidate(line)) is not None
    ]
    if not session_candidates:
        return []

    first_date = None
    for line in lines:
        parsed = parse_date_value(line.text, DEFAULT_YEAR)
        if parsed:
            first_date = parsed
            break

    if first_date is None:
        return []

    current_date = datetime.strptime(first_date, "%Y-%m-%d").date()
    previous_start: Optional[time] = None
    for candidate in session_candidates:
        start_time = candidate["start_time"]
        if previous_start is not None and start_time < previous_start:
            current_date += timedelta(days=1)
        candidate["date"] = current_date.isoformat()
        previous_start = start_time

    weight_class_candidates = [
        candidate
        for line in lines
        if (candidate := extract_ocr_weight_class_candidate(line)) is not None
    ]
    classes_by_session_top: dict[int, List[str]] = {}

    has_totals = all(
        candidate.get("session_total") is not None for candidate in session_candidates
    ) and all(candidate[2] is not None for candidate in weight_class_candidates)

    if has_totals:
        class_index = 0
        for session in session_candidates:
            assigned = []
            lifter_total = 0
            session_total = int(session["session_total"])

            while class_index < len(weight_class_candidates):
                _, weight_class, lifter_count = weight_class_candidates[class_index]
                assigned.append(weight_class)
                lifter_total += int(lifter_count or 0)
                class_index += 1
                if lifter_total >= session_total:
                    break

            classes_by_session_top[session["top"]] = assigned
    else:
        classes_by_session_top = {
            candidate["top"]: [] for candidate in session_candidates
        }
        session_tops = [candidate["top"] for candidate in session_candidates]
        for class_top, weight_class, _ in weight_class_candidates:
            nearest_session_top = min(session_tops, key=lambda top: abs(top - class_top))
            classes_by_session_top[nearest_session_top].append(weight_class)

    rows: List[dict] = []
    for candidate in session_candidates:
        weight_classes = classes_by_session_top.get(candidate["top"], [])
        for weight_class in weight_classes:
            rows.append(
                {
                    "date": candidate["date"],
                    "session_id": candidate["session_id"],
                    "start_time": candidate["start_time"].strftime("%H:%M:%S"),
                    "weigh_in_time": candidate["weigh_in_time"].strftime("%H:%M:%S"),
                    "platform": candidate["platform"],
                    "weight_class": weight_class,
                    "meet": meet_name,
                }
            )

    return rows


def extract_rows_from_ocr_page(
    page: pdfplumber.page.Page, meet_name: str
) -> List[dict]:
    lines = ocr_page_lines(page)
    return extract_rows_from_ocr_lines(lines=lines, meet_name=meet_name)


def extract_platform(cells: Sequence[str]) -> Optional[str]:
    for cell in cells:
        up = cell.upper()
        up = PLATFORM_ALIASES.get(up, up)
        if up in PLATFORM_VALUES:
            return up.title()
        for platform in PLATFORM_VALUES:
            if re.search(rf"\b{re.escape(platform)}\b", up):
                platform = PLATFORM_ALIASES.get(platform, platform)
                return platform.title()
    return None


def parse_session_value(value: str) -> Optional[float]:
    raw = value.strip()
    if re.fullmatch(r"\d+", raw):
        return float(int(raw))
    if re.fullmatch(r"\d+\.\d+", raw):
        return float(raw)
    return None


def extract_session_id(
    cells: Sequence[str], current_session: Optional[float]
) -> Optional[float]:
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
        if any(
            marker in clean.upper() for marker in ("SESSION", "PLATFORM", "DAY", "TIME")
        ):
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
        dt = datetime.combine(date_cls(2000, 1, 1), start) - timedelta(
            hours=WEIGH_IN_OFFSET_HOURS
        )
        return dt.time(), start

    return None, None


def is_header_row(cells: Sequence[str]) -> bool:
    joined = " ".join(c.upper() for c in cells)
    header_tokens = ("SESSION", "PLATFORM", "DAY", "COMP", "WEIGH", "START", "CATEGORY")
    return (
        all(token in joined for token in ("SESSION", "PLATFORM"))
        or any(token in joined for token in header_tokens)
        and "KG" not in joined
    )


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

            if (
                session_value is not None
                and platform_value
                and date_value
                and start_value
            ):
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

        if not (
            current_date
            and session_id
            and platform
            and weight_class
            and start_time
            and weigh_in_time
        ):
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


def class_sort_key(weight_class: str) -> Tuple[str, int, str]:
    m = re.match(r"\s*([MW])(\d{2})\b", weight_class, re.IGNORECASE)
    if not m:
        return ("Z", 999, weight_class)
    return (m.group(1).upper(), int(m.group(2)), weight_class)


def parse_age_group_class(weight_class: str) -> Optional[Tuple[str, str]]:
    m = re.match(r"\s*([MW]\d{2})\s+(.+?)\s*$", weight_class, re.IGNORECASE)
    if not m:
        return None
    return m.group(1).upper(), m.group(2).strip()


def is_all_weight_category(group: str, category: str) -> bool:
    sex = group[0].upper()
    normalized = normalize_ocr_weight_category(category)
    if normalized is None:
        return False
    return (sex == "M" and normalized == "60-110+") or (
        sex == "W" and normalized == "49-86+"
    )


def format_combined_weight_classes(weight_classes: Sequence[str]) -> str:
    unique_classes = []
    seen = set()
    for weight_class in weight_classes:
        clean = normalize_cell(weight_class)
        if clean and clean not in seen:
            seen.add(clean)
            unique_classes.append(clean)

    if not unique_classes:
        return ""

    parsed = [parse_age_group_class(weight_class) for weight_class in unique_classes]
    if any(item is None for item in parsed):
        return ", ".join(sorted(unique_classes, key=class_sort_key))

    grouped_by_category: dict[str, List[str]] = {}
    for group, category in parsed:
        normalized_category = normalize_ocr_weight_category(category) or category
        grouped_by_category.setdefault(normalized_category, []).append(group)

    formatted = []
    for category, groups in grouped_by_category.items():
        sorted_groups = sorted(groups, key=class_sort_key)
        label = "All" if all(is_all_weight_category(g, category) for g in groups) else category
        formatted.append(
            {
                "sort": class_sort_key(sorted_groups[0]),
                "text": f"{', '.join(sorted_groups)} {label}",
            }
        )

    return ", ".join(item["text"] for item in sorted(formatted, key=lambda item: item["sort"]))


def combine_session_rows(rows: Sequence[dict]) -> List[dict]:
    grouped: dict[tuple, dict] = {}

    for row in rows:
        key = (
            row["meet"],
            row["date"],
            row["session_id"],
            row["start_time"],
            row["weigh_in_time"],
            row["platform"],
        )
        if key not in grouped:
            grouped[key] = {**row, "weight_classes": []}
        grouped[key]["weight_classes"].append(row.get("weight_class", ""))

    combined = []
    for row in grouped.values():
        weight_classes = row.pop("weight_classes")
        row["weight_class"] = format_combined_weight_classes(weight_classes)
        combined.append(row)

    return combined


def dedupe_rows(rows: Sequence[dict]) -> List[dict]:
    unique = {}
    for row in rows:
        key = (
            row["meet"],
            row["date"],
            row["session_id"],
            row["start_time"],
            row["weigh_in_time"],
            row["platform"],
            row["weight_class"],
        )
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
                parsed, current_date, current_session, current_platform = (
                    parse_rows_from_table(
                        table=table,
                        meet_name=meet_name,
                        current_date=current_date,
                        current_session=current_session,
                        current_platform=current_platform,
                    )
                )
                all_rows.extend(parsed)

        if not all_rows:
            print("No table rows found; trying OCR fallback for image-only schedule PDF...")
            for idx, page in enumerate(pdf.pages, 1):
                print(f"OCR processing page {idx}/{total_pages}")
                all_rows.extend(
                    extract_rows_from_ocr_page(page=page, meet_name=meet_name)
                )

    deduped = dedupe_rows(all_rows)
    combined = combine_session_rows(deduped)
    print(
        f"Extracted {len(combined)} session rows "
        f"({len(deduped)} unique class rows, {len(all_rows)} raw rows)"
    )
    return combined


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


def ts_value(value: object) -> str:
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value)


def export_ts(rows: Sequence[ScheduleRow], output_path: str) -> None:
    if not rows:
        raise ValueError("No rows parsed; TypeScript file was not written")

    print(f"Writing TypeScript rows: {output_path}")
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write("[\n")
        for index, row in enumerate(rows):
            row_data = row.to_ts_object()
            fields = ", ".join(
                f"{key}: {ts_value(value)}" for key, value in row_data.items()
            )
            suffix = "," if index < len(rows) - 1 else ""
            handle.write(f"  {{ {fields} }}{suffix}\n")
        handle.write("]\n")


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
            response = requests.post(
                endpoint, json=payload, timeout=REQUEST_TIMEOUT_SECONDS
            )
            if not response.ok:
                failed += 1
                print(
                    f"HTTP {response.status_code} for session {row.session_id} {row.platform}: {response.text}"
                )
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
        if output_path.lower().endswith(".csv"):
            export_csv(rows_with_ids, output_path)
        else:
            export_ts(rows_with_ids, output_path)
        print(f"Dry run complete. Parsed {len(rows_with_ids)} rows.")
        print(f"Preview file: {output_path}")
        return

    stats = ingest_to_convex(rows_with_ids)
    print("Convex ingest complete:")
    print(stats)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Scrape OWLCMS final schedule PDF")
    parser.add_argument(
        "mode", choices=["dry-run", "convex"], help="dry-run writes CSV, convex uploads"
    )
    parser.add_argument(
        "--url", default=PDF_URL, help="PDF URL (defaults to top-level PDF_URL)"
    )
    parser.add_argument(
        "--meet", default=MEET_NAME, help="Meet name (defaults to top-level MEET_NAME)"
    )
    parser.add_argument(
        "--start-id",
        type=int,
        default=START_ID,
        help="Starting ID for CSV rows (defaults to top-level START_ID)",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_PATH,
        help="Output path for dry-run mode. Defaults to TypeScript rows; use .csv for CSV.",
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
