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
from pathlib import Path
from typing import Dict, List, Optional, Sequence, Set, Tuple

import pdfplumber
import requests
from dotenv import load_dotenv

try:
    from pypdf import PdfReader
except ImportError:
    PdfReader = None

load_dotenv()
load_dotenv(Path(__file__).resolve().parents[3] / ".env.local")
load_dotenv(Path(__file__).resolve().parents[3] / ".env")


def get_convex_url() -> Optional[str]:
    return os.getenv("CONVEX_URL") or os.getenv("EXPO_PUBLIC_CONVEX_URL")

# ---------------------------
# Top-level scraper config
# ---------------------------
PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt7b3763235e6b397c/6a111b3ad7617bb684580901/2026_-_NCW_-_Preliminary_Schedule.pdf"
START_LIST_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt4c16dd3b8ea80091/6a29bded2650fd0c87594a5f/2026_-_NCW_-_START_LIST.pdf"
MEET_NAME = "2026 USA Weightlifting National Championships, Powered by Rogue Fitness"
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
CONVEX_DELETE_PATH = "scraperIngestion:deleteSessionScheduleByMeet"
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
START_LIST_TAIL_PATTERN = re.compile(
    rf"\s(?P<entry_total>\d{{1,3}})(?:\s*(?P<group>[A-Z]))?\s+"
    rf"(?P<session>\d+(?:\.\d+)?)\s*(?P<platform>{'|'.join(PLATFORM_VALUES)})\s+"
    r"\d{1,2}-[A-Za-z]{3}\s+\d{1,2}:\d{2}\s+[AP]M$",
    re.IGNORECASE,
)
START_LIST_YEAR_AGE_PATTERN = re.compile(
    r"(?:\b[A-Z]{2,3}\b\s+)?(19\d{2}|20\d{2})\s+(\d{1,2})(?=\s|[A-Za-z]|$)"
)
START_LIST_COMP_MARKERS = {
    "ADAP",
    "JR",
    "JUNIOR",
    "MIL",
    "NAT",
    "OPEN",
    "TKOK",
    "UNI",
    "WSO",
}
MONTH_NAMES = (
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
)
WEEKDAY_NAMES = (
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
)


@dataclass
class NcwPrelimState:
    current_date: Optional[str] = None
    current_session: Optional[float] = None
    last_headers: Optional[List[str]] = None


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


@dataclass
class CompactScheduleClass:
    category: str
    weight: str
    group: str
    count: int
    is_wso: bool
    is_marker: bool


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


def parse_long_form_date(raw: str) -> Optional[str]:
    value = raw.replace("\n", " ").strip()
    if not value:
        return None

    match = re.search(r"([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})", value)
    if match:
        try:
            parsed = datetime.strptime(
                f"{match.group(1)} {match.group(2)} {match.group(3)}",
                "%B %d %Y",
            )
            return parsed.date().isoformat()
        except ValueError:
            pass

    return parse_date_value(value, DEFAULT_YEAR)


def normalize_table_row(raw_row: Sequence[object]) -> List[str]:
    return [normalize_cell(cell) for cell in raw_row]


def row_has_schedule_date(row: Sequence[str]) -> bool:
    row_text = " ".join(cell for cell in row if cell)
    if not any(month in row_text for month in MONTH_NAMES):
        return False
    return any(day in row_text for day in WEEKDAY_NAMES)


def parse_schedule_date_row(row: Sequence[str]) -> Optional[str]:
    row_text = " ".join(cell for cell in row if cell)
    return parse_long_form_date(row_text)


def is_date_only_row(row: Sequence[str], header_map: dict[str, int]) -> bool:
    if not row_has_schedule_date(row):
        return False

    platform_idx = header_map.get("platform_idx", 2)
    platform = extract_platform(
        [row[platform_idx] if platform_idx < len(row) else ""]
    )
    if platform:
        return False

    weigh_idx = header_map.get("weigh_idx", 3)
    time_idx = header_map.get("time_idx", 4)
    if parse_time_value(row[weigh_idx] if weigh_idx < len(row) else ""):
        return False
    if parse_time_value(row[time_idx] if time_idx < len(row) else ""):
        return False

    return True


def is_ncw_prelim_header_row(row: Sequence[str]) -> bool:
    row_text = " ".join(cell.lower() for cell in row if cell)
    keywords_found = sum(
        keyword in row_text
        for keyword in (
            "sess",
            "date",
            "plat",
            "weigh",
            "time",
            "gender",
            "category",
        )
    )
    return keywords_found >= 4


def build_ncw_prelim_header_map(headers: Sequence[str]) -> dict[str, int]:
    header_map: dict[str, int] = {}
    for idx, header in enumerate(headers):
        if not header:
            continue
        header_lower = header.lower().strip().replace("\n", " ")
        if "weight" in header_lower and "category" in header_lower:
            header_map["weight_class_idx"] = idx
        elif header_lower == "weigh":
            header_map["weigh_idx"] = idx
        elif "date" in header_lower:
            header_map["date_idx"] = idx
        elif "sess" in header_lower:
            header_map["session_idx"] = idx
        elif "plat" in header_lower:
            header_map["platform_idx"] = idx
        elif "time" in header_lower:
            header_map["time_idx"] = idx
        elif "gender" in header_lower:
            header_map["gender_idx"] = idx
        elif "age" in header_lower and "group" in header_lower:
            header_map["age_group_idx"] = idx
        elif "estimated" in header_lower or (
            "total" in header_lower and "entry" in header_lower
        ):
            header_map["entry_totals_idx"] = idx
    return header_map


def table_has_ncw_prelim_headers(table: Sequence[Sequence[object]]) -> bool:
    for raw_row in table:
        row = normalize_table_row(raw_row)
        if is_ncw_prelim_header_row(row):
            return True
    return False


def ncw_prelim_row_offset(row: Sequence[str], header_map: dict[str, int]) -> int:
    platform_idx = header_map.get("platform_idx", 2)
    for idx, value in enumerate(row):
        if extract_platform([value]):
            return idx - platform_idx
    return 0


def ncw_prelim_cell(
    row: Sequence[str],
    header_map: dict[str, int],
    column: str,
    default_idx: int,
    offset: int,
) -> str:
    index = header_map.get(column, default_idx) + offset
    return row[index] if 0 <= index < len(row) else ""


