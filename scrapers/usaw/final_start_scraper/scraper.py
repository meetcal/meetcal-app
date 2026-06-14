"""
CLI usage:

From the repo root, run this for any start-list PDF:
  scrapers/usaw/final_start_scraper/venv/bin/python "scrapers/usaw/final_start_scraper/scraper.py" --pdf-url "<pdf-url>"

This command now generates output and then runs verification automatically.
If you omit `--pdf-url`, the script falls back to the canonical masters PDF.
"""

from __future__ import annotations

import argparse
import json
import math
import os
import re
import subprocess
import sys
from dataclasses import dataclass, field
from io import BytesIO
from pathlib import Path
from typing import Dict, Iterable, List, Optional, Sequence, Tuple
from urllib.parse import unquote, urlparse
from urllib.request import Request, urlopen

import pdfplumber

try:
    from PyPDF2 import PdfReader
except ImportError:
    from pypdf import PdfReader

DEFAULT_PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt7b3763235e6b397c/6a111b3ad7617bb684580901/2026_-_NCW_-_Preliminary_Schedule.pdf"
DEFAULT_MEET_NAME = (
    "2026 USA Weightlifting National Championships, Powered by Rogue Fitness"
)
DEFAULT_OUTPUT_TS = Path(__file__).with_name("convex_output.ts")
START_MEMBER_ID = 3100
REQUEST_TIMEOUT_SECONDS = 45

PLATFORMS = ["RED", "WHITE", "BLUE", "STARS", "STRIPES", "ROGUE"]
PLATFORM_PATTERN = "|".join(PLATFORMS)
SUPPORTED_SOURCE_FORMATS = {"auto", "masters", "owlcms", "registration"}
PLATFORM_SORT_ORDER = {
    platform.title(): index for index, platform in enumerate(PLATFORMS)
}
TAIL_PATTERN = re.compile(
    rf"\s(?P<entry_total>\d{{1,3}})(?:\s*(?P<group>[A-Z]))?\s+(?P<session>\d+(?:\.\d+)?)\s*(?P<platform>{PLATFORM_PATTERN})\s+\d{{1,2}}-[A-Za-z]{{3}}\s+\d{{1,2}}:\d{{2}}\s+[AP]M$",
    re.IGNORECASE,
)
ROGUE_TAIL_PATTERN = re.compile(
    r"\s(?P<entry_total>\d{1,3})\s*ROGUE\s+(?P<session>\d+(?:\.\d+)?)\s*ROGUE\s+\d{1,2}-[A-Za-z]{3}\s+\d{1,2}:\d{2}\s+[AP]M$",
    re.IGNORECASE,
)
YEAR_AGE_PATTERN = re.compile(
    r"(?:\b[A-Z]{2,3}\b\s+)?(19\d{2}|20\d{2})\s+(\d{1,2})(?=\s|[A-Za-z]|$)"
)
COMP_MARKERS = {
    "UNI",
    "WSO",
    "OPEN",
    "JR",
    "JUNIOR",
    "ADAP",
    "MIL",
    "NAT",
    "TKOK",
    "14-15YO",
    "16-17YO",
}
OWLCMS_HEADER_MARKERS = {
    "Session Date Gndr Group Cat Lot Age Name Total Team Comps",
    "Start list provided by",
}
OWLCMS_SESSION_PATTERN = re.compile(
    r"(?P<session>\d+)\s+(?P<platform>RED|WHITE|BLUE|STARS|STRIPES|ROGUE)$",
    re.IGNORECASE,
)
OWLCMS_SESSION_PREFIX_PATTERN = re.compile(
    r"^(?P<session>\d+)\s+(?P<platform>RED|WHITE|BLUE|STARS|STRIPES|ROGUE)\b",
    re.IGNORECASE,
)
OWLCMS_NAME_PATTERN = re.compile(r"[^,]+,\s+.+")
OWLCMS_CATEGORY_PATTERN = re.compile(
    r"^(U\d{1,2}|JR|U23|U25|OPEN|ADAP)$", re.IGNORECASE
)
WEIGHT_CLASS_PATTERN = re.compile(r"^\d{2,3}\+?$")
REGISTRATION_HEADER = [
    "First Name",
    "Last Names",
    "Gender",
    "Country",
    "Master Age",
    "Weight Class",
    "Announced Total",
    "Adaptive Athlete",
]
REGISTRATION_AGE_PATTERN = re.compile(r"^(?P<age>\d{2})(?:-\d{2}|\+)?$")
CLUB_ALIASES = {
    "Heavy Athletics": "Marin Heavy Athletics",
    "Jacksonville University Weightlifting": "Jacksonville Weightlifting",
}


@dataclass
class RunSettings:
    pdf_url: str = DEFAULT_PDF_URL
    meet_name: Optional[str] = DEFAULT_MEET_NAME
    output_path: Optional[Path] = DEFAULT_OUTPUT_TS
    start_member_id: int = START_MEMBER_ID
    source_format: str = "auto"
    run_verification: bool = True
    backfill_wso_from_convex: bool = False


@dataclass
class OwlcmsSessionContext:
    session_number: Optional[int] = None
    session_platform: str = ""
    gender: str = ""
    current_category: str = ""
    current_weight: str = ""
    category_weights: Dict[str, str] = field(default_factory=dict)
    wso: str = ""

    def reset_for_session(self) -> None:
        self.gender = ""
        self.current_category = ""
        self.current_weight = ""
        self.category_weights = {}
        self.wso = ""


@dataclass
class OwlcmsPageContext:
    session_number: int
    session_platform: str
    gender: str = ""
    category_weights: Dict[str, str] = field(default_factory=dict)


