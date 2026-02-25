import csv
import math
import re
from io import BytesIO
from typing import Dict, List, Optional
from urllib.request import urlopen

import pdfplumber

PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt9bb5856a1e3d2f65/699f5747513403f7a8d1bd72/2026_-_VWS1_-_START_LIST_v2.pdf"
MEET_NAME = "2026 VIRUS Weightlifting Series 1"
OUTPUT_CSV = "ao1_26.csv"
START_MEMBER_ID = 3100
REQUEST_TIMEOUT_SECONDS = 45

PLATFORMS = ["RED", "WHITE", "BLUE", "STARS", "STRIPES", "ROGUE"]
PLATFORM_PATTERN = "|".join(PLATFORMS)
COMP_START_PATTERN = re.compile(
    r"\b(OPEN|U\d{1,2}|14-15YO|16-17YO|JR|JUNIOR|ADAP|MIL|W\d{2}|M\d{2}|[WM][A-Za-z]+\s*\d{2,3}\+?)\b"
)


def download_pdf(url: str) -> BytesIO:
    with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return BytesIO(response.read())


def normalize_name(raw_name: str) -> str:
    parts = [p for p in re.split(r"\s+", raw_name.strip()) if p]
    return " ".join(parts).title()


def parse_weight_class(competitions: str) -> str:
    match = re.search(r"[WM][A-Za-z]*\s*(\d{2,3}\+?)", competitions, re.IGNORECASE)
    return match.group(1) if match else ""


def parse_gender(competitions: str) -> str:
    match = re.search(r"([WM])[A-Za-z]*\s*\d{2,3}\+?", competitions, re.IGNORECASE)
    if not match:
        return ""
    return "Male" if match.group(1).upper() == "M" else "Female"


def parse_member_name(before_state: str) -> Optional[str]:
    # Strip trailing nationality tokens like USA/CAN/GBR.
    base = re.sub(r"\s+[A-Z]{2,3}$", "", before_state.strip())

    # Most lines look like: "<WSO words> <lot><First Last>"
    lot_name_match = re.search(r"(\d+)([^\d]+)$", base)
    if not lot_name_match:
        return None

    raw_name = lot_name_match.group(2).strip()
    # Drop trailing uppercase geography/nationality artifacts.
    raw_name = re.sub(r"\s+(?:[A-Z]{2,3}|[A-Z]{4,})$", "", raw_name).strip()
    if not raw_name:
        return None

    return normalize_name(raw_name)


def parse_entry_line(line: str) -> Optional[Dict]:
    # Tail anchor variant 1: total+group, session+platform, day, comp time
    tail_match = re.search(
        rf"\s(\d{{1,3}})[A-Z]\s+(\d+(?:\.\d+)?)({PLATFORM_PATTERN})\s+\d{{1,2}}-[A-Za-z]{{3}}\s+\d{{1,2}}:\d{{2}}\s+[AP]M$",
        line,
    )
    if tail_match:
        entry_total = int(tail_match.group(1))
        session_raw = tail_match.group(2)
        platform = tail_match.group(3).title()
        head = line[: tail_match.start()].strip()
    else:
        # Tail anchor variant 2 seen in Rogue rows:
        # "... ADAP ... 200ROGUE 13.5ROGUE 7-Mar 10:00 AM"
        rogue_tail_match = re.search(
            r"\s(\d{1,3})ROGUE\s+(\d+(?:\.\d+)?)ROGUE\s+\d{1,2}-[A-Za-z]{3}\s+\d{1,2}:\d{2}\s+[AP]M$",
            line,
            re.IGNORECASE,
        )
        if not rogue_tail_match:
            return None
        entry_total = int(rogue_tail_match.group(1))
        session_raw = rogue_tail_match.group(2)
        platform = "Rogue"
        head = line[: rogue_tail_match.start()].strip()

    # Anchor on year + age (state/country tokens are noisy in this PDF).
    year_age_match = re.search(r"(19\d{2}|20\d{2})\s+(\d{1,2})", head)
    if not year_age_match:
        return None

    age = int(year_age_match.group(2))
    before_state = head[: year_age_match.start()].strip()
    after_state = head[year_age_match.end() :].strip()

    name = parse_member_name(before_state)
    if not name:
        return None

    comp_match = COMP_START_PATTERN.search(after_state)
    if not comp_match:
        # Fallback for OCR-corrupted OPEN/JUNIOR tokens; anchor on first weight token.
        comp_match = re.search(r"(ADAP|[WM]\s*\d{2,3}\+?)", after_state, re.IGNORECASE)
    if not comp_match:
        return None

    club = after_state[: comp_match.start()].strip()
    competitions = after_state[comp_match.start() :].strip()

    weight_class = parse_weight_class(competitions)
    gender = parse_gender(competitions)
    adaptive = "ADAP" in competitions.upper()

    if not club:
        club = "Unaffiliated"

    if "." in session_raw:
        session_number = math.ceil(float(session_raw))
    else:
        session_number = int(session_raw)

    return {
        "name": name,
        "age": age,
        "club": club,
        "gender": gender,
        "weight_class": weight_class,
        "entry_total": entry_total,
        "session_number": session_number,
        "session_platform": platform,
        "meet": MEET_NAME,
        "adaptive": "true" if adaptive else "false",
    }


def extract_entries(pdf_file: BytesIO) -> List[Dict]:
    entries: List[Dict] = []

    with pdfplumber.open(pdf_file) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            for raw_line in text.splitlines():
                line = re.sub(r"\s+", " ", raw_line).strip()
                if not line:
                    continue
                if line.startswith("WSO Lot"):
                    continue
                if "Start List" in line or "presented by" in line.lower():
                    continue

                parsed = parse_entry_line(line)
                if parsed:
                    entries.append(parsed)

    return entries


def write_csv(entries: List[Dict], output_path: str) -> None:
    fieldnames = [
        "member_id",
        "name",
        "age",
        "club",
        "gender",
        "weight_class",
        "entry_total",
        "session_number",
        "session_platform",
        "meet",
        "adaptive",
    ]

    with open(output_path, "w", newline="", encoding="utf-8") as handle:
        writer = csv.DictWriter(handle, fieldnames=fieldnames)
        writer.writeheader()

        member_id = START_MEMBER_ID
        for entry in entries:
            row = {
                "member_id": member_id,
                **entry,
            }
            writer.writerow(row)
            member_id += 1


def main() -> None:
    pdf_file = download_pdf(PDF_URL)
    entries = extract_entries(pdf_file)
    write_csv(entries, OUTPUT_CSV)
    print(f"Parsed {len(entries)} entries")
    print(f"Wrote {OUTPUT_CSV}")


if __name__ == "__main__":
    main()