def extract_ncw_prelim_entry(
    row: Sequence[str],
    header_map: dict[str, int],
    meet_name: str,
    current_date: Optional[str],
    current_session: Optional[float],
) -> Tuple[Optional[dict], Optional[str], Optional[float]]:
    offset = ncw_prelim_row_offset(row, header_map)

    platform = extract_platform(
        [ncw_prelim_cell(row, header_map, "platform_idx", 2, offset)]
    )
    if not platform:
        return None, current_date, current_session

    weigh_time = parse_time_value(
        ncw_prelim_cell(row, header_map, "weigh_idx", 3, offset)
    )
    start_time = parse_time_value(
        ncw_prelim_cell(row, header_map, "time_idx", 4, offset)
    )
    if not weigh_time or not start_time:
        return None, current_date, current_session

    weight_class = ncw_prelim_cell(row, header_map, "weight_class_idx", 7, offset).strip()
    if not weight_class or weight_class == "---":
        return None, current_date, current_session

    gender = ncw_prelim_cell(row, header_map, "gender_idx", 5, offset).strip().upper()
    age_group = ncw_prelim_cell(row, header_map, "age_group_idx", 6, offset).strip()
    entry_totals_range = ncw_prelim_cell(
        row, header_map, "entry_totals_idx", 8, offset
    ).strip()

    date_str = ncw_prelim_cell(row, header_map, "date_idx", 0, offset)
    if date_str:
        parsed_date = parse_long_form_date(date_str)
        if parsed_date:
            current_date = parsed_date

    session_str = ncw_prelim_cell(row, header_map, "session_idx", 1, offset).strip()
    explicit_session = re.fullmatch(r"\d+", session_str)
    if explicit_session:
        current_session = float(int(session_str))

    if not current_date or current_session is None:
        return None, current_date, current_session

    return (
        {
            "date": current_date,
            "session_id": current_session,
            "start_time": start_time.strftime("%H:%M:%S"),
            "weigh_in_time": weigh_time.strftime("%H:%M:%S"),
            "platform": platform,
            "weight_class": weight_class,
            "gender": gender,
            "age_group": age_group,
            "entry_totals_range": entry_totals_range,
            "meet": meet_name,
            "_explicit_session": explicit_session is not None,
        },
        current_date,
        current_session,
    )


def assign_ncw_prelim_sessions(rows: Sequence[dict]) -> List[dict]:
    groups: dict[tuple[str, str, str], List[dict]] = {}
    group_order: List[tuple[str, str, str]] = []

    for row in rows:
        key = (row["date"], row["weigh_in_time"], row["start_time"])
        if key not in groups:
            groups[key] = []
            group_order.append(key)
        groups[key].append(row)

    assigned: List[dict] = []
    last_session_id: Optional[float] = None

    for key in group_order:
        group = groups[key]
        explicit_sessions = [
            row["session_id"] for row in group if row.get("_explicit_session")
        ]
        if explicit_sessions:
            session_id = explicit_sessions[0]
        elif last_session_id is not None:
            session_id = last_session_id + 1
        else:
            session_id = group[0]["session_id"]

        last_session_id = session_id
        for row in group:
            row["session_id"] = session_id
            cleaned = {k: v for k, v in row.items() if k != "_explicit_session"}
            assigned.append(cleaned)

    return assigned


def fix_ncw_prelim_platform_errors(rows: Sequence[dict]) -> List[dict]:
    fixed: List[dict] = []
    for row in rows:
        updated = dict(row)
        session_id = updated.get("session_id")
        age_group = str(updated.get("age_group", "")).upper()
        if (
            session_id is not None
            and float(session_id) == 44
            and updated.get("platform") == "Red"
            and age_group == "NAT"
        ):
            updated["platform"] = "White"
        fixed.append(updated)
    return fixed


def find_ncw_prelim_header_sections(
    table: Sequence[Sequence[object]],
) -> List[dict]:
    sections: List[dict] = []
    normalized_table = [normalize_table_row(raw_row) for raw_row in table]

    for idx, row in enumerate(normalized_table):
        if not is_ncw_prelim_header_row(row):
            continue

        date_for_section = None
        for look_back in range(1, min(4, idx + 1)):
            prev_row = normalized_table[idx - look_back]
            if row_has_schedule_date(prev_row):
                date_for_section = parse_schedule_date_row(prev_row)
                break

        sections.append(
            {
                "header_row": row,
                "start_idx": idx + 1,
                "date_text": date_for_section,
            }
        )

    return sections


def parse_ncw_prelim_rows_with_headers(
    data_rows: Sequence[Sequence[object]],
    headers: Sequence[str],
    meet_name: str,
    state: NcwPrelimState,
    section_date: Optional[str] = None,
) -> Tuple[List[dict], NcwPrelimState]:
    rows: List[dict] = []
    header_map = build_ncw_prelim_header_map(headers)
    current_date = state.current_date
    current_session = state.current_session

    if section_date:
        current_date = section_date
        state.current_date = section_date
    elif not current_date:
        date_idx = header_map.get("date_idx", 0)
        for raw_row in data_rows[:10]:
            row = normalize_table_row(raw_row)
            if date_idx < len(row):
                parsed_date = parse_long_form_date(row[date_idx])
                if parsed_date:
                    current_date = parsed_date
                    state.current_date = parsed_date
                    break

    for raw_row in data_rows:
        row = normalize_table_row(raw_row)
        if not any(cell for cell in row):
            continue

        if is_date_only_row(row, header_map):
            parsed_date = parse_schedule_date_row(row)
            if parsed_date:
                current_date = parsed_date
                state.current_date = parsed_date
            continue

        entry, current_date, current_session = extract_ncw_prelim_entry(
            row=row,
            header_map=header_map,
            meet_name=meet_name,
            current_date=current_date,
            current_session=current_session,
        )
        if entry is None:
            continue

        state.current_date = current_date
        state.current_session = current_session
        rows.append(entry)

    return rows, state