@dataclass
class OwlcmsRowGroup:
    explicit_key: Optional[Tuple[int, str]]
    rows: List[List[str]] = field(default_factory=list)
    override_context: Optional[OwlcmsPageContext] = None


def has_tail_pattern(line: str) -> bool:
    return bool(TAIL_PATTERN.search(line) or ROGUE_TAIL_PATTERN.search(line))


def is_withdrawn_master_line(line: str) -> bool:
    if has_tail_pattern(line):
        return False
    if not YEAR_AGE_PATTERN.search(line):
        return False
    tokens = normalize_fragment(line).split()
    if len(tokens) < 2:
        return False
    withdrawal_tokens = [
        token for token in tokens[-3:] if re.fullmatch(r"[WB]{4,}", token.upper())
    ]
    return bool(withdrawal_tokens) and any("W" in token.upper() for token in withdrawal_tokens)


def download_pdf(url: str) -> BytesIO:
    with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return BytesIO(response.read())


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key, value.strip().strip("\"'"))


def get_convex_url() -> Optional[str]:
    root = Path(__file__).resolve().parents[3]
    load_env_file(root / ".env.local")
    load_env_file(root / ".env")
    return os.getenv("CONVEX_URL") or os.getenv("EXPO_PUBLIC_CONVEX_URL")


def normalize_fragment(value: str) -> str:
    cleaned = value.strip()
    cleaned = re.sub(r"([a-z])([A-Z])", r"\1 \2", cleaned)
    for _ in range(3):
        cleaned = re.sub(r"\b([A-Z])\s([A-Z])\b", r"\1\2", cleaned)
        cleaned = re.sub(r"([A-Za-z]{2,})\s([a-z])\b", r"\1\2", cleaned)
        cleaned = re.sub(r"\s+", " ", cleaned).strip()
    return cleaned


def normalize_name(raw_name: str) -> str:
    cleaned = normalize_fragment(raw_name)
    parts = [part for part in re.split(r"\s+", cleaned) if part]
    normalized = " ".join(parts).title()
    normalized = re.sub(r"\bMc\s+([A-Z])", r"Mc\1", normalized)
    return normalized


def normalize_comma_name(raw_name: str) -> str:
    cleaned = normalize_fragment(raw_name)
    if "," not in cleaned:
        return normalize_name(cleaned)
    last_name, first_name = cleaned.split(",", 1)
    return normalize_name(f"{first_name.strip()} {last_name.strip()}")


def normalize_competitions(raw_competitions: str) -> str:
    return normalize_fragment(raw_competitions)


def normalize_club(raw_club: str) -> str:
    club = normalize_fragment(raw_club)
    if club in {"", "0"}:
        return "Unaffiliated"
    return CLUB_ALIASES.get(club, club)


def normalize_weight_class(raw_weight: str) -> str:
    candidate = normalize_fragment(raw_weight).replace(" ", "")
    if WEIGHT_CLASS_PATTERN.fullmatch(candidate):
        return candidate
    return ""


def normalize_competition_marker_spacing(value: str) -> str:
    normalized = normalize_fragment(value)
    return re.sub(r"(?<=[A-Za-z.])(?=(WSO|NAT|MIL|ADAP)\b)", " ", normalized)


def parse_owlcms_descriptor(value: str) -> Tuple[str, str, str]:
    tokens = normalize_fragment(value).replace("JUNIOR", "JR").split()
    gender = ""
    category = ""
    weight = ""

    gender_index: Optional[int] = None
    for index, token in enumerate(tokens):
        if token.upper() in {"F", "M"}:
            gender_index = index
            gender = parse_owlcms_gender(token)
            break

    if gender_index is not None:
        for index in range(gender_index + 1, len(tokens)):
            token = tokens[index].upper()
            if OWLCMS_CATEGORY_PATTERN.fullmatch(token):
                category = token
                if index + 1 < len(tokens):
                    weight = normalize_weight_class(tokens[index + 1])
                break

    if not category:
        for index, token in enumerate(tokens):
            upper = token.upper()
            if OWLCMS_CATEGORY_PATTERN.fullmatch(upper):
                category = upper
                if index + 1 < len(tokens):
                    weight = normalize_weight_class(tokens[index + 1])
                break

    return gender, category, weight


def is_owlcms_metadata_line(value: str) -> bool:
    upper = normalize_fragment(value).upper()
    if not upper:
        return True
    if upper.startswith(
        ("START LIST PROVIDED BY", "OWLCMS", "SESSION DATE GNDR GROUP CAT")
    ):
        return True
    if upper.startswith(("WEIGH IN", "START ")):
        return True
    if upper in {"SAT", "SUN", "MON", "TUE", "WED", "THU", "FRI"}:
        return True
    if re.fullmatch(r"[A-Z][a-z]{2}\s+\d{1,2}", value):
        return True
    return False


def resolve_output_path(output_path: Optional[str]) -> Path:
    if not output_path:
        return DEFAULT_OUTPUT_TS
    path = Path(output_path)
    if path.is_absolute():
        return path
    return Path(__file__).resolve().parent / path


def slugify_filename(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "_", value.lower()).strip("_")
    return slug or "start_list"


