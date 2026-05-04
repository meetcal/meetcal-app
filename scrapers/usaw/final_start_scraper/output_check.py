"""
CLI usage:

Run this after generating output with the same PDF URL:
  venv/bin/python output_check.py --pdf-url "<pdf-url>"

If you omit `--pdf-url`, the script verifies the canonical masters output.
Run `scraper.py` first so the inferred or chosen output file exists before
verification.
"""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Dict, Optional, Sequence

import pdfplumber

try:
    from PyPDF2 import PdfReader
except ImportError:
    from pypdf import PdfReader

from scraper import (
    DEFAULT_MEET_NAME,
    DEFAULT_OUTPUT_TS,
    DEFAULT_PDF_URL,
    detect_source_format,
    download_pdf,
    extract_entries,
    has_tail_pattern,
    infer_meet_name,
    infer_output_path,
    is_registration_header,
    normalize_fragment,
    normalize_table_row,
    resolve_output_path,
)

EXPECTED_PLATFORMS = {"Red", "White", "Blue", "Stars", "Stripes", "Rogue"}
EXPECTED_GENDERS = {"Male", "Female"}
EXPECTED_WSOS = {
    "Alabama",
    "California North Central",
    "California South",
    "Carolina",
    "DMV",
    "Florida",
    "Georgia",
    "Hawaii and International",
    "Illinois",
    "Indiana",
    "Iowa-Nebraska",
    "Michigan",
    "Minnesota-Dakotas",
    "Missouri Valley",
    "Mountain North",
    "Mountain South",
    "New England",
    "New Jersey",
    "New York",
    "Ohio",
    "Pacific Northwest",
    "Pennsylvania-West Virginia",
    "Southern",
    "Tennessee-Kentucky",
    "Texas-Oklahoma",
    "Wisconsin",
}
TRUNCATED_WSO_VALUES = {
    "California North Cent",
    "Hawaii and Internatio",
    "Pennsylvania-West V",
}
TRUNCATED_CLUB_VALUES = {
    "-",
    "COASTAL EMPIRE WEIGHTLIFTIN G",
    "Delaware and Vermont Weightlift",
    "East Carolina Club Weightlifting -",
    "East Tennessee State University -",
    "HARRISBURG WEIGHTLIFTING CL U",
    "Industrial Strength WL C",
    "MILWAUKEE BARBELL WEIGHTLIF T",
    "North Dakota State University - N",
    "Rowan-Cabarrus Community Colle",
    "Rutgers, The State Univ. of New J e",
    "Rutgers, The State University of N",
    "Southern California Weightlifting C",
    "Southern Methodist University - T",
    "Stevens Institute of Technology - N",
    "The Strength Tank Weightlifting C",
    "University of California, Los Angel",
    "University of California, Los Angeleses",
    "University of California, Santa Bar",
    "University of Colorado, Boulder - C",
    "University of Maryland, College P a",
    "Worcester Polytechnic Institute -",
}
NAME_PATTERNS = [
    re.compile(r"\bMc [A-Z]"),
    re.compile(r"\bMcc[A-Z]"),
    re.compile(r"\bNz L\b"),
    re.compile(r"\bPo L\b"),
    re.compile(r"\bCrc\b"),
]
WEIGHT_CLASS_PATTERN = re.compile(r"^\d{2,3}\+?$")
LEFTOVER_CATEGORY_PREFIX_PATTERN = re.compile(r"^(U\d{1,2}|JR|U23|U25|OPEN|ADAP)\b", re.IGNORECASE)
LEFTOVER_PLATFORM_PREFIX_PATTERN = re.compile(r"^(RED|WHITE|BLUE|STARS|STRIPES|ROGUE)\b(?=\s+\d|,)", re.IGNORECASE)
DEFAULT_REPORT_PATH = Path(__file__).with_name("verify_output.txt")
DEFAULT_SCHEDULE_PATH = Path(__file__).resolve().parents[1] / "owlcms_schedule_scraper" / "prelim" / "mnats.ts"
CLUB_CHECK_PATTERNS = {
    "Review clubs with trailing school/state fragment truncation": (
        "East Carolina Club Weightlifting -",
        "East Tennessee State University -",
        "North Dakota State University - N",
        "Rutgers, The State University of N",
        "Southern Methodist University - T",
        "Stevens Institute of Technology - N",
        "University of Maryland, College P a",
        "Worcester Polytechnic Institute -",
    ),
    "Review clubs with chopped final word or final capital": (
        "COASTAL EMPIRE WEIGHTLIFTIN G",
        "HARRISBURG WEIGHTLIFTING CL U",
        "Industrial Strength WL C",
        "MILWAUKEE BARBELL WEIGHTLIF T",
        "Southern California Weightlifting C",
        "The Strength Tank Weightlifting C",
    ),
    "Review clubs with truncated university/place names": (
        "Delaware and Vermont Weightlift",
        "Rowan-Cabarrus Community Colle",
        "University of California, Los Angel",
        "University of California, Los Angeleses",
        "University of California, Santa Bar",
        "University of Colorado, Boulder - C",
    ),
    "Review clubs that collapsed to placeholder values": ("-", ""),
}