def parse_ncw_prelim_table(
    table: Sequence[Sequence[object]],
    meet_name: str,
    state: NcwPrelimState,
) -> Tuple[List[dict], NcwPrelimState]:
    rows: List[dict] = []
    sections = find_ncw_prelim_header_sections(table)

    if sections:
        if sections[0]["start_idx"] > 0 and state.last_headers:
            pre_header_rows = table[: sections[0]["start_idx"]]
            parsed, state = parse_ncw_prelim_rows_with_headers(
                data_rows=pre_header_rows,
                headers=state.last_headers,
                meet_name=meet_name,
                state=state,
                section_date=None,
            )
            rows.extend(parsed)

        for index, section in enumerate(sections):
            end_idx = (
                sections[index + 1]["start_idx"] - 1
                if index + 1 < len(sections)
                else len(table)
            )
            data_rows = table[section["start_idx"] : end_idx]
            state.last_headers = section["header_row"]
            parsed, state = parse_ncw_prelim_rows_with_headers(
                data_rows=data_rows,
                headers=section["header_row"],
                meet_name=meet_name,
                state=state,
                section_date=section.get("date_text"),
            )
            rows.extend(parsed)
        return rows, state

    if state.last_headers:
        parsed, state = parse_ncw_prelim_rows_with_headers(
            data_rows=table,
            headers=state.last_headers,
            meet_name=meet_name,
            state=state,
            section_date=None,
        )
        rows.extend(parsed)

    return rows, state


def extract_ncw_prelim_schedule_data(
    pdf_file: BytesIO, meet_name: str
) -> List[dict]:
    print("Extracting rows using NCW preliminary schedule parser...")
    all_rows: List[dict] = []
    state = NcwPrelimState()

    with pdfplumber.open(pdf_file) as pdf:
        total_pages = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, 1):
            print(f"Processing page {idx}/{total_pages}")
            for table in page.extract_tables() or []:
                if not table:
                    continue
                parsed, state = parse_ncw_prelim_table(
                    table=table,
                    meet_name=meet_name,
                    state=state,
                )
                all_rows.extend(parsed)

    reconciled = fix_ncw_prelim_platform_errors(assign_ncw_prelim_sessions(all_rows))
    deduped = dedupe_rows(reconciled)
    combined = combine_session_rows(deduped)
    print(
        f"Extracted {len(combined)} session rows "
        f"({len(deduped)} unique class rows, {len(all_rows)} raw rows)"
    )
    return combined


def to_assign_schedule_row(entry: dict) -> dict:
    session_id = entry["session_id"]
    session_value = (
        int(session_id) if float(session_id).is_integer() else session_id
    )
    return {
        "sess": str(session_value),
        "plat": entry["platform"],
        "gender": entry.get("gender", ""),
        "age_group": entry.get("age_group", ""),
        "weight_category": entry["weight_class"],
        "age_group_weight_category": entry["weight_class"],
        "estimated_entry_totals_(min___max)": entry.get("entry_totals_range", ""),
        "meet": entry["meet"],
    }


def extract_ncw_prelim_assignment_rows(
    pdf_file: BytesIO, meet_name: str
) -> List[dict]:
    print("Extracting assignment schedule rows from PDF...")
    all_rows: List[dict] = []
    state = NcwPrelimState()

    with pdfplumber.open(pdf_file) as pdf:
        total_pages = len(pdf.pages)
        for idx, page in enumerate(pdf.pages, 1):
            print(f"Processing page {idx}/{total_pages}")
            for table in page.extract_tables() or []:
                if not table:
                    continue
                parsed, state = parse_ncw_prelim_table(
                    table=table,
                    meet_name=meet_name,
                    state=state,
                )
                all_rows.extend(parsed)

    reconciled = fix_ncw_prelim_platform_errors(assign_ncw_prelim_sessions(all_rows))
    deduped = dedupe_rows(reconciled)
    print(
        f"Extracted {len(deduped)} assignment schedule rows "
        f"({len(all_rows)} raw rows before dedupe)"
    )
    return deduped


def extract_assignment_schedule_data(
    pdf_file: BytesIO, meet_name: str
) -> List[dict]:
    with pdfplumber.open(pdf_file) as pdf:
        uses_ncw_prelim = any(
            table_has_ncw_prelim_headers(table)
            for page in pdf.pages
            for table in (page.extract_tables() or [])
        )

    if not uses_ncw_prelim:
        raise ValueError(
            "Assignment schedule extraction requires an NCW preliminary schedule PDF"
        )

    pdf_file.seek(0)
    rows = extract_ncw_prelim_assignment_rows(pdf_file=pdf_file, meet_name=meet_name)
    return [to_assign_schedule_row(row) for row in rows]


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
            nearest_session_top = min(
                session_tops, key=lambda top: abs(top - class_top)
            )
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


def parse_basic_schedule_text_line(line: str, meet_name: str) -> Optional[dict]:
    match = re.fullmatch(
        r"\s*(?P<session>\d+(?:\.\d+)?)\s+"
        r"(?P<platform>[A-Za-z]+)\s+"
        r"(?P<date>\d{1,2}-[A-Za-z]{3}|[A-Za-z]{3,9}\s+\d{1,2}|\d{1,2}/\d{1,2}(?:/\d{2,4})?)\s+"
        r"(?P<time>\d{1,2}:\d{2}\s*(?:AM|PM)?)\s+"
        r"(?P<count>\d+)\s*",
        line,
        re.IGNORECASE,
    )
    if not match:
        return None

    session_id = parse_session_value(match.group("session"))
    platform = extract_platform([match.group("platform")])
    date_value = parse_date_value(match.group("date"), DEFAULT_YEAR)
    start_time = parse_time_value(match.group("time"))
    if not (session_id is not None and platform and date_value and start_time):
        return None

    weigh_time = (
        datetime.combine(date_cls(2000, 1, 1), start_time)
        - timedelta(hours=WEIGH_IN_OFFSET_HOURS)
    ).time()
    return {
        "date": date_value,
        "session_id": session_id,
        "start_time": start_time.strftime("%H:%M:%S"),
        "weigh_in_time": weigh_time.strftime("%H:%M:%S"),
        "platform": platform,
        "weight_class": "",
        "meet": meet_name,
    }


def extract_basic_schedule_text_rows(page: pdfplumber.page.Page, meet_name: str) -> List[dict]:
    rows: List[dict] = []
    text = page.extract_text() or ""
    for raw_line in text.splitlines():
        line = normalize_cell(raw_line)
        parsed = parse_basic_schedule_text_line(line=line, meet_name=meet_name)
        if parsed:
            rows.append(parsed)
    return rows