def infer_meet_name(pdf_bytes: bytes, source_format: str) -> str:
    if source_format in {"masters", "registration"}:
        return DEFAULT_MEET_NAME

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        text = pdf.pages[0].extract_text() or ""

    lines = [
        normalize_fragment(line)
        for line in text.splitlines()
        if normalize_fragment(line)
    ]
    for line in lines:
        lower = line.lower()
        if lower.startswith("start list provided by"):
            continue
        if lower.startswith("owlcms "):
            continue
        if "session date gndr group cat" in lower:
            continue
        if re.search(r"\b20\d{2}\b", line) and any(
            keyword in lower
            for keyword in (
                "championship",
                "championships",
                "national",
                "nationals",
                "american open",
                "classic",
            )
        ):
            return line

    return DEFAULT_MEET_NAME if source_format == "masters" else "USAW Start List"


def infer_output_path(pdf_url: str, meet_name: str, source_format: str) -> Path:
    if (
        pdf_url == DEFAULT_PDF_URL
        and meet_name == DEFAULT_MEET_NAME
        and source_format in {"masters", "registration"}
    ):
        return DEFAULT_OUTPUT_TS

    parsed_url = urlparse(pdf_url)
    url_stem = Path(unquote(parsed_url.path)).stem
    base_name = slugify_filename(meet_name or url_stem or f"{source_format}_start_list")
    return Path(__file__).resolve().parent / f"{base_name}.ts"


def build_run_settings(argv: Optional[Sequence[str]] = None) -> RunSettings:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-url")
    parser.add_argument("--meet-name")
    parser.add_argument("--output-path")
    parser.add_argument("--start-member-id", type=int, default=START_MEMBER_ID)
    parser.add_argument(
        "--source-format", choices=sorted(SUPPORTED_SOURCE_FORMATS), default="auto"
    )
    parser.add_argument("--skip-verify", action="store_true")
    parser.add_argument(
        "--backfill-wso-from-convex",
        action="store_true",
        help="Fill blank WSO values from prior Convex athlete rows with the same name.",
    )
    args = parser.parse_args(argv)
    return RunSettings(
        pdf_url=args.pdf_url or DEFAULT_PDF_URL,
        meet_name=args.meet_name,
        output_path=resolve_output_path(args.output_path) if args.output_path else None,
        start_member_id=args.start_member_id,
        source_format=args.source_format,
        run_verification=not args.skip_verify,
        backfill_wso_from_convex=args.backfill_wso_from_convex,
    )


def extract_weight_token(tokens: List[str], index: int) -> str:
    if index >= len(tokens):
        return ""
    token = tokens[index]
    if token.endswith("+") and re.fullmatch(r"\d{2,3}\+", token):
        return token
    if not token.isdigit():
        return ""

    number = token
    next_index = index + 1
    while next_index < len(tokens) and tokens[next_index].isdigit() and len(number) < 3:
        number += tokens[next_index]
        next_index += 1

    if len(number) not in {2, 3}:
        return ""

    if next_index < len(tokens) and tokens[next_index] == "+":
        return f"{number}+"
    return number


def parse_weight_class_and_gender(competitions: str) -> Tuple[str, str]:
    tokens = competitions.replace("/", " / ").split()
    gender = ""
    weight_class = ""

    for idx, token in enumerate(tokens):
        upper = token.upper()
        next_token = tokens[idx + 1] if idx + 1 < len(tokens) else ""

        if upper in {"W", "M"} and extract_weight_token(tokens, idx + 1):
            gender = "Male" if upper == "M" else "Female"
            weight_class = extract_weight_token(tokens, idx + 1)
            continue

        compact = re.sub(r"\s+", "", upper)
        fused_match = re.fullmatch(r"[WM]([WM])(\d{2,3}\+?)", compact)
        if fused_match:
            gender = "Male" if fused_match.group(1) == "M" else "Female"
            if extract_weight_token(tokens, idx + 1):
                weight_class = extract_weight_token(tokens, idx + 1)
            else:
                weight_class = fused_match.group(2)
            continue

        match = re.fullmatch(r"([WM])(\d{2,3}\+?)", compact)
        if not match:
            continue

        gender = "Male" if match.group(1) == "M" else "Female"
        if extract_weight_token(tokens, idx + 1):
            weight_class = extract_weight_token(tokens, idx + 1)
        else:
            weight_class = match.group(2)

    return weight_class, gender


def parse_head(before_year: str) -> Optional[Tuple[str, str]]:
    cleaned = normalize_fragment(re.sub(r"\s+[A-Z]{2,3}$", "", before_year.strip()))
    match = re.match(r"(?P<wso>.+?)\s+(?P<lot>\d+)\s*(?P<name>.+)$", cleaned)
    if match:
        wso = normalize_fragment(match.group("wso"))
        name = normalize_name(match.group("name"))
        if not name:
            return None
        return name, wso

    missing_wso_match = re.match(r"(?P<lot>\d+)\s*(?P<name>.+)$", cleaned)
    if not missing_wso_match:
        return None

    name = normalize_name(missing_wso_match.group("name"))
    if not name:
        return None
    return name, ""


def split_club_and_competitions(after_year: str) -> Optional[Tuple[str, str]]:
    tokens = normalize_competition_marker_spacing(after_year).split()
    if tokens and tokens[0] == "0":
        tokens = tokens[1:]

    start_idx: Optional[int] = None
    for idx, token in enumerate(tokens):
        upper = token.upper()
        next_token = tokens[idx + 1] if idx + 1 < len(tokens) else ""

        if (
            upper in COMP_MARKERS
            or re.fullmatch(r"U\d{1,2}", upper)
            or re.fullmatch(r"\d{1,2}-\d{1,2}(?:YO)?", upper)
        ):
            start_idx = idx
            break

        if re.fullmatch(r"[WM]{2}\d{2,3}\+?", upper):
            start_idx = idx
            break

        if re.fullmatch(r"[WM]\d{2,3}\+?", upper):
            start_idx = idx
            break

        if upper in {"W", "M"} and re.fullmatch(r"\d{2,3}\+?", next_token):
            start_idx = idx
            break

    if start_idx is None:
        return None

    club = normalize_club(" ".join(tokens[:start_idx]))
    competitions = normalize_competitions(" ".join(tokens[start_idx:]))
    return club, competitions