@dataclass
class VerificationSettings:
    pdf_url: str
    meet_name: str
    output_path: Path
    report_path: Path
    source_format: str
    schedule_path: Optional[Path]
    start_member_id: int


def default_report_path(output_path: Path, source_format: str) -> Path:
    if output_path == DEFAULT_OUTPUT_TS and source_format in {
        "auto",
        "masters",
        "registration",
    }:
        return DEFAULT_REPORT_PATH
    return output_path.with_name(f"{output_path.stem}_report.txt")


def build_verification_settings(argv: Optional[Sequence[str]] = None) -> VerificationSettings:
    parser = argparse.ArgumentParser()
    parser.add_argument("--pdf-url")
    parser.add_argument("--meet-name")
    parser.add_argument("--output-path")
    parser.add_argument("--report-path")
    parser.add_argument(
        "--source-format",
        choices=["auto", "masters", "owlcms", "registration"],
        default="auto",
    )
    parser.add_argument("--schedule-path")
    parser.add_argument("--skip-schedule-checks", action="store_true")
    parser.add_argument("--start-member-id", type=int, default=3100)
    args = parser.parse_args(argv)

    schedule_path: Optional[Path]
    if args.skip_schedule_checks:
        schedule_path = None
    elif args.schedule_path:
        schedule_path = resolve_output_path(args.schedule_path)
    else:
        schedule_path = (
            DEFAULT_SCHEDULE_PATH
            if args.source_format in {"auto", "masters"}
            else None
        )

    return VerificationSettings(
        pdf_url=args.pdf_url or DEFAULT_PDF_URL,
        meet_name=args.meet_name,
        output_path=resolve_output_path(args.output_path) if args.output_path else Path(),
        report_path=resolve_output_path(args.report_path) if args.report_path else Path(),
        source_format=args.source_format,
        schedule_path=schedule_path,
        start_member_id=args.start_member_id,
    )


def load_output_entries(path: Path) -> list[dict]:
    text = path.read_text(encoding="utf-8")
    entries: list[dict] = []
    for block in text.split("  {\n")[1:]:
        chunk = block.split("  },", 1)[0]
        entry: dict = {}
        for line in chunk.splitlines():
            match = re.match(r"\s+(\w+): (.+),$", line)
            if not match:
                continue
            key, raw_value = match.groups()
            if raw_value in {"true", "false"}:
                entry[key] = raw_value == "true"
            elif re.fullmatch(r"\d+", raw_value):
                entry[key] = int(raw_value)
            else:
                entry[key] = json.loads(raw_value)
        entries.append(entry)
    return entries


def load_expected_session_platforms(path: Path) -> dict[int, set[str]]:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'platform: "([^"]+)", sessionId: (\d+)')
    expected: dict[int, set[str]] = {}
    for platform, session_text in pattern.findall(text):
        session_id = int(session_text)
        expected.setdefault(session_id, set()).add(platform)
    return expected


def count_raw_master_rows(pdf_bytes: bytes) -> int:
    reader = PdfReader(BytesIO(pdf_bytes))
    total = 0
    for page in reader.pages:
        for raw_line in (page.extract_text() or "").splitlines():
            line = normalize_fragment(raw_line)
            if has_tail_pattern(line):
                total += 1
    return total