COMPACT_WEEKDAY_PATTERN = r"(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)"
COMPACT_MONTH_PATTERN = r"(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)"
COMPACT_PLATFORM_PATTERN = "|".join(sorted(PLATFORM_VALUES, key=len, reverse=True))
COMPACT_TIME_PATTERN = r"\d{1,2}:\d{2}\s*(?:AM|PM)"
COMPACT_PLATFORM_RE = re.compile(
    rf"^(?:{COMPACT_WEEKDAY_PATTERN}\s+)?"
    rf"(?:(?:{COMPACT_MONTH_PATTERN})\s+\d{{1,2}}\s+)?"
    rf"(?:(?P<session>\d{{1,3}})\s+)?"
    rf"(?P<platform>{COMPACT_PLATFORM_PATTERN})\s+"
    rf"(?P<weigh>{COMPACT_TIME_PATTERN})\s+"
    rf"(?P<start>{COMPACT_TIME_PATTERN})\s+"
    r"(?P<gender>[FM])(?:\s+(?P<rest>.+))?$",
    re.IGNORECASE,
)
COMPACT_CLASS_TOTAL_RE = re.compile(
    r"^(?P<head>.+?)\s+\d+\s*[-–]\s*\d+\s+(?P<count>\d+)(?:\s+\d+)?$"
)
COMPACT_CLASS_HEAD_RE = re.compile(
    r"^(?P<prefix>.*?)\s*(?P<weight>\d{1,3}\+?(?:\s*[-–]\s*\d{1,3}\+?)?)\s+"
    r"(?P<group>[A-Z])$"
)
COMPACT_MARKERS = {"ADAP", "MIL", "NAT", "WSO"}


def is_compact_schedule_pdf(pdf: pdfplumber.PDF) -> bool:
    text = "\n".join(page.extract_text() or "" for page in pdf.pages[:2])
    return (
        "Age Weight # Lifters" in text
        and "Date Session Platform Weigh-In Start" in text
    )


def compact_clean_line(line: str) -> str:
    line = normalize_cell(line)
    line = line.replace("—", "-").replace("–", "-")
    return line


def compact_is_noise_line(line: str) -> bool:
    upper = line.upper()
    if not line:
        return True
    if upper.startswith("2026 USAW"):
        return True
    if "AGE WEIGHT # LIFTERS" in upper:
        return True
    if "DATE SESSION PLATFORM" in upper:
        return True
    if upper.startswith("OWL CMS"):
        return True
    if re.fullmatch(r"PAGE\s+\d+\s+OF\s+\d+", upper):
        return True
    return False


def compact_strip_prefixes(line: str) -> str:
    clean = compact_clean_line(line)
    clean = re.sub(rf"^(?:{COMPACT_WEEKDAY_PATTERN})\s+", "", clean, flags=re.I)
    clean = re.sub(
        rf"^(?:{COMPACT_MONTH_PATTERN})\s+\d{{1,2}}\s+", "",
        clean,
        flags=re.I,
    )
    clean = re.sub(r"^\d{1,3}\s+(?=(?:ADAP|MIL|NAT|WSO|U\d{1,2}|JR|U25|Open|M\d{2}|W\d{2}|\d))", "", clean, flags=re.I)
    return normalize_cell(clean)


def normalize_compact_weight(weight: str) -> str:
    return normalize_cell(weight.replace("–", "-").replace("—", "-")).replace(" - ", "-")


def parse_compact_class_text(text: str) -> Optional[CompactScheduleClass]:
    clean = compact_strip_prefixes(text)
    total_match = COMPACT_CLASS_TOTAL_RE.fullmatch(clean)
    if not total_match:
        return None

    head = normalize_cell(total_match.group("head"))
    head_match = COMPACT_CLASS_HEAD_RE.fullmatch(head)
    if not head_match:
        return None

    prefix_tokens = [
        token
        for token in normalize_cell(head_match.group("prefix")).split()
        if token
    ]
    marker_tokens = {token.upper() for token in prefix_tokens if token.upper() in COMPACT_MARKERS}
    category_tokens = [
        token
        for token in prefix_tokens
        if token.upper() not in COMPACT_MARKERS
    ]
    category = display_start_list_category(category_tokens[-1]) if category_tokens else ""
    if category.upper() == "OPEN":
        category = "Open"

    return CompactScheduleClass(
        category=category,
        weight=normalize_compact_weight(head_match.group("weight")),
        group=head_match.group("group").upper(),
        count=int(total_match.group("count")),
        is_wso="WSO" in marker_tokens,
        is_marker=bool(marker_tokens - {"WSO"}),
    )


def compact_weight_bounds(weight: str) -> Tuple[int, int, bool]:
    clean = normalize_compact_weight(weight)
    numbers = [int(value) for value in re.findall(r"\d+", clean)]
    if not numbers:
        return 0, 0, False
    return numbers[0], numbers[-1], clean.endswith("+")


def compact_weight_sort_key(weight: str) -> Tuple[int, int, str]:
    low, high, _ = compact_weight_bounds(weight)
    return low, high, weight


def format_compact_weight_range(
    weights: Set[str], strip_plus_for_range: bool = False
) -> str:
    if not weights:
        return ""

    ordered = sorted(weights, key=compact_weight_sort_key)
    if len(ordered) == 1:
        weight = ordered[0]
        if strip_plus_for_range:
            weight = weight.rstrip("+")
        return f"{weight}kg"

    lows = []
    highs = []
    has_plus_high = False
    for weight in ordered:
        low, high, plus_high = compact_weight_bounds(weight)
        lows.append(low)
        highs.append(high)
        has_plus_high = has_plus_high or plus_high

    high_text = str(max(highs))
    if has_plus_high and not strip_plus_for_range:
        high_text += "+"
    return f"{min(lows)}-{high_text}kg"