def parse_inline_tail_row(line: str, meet_name: str) -> Optional[Dict[str, object]]:
    tail_match = TAIL_PATTERN.search(line)
    if tail_match:
        entry_total = int(tail_match.group("entry_total"))
        session_raw = tail_match.group("session")
        platform = tail_match.group("platform").title()
        head = line[: tail_match.start()].strip()
    else:
        rogue_tail_match = ROGUE_TAIL_PATTERN.search(line)
        if not rogue_tail_match:
            return None
        entry_total = int(rogue_tail_match.group("entry_total"))
        session_raw = rogue_tail_match.group("session")
        platform = "Rogue"
        head = line[: rogue_tail_match.start()].strip()

    year_age_match = YEAR_AGE_PATTERN.search(head)
    if not year_age_match:
        return None

    age = int(year_age_match.group(2))
    before_year = head[: year_age_match.start()].strip()
    after_year = head[year_age_match.end() :].strip()

    head_values = parse_head(before_year)
    if not head_values:
        return None
    name, wso = head_values

    club_and_competitions = split_club_and_competitions(after_year)
    if not club_and_competitions:
        return None
    club, competitions = club_and_competitions

    weight_class, gender = parse_weight_class_and_gender(competitions)
    adaptive = "ADAP" in competitions.upper()

    if not weight_class or not gender:
        return None

    if "." in session_raw:
        session_number = math.ceil(float(session_raw))
    else:
        session_number = int(session_raw)

    return {
        "adaptive": adaptive,
        "age": age,
        "club": club,
        "entryTotal": entry_total,
        "gender": gender,
        "meet": meet_name,
        "name": name,
        "sessionNumber": session_number,
        "sessionPlatform": platform,
        "weightClass": weight_class,
        "wso": wso,
    }


def iter_master_lines(pdf_bytes: bytes) -> Iterable[str]:
    reader = PdfReader(BytesIO(pdf_bytes))
    for page in reader.pages:
        text = page.extract_text() or ""
        for raw_line in text.splitlines():
            line = normalize_fragment(raw_line)
            if not line:
                continue
            if is_withdrawn_master_line(line):
                continue
            if line.startswith("WSO Lot"):
                continue
            if "Start List" in line or "presented by" in line.lower():
                continue
            yield line


def extract_masters_entries(
    pdf_bytes: bytes, meet_name: str
) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []
    pending_line = ""

    for line in iter_master_lines(pdf_bytes):
        if pending_line:
            combined_line = normalize_fragment(f"{pending_line} {line}")
            parsed = parse_inline_tail_row(combined_line, meet_name)
            if parsed:
                entries.append(parsed)
                pending_line = ""
                continue

            parsed = parse_inline_tail_row(line, meet_name)
            if parsed:
                entries.append(parsed)
                pending_line = ""
                continue

            pending_line = combined_line if not has_tail_pattern(combined_line) else ""
            continue

        parsed = parse_inline_tail_row(line, meet_name)
        if parsed:
            entries.append(parsed)
            continue

        pending_line = line if not has_tail_pattern(line) else ""

    return entries


def normalize_table_row(raw_row: Sequence[Optional[str]]) -> List[str]:
    return [normalize_fragment(value) if value else "" for value in raw_row]


def get_owlcms_session_key(row: Sequence[str]) -> Optional[Tuple[int, str]]:
    session_cell = row[0] if row else ""
    session_match = OWLCMS_SESSION_PATTERN.fullmatch(session_cell)
    if not session_match:
        return None
    return int(session_match.group("session")), session_match.group("platform").title()


def extract_owlcms_page_contexts(page_text: str) -> List[OwlcmsPageContext]:
    contexts: Dict[Tuple[int, str], OwlcmsPageContext] = {}
    lines = [
        normalize_fragment(line)
        for line in page_text.splitlines()
        if normalize_fragment(line)
    ]
    for index, line in enumerate(lines):
        session_match = OWLCMS_SESSION_PREFIX_PATTERN.match(line)
        if not session_match:
            continue

        key = (
            int(session_match.group("session")),
            session_match.group("platform").title(),
        )
        context = contexts.setdefault(
            key,
            OwlcmsPageContext(
                session_number=key[0],
                session_platform=key[1],
            ),
        )

        inline_gender, inline_category, inline_weight = parse_owlcms_descriptor(
            line[session_match.end() :]
        )
        if inline_gender:
            context.gender = inline_gender
        if inline_category and inline_weight:
            context.category_weights[inline_category] = inline_weight

        for look_ahead in lines[index + 1 : index + 7]:
            if OWLCMS_SESSION_PREFIX_PATTERN.match(look_ahead):
                break
            gender, category, weight = parse_owlcms_descriptor(look_ahead)
            if gender:
                context.gender = gender
            if category and weight:
                context.category_weights[category] = weight

    return sorted(
        contexts.values(),
        key=lambda value: (
            value.session_number,
            PLATFORM_SORT_ORDER.get(value.session_platform, 999),
        ),
    )


