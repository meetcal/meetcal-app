import json
import re
from pathlib import Path

from scraper import MEET_NAME, OUTPUT_TS, download_pdf, extract_entries, has_tail_pattern, normalize_fragment

try:
    from PyPDF2 import PdfReader
except ImportError:
    from pypdf import PdfReader

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
REPORT_PATH = Path(__file__).with_name("verify_ao1_26_report.txt")
SCHEDULE_PATH = Path(__file__).resolve().parents[1] / "owlcms_schedule_scraper" / "prelim" / "mnats.ts"
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
    "Review clubs that collapsed to placeholder values": (
        "-",
        "",
    ),
}


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


def count_raw_tail_like_pdf_lines() -> int:
    pdf_file = download_pdf("https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt743172239cf12117/69cdcb8d048bd1762a166ec0/2026_-_Master_&_Uni_-_Start_Listc.pdf")
    reader = PdfReader(pdf_file)
    total = 0
    for page in reader.pages:
        for raw_line in (page.extract_text() or "").splitlines():
            line = normalize_fragment(raw_line)
            if has_tail_pattern(line):
                total += 1
    return total


def load_expected_session_platforms(path: Path) -> dict[int, set[str]]:
    text = path.read_text(encoding="utf-8")
    pattern = re.compile(r'platform: "([^"]+)", sessionId: (\d+)')
    expected: dict[int, set[str]] = {}
    for platform, session_text in pattern.findall(text):
        session_id = int(session_text)
        expected.setdefault(session_id, set()).add(platform)
    return expected


def collect_name_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | club={entry["club"]} | session={entry["sessionNumber"]} {entry["sessionPlatform"]}'
            for entry in entries
            if any(pattern.search(entry.get("name", "")) for pattern in NAME_PATTERNS)
        }
    )


def collect_club_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | {entry["club"]} | session={entry["sessionNumber"]} {entry["sessionPlatform"]}'
            for entry in entries
            if entry.get("club", "") in TRUNCATED_CLUB_VALUES or entry.get("club") == ""
        }
    )


def collect_wso_issues(entries: list[dict]) -> list[str]:
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
            f'{entry["name"]} | weightClass={entry["weightClass"]} | session={entry["sessionNumber"]} {entry["sessionPlatform"]}'
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


def collect_session_issues(entries: list[dict]) -> list[str]:
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


def collect_meet_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | meet={entry["meet"]}'
            for entry in entries
            if entry.get("meet") != MEET_NAME
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

    missing_sessions = [
        f"session {session}"
        for session in sorted(expected)
        if session not in actual
    ]

    missing_session_platforms = [
        f"session {session} | platform {platform}"
        for session in sorted(expected)
        for platform in sorted(expected[session], key=lambda p: ("Red", "White", "Blue", "Stars", "Stripes", "Rogue").index(p))
        if platform not in actual.get(session, set())
    ]

    coverage_counts = [
        f"session {session} | platform {platform} | athletes {counts.get((session, platform), 0)}"
        for session in sorted(expected)
        for platform in sorted(expected[session], key=lambda p: ("Red", "White", "Blue", "Stars", "Stripes", "Rogue").index(p))
    ]

    return missing_sessions, missing_session_platforms, coverage_counts


def collect_all_issues(entries: list[dict]) -> dict[str, list[str]]:
    return {
        "names": collect_name_issues(entries),
        "clubs": collect_club_issues(entries),
        "wsos": collect_wso_issues(entries),
        "weightClasses": collect_weight_class_issues(entries),
        "genders": collect_gender_issues(entries),
        "sessions": collect_session_issues(entries),
        "memberIds": collect_member_id_issues(entries),
        "meets": collect_meet_issues(entries),
    }


def collect_checks_to_do(entries: list[dict]) -> list[str]:
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
    checks.append(f"Review specifically truncated WSO values: {len(truncated_wso_values)}")
    for value in truncated_wso_values:
        checks.append(f"- {value}")

    return checks


def main() -> None:
    output_entries = load_output_entries(OUTPUT_TS)
    parsed_entries = extract_entries(download_pdf("https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt743172239cf12117/69cdcb8d048bd1762a166ec0/2026_-_Master_&_Uni_-_Start_Listc.pdf"))
    expected_session_platforms = load_expected_session_platforms(SCHEDULE_PATH)
    missing_sessions, missing_session_platforms, coverage_counts = collect_session_coverage(
        output_entries, expected_session_platforms
    )
    raw_tail_like_lines = count_raw_tail_like_pdf_lines()
    issues = collect_all_issues(output_entries)
    checks_to_do = collect_checks_to_do(output_entries)
    lines: list[str] = []
    lines.append(f"Output rows: {len(output_entries)}")
    lines.append(f"Parser rows: {len(parsed_entries)}")
    lines.append(f"Raw single-line tail rows: {raw_tail_like_lines}")
    lines.append(f"Output matches parser: {len(output_entries) == len(parsed_entries)}")
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
    REPORT_PATH.write_text(report, encoding="utf-8")
    print(report, end="")
    print(f"\nSaved report: {REPORT_PATH}")


if __name__ == "__main__":
    main()