def format_compact_schedule_label(classes: Sequence[CompactScheduleClass]) -> str:
    if not classes:
        return ""

    if all(item.is_wso for item in classes):
        weights = {item.weight for item in classes}
        return f"WSO {format_compact_weight_range(weights, strip_plus_for_range=True)}"

    visible_classes = [item for item in classes if not item.is_wso]
    if not visible_classes:
        visible_classes = list(classes)

    covered_by_group: Dict[str, Set[str]] = {}
    for item in visible_classes:
        if item.category and not item.is_marker:
            covered_by_group.setdefault(item.group, set()).add(item.weight)

    grouped: Dict[Tuple[str, str], Set[str]] = {}
    for item in visible_classes:
        if item.is_marker and item.weight in covered_by_group.get(item.group, set()):
            continue
        grouped.setdefault((item.category, item.group), set()).add(item.weight)

    label_groups: Dict[Tuple[str, str], List[str]] = {}
    for (category, group), weights in grouped.items():
        weight_range = format_compact_weight_range(weights)
        label_groups.setdefault((weight_range, group), []).append(category)

    labels = []
    for (weight_range, group), categories in sorted(
        label_groups.items(),
        key=lambda item: (
            min(start_list_category_sort_key(category or "ZZ") for category in item[1]),
            compact_weight_sort_key(item[0][0].replace("kg", "")),
            item[0][1],
        ),
    ):
        display_categories = [
            display_start_list_category(category)
            for category in sorted(categories, key=start_list_category_sort_key)
            if category
        ]
        category_prefix = f"{'/'.join(display_categories)} " if display_categories else ""
        group_suffix = f" {group}" if group else ""
        labels.append(f"{category_prefix}{weight_range}{group_suffix}")
    return " // ".join(labels)


def extract_compact_visual_lines(pdf_file: BytesIO) -> List[str]:
    lines: List[str] = []
    with pdfplumber.open(pdf_file) as pdf:
        for page in pdf.pages:
            words = page.extract_words(
                x_tolerance=2,
                y_tolerance=3,
                keep_blank_chars=False,
                use_text_flow=False,
            )
            current_words: List[dict] = []
            current_top: Optional[float] = None

            for word in sorted(words, key=lambda item: (item["top"], item["x0"])):
                top = float(word["top"])
                if current_top is None or abs(top - current_top) <= 3:
                    current_words.append(word)
                    current_top = top if current_top is None else current_top
                    continue

                line_words = sorted(current_words, key=lambda item: item["x0"])
                lines.append(compact_clean_line(" ".join(item["text"] for item in line_words)))
                current_words = [word]
                current_top = top

            if current_words:
                line_words = sorted(current_words, key=lambda item: item["x0"])
                lines.append(compact_clean_line(" ".join(item["text"] for item in line_words)))
    return lines


def compact_platform_order(platform: str) -> int:
    return PLATFORM_SORT_ORDER.get(platform.title(), 99)


def extract_compact_schedule_data(pdf_file: BytesIO, meet_name: str) -> List[dict]:
    print("Extracting rows using compact OWLCMS schedule parser...")
    raw_lines = extract_compact_visual_lines(pdf_file)

    first_date = None
    for line in raw_lines:
        parsed_date = parse_date_value(line, DEFAULT_YEAR)
        if parsed_date:
            first_date = parsed_date
            break
    if first_date is None:
        raise ValueError("Could not infer first date from compact schedule PDF")

    rows: List[dict] = []
    pending_classes: List[CompactScheduleClass] = []
    current_row: Optional[dict] = None
    current_session: Optional[int] = None
    pending_session: Optional[int] = None
    last_platform_order: Optional[int] = None

    def finish_current_row() -> None:
        nonlocal current_row
        if not current_row:
            return
        rows.append(current_row)
        current_row = None

    def add_class_to_current(item: CompactScheduleClass) -> None:
        nonlocal current_row
        if not current_row:
            pending_classes.append(item)
            return
        current_row["_classes"].append(item)
        current_row["_class_total"] += item.count
        if current_row["_target_total"] and current_row["_class_total"] >= current_row["_target_total"]:
            finish_current_row()

    for raw_line in raw_lines:
        line = compact_clean_line(raw_line)
        if compact_is_noise_line(line):
            continue

        if re.fullmatch(r"\d{1,3}", line):
            session_marker = int(line)
            if (
                current_row
                and int(current_row["session_id"]) == session_marker
                and current_row.get("_target_total")
                and current_row.get("_class_total", 0) < current_row.get("_target_total", 0)
            ):
                continue
            finish_current_row()
            pending_session = session_marker
            current_session = pending_session
            last_platform_order = None
            continue

        platform_match = COMPACT_PLATFORM_RE.fullmatch(line)
        if platform_match:
            explicit_session = platform_match.group("session")
            platform = extract_platform([platform_match.group("platform")])
            if not platform:
                continue

            weigh_time = parse_time_value(platform_match.group("weigh"))
            start_time = parse_time_value(platform_match.group("start"))
            if not weigh_time or not start_time:
                continue

            start_time_text = start_time.strftime("%H:%M:%S")
            weigh_time_text = weigh_time.strftime("%H:%M:%S")
            continues_current_row = (
                current_row
                and current_row["platform"] == platform
                and current_row["start_time"] == start_time_text
                and current_row["weigh_in_time"] == weigh_time_text
                and current_row.get("_target_total")
                and current_row.get("_class_total", 0) < current_row.get("_target_total", 0)
            )

            order = compact_platform_order(platform)
            if explicit_session:
                current_session = int(explicit_session)
                pending_session = None
            elif continues_current_row:
                current_session = int(current_row["session_id"])
            elif pending_session is not None:
                current_session = pending_session
                pending_session = None
            elif current_session is None:
                current_session = 1
            elif last_platform_order is not None and order <= last_platform_order:
                current_session += 1

            last_platform_order = order
            if current_session is None:
                continue

            rest = normalize_cell(platform_match.group("rest") or "")
            target_total = 0
            inline_class = parse_compact_class_text(rest) if rest else None
            if inline_class:
                target_match = re.search(r"\s(\d+)\s*$", rest)
                target_total = int(target_match.group(1)) if target_match else inline_class.count
            elif rest and re.fullmatch(r"\d+", rest):
                target_total = int(rest)

            if (
                continues_current_row
                and int(current_row["session_id"]) == current_session
            ):
                if target_total:
                    current_row["_target_total"] = target_total
                if inline_class:
                    add_class_to_current(inline_class)
                continue

            finish_current_row()

            current_row = {
                "date": first_date,
                "session_id": float(current_session),
                "start_time": start_time_text,
                "weigh_in_time": weigh_time_text,
                "platform": platform,
                "weight_class": "",
                "meet": meet_name,
                "_gender": platform_match.group("gender").upper(),
                "_classes": [],
                "_target_total": target_total,
                "_class_total": 0,
            }
            for item in pending_classes:
                add_class_to_current(item)
            pending_classes = []
            if inline_class:
                add_class_to_current(inline_class)
            continue

        parsed_class = parse_compact_class_text(line)
        if parsed_class:
            add_class_to_current(parsed_class)

    finish_current_row()

    merged_by_key: Dict[Tuple[float, str, str, str], dict] = {}
    merged_order: List[Tuple[float, str, str, str]] = []
    for row in rows:
        key = (
            row["session_id"],
            row["start_time"],
            row["weigh_in_time"],
            row["platform"],
        )
        if key not in merged_by_key:
            merged_by_key[key] = row
            merged_order.append(key)
            continue
        merged_by_key[key]["_classes"].extend(row.get("_classes", []))
        merged_by_key[key]["_class_total"] += row.get("_class_total", 0)

    rows = [merged_by_key[key] for key in merged_order]

    current_date = datetime.strptime(first_date, "%Y-%m-%d").date()
    previous_start: Optional[time] = None
    previous_session: Optional[float] = None
    for row in rows:
        start_time = parse_time_value(row["start_time"])
        session_id = row["session_id"]
        if (
            previous_session is not None
            and session_id != previous_session
            and previous_start is not None
            and start_time
            and start_time < previous_start
        ):
            current_date += timedelta(days=1)
        row["date"] = current_date.isoformat()
        if start_time:
            previous_start = start_time
        previous_session = session_id
        row["_lifter_count"] = row.get("_class_total", 0)
        row["weight_class"] = format_compact_schedule_label(row.pop("_classes"))
        row.pop("_target_total", None)
        row.pop("_class_total", None)

    print(f"Extracted {len(rows)} compact schedule rows")
    return rows