def build_owlcms_row_groups(rows: Sequence[List[str]]) -> List[OwlcmsRowGroup]:
    groups: List[OwlcmsRowGroup] = []
    current_group: Optional[OwlcmsRowGroup] = None

    for row in rows:
        session_key = get_owlcms_session_key(row[:-6])
        if session_key:
            current_group = OwlcmsRowGroup(explicit_key=session_key, rows=[row])
            groups.append(current_group)
            continue
        if current_group is None:
            current_group = OwlcmsRowGroup(explicit_key=None, rows=[row])
            groups.append(current_group)
            continue
        current_group.rows.append(row)

    return groups


def apply_owlcms_page_context(
    context: OwlcmsSessionContext, page_context: OwlcmsPageContext
) -> None:
    context.session_number = page_context.session_number
    context.session_platform = page_context.session_platform
    context.reset_for_session()
    context.gender = page_context.gender
    context.category_weights = dict(page_context.category_weights)
    if page_context.category_weights:
        last_category = next(reversed(page_context.category_weights))
        context.current_category = last_category
        context.current_weight = page_context.category_weights[last_category]


def split_trailing_missing_group(
    group: OwlcmsRowGroup,
    current_context: OwlcmsPageContext,
    next_context: OwlcmsPageContext,
) -> Optional[OwlcmsRowGroup]:
    if current_context.gender == next_context.gender:
        return None
    if not group.rows or len(group.rows) < 2:
        return None

    entry_totals = [int(row[-3]) for row in group.rows if row[-3].isdigit()]
    if len(entry_totals) != len(group.rows):
        return None

    max_seen = entry_totals[0]
    split_index: Optional[int] = None
    for index in range(1, len(entry_totals)):
        if entry_totals[index] > max_seen + 40:
            split_index = index
            break
        max_seen = max(max_seen, entry_totals[index])

    if split_index is None:
        return None

    trailing_rows = group.rows[split_index:]
    group.rows = group.rows[:split_index]
    return OwlcmsRowGroup(
        explicit_key=None, rows=trailing_rows, override_context=next_context
    )


def detect_source_format(pdf_bytes: bytes, requested_format: str = "auto") -> str:
    if requested_format != "auto":
        return requested_format

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        first_page = pdf.pages[0]
        text = first_page.extract_text() or ""
        for table in first_page.extract_tables() or []:
            for raw_row in table[:10]:
                row = normalize_table_row(raw_row)
                if is_registration_header(row):
                    return "registration"
        if "owlcms" in text.lower():
            return "owlcms"
        for table in first_page.extract_tables() or []:
            for raw_row in table[:10]:
                row = normalize_table_row(raw_row)
                if len(row) < 6:
                    continue
                lot_text, age_text, name, entry_total_text = (
                    row[-6],
                    row[-5],
                    row[-4],
                    row[-3],
                )
                if (
                    lot_text.isdigit()
                    and age_text.isdigit()
                    and entry_total_text.isdigit()
                    and OWLCMS_NAME_PATTERN.fullmatch(name)
                ):
                    return "owlcms"
    return "masters"


def extract_owlcms_categories(comps: str) -> List[str]:
    categories: List[str] = []
    for token in re.split(r"[,/]", comps):
        cleaned = normalize_fragment(token).replace("JUNIOR", "JR")
        for part in cleaned.split():
            upper = part.upper()
            if OWLCMS_CATEGORY_PATTERN.fullmatch(upper):
                categories.append(upper)
    return categories


def parse_owlcms_gender(value: str) -> str:
    upper = normalize_fragment(value).upper()
    if upper == "F":
        return "Female"
    if upper == "M":
        return "Male"
    return ""


def is_registration_header(row: Sequence[str]) -> bool:
    return list(row[: len(REGISTRATION_HEADER)]) == REGISTRATION_HEADER


def parse_registration_age(value: str) -> Optional[int]:
    match = REGISTRATION_AGE_PATTERN.fullmatch(normalize_fragment(value))
    if not match:
        return None
    return int(match.group("age"))


def parse_registration_gender(value: str) -> str:
    normalized = normalize_fragment(value).title()
    if normalized in {"Female", "Male"}:
        return normalized
    return ""


def parse_registration_row(
    row: Sequence[str], meet_name: str
) -> Optional[Dict[str, object]]:
    if len(row) < len(REGISTRATION_HEADER):
        return None

    (
        first_name,
        last_name,
        raw_gender,
        country,
        raw_age,
        raw_weight,
        raw_total,
        adaptive,
    ) = row[:8]
    gender = parse_registration_gender(raw_gender)
    age = parse_registration_age(raw_age)
    weight_class = normalize_weight_class(raw_weight)
    if not first_name or not last_name or not gender or age is None:
        return None
    if not weight_class or not raw_total.isdigit():
        return None

    return {
        "adaptive": normalize_fragment(adaptive).upper().startswith("YES"),
        "age": age,
        "club": normalize_club(country),
        "entryTotal": int(raw_total),
        "gender": gender,
        "meet": meet_name,
        "name": normalize_name(f"{first_name} {last_name}"),
        "weightClass": weight_class,
    }


def extract_registration_entries(
    pdf_bytes: bytes, meet_name: str
) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for raw_row in table:
                    row = normalize_table_row(raw_row)
                    if not any(row) or is_registration_header(row):
                        continue
                    parsed = parse_registration_row(row, meet_name)
                    if parsed:
                        entries.append(parsed)

    return entries