def count_raw_owlcms_rows(pdf_bytes: bytes) -> int:
    total = 0
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for raw_row in table:
                    row = [
                        normalize_fragment(value) if value else ""
                        for value in raw_row
                    ]
                    if len(row) >= 6:
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
                            and ", " in name
                        ):
                            total += 1
                    elif len(row) == 6:
                        lot_text, age_text, name, entry_total_text = (
                            row[0],
                            row[1],
                            row[2],
                            row[3],
                        )
                        if (
                            lot_text.isdigit()
                            and age_text.isdigit()
                            and entry_total_text.isdigit()
                            and ", " in name
                        ):
                            total += 1
    return total


def count_raw_registration_rows(pdf_bytes: bytes) -> int:
    total = 0
    with pdfplumber.open(BytesIO(pdf_bytes)) as pdf:
        for page in pdf.pages:
            for table in page.extract_tables() or []:
                for raw_row in table:
                    row = normalize_table_row(raw_row)
                    if not any(row) or is_registration_header(row):
                        continue
                    if (
                        len(row) >= 8
                        and row[2] in {"Female", "Male"}
                        and row[6].isdigit()
                        and WEIGHT_CLASS_PATTERN.fullmatch(row[5])
                    ):
                        total += 1
    return total


def collect_name_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | club={entry["club"]} | '
            f'session={entry.get("sessionNumber")} {entry.get("sessionPlatform")}'
            for entry in entries
            if any(pattern.search(entry.get("name", "")) for pattern in NAME_PATTERNS)
        }
    )


def collect_club_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | {entry["club"]} | '
            f'session={entry.get("sessionNumber")} {entry.get("sessionPlatform")}'
            for entry in entries
            if entry.get("club", "") in TRUNCATED_CLUB_VALUES or entry.get("club") == ""
        }
    )


def collect_wso_issues(entries: list[dict], source_format: str) -> list[str]:
    if source_format != "masters":
        return []
    return sorted(
        {
            f'{entry["name"]} | {entry.get("wso", "")}'
            for entry in entries
            if (
                entry.get("wso", "") not in EXPECTED_WSOS
                or entry.get("wso", "") in TRUNCATED_WSO_VALUES
            )
        }
    )


def collect_weight_class_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | weightClass={entry["weightClass"]} | '
            f'session={entry.get("sessionNumber")} {entry.get("sessionPlatform")}'
            for entry in entries
            if not WEIGHT_CLASS_PATTERN.fullmatch(entry.get("weightClass", ""))
        }
    )


def collect_gender_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | gender={entry["gender"]} | weightClass={entry["weightClass"]}'
            for entry in entries
            if entry.get("gender") not in EXPECTED_GENDERS
        }
    )


def collect_session_issues(entries: list[dict], source_format: str) -> list[str]:
    if source_format == "registration":
        return sorted(
            {
                f'{entry["name"]} | session={entry.get("sessionNumber")} | '
                f'platform={entry.get("sessionPlatform")}'
                for entry in entries
                if (
                    entry.get("sessionNumber") is not None
                    and (
                        not isinstance(entry.get("sessionNumber"), int)
                        or entry["sessionNumber"] <= 0
                    )
                )
                or (
                    entry.get("sessionPlatform")
                    and entry.get("sessionPlatform") not in EXPECTED_PLATFORMS
                )
            }
        )
    return sorted(
        {
            f'{entry["name"]} | session={entry["sessionNumber"]} | platform={entry["sessionPlatform"]}'
            for entry in entries
            if (
                not isinstance(entry.get("sessionNumber"), int)
                or entry["sessionNumber"] <= 0
                or entry.get("sessionPlatform") not in EXPECTED_PLATFORMS
            )
        }
    )


def collect_member_id_issues(entries: list[dict]) -> list[str]:
    seen: set[str] = set()
    issues: set[str] = set()
    for entry in entries:
        member_id = str(entry.get("memberId", ""))
        if not re.fullmatch(r"\d+", member_id):
            issues.add(f'{entry["name"]} | memberId={member_id}')
        if member_id in seen:
            issues.add(f'duplicate memberId={member_id} | name={entry["name"]}')
        seen.add(member_id)
    return sorted(issues)


def collect_meet_issues(entries: list[dict], expected_meet: str) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | meet={entry["meet"]}'
            for entry in entries
            if entry.get("meet") != expected_meet
        }
    )