def has_start_list_tail(line: str) -> bool:
    return bool(START_LIST_TAIL_PATTERN.search(line))


def is_withdrawn_start_list_line(line: str) -> bool:
    if has_start_list_tail(line):
        return False
    if not START_LIST_YEAR_AGE_PATTERN.search(line):
        return False
    tokens = normalize_cell(line).split()
    if len(tokens) < 2:
        return False
    withdrawal_tokens = [
        token for token in tokens[-3:] if re.fullmatch(r"[WB]{4,}", token.upper())
    ]
    return bool(withdrawal_tokens) and any("W" in token.upper() for token in withdrawal_tokens)


def iter_start_list_lines(pdf_bytes: bytes) -> Sequence[str]:
    if PdfReader is None:
        raise RuntimeError("pypdf is required to read start-list PDF text")

    lines = []
    reader = PdfReader(BytesIO(pdf_bytes))
    for page in reader.pages:
        text = page.extract_text() or ""
        for raw_line in text.splitlines():
            line = normalize_cell(raw_line)
            if not line:
                continue
            if is_withdrawn_start_list_line(line):
                continue
            if line.startswith("WSO Lot"):
                continue
            if "Start List" in line or "presented by" in line.lower():
                continue
            lines.append(line)
    return lines


def iter_start_list_row_lines(pdf_bytes: bytes) -> Sequence[str]:
    rows = []
    pending_line = ""

    for line in iter_start_list_lines(pdf_bytes):
        if pending_line:
            combined_line = normalize_cell(f"{pending_line} {line}")
            if has_start_list_tail(combined_line):
                rows.append(combined_line)
                pending_line = ""
                continue
            if has_start_list_tail(line):
                rows.append(line)
                pending_line = ""
                continue
            pending_line = combined_line
            continue

        if has_start_list_tail(line):
            rows.append(line)
        else:
            pending_line = line

    return rows


def is_start_list_category_token(token: str) -> bool:
    upper = token.upper()
    return (
        upper in START_LIST_COMP_MARKERS
        or re.fullmatch(r"U\d{1,2}", upper) is not None
        or re.fullmatch(r"\d{1,2}-\d{1,2}(?:YO)?", upper) is not None
        or re.fullmatch(r"[MW]\d{2}", upper) is not None
    )


def split_start_list_competitions(after_year: str) -> str:
    tokens = normalize_start_list_competition_text(after_year).split()
    if tokens and tokens[0] == "0":
        tokens = tokens[1:]

    for idx, token in enumerate(tokens):
        upper = token.upper()
        next_token = tokens[idx + 1] if idx + 1 < len(tokens) else ""
        if is_start_list_category_token(upper):
            return " ".join(tokens[idx:])
        if upper in {"W", "M"} and normalize_start_list_weight(next_token):
            return " ".join(tokens[idx:])
    return ""


def normalize_start_list_weight(token: str) -> str:
    clean = token.strip().replace(" ", "")
    if re.fullmatch(r"\d{2,3}\+?", clean):
        return clean
    return ""


def normalize_start_list_competition_text(value: str) -> str:
    normalized = normalize_cell(value)
    return re.sub(r"(?<=[A-Za-z.])(?=(WSO|NAT|MIL|ADAP)\b)", " ", normalized)


def start_list_weight_value(weight: str) -> int:
    return int(re.sub(r"\D", "", weight) or "0")


def start_list_category_sort_key(category: str) -> Tuple[int, str]:
    upper = category.upper()
    if match := re.fullmatch(r"U(\d{1,2})", upper):
        return int(match.group(1)), upper
    if match := re.fullmatch(r"(\d{1,2})-(\d{1,2})(?:YO)?", upper):
        return int(match.group(1)), upper
    if upper == "JR":
        return 18, upper
    if upper == "U23":
        return 23, upper
    if upper == "OPEN":
        return 30, upper
    if re.fullmatch(r"[MW](\d{2})", upper):
        return int(upper[1:]), upper
    if upper == "WSO":
        return 900, upper
    return 999, upper


def format_weight_range(weights: Set[str], strip_plus_for_range: bool = False) -> str:
    ordered = sorted(weights, key=start_list_weight_value)
    if not ordered:
        return ""
    if len(ordered) == 1:
        weight = ordered[0]
        if strip_plus_for_range:
            weight = weight.rstrip("+")
        return f"{weight}kg"

    first = ordered[0].rstrip("+") if strip_plus_for_range else ordered[0]
    last = ordered[-1].rstrip("+") if strip_plus_for_range else ordered[-1]
    return f"{first}-{last}kg"