def parse_owlcms_context(
    prefix: Sequence[str], context: OwlcmsSessionContext
) -> Tuple[str, str]:
    session_cell = prefix[0] if len(prefix) > 0 else ""
    gender_cell = prefix[2] if len(prefix) > 2 else ""
    category_cell = prefix[3] if len(prefix) > 3 else ""
    weight_cell = prefix[4] if len(prefix) > 4 else ""
    extra_cells = [value for value in prefix[5:] if value]

    session_match = OWLCMS_SESSION_PATTERN.fullmatch(session_cell)
    if session_match:
        context.session_number = int(session_match.group("session"))
        context.session_platform = session_match.group("platform").title()
        context.reset_for_session()

    parsed_gender = parse_owlcms_gender(gender_cell)
    if parsed_gender:
        context.gender = parsed_gender

    row_category = ""
    if category_cell:
        category_upper = category_cell.upper()
        if OWLCMS_CATEGORY_PATTERN.fullmatch(category_upper):
            row_category = category_upper
            context.current_category = row_category

    row_weight = normalize_weight_class(weight_cell)
    if row_weight:
        category_key = row_category or context.current_category
        if category_key:
            context.category_weights[category_key] = row_weight
            context.current_category = category_key
        context.current_weight = row_weight

    row_wso = normalize_fragment(extra_cells[-1]) if extra_cells else ""
    if row_wso:
        context.wso = row_wso

    return row_category, row_weight


def derive_owlcms_weight(
    row_category: str,
    row_weight: str,
    comps: str,
    context: OwlcmsSessionContext,
) -> str:
    if row_weight:
        return row_weight
    if row_category and row_category in context.category_weights:
        return context.category_weights[row_category]

    category_tokens = extract_owlcms_categories(comps)
    matched_weights = [
        context.category_weights[token]
        for token in category_tokens
        if token in context.category_weights
    ]
    if len(set(matched_weights)) == 1 and matched_weights:
        return matched_weights[0]

    for token in category_tokens:
        if token in context.category_weights:
            return context.category_weights[token]

    if context.current_category and context.current_weight:
        return context.current_weight
    return ""


def parse_owlcms_row(
    row: Sequence[str], context: OwlcmsSessionContext, meet_name: str
) -> Optional[Dict[str, object]]:
    if len(row) < 6:
        return None

    lot_text, age_text, raw_name, entry_total_text, raw_club, raw_comps = row[-6:]
    if not (
        lot_text.isdigit()
        and age_text.isdigit()
        and entry_total_text.isdigit()
        and OWLCMS_NAME_PATTERN.fullmatch(raw_name)
    ):
        return None

    prefix = list(row[:-6])
    row_category, row_weight = parse_owlcms_context(prefix, context)

    if context.session_number is None or not context.session_platform:
        return None

    weight_class = derive_owlcms_weight(row_category, row_weight, raw_comps, context)
    if not weight_class:
        return None

    if not context.gender:
        return None

    entry: Dict[str, object] = {
        "adaptive": "ADAP" in raw_comps.upper() or row_category == "ADAP",
        "age": int(age_text),
        "club": normalize_club(raw_club),
        "entryTotal": int(entry_total_text),
        "gender": context.gender,
        "meet": meet_name,
        "name": normalize_comma_name(raw_name),
        "sessionNumber": context.session_number,
        "sessionPlatform": context.session_platform,
        "weightClass": weight_class,
    }
    if context.wso:
        entry["wso"] = context.wso
    return entry


def is_compact_owlcms_row(row: Sequence[str]) -> bool:
    if len(row) < 12:
        return False
    lot_text = row[5]
    age_text = row[6]
    raw_name = row[8]
    entry_total_text = row[9]
    return (
        lot_text.isdigit()
        and age_text.isdigit()
        and entry_total_text.isdigit()
        and OWLCMS_NAME_PATTERN.fullmatch(raw_name) is not None
    )


def parse_compact_owlcms_row(
    row: Sequence[str], context: OwlcmsSessionContext, meet_name: str
) -> Optional[Dict[str, object]]:
    if len(row) < 12 or not is_compact_owlcms_row(row):
        return None

    session_cell = row[0]
    session_match = OWLCMS_SESSION_PATTERN.fullmatch(session_cell)
    if session_match:
        context.session_number = int(session_match.group("session"))
        context.session_platform = session_match.group("platform").title()
        context.reset_for_session()

    parsed_gender = parse_owlcms_gender(row[2])
    if parsed_gender:
        context.gender = parsed_gender

    row_category = ""
    category_cell = row[3].upper()
    if category_cell and OWLCMS_CATEGORY_PATTERN.fullmatch(category_cell):
        row_category = category_cell
        context.current_category = row_category

    row_weight = normalize_weight_class(row[4])
    if row_weight:
        category_key = row_category or context.current_category
        if category_key:
            context.category_weights[category_key] = row_weight
            context.current_category = category_key
        context.current_weight = row_weight

    if context.session_number is None or not context.session_platform:
        return None
    if not context.gender:
        return None

    raw_comps = row[11]
    weight_class = derive_owlcms_weight(
        row_category=row_category,
        row_weight=row_weight,
        comps=raw_comps,
        context=context,
    )
    if not weight_class:
        return None

    return {
        "adaptive": "ADAP" in raw_comps.upper() or row_category == "ADAP",
        "age": int(row[6]),
        "club": normalize_club(row[10]),
        "entryTotal": int(row[9]),
        "gender": context.gender,
        "meet": meet_name,
        "name": normalize_comma_name(row[8]),
        "sessionNumber": context.session_number,
        "sessionPlatform": context.session_platform,
        "weightClass": weight_class,
    }