def collect_leftover_prefix_issues(entries: list[dict], source_format: str) -> list[str]:
    if source_format != "owlcms":
        return []
    return sorted(
        {
            f'{entry["name"]} | club={entry["club"]}'
            for entry in entries
            if (
                LEFTOVER_CATEGORY_PREFIX_PATTERN.search(entry.get("name", ""))
                or LEFTOVER_CATEGORY_PREFIX_PATTERN.search(entry.get("club", ""))
                or LEFTOVER_PLATFORM_PREFIX_PATTERN.search(entry.get("name", ""))
                or LEFTOVER_PLATFORM_PREFIX_PATTERN.search(entry.get("club", ""))
            )
        }
    )


def collect_session_coverage(entries: list[dict], expected: dict[int, set[str]]) -> tuple[list[str], list[str], list[str]]:
    actual: dict[int, set[str]] = {}
    counts: dict[tuple[int, str], int] = {}
    for entry in entries:
        session = entry["sessionNumber"]
        platform = entry["sessionPlatform"]
        actual.setdefault(session, set()).add(platform)
        counts[(session, platform)] = counts.get((session, platform), 0) + 1

    missing_sessions = [f"session {session}" for session in sorted(expected) if session not in actual]
    missing_session_platforms = [
        f"session {session} | platform {platform}"
        for session in sorted(expected)
        for platform in sorted(expected[session], key=lambda value: ("Red", "White", "Blue", "Stars", "Stripes", "Rogue").index(value))
        if platform not in actual.get(session, set())
    ]
    coverage_counts = [
        f"session {session} | platform {platform} | athletes {counts.get((session, platform), 0)}"
        for session in sorted(expected)
        for platform in sorted(expected[session], key=lambda value: ("Red", "White", "Blue", "Stars", "Stripes", "Rogue").index(value))
    ]
    return missing_sessions, missing_session_platforms, coverage_counts


def collect_actual_session_counts(entries: list[dict]) -> list[str]:
    counts: dict[tuple[int, str], int] = {}
    for entry in entries:
        if entry.get("sessionNumber") is None or not entry.get("sessionPlatform"):
            continue
        key = (entry["sessionNumber"], entry["sessionPlatform"])
        counts[key] = counts.get(key, 0) + 1
    return [
        f"session {session} | platform {platform} | athletes {count}"
        for (session, platform), count in sorted(counts.items(), key=lambda item: (item[0][0], item[0][1]))
    ]


def collect_all_issues(entries: list[dict], source_format: str, expected_meet: str) -> dict[str, list[str]]:
    return {
        "names": collect_name_issues(entries),
        "clubs": collect_club_issues(entries),
        "wsos": collect_wso_issues(entries, source_format),
        "weightClasses": collect_weight_class_issues(entries),
        "genders": collect_gender_issues(entries),
        "sessions": collect_session_issues(entries, source_format),
        "memberIds": collect_member_id_issues(entries),
        "meets": collect_meet_issues(entries, expected_meet),
        "prefixes": collect_leftover_prefix_issues(entries, source_format),
    }


def collect_checks_to_do(entries: list[dict], source_format: str) -> list[str]:
    checks: list[str] = []
    for label, values in CLUB_CHECK_PATTERNS.items():
        matches = [
            f'{entry["name"]} | {entry["club"]} | session={entry["sessionNumber"]} {entry["sessionPlatform"]}'
            for entry in entries
            if entry.get("club", "") in values
        ]
        if matches:
            checks.append(f"{label}: {len(matches)}")
            for match in sorted(matches):
                checks.append(f"- {match}")
            checks.append("")

    if source_format == "masters":
        noncanonical_wsos = sorted(
            {
                f'{entry["name"]} | {entry.get("wso", "")}'
                for entry in entries
                if entry.get("wso", "") not in EXPECTED_WSOS
            }
        )
        checks.append(f"Review WSO values outside canonical list: {len(noncanonical_wsos)}")
        for value in noncanonical_wsos:
            checks.append(f"- {value}")
        checks.append("")

        truncated_wso_values = sorted(
            {
                f'{entry["name"]} | {entry.get("wso", "")}'
                for entry in entries
                if entry.get("wso", "") in TRUNCATED_WSO_VALUES
            }
        )
        checks.append(
            f"Review specifically truncated WSO values: {len(truncated_wso_values)}"
        )
        for value in truncated_wso_values:
            checks.append(f"- {value}")
    elif source_format == "owlcms":
        checks.append(
            "OWLCMS note: WSO checks skipped unless the source explicitly exposes WSO."
        )
    else:
        checks.append(
            "Registration note: session, platform, and WSO checks skipped because "
            "the source does not expose them."
        )

    return checks