def display_start_list_category(category: str) -> str:
    upper = category.upper()
    if re.fullmatch(r"14-15(?:YO)?", upper):
        return "U15"
    if re.fullmatch(r"16-17(?:YO)?", upper):
        return "U17"
    return category


def extract_start_list_class_entries(
    competitions: str, group: str, source_wso: str, athlete_key: str
) -> Sequence[dict]:
    tokens = [
        token
        for token in normalize_start_list_competition_text(competitions)
        .replace("/", " / ")
        .split()
        if token != "/"
    ]
    entries = []
    is_wso = any(token.upper() == "WSO" for token in tokens)

    for idx, token in enumerate(tokens):
        upper = token.upper().replace("JUNIOR", "JR")
        if upper == "WSO":
            continue
        if not is_start_list_category_token(upper):
            continue

        gender_index = None
        for candidate_idx in range(idx + 1, min(idx + 5, len(tokens))):
            if tokens[candidate_idx].upper() in {"W", "M"}:
                gender_index = candidate_idx
                break
        if gender_index is None or gender_index + 1 >= len(tokens):
            continue

        weight = normalize_start_list_weight(tokens[gender_index + 1])
        if not weight:
            continue

        entries.append(
            {
                "category": (
                    "WSO"
                    if is_wso
                    else "" if upper in {"ADAP", "MIL", "NAT"} else upper
                ),
                "group": group,
                "weight": weight,
                "is_wso": is_wso,
                "is_marker": upper in {"ADAP", "MIL", "NAT"},
                "source_wso": source_wso,
                "athlete_key": athlete_key,
            }
        )

    return entries


def extract_start_list_source_wso(before_year: str) -> str:
    match = re.match(r"(?P<wso>.+?)\s+\d+\s*.+$", normalize_cell(before_year))
    return normalize_cell(match.group("wso")) if match else ""


def parse_start_list_schedule_classes(line: str) -> Optional[Tuple[Tuple[int, str], Sequence[dict]]]:
    tail_match = START_LIST_TAIL_PATTERN.search(line)
    if not tail_match:
        return None

    year_age_match = START_LIST_YEAR_AGE_PATTERN.search(line[: tail_match.start()])
    if not year_age_match:
        return None

    session_id = parse_session_value(tail_match.group("session"))
    platform = extract_platform([tail_match.group("platform")])
    group = (tail_match.group("group") or "").upper()
    if session_id is None or not platform:
        return None

    source_wso = extract_start_list_source_wso(line[: year_age_match.start()])
    athlete_key = normalize_cell(line[: tail_match.start()])
    competitions = split_start_list_competitions(
        line[year_age_match.end() : tail_match.start()]
    )
    if not competitions:
        return None

    class_entries = extract_start_list_class_entries(
        competitions, group, source_wso, athlete_key
    )
    if not class_entries:
        return None
    return (int(session_id), platform), class_entries


def format_start_list_schedule_label(class_entries: Sequence[dict]) -> str:
    wso_entries = [entry for entry in class_entries if entry.get("is_wso")]
    non_wso_entries = [entry for entry in class_entries if not entry.get("is_wso")]
    source_wsos = {
        entry.get("source_wso", "")
        for entry in class_entries
        if entry.get("source_wso")
    }
    athlete_keys = {
        entry.get("athlete_key", "")
        for entry in class_entries
        if entry.get("athlete_key")
    }
    wso_athlete_keys = {
        entry.get("athlete_key", "")
        for entry in wso_entries
        if entry.get("athlete_key")
    }
    all_athletes_entered_wso = bool(athlete_keys) and athlete_keys == wso_athlete_keys
    if wso_entries and (len(source_wsos) == 1 or all_athletes_entered_wso):
        wso_weights = {entry["weight"] for entry in wso_entries}
        return f"WSO {format_weight_range(wso_weights, strip_plus_for_range=True)}"

    if non_wso_entries:
        class_entries = non_wso_entries
    else:
        class_entries = [
            {**entry, "category": "", "is_wso": False, "is_marker": True}
            for entry in wso_entries
        ]

    group_counts_by_category: Dict[str, Dict[str, int]] = {}
    weights_by_category_group: Dict[Tuple[str, str], Set[str]] = {}
    for entry in class_entries:
        if entry.get("is_marker") or not entry.get("category"):
            continue
        category = entry["category"]
        group = entry.get("group", "")
        group_counts_by_category.setdefault(category, {})
        group_counts_by_category[category][group] = (
            group_counts_by_category[category].get(group, 0) + 1
        )
        weights_by_category_group.setdefault((category, group), set()).add(
            entry["weight"]
        )

    dominant_group_by_category = {
        category: max(group_counts.items(), key=lambda item: item[1])[0]
        for category, group_counts in group_counts_by_category.items()
    }

    normalized_entries = []
    for entry in class_entries:
        next_entry = dict(entry)
        category = next_entry.get("category")
        group = next_entry.get("group", "")
        dominant_group = dominant_group_by_category.get(category or "")
        if (
            category
            and dominant_group
            and group != dominant_group
            and group_counts_by_category.get(category, {}).get(group) == 1
            and next_entry["weight"]
            in weights_by_category_group.get((category, dominant_group), set())
        ):
            next_entry["group"] = dominant_group
        normalized_entries.append(next_entry)

    covered_by_category: Dict[str, Set[str]] = {}
    for entry in normalized_entries:
        if entry.get("category") and not entry.get("is_marker"):
            covered_by_category.setdefault(entry.get("group", ""), set()).add(
                entry["weight"]
            )

    grouped: Dict[Tuple[str, str], Set[str]] = {}
    for entry in normalized_entries:
        if (
            entry.get("is_marker")
            and entry["weight"] in covered_by_category.get(entry.get("group", ""), set())
        ):
            continue
        key = (entry["category"], entry.get("group", ""))
        grouped.setdefault(key, set()).add(entry["weight"])

    label_groups: Dict[Tuple[str, str], List[str]] = {}
    for (category, group), weights in grouped.items():
        weight_range = format_weight_range(weights)
        label_groups.setdefault((weight_range, group), []).append(category)

    labels = []
    for (weight_range, group), categories in sorted(
        label_groups.items(),
        key=lambda item: (
            min(start_list_category_sort_key(category) for category in item[1]),
            item[0][1],
            item[0][0],
        ),
    ):
        display_categories = [
            display_start_list_category(category)
            for category in sorted(categories, key=start_list_category_sort_key)
            if category
        ]
        category_prefix = f"{'/'.join(display_categories)} " if display_categories else ""
        group_suffix = f" {group}" if group else ""
        labels.append(f"{category_prefix}{weight_range}{group_suffix}")
    return " // ".join(labels)