def extract_compact_owlcms_entries(
    pdf_bytes: bytes, meet_name: str
) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []
    context = OwlcmsSessionContext()

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            page_contexts = extract_owlcms_page_contexts(page.extract_text() or "")
            rows: List[List[str]] = []
            for table in page.extract_tables() or []:
                for raw_row in table:
                    row = normalize_table_row(raw_row)
                    if not any(row):
                        continue
                    if any(
                        marker in value
                        for marker in OWLCMS_HEADER_MARKERS
                        for value in row
                        if value
                    ):
                        continue
                    rows.append(row)

            if not rows:
                continue

            first_explicit_key = next(
                (get_owlcms_session_key(row[:-6]) for row in rows if get_owlcms_session_key(row[:-6])),
                None,
            )
            if rows and not get_owlcms_session_key(rows[0][:-6]) and page_contexts:
                leading_context = None
                if first_explicit_key:
                    first_explicit_index = next(
                        (
                            index
                            for index, page_context in enumerate(page_contexts)
                            if (
                                page_context.session_number,
                                page_context.session_platform,
                            )
                            == first_explicit_key
                        ),
                        -1,
                    )
                    if first_explicit_index > 0:
                        leading_context = page_contexts[first_explicit_index - 1]
                elif len(page_contexts) == 1:
                    leading_context = page_contexts[0]

                if leading_context:
                    apply_owlcms_page_context(context, leading_context)

            for row in rows:
                    parsed = parse_compact_owlcms_row(row, context, meet_name)
                    if parsed:
                        entries.append(parsed)

    return entries


def extract_owlcms_entries(pdf_bytes: bytes, meet_name: str) -> List[Dict[str, object]]:
    compact_entries = extract_compact_owlcms_entries(pdf_bytes, meet_name)
    if compact_entries:
        return compact_entries

    entries: List[Dict[str, object]] = []
    context = OwlcmsSessionContext()

    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        page_contexts = [
            extract_owlcms_page_contexts(page.extract_text() or "")
            for page in pdf.pages
        ]

        for page_index, page in enumerate(pdf.pages):
            rows: List[List[str]] = []
            for table in page.extract_tables() or []:
                for raw_row in table:
                    row = normalize_table_row(raw_row)
                    if not any(row):
                        continue
                    if any(
                        marker in value
                        for marker in OWLCMS_HEADER_MARKERS
                        for value in row
                        if value
                    ):
                        continue
                    rows.append(row)

            if not rows:
                continue

            groups = build_owlcms_row_groups(rows)
            contexts_for_page = page_contexts[page_index]
            explicit_keys = [
                group.explicit_key for group in groups if group.explicit_key
            ]

            if groups and groups[0].explicit_key is None and contexts_for_page:
                first_explicit_key = next((key for key in explicit_keys if key), None)
                if first_explicit_key:
                    first_explicit_index = next(
                        (
                            index
                            for index, page_context in enumerate(contexts_for_page)
                            if (
                                page_context.session_number,
                                page_context.session_platform,
                            )
                            == first_explicit_key
                        ),
                        -1,
                    )
                    leading_candidates = [
                        page_context
                        for page_context in contexts_for_page[:first_explicit_index]
                        if (page_context.session_number, page_context.session_platform)
                        not in explicit_keys
                    ]
                    if len(leading_candidates) == 1:
                        groups[0].override_context = leading_candidates[0]
                elif len(contexts_for_page) == 1:
                    groups[0].override_context = contexts_for_page[0]

            if (
                groups
                and all(group.explicit_key is None for group in groups)
                and len(contexts_for_page) == 1
            ):
                groups[0].override_context = contexts_for_page[0]

            if page_index + 1 < len(page_contexts) and groups:
                next_page_contexts = page_contexts[page_index + 1]
                next_page_has_only_implicit_rows = False
                if next_page_contexts:
                    next_page_rows: List[List[str]] = []
                    for table in pdf.pages[page_index + 1].extract_tables() or []:
                        for raw_row in table:
                            row = normalize_table_row(raw_row)
                            if any(row):
                                next_page_rows.append(row)
                    next_page_has_only_implicit_rows = bool(next_page_rows) and all(
                        get_owlcms_session_key(row[:-6]) is None
                        for row in next_page_rows
                    )

                if next_page_has_only_implicit_rows and len(next_page_contexts) == 1:
                    next_context = next_page_contexts[0]
                    trailing_group = groups[-1]
                    if trailing_group.explicit_key:
                        current_page_context = next(
                            (
                                value
                                for value in contexts_for_page
                                if (value.session_number, value.session_platform)
                                == trailing_group.explicit_key
                            ),
                            None,
                        )
                        if current_page_context and trailing_group.rows:
                            repaired_group = split_trailing_missing_group(
                                trailing_group, current_page_context, next_context
                            )
                            if repaired_group:
                                groups.append(repaired_group)

            for group in groups:
                if group.override_context:
                    apply_owlcms_page_context(context, group.override_context)
                for row in group.rows:
                    parsed = parse_owlcms_row(row, context, meet_name)
                    if parsed:
                        entries.append(parsed)

    return entries


def assign_member_ids(
    entries: List[Dict[str, object]], start_member_id: int
) -> List[Dict[str, object]]:
    member_id = start_member_id
    for entry in entries:
        entry["memberId"] = str(member_id)
        member_id += 1
    return entries


