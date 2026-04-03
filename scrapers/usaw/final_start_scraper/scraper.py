"""
python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
"""

from __future__ import annotations

import json
import math
import re
from io import BytesIO
from typing import Dict, List, Optional, Tuple
from urllib.request import urlopen

try:
    from PyPDF2 import PdfReader
except ImportError:
    from pypdf import PdfReader

PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt743172239cf12117/69cdcb8d048bd1762a166ec0/2026_-_Master_&_Uni_-_Start_Listc.pdf"
MEET_NAME = "2026 Masters National Championships & National University Championships"
OUTPUT_TS = "mnats_26.ts"
START_MEMBER_ID = 3100
REQUEST_TIMEOUT_SECONDS = 45

PLATFORMS = ["RED", "WHITE", "BLUE", "STARS", "STRIPES", "ROGUE"]
PLATFORM_PATTERN = "|".join(PLATFORMS)
TAIL_PATTERN = re.compile(
    rf"\s(?P<entry_total>\d{{1,3}})\s*(?P<group>[A-Z])\s+(?P<session>\d+(?:\.\d+)?)\s*(?P<platform>{PLATFORM_PATTERN})\s+\d{{1,2}}-[A-Za-z]{{3}}\s+\d{{1,2}}:\d{{2}}\s+[AP]M$",
    re.IGNORECASE,
)
ROGUE_TAIL_PATTERN = re.compile(
    r"\s(?P<entry_total>\d{1,3})\s*ROGUE\s+(?P<session>\d+(?:\.\d+)?)\s*ROGUE\s+\d{1,2}-[A-Za-z]{3}\s+\d{1,2}:\d{2}\s+[AP]M$",
    re.IGNORECASE,
)
YEAR_AGE_PATTERN = re.compile(r"(?:\b[A-Z]{2,3}\b\s+)?(19\d{2}|20\d{2})\s+(\d{1,2})(?=\s|[A-Za-z]|$)")
COMP_MARKERS = {
    "UNI",
    "WSO",
    "OPEN",
    "JR",
    "JUNIOR",
    "ADAP",
    "MIL",
    "TKOK",
    "14-15YO",
    "16-17YO",
}


def download_pdf(url: str) -> BytesIO:
    with urlopen(url, timeout=REQUEST_TIMEOUT_SECONDS) as response:
        return BytesIO(response.read())


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
    return " ".join(parts).title()


def normalize_competitions(raw_competitions: str) -> str:
    return normalize_fragment(raw_competitions)


def normalize_club(raw_club: str) -> str:
    club = normalize_fragment(raw_club)
    if club in {"", "0"}:
        return "Unaffiliated"
    return club


def parse_weight_class_and_gender(competitions: str) -> Tuple[str, str]:
    tokens = competitions.replace("/", " / ").split()
    gender = ""
    weight_class = ""

    for idx, token in enumerate(tokens):
        upper = token.upper()
        next_token = tokens[idx + 1] if idx + 1 < len(tokens) else ""

        if upper in {"W", "M"} and re.fullmatch(r"\d{2,3}\+?", next_token):
            gender = "Male" if upper == "M" else "Female"
            weight_class = next_token
            continue

        compact = re.sub(r"\s+", "", upper)
        fused_match = re.fullmatch(r"[WM]([WM])(\d{2,3}\+?)", compact)
        if fused_match:
            gender = "Male" if fused_match.group(1) == "M" else "Female"
            if re.fullmatch(r"\d{2,3}\+?", next_token):
                weight_class = next_token
            else:
                weight_class = fused_match.group(2)
            continue

        match = re.fullmatch(r"([WM])(\d{2,3}\+?)", compact)
        if not match:
            continue

        gender = "Male" if match.group(1) == "M" else "Female"
        if re.fullmatch(r"\d{2,3}\+?", next_token):
            weight_class = next_token
        else:
            weight_class = match.group(2)

    return weight_class, gender


def parse_head(before_year: str) -> Optional[Tuple[str, str]]:
    cleaned = normalize_fragment(re.sub(r"\s+[A-Z]{2,3}$", "", before_year.strip()))
    match = re.match(r"(?P<wso>.+?)\s+(?P<lot>\d+)\s*(?P<name>.+)$", cleaned)
    if not match:
        return None

    wso = normalize_fragment(match.group("wso"))
    name = normalize_name(match.group("name"))
    if not name:
        return None
    return name, wso


def split_club_and_competitions(after_year: str) -> Optional[Tuple[str, str]]:
    tokens = normalize_fragment(after_year).split()
    if tokens and tokens[0] == "0":
        tokens = tokens[1:]

    start_idx: Optional[int] = None
    for idx, token in enumerate(tokens):
        upper = token.upper()
        next_token = tokens[idx + 1] if idx + 1 < len(tokens) else ""

        if upper in COMP_MARKERS or re.fullmatch(r"U\d{1,2}", upper):
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


def parse_entry_line(line: str) -> Optional[Dict[str, object]]:
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
        "meet": MEET_NAME,
        "name": name,
        "sessionNumber": session_number,
        "sessionPlatform": platform,
        "weightClass": weight_class,
        "wso": wso,
    }


def extract_entries(pdf_file: BytesIO) -> List[Dict[str, object]]:
    entries: List[Dict[str, object]] = []

    reader = PdfReader(pdf_file)
    for page in reader.pages:
        pending_line = ""
        text = page.extract_text() or ""
        for raw_line in text.splitlines():
            line = normalize_fragment(raw_line)
            if not line:
                continue
            if line.startswith("WSO Lot"):
                continue
            if "Start List" in line or "presented by" in line.lower():
                continue

            if pending_line:
                combined_line = normalize_fragment(f"{pending_line} {line}")
                parsed = parse_entry_line(combined_line)
                if parsed:
                    entries.append(parsed)
                    pending_line = ""
                    continue

                parsed = parse_entry_line(line)
                if parsed:
                    entries.append(parsed)
                    pending_line = ""
                    continue

                pending_line = combined_line if not TAIL_PATTERN.search(combined_line) else ""
                continue

            parsed = parse_entry_line(line)
            if parsed:
                entries.append(parsed)
                continue

            pending_line = line if not TAIL_PATTERN.search(line) else ""

    member_id = START_MEMBER_ID
    for entry in entries:
        entry["memberId"] = str(member_id)
        member_id += 1

    return entries


def format_ts_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value, ensure_ascii=True)


def write_typescript(entries: List[Dict[str, object]], output_path: str) -> None:
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write("export type StartListEntry = {\n")
        handle.write("  adaptive: boolean;\n")
        handle.write("  age: number;\n")
        handle.write("  club: string;\n")
        handle.write("  entryTotal: number;\n")
        handle.write("  gender: string;\n")
        handle.write("  meet: string;\n")
        handle.write("  memberId: string;\n")
        handle.write("  name: string;\n")
        handle.write("  sessionNumber: number;\n")
        handle.write("  sessionPlatform: string;\n")
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
                if field == "wso" and not value:
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
    return issues


def main() -> None:
    pdf_file = download_pdf(PDF_URL)
    entries = extract_entries(pdf_file)
    write_typescript(entries, OUTPUT_TS)
    issues = audit_entries(entries)
    print(f"Parsed {len(entries)} entries")
    print(f"Wrote {OUTPUT_TS}")
    print(f"Audit issues: {len(issues)}")
    for issue in issues[:10]:
        print(f"- {issue}")


if __name__ == "__main__":
    main()
