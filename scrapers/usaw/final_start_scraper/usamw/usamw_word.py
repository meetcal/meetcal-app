import json
import re
import uuid
from pathlib import Path

import pdfplumber

PDF_NAME = "mnats-26.pdf"
OUTPUT_NAME = "mnats-26.json"
MEET_NAME = "2026 USA Masters Nationals"

ENTRY_PATTERN = re.compile(
    r"^(?P<division>[WM]\d+)\s+"
    r"(?P<name>.+?)"
    r"(?:\s+(?P<marker>\((?:ADAP|ADAPT|ADAPTIVE|EXTRA)\)))?\s+"
    r"(?P<weight>\d+\+?)\s+"
    r"(?P<total>\d+)\s+"
    r"(?P<club>.+)$",
    re.IGNORECASE,
)


def extract_lines_from_pdf(pdf_path: Path) -> list[str]:
    lines: list[str] = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text() or ""
            lines.extend(text.splitlines())

    return lines


def normalize_club(club: str) -> str:
    cleaned = club.strip()
    cleaned = re.sub(r"\s+Deadlift$", "", cleaned, flags=re.IGNORECASE)

    if cleaned.upper() == "UNA":
        return "Unaffiliated"

    return cleaned


def parse_entry(line: str) -> dict | None:
    match = ENTRY_PATTERN.match(line.strip())
    if not match:
        return None

    division = match.group("division")
    marker = match.group("marker") or ""

    return {
        "adaptive": marker.upper() in {"(ADAP)", "(ADAPT)", "(ADAPTIVE)"},
        "age": int(division[1:]),
        "club": normalize_club(match.group("club")),
        "entryTotal": int(match.group("total")),
        "gender": "Female" if division.startswith("W") else "Male",
        "meet": MEET_NAME,
        "memberId": str(uuid.uuid4()),
        "name": match.group("name").strip(),
        "weightClass": f"{match.group('weight')}kg",
    }


def parse_start_list(lines: list[str]) -> list[dict]:
    entries: list[dict] = []
    seen: set[tuple[str, int, str, int]] = set()

    for raw_line in lines:
        line = raw_line.strip()
        if not re.match(r"^[WM]\d+", line):
            continue

        entry = parse_entry(line)
        if entry is None:
            continue

        key = (
            entry["name"],
            entry["age"],
            entry["weightClass"],
            entry["entryTotal"],
        )
        if key in seen:
            continue

        seen.add(key)
        entries.append(entry)

    return entries


def save_to_json(data: list[dict], output_path: Path) -> None:
    output_path.write_text(json.dumps(data, indent=2), encoding="utf-8")


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    pdf_path = script_dir / PDF_NAME
    output_path = script_dir / OUTPUT_NAME

    if not pdf_path.exists():
        print(f"Error: Could not find PDF file: {pdf_path}")
        return

    print(f"Extracting text from {pdf_path.name}...")
    lines = extract_lines_from_pdf(pdf_path)

    print("Parsing text...")
    parsed_data = parse_start_list(lines)

    print(f"Unique entries: {len(parsed_data)}")

    if not parsed_data:
        print("Error: No entries were parsed from the PDF")
        return

    save_to_json(parsed_data, output_path)
    print(f"Data saved to {output_path.name}")


if __name__ == "__main__":
    main()