def query_convex_wso_history(
    names: Sequence[str], exclude_meet: str
) -> Dict[str, str]:
    convex_url = get_convex_url()
    if not convex_url:
        print("Skipping WSO backfill: CONVEX_URL or EXPO_PUBLIC_CONVEX_URL is not set")
        return {}

    payload = {
        "path": "athletes:getWsoHistoryByNames",
        "args": {"names": list(names), "excludeMeet": exclude_meet},
    }
    request = Request(
        f"{convex_url.rstrip('/')}/api/query",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with urlopen(request, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        data = json.loads(response.read().decode("utf-8") or "{}")

    rows = data.get("value", []) if isinstance(data, dict) else []
    return {
        normalize_name(str(row.get("name", ""))): str(row.get("wso", ""))
        for row in rows
        if row.get("name") and row.get("wso")
    }


def backfill_missing_wsos_from_convex(
    entries: List[Dict[str, object]], meet_name: str
) -> int:
    missing_names = sorted(
        {
            str(entry["name"])
            for entry in entries
            if not normalize_fragment(str(entry.get("wso", "")))
        }
    )
    if not missing_names:
        return 0

    history = query_convex_wso_history(missing_names, exclude_meet=meet_name)
    updated = 0
    for entry in entries:
        if normalize_fragment(str(entry.get("wso", ""))):
            continue
        wso = history.get(normalize_name(str(entry["name"])))
        if not wso:
            continue
        entry["wso"] = wso
        updated += 1
    return updated


def extract_entries(
    pdf_file: BytesIO,
    meet_name: str = DEFAULT_MEET_NAME,
    source_format: str = "auto",
    start_member_id: int = START_MEMBER_ID,
) -> List[Dict[str, object]]:
    pdf_bytes = pdf_file.getvalue()
    detected_format = detect_source_format(pdf_bytes, source_format)
    if detected_format == "owlcms":
        entries = extract_owlcms_entries(pdf_bytes, meet_name)
    elif detected_format == "registration":
        entries = extract_registration_entries(pdf_bytes, meet_name)
    else:
        entries = extract_masters_entries(pdf_bytes, meet_name)
    return assign_member_ids(entries, start_member_id)


def format_ts_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=True)


def write_typescript(entries: List[Dict[str, object]], output_path: Path) -> None:
    with output_path.open("w", encoding="utf-8") as handle:
        handle.write("export type StartListEntry = {\n")
        handle.write("  adaptive: boolean;\n")
        handle.write("  age: number;\n")
        handle.write("  club: string;\n")
        handle.write("  entryTotal: number;\n")
        handle.write("  gender: string;\n")
        handle.write("  meet: string;\n")
        handle.write("  memberId: string;\n")
        handle.write("  name: string;\n")
        handle.write("  sessionNumber?: number;\n")
        handle.write("  sessionPlatform?: string;\n")
        handle.write("  weightClass: string;\n")
        handle.write("  wso?: string;\n")
        handle.write("};\n\n")
        handle.write("export const startList: StartListEntry[] = [\n")

        field_order = [
            "adaptive",
            "age",
            "club",
            "entryTotal",
            "gender",
            "meet",
            "memberId",
            "name",
            "sessionNumber",
            "sessionPlatform",
            "weightClass",
            "wso",
        ]

        for entry in entries:
            handle.write("  {\n")
            for field in field_order:
                value = entry.get(field)
                if (
                    field in {"sessionNumber", "sessionPlatform", "wso"}
                    and value is None
                ):
                    continue
                if field in {"sessionPlatform", "wso"} and not value:
                    continue
                handle.write(f"    {field}: {format_ts_value(value)},\n")
            handle.write("  },\n")

        handle.write("];\n")


def audit_entries(entries: List[Dict[str, object]]) -> List[str]:
    issues: List[str] = []
    for entry in entries:
        name = str(entry["name"])
        club = str(entry["club"])
        if len(name.split()) < 2:
            issues.append(f"single-token name: {name}")
        if club.startswith("0 ") or "/ / / /" in club:
            issues.append(f"suspicious club: {name} -> {club}")
        if not entry.get("weightClass"):
            issues.append(f"missing weight class: {name}")
        if ("sessionPlatform" in entry and not entry.get("sessionPlatform")) or (
            "sessionNumber" in entry and not entry.get("sessionNumber")
        ):
            issues.append(f"missing session: {name}")
    return issues


def main(argv: Optional[Sequence[str]] = None) -> None:
    settings = build_run_settings(argv)
    pdf_file = download_pdf(settings.pdf_url)
    pdf_bytes = pdf_file.getvalue()
    actual_format = detect_source_format(pdf_bytes, settings.source_format)
    meet_name = settings.meet_name or infer_meet_name(pdf_bytes, actual_format)
    output_path = settings.output_path or infer_output_path(
        settings.pdf_url, meet_name, actual_format
    )
    entries = extract_entries(
        BytesIO(pdf_bytes),
        meet_name=meet_name,
        source_format=actual_format,
        start_member_id=settings.start_member_id,
    )
    backfilled_wsos = 0
    if settings.backfill_wso_from_convex:
        backfilled_wsos = backfill_missing_wsos_from_convex(entries, meet_name)
    write_typescript(entries, output_path)
    issues = audit_entries(entries)
    print(f"Parsed {len(entries)} entries", flush=True)
    print(f"Detected format: {actual_format}", flush=True)
    print(f"Meet name: {meet_name}", flush=True)
    print(f"Wrote {output_path}", flush=True)
    print(f"Backfilled WSOs from Convex: {backfilled_wsos}", flush=True)
    print(f"Audit issues: {len(issues)}", flush=True)
    for issue in issues[:10]:
        print(f"- {issue}", flush=True)

    if settings.run_verification:
        verify_script = Path(__file__).with_name("output_check.py")
        verify_command = [
            sys.executable,
            str(verify_script),
            "--pdf-url",
            settings.pdf_url,
            "--meet-name",
            meet_name,
            "--output-path",
            str(output_path),
            "--source-format",
            actual_format,
            "--start-member-id",
            str(settings.start_member_id),
        ]
        print("Running verification...", flush=True)
        subprocess.run(verify_command, check=True)


if __name__ == "__main__":
    main()
