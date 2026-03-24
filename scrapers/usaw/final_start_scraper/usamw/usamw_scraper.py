"""Run from this folder: ./venv/bin/python usamw_scraper.py"""

from __future__ import annotations

import json
import re
import uuid
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.request import urlopen

import pdfplumber

PDF_URL = "https://storage.googleapis.com/production-ipower-v1-0-4/354/1018354/vixoE8Rk/91549a10aeb14b769063f941ce01aacc?fileName=26_natl_master_final_start.pdf"
PDF_NAME = "26_natl_master_final_start.pdf"
OUTPUT_NAME = "26_natl_master_final_start.ts"
MEET_NAME = "2026 USA Masters Nationals"

NAME_MIN_X = 150
TOTAL_MIN_X = 300
TEAM_MIN_X = 350
COMPS_MIN_X = 520

DIVISION_PATTERN = re.compile(r"^[WM]\d+$")
WEIGHT_PATTERN = re.compile(r"^\d+\+?$")
AGE_PATTERN = re.compile(r"^\d+$")
MARKERS = {"(ADAP)", "(ADAPT)", "(ADAPTIVE)"}


def download_pdf(url: str, destination: Path) -> None:
    try:
        with urlopen(url) as response:
            destination.write_bytes(response.read())
    except (HTTPError, URLError) as exc:
        raise RuntimeError(f"Failed to download PDF from {url}") from exc


def extract_rows_from_pdf(pdf_path: Path) -> list[list[dict]]:
    rows: list[list[dict]] = []

    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            words = page.extract_words(use_text_flow=True)
            lines: dict[float, list[dict]] = {}

            for word in words:
                key = round(word["top"], 1)
                lines.setdefault(key, []).append(word)

            for _, line_words in sorted(lines.items()):
                ordered_words = sorted(line_words, key=lambda word: word["x0"])
                texts = [word["text"] for word in ordered_words]

                if len(texts) < 3:
                    continue

                if not DIVISION_PATTERN.match(texts[0]):
                    continue

                if not WEIGHT_PATTERN.match(texts[1]) or not AGE_PATTERN.match(texts[2]):
                    continue

                rows.append(ordered_words)

    return rows


def is_uppercase_name_token(token: str) -> bool:
    cleaned = token.replace("'", "").replace("-", "")
    return bool(cleaned) and cleaned.isupper()


def format_name_token(token: str) -> str:
    if token.isupper():
        if len(token) <= 2:
            return token
        return token.title()
    return token


def build_name(name_tokens: list[str]) -> str:
    filtered_tokens = [token for token in name_tokens if token.upper() not in MARKERS]

    surname_tokens: list[str] = []
    given_tokens: list[str] = []
    seen_given_name = False

    for token in filtered_tokens:
        if not seen_given_name and is_uppercase_name_token(token):
            surname_tokens.append(token)
            continue

        seen_given_name = True
        given_tokens.append(token)

    if not given_tokens and surname_tokens:
        given_tokens = [surname_tokens.pop()]

    ordered_tokens = [format_name_token(token) for token in given_tokens + surname_tokens]
    return " ".join(ordered_tokens).strip()


def parse_total(total_words: list[str]) -> int:
    if not total_words:
        return 0

    digits = "".join(total_words)
    return int(digits) if digits.isdigit() else 0


def parse_comps(comps_words: list[str]) -> int:
    if not comps_words:
        return 0

    value = comps_words[0]
    return int(value) if value.isdigit() else 0


def parse_row(words: list[dict]) -> dict:
    division = words[0]["text"]
    weight = words[1]["text"]
    age = int(words[2]["text"])

    name_words = [word["text"] for word in words if NAME_MIN_X <= word["x0"] < TOTAL_MIN_X]
    total_words = [word["text"] for word in words if TOTAL_MIN_X <= word["x0"] < TEAM_MIN_X]
    team_words = [word["text"] for word in words if TEAM_MIN_X <= word["x0"] < COMPS_MIN_X]
    comps_words = [word["text"] for word in words if word["x0"] >= COMPS_MIN_X]

    name = build_name(name_words)
    club = " ".join(team_words).strip()
    comps = parse_comps(comps_words)

    return {
        "adaptive": comps == 2,
        "age": age,
        "club": club,
        "entryTotal": parse_total(total_words),
        "gender": "Female" if division.startswith("W") else "Male",
        "meet": MEET_NAME,
        "memberId": str(uuid.uuid4()),
        "name": name,
        "sessionNumber": None,
        "sessionPlatform": None,
        "weightClass": f"{weight}kg",
    }


def parse_start_list(pdf_path: Path) -> list[dict]:
    entries: list[dict] = []
    seen: set[tuple[str, int, str, int, str]] = set()

    for row in extract_rows_from_pdf(pdf_path):
        entry = parse_row(row)
        key = (
            entry["name"],
            entry["age"],
            entry["weightClass"],
            entry["entryTotal"],
            entry["club"],
        )

        if key in seen:
            continue

        seen.add(key)
        entries.append(entry)

    return entries


def save_to_ts(data: list[dict], output_path: Path) -> None:
    type_definition = """export type StartListEntry = {
  adaptive: boolean;
  age: number;
  club: string;
  entryTotal: number;
  gender: string;
  meet: string;
  memberId: string;
  name: string;
  sessionNumber: number | null;
  sessionPlatform: string | null;
  weightClass: string;
};
"""

    def format_value(value: object) -> str:
        return json.dumps(value)

    formatted_entries: list[str] = []
    for entry in data:
        lines = ["  {"]
        for key, value in entry.items():
            lines.append(f"    {key}: {format_value(value)},")
        lines.append("  },")
        formatted_entries.append("\n".join(lines))

    entries = "[\n" + "\n".join(formatted_entries) + "\n]"
    content = f"{type_definition}\nexport const startList: StartListEntry[] = {entries};\n"
    output_path.write_text(content, encoding="utf-8")


def main() -> None:
    script_dir = Path(__file__).resolve().parent
    pdf_path = script_dir / PDF_NAME
    output_path = script_dir / OUTPUT_NAME

    print(f"Downloading {pdf_path.name}...")
    download_pdf(PDF_URL, pdf_path)

    print("Parsing start list...")
    parsed_data = parse_start_list(pdf_path)

    if not parsed_data:
        print("Error: No entries were parsed from the PDF")
        return

    save_to_ts(parsed_data, output_path)
    print(f"Saved {len(parsed_data)} entries to {output_path.name}")


if __name__ == "__main__":
    main()