def main(argv: Optional[Sequence[str]] = None) -> None:
    settings = build_verification_settings(argv)
    pdf_file = download_pdf(settings.pdf_url)
    pdf_bytes = pdf_file.getvalue()
    actual_format = detect_source_format(pdf_bytes, settings.source_format)
    meet_name = settings.meet_name or infer_meet_name(pdf_bytes, actual_format)
    output_path = (
        settings.output_path
        if str(settings.output_path) not in {"", "."}
        else infer_output_path(settings.pdf_url, meet_name, actual_format)
    )
    report_path = (
        settings.report_path
        if str(settings.report_path) not in {"", "."}
        else default_report_path(output_path, actual_format)
    )

    if not output_path.exists():
        raise FileNotFoundError(
            f"Output file not found: {output_path}. Run scraper.py with the same --pdf-url first, "
            "or pass --output-path to point to an existing generated file."
        )

    output_entries = load_output_entries(output_path)
    parsed_entries = extract_entries(
        BytesIO(pdf_bytes),
        meet_name=meet_name,
        source_format=actual_format,
        start_member_id=settings.start_member_id,
    )

    if actual_format == "masters":
        raw_source_rows = count_raw_master_rows(pdf_bytes)
    elif actual_format == "registration":
        raw_source_rows = count_raw_registration_rows(pdf_bytes)
    else:
        raw_source_rows = count_raw_owlcms_rows(pdf_bytes)
    issues = collect_all_issues(output_entries, actual_format, meet_name)
    checks_to_do = collect_checks_to_do(output_entries, actual_format)
    lines: list[str] = []

    lines.append(f"Source format: {actual_format}")
    lines.append(f"Output rows: {len(output_entries)}")
    lines.append(f"Parser rows: {len(parsed_entries)}")
    if actual_format == "masters":
        lines.append(f"Raw single-line tail rows: {raw_source_rows}")
    else:
        lines.append(f"Raw source rows: {raw_source_rows}")
    lines.append(f"Output matches parser: {len(output_entries) == len(parsed_entries)}")
    if actual_format == "masters":
        lines.append("Parser matches raw source rows: skipped")
    else:
        lines.append(
            f"Parser matches raw source rows: {len(parsed_entries) == raw_source_rows}"
        )

    if actual_format == "masters" and settings.schedule_path and settings.schedule_path.exists():
        expected_session_platforms = load_expected_session_platforms(settings.schedule_path)
        missing_sessions, missing_session_platforms, coverage_counts = collect_session_coverage(
            output_entries, expected_session_platforms
        )
        lines.append(f"Missing sessions from schedule: {len(missing_sessions)}")
        lines.append(f"Missing session/platform combos from schedule: {len(missing_session_platforms)}")
        lines.append("")
        lines.append("sessionCoverage:")
        for value in coverage_counts:
            lines.append(f"- {value}")
        lines.append("")
        lines.append("missingSessionCoverage:")
        for value in missing_sessions:
            lines.append(f"- {value}")
        for value in missing_session_platforms:
            lines.append(f"- {value}")
    else:
        lines.append("Missing sessions from schedule: skipped")
        lines.append("Missing session/platform combos from schedule: skipped")
        lines.append("")
        lines.append("sessionCoverage:")
        for value in collect_actual_session_counts(output_entries):
            lines.append(f"- {value}")
        lines.append("")
        lines.append("missingSessionCoverage:")
        lines.append("- schedule-based coverage skipped for this format")

    lines.append("")
    for category, values in issues.items():
        lines.append(f"{category}: {len(values)}")
        for value in values:
            lines.append(f"- {value}")
        lines.append("")
    lines.append("checksToDo:")
    for value in checks_to_do:
        lines.append(value)
    lines.append("")

    report = "\n".join(lines).rstrip() + "\n"
    report_path.write_text(report, encoding="utf-8")
    print(report, end="")
    print(f"\nDetected format: {actual_format}")
    print(f"Meet name: {meet_name}")
    print(f"Verified output: {output_path}")
    print(f"Saved report: {report_path}")


if __name__ == "__main__":
    main()