def extract_start_list_schedule_labels(start_list_url: str) -> Dict[Tuple[int, str], str]:
    print(f"Downloading start-list PDF for schedule classes: {start_list_url}")
    pdf_file = download_pdf(start_list_url)
    class_entries_by_session: Dict[Tuple[int, str], List[dict]] = {}

    for line in iter_start_list_row_lines(pdf_file.getvalue()):
        parsed = parse_start_list_schedule_classes(line)
        if not parsed:
            continue
        key, class_entries = parsed
        class_entries_by_session.setdefault(key, []).extend(class_entries)

    labels = {
        key: format_start_list_schedule_label(entries)
        for key, entries in class_entries_by_session.items()
    }
    print(f"Extracted start-list class labels for {len(labels)} schedule rows")
    return labels


def apply_start_list_schedule_labels(
    rows: Sequence[dict], start_list_url: Optional[str]
) -> List[dict]:
    if not start_list_url:
        return [dict(row) for row in rows]

    labels = extract_start_list_schedule_labels(start_list_url)
    updated = []
    missing = []
    for row in rows:
        next_row = dict(row)
        key = (int(next_row["session_id"]), next_row["platform"])
        if not next_row.get("weight_class") and labels.get(key):
            next_row["weight_class"] = labels[key]
        elif not next_row.get("weight_class"):
            missing.append(key)
        updated.append(next_row)

    if missing:
        print(f"Missing start-list class labels for {len(set(missing))} schedule rows")
    return updated


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
        label = (
            "All"
            if all(is_all_weight_category(g, category) for g in groups)
            else category
        )
        formatted.append(
            {
                "sort": class_sort_key(sorted_groups[0]),
                "text": f"{', '.join(sorted_groups)} {label}",
            }
        )

    return ", ".join(
        item["text"] for item in sorted(formatted, key=lambda item: item["sort"])
    )


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


def extract_schedule_data(
    pdf_file: BytesIO, meet_name: str, start_list_url: Optional[str] = None
) -> List[dict]:
    with pdfplumber.open(pdf_file) as pdf:
        uses_compact_schedule = is_compact_schedule_pdf(pdf)
        uses_ncw_prelim = any(
            table_has_ncw_prelim_headers(table)
            for page in pdf.pages
            for table in (page.extract_tables() or [])
        )

    if uses_compact_schedule:
        pdf_file.seek(0)
        return extract_compact_schedule_data(pdf_file=pdf_file, meet_name=meet_name)

    if uses_ncw_prelim:
        pdf_file.seek(0)
        rows = extract_ncw_prelim_schedule_data(pdf_file=pdf_file, meet_name=meet_name)
        return apply_start_list_schedule_labels(rows, start_list_url)

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
            all_rows.extend(
                extract_basic_schedule_text_rows(page=page, meet_name=meet_name)
            )

        if not all_rows:
            print(
                "No table rows found; trying OCR fallback for image-only schedule PDF..."
            )
            for idx, page in enumerate(pdf.pages, 1):
                print(f"OCR processing page {idx}/{total_pages}")
                all_rows.extend(
                    extract_rows_from_ocr_page(page=page, meet_name=meet_name)
                )

    deduped = dedupe_rows(all_rows)
    combined = combine_session_rows(deduped)
    combined = apply_start_list_schedule_labels(combined, start_list_url)
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
    convex_url = get_convex_url()
    scraper_secret = os.getenv("SCRAPER_SECRET")

    if not convex_url or not scraper_secret:
        raise ValueError(
            "CONVEX_URL (or EXPO_PUBLIC_CONVEX_URL) and SCRAPER_SECRET are required for convex mode"
        )

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


def delete_schedule_from_convex(meet_name: str) -> dict:
    convex_url = get_convex_url()
    scraper_secret = os.getenv("SCRAPER_SECRET")

    if not convex_url or not scraper_secret:
        raise ValueError(
            "CONVEX_URL (or EXPO_PUBLIC_CONVEX_URL) and SCRAPER_SECRET are required for convex mode"
        )

    endpoint = f"{convex_url.rstrip('/')}/api/action"
    response = requests.post(
        endpoint,
        json={
            "path": CONVEX_DELETE_PATH,
            "args": {"scraperSecret": scraper_secret, "meet": meet_name},
        },
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    data = response.json()
    return data.get("value", {}) if isinstance(data, dict) else {}


def run(
    mode: str,
    url: str,
    meet_name: str,
    output_path: str,
    start_id: int,
    start_list_url: Optional[str],
    replace_existing: bool,
) -> None:
    pdf_file = download_pdf(url)
    parsed_rows = extract_schedule_data(
        pdf_file=pdf_file, meet_name=meet_name, start_list_url=start_list_url
    )
    rows_with_ids = add_ids(parsed_rows, start_id=start_id)

    if mode == "dry-run":
        if output_path.lower().endswith(".csv"):
            export_csv(rows_with_ids, output_path)
        else:
            export_ts(rows_with_ids, output_path)
        print(f"Dry run complete. Parsed {len(rows_with_ids)} rows.")
        print(f"Preview file: {output_path}")
        return

    if replace_existing:
        stats = delete_schedule_from_convex(meet_name)
        print("Deleted existing Convex schedule rows:")
        print(stats)

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
    parser.add_argument(
        "--start-list-url",
        default=None,
        help="Optional start-list PDF URL used to fill schedule weight-class labels.",
    )
    parser.add_argument(
        "--replace-existing",
        action="store_true",
        help="In convex mode, delete existing schedule rows for the meet before ingesting.",
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
        start_list_url=args.start_list_url,
        replace_existing=args.replace_existing,
    )


if __name__ == "__main__":
    main()
