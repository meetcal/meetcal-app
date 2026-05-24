"""
Verify athlete placement output after assign_athlete_sessions.py dry-run.

Usage:
  venv/bin/python output_check.py
  venv/bin/python output_check.py --output athlete_placements_preview.ts --url "<pdf-url>"
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from dataclasses import dataclass
from io import BytesIO
from pathlib import Path
from typing import Optional, Sequence

from assign_athlete_sessions import (
    DEFAULT_OUTPUT_PATH,
    assign_placements,
    fetch_athletes_from_convex,
)
from final_scraper import (
    MEET_NAME,
    PDF_URL,
    download_pdf,
    extract_assignment_schedule_data,
)

EXPECTED_PLATFORMS = {"Red", "White", "Blue", "Stars", "Stripes", "Rogue"}
EXPECTED_GENDERS = {"Male", "Female"}
WEIGHT_CLASS_PATTERN = re.compile(r"^\+?\d{2,3}\+?$")
DEFAULT_REPORT_PATH = Path(__file__).with_name("verify_output.txt")
DEFAULT_SCHEDULE_PATH = Path(__file__).with_name("final_schedule_preview.ts")
PRESERVED_FIELDS = (
    "memberId",
    "name",
    "age",
    "club",
    "gender",
    "weightClass",
    "entryTotal",
    "meet",
    "adaptive",
)


@dataclass
class VerificationSettings:
    meet_name: str
    pdf_url: str
    output_path: Path
    report_path: Path
    schedule_path: Path


def build_verification_settings(argv: Optional[Sequence[str]] = None) -> VerificationSettings:
    parser = argparse.ArgumentParser(
        description="Verify athlete placement TypeScript output"
    )
    parser.add_argument("--meet", default=MEET_NAME)
    parser.add_argument("--url", default=PDF_URL)
    parser.add_argument("--output", default=DEFAULT_OUTPUT_PATH)
    parser.add_argument("--report-path")
    parser.add_argument("--schedule-path", default=str(DEFAULT_SCHEDULE_PATH))
    args = parser.parse_args(argv)

    output_path = Path(args.output)
    report_path = (
        Path(args.report_path)
        if args.report_path
        else output_path.with_name(f"{output_path.stem}_report.txt")
    )
    return VerificationSettings(
        meet_name=args.meet,
        pdf_url=args.url,
        output_path=output_path,
        report_path=report_path,
        schedule_path=Path(args.schedule_path),
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


def valid_assignment_session_platforms(schedule: Sequence[dict]) -> set[tuple[int, str]]:
    valid: set[tuple[int, str]] = set()
    for row in schedule:
        session_text = row.get("sess")
        platform = row.get("plat")
        if session_text in (None, "") or not platform:
            continue
        valid.add((int(float(session_text)), platform))
    return valid


def collect_unassigned_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | memberId={entry.get("memberId")} | '
            f'gender={entry.get("gender")} | weightClass={entry.get("weightClass")} | '
            f'entryTotal={entry.get("entryTotal")}'
            for entry in entries
            if entry.get("sessionNumber") is None or not entry.get("sessionPlatform")
        }
    )


def collect_session_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | session={entry.get("sessionNumber")} | '
            f'platform={entry.get("sessionPlatform")}'
            for entry in entries
            if (
                not isinstance(entry.get("sessionNumber"), int)
                or entry["sessionNumber"] <= 0
                or entry.get("sessionPlatform") not in EXPECTED_PLATFORMS
            )
        }
    )


def collect_meet_issues(entries: list[dict], expected_meet: str) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | meet={entry.get("meet")}'
            for entry in entries
            if entry.get("meet") != expected_meet
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
            issues.add(f"duplicate memberId={member_id} | name={entry['name']}")
        seen.add(member_id)
    return sorted(issues)


def collect_gender_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | gender={entry.get("gender")} | '
            f'weightClass={entry.get("weightClass")}'
            for entry in entries
            if entry.get("gender") not in EXPECTED_GENDERS
        }
    )


def collect_weight_class_issues(entries: list[dict]) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | weightClass={entry.get("weightClass")} | '
            f'session={entry.get("sessionNumber")} {entry.get("sessionPlatform")}'
            for entry in entries
            if not WEIGHT_CLASS_PATTERN.fullmatch(str(entry.get("weightClass", "")))
        }
    )


def collect_preserved_field_issues(
    output_entries: list[dict], expected_by_member: dict[str, dict]
) -> list[str]:
    issues: set[str] = set()
    for entry in output_entries:
        member_id = str(entry.get("memberId", ""))
        expected = expected_by_member.get(member_id)
        if expected is None:
            issues.add(f'missing convex athlete for memberId={member_id} | name={entry["name"]}')
            continue
        for field in PRESERVED_FIELDS:
            if entry.get(field) != expected.get(field):
                issues.add(
                    f'{entry["name"]} | {field} output={entry.get(field)!r} '
                    f'expected={expected.get(field)!r}'
                )
    return sorted(issues)


def collect_assignment_mismatch_issues(
    output_entries: list[dict], expected_placements: dict[str, dict]
) -> list[str]:
    issues: set[str] = set()
    for entry in output_entries:
        member_id = str(entry.get("memberId", ""))
        expected = expected_placements.get(member_id)
        if expected is None:
            continue
        for field in ("sessionNumber", "sessionPlatform"):
            if entry.get(field) != expected.get(field):
                issues.add(
                    f'{entry["name"]} | {field} output={entry.get(field)!r} '
                    f'expected={expected.get(field)!r}'
                )
    return sorted(issues)


def collect_schedule_membership_issues(
    entries: list[dict], valid_pairs: set[tuple[int, str]]
) -> list[str]:
    return sorted(
        {
            f'{entry["name"]} | session={entry.get("sessionNumber")} | '
            f'platform={entry.get("sessionPlatform")}'
            for entry in entries
            if entry.get("sessionNumber") is not None
            and entry.get("sessionPlatform")
            and (entry["sessionNumber"], entry["sessionPlatform"]) not in valid_pairs
        }
    )


def collect_session_coverage(
    entries: list[dict], expected: dict[int, set[str]]
) -> tuple[list[str], list[str], list[str]]:
    actual: dict[int, set[str]] = {}
    counts: dict[tuple[int, str], int] = {}
    for entry in entries:
        session = entry.get("sessionNumber")
        platform = entry.get("sessionPlatform")
        if session is None or not platform:
            continue
        actual.setdefault(session, set()).add(platform)
        counts[(session, platform)] = counts.get((session, platform), 0) + 1

    missing_sessions = [
        f"session {session}" for session in sorted(expected) if session not in actual
    ]
    missing_session_platforms = [
        f"session {session} | platform {platform}"
        for session in sorted(expected)
        for platform in sorted(
            expected[session],
            key=lambda value: ("Red", "White", "Blue", "Stars", "Stripes", "Rogue").index(
                value
            ),
        )
        if platform not in actual.get(session, set())
    ]
    coverage_counts = [
        f"session {session} | platform {platform} | athletes {counts.get((session, platform), 0)}"
        for session in sorted(expected)
        for platform in sorted(
            expected[session],
            key=lambda value: ("Red", "White", "Blue", "Stars", "Stripes", "Rogue").index(
                value
            ),
        )
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
        for (session, platform), count in sorted(counts.items())
    ]


def collect_all_issues(
    output_entries: list[dict],
    expected_placements: dict[str, dict],
    expected_by_member: dict[str, dict],
    expected_meet: str,
    valid_pairs: set[tuple[int, str]],
) -> dict[str, list[str]]:
    return {
        "unassigned": collect_unassigned_issues(output_entries),
        "sessions": collect_session_issues(output_entries),
        "scheduleMembership": collect_schedule_membership_issues(
            output_entries, valid_pairs
        ),
        "assignmentMismatch": collect_assignment_mismatch_issues(
            output_entries, expected_placements
        ),
        "preservedFields": collect_preserved_field_issues(
            output_entries, expected_by_member
        ),
        "memberIds": collect_member_id_issues(output_entries),
        "meets": collect_meet_issues(output_entries, expected_meet),
        "genders": collect_gender_issues(output_entries),
        "weightClasses": collect_weight_class_issues(output_entries),
    }


def main(argv: Optional[Sequence[str]] = None) -> int:
    settings = build_verification_settings(argv)

    if not settings.output_path.exists():
        raise FileNotFoundError(
            f"Output file not found: {settings.output_path}. Run assign_athlete_sessions.py "
            "dry-run first, or pass --output to an existing generated file."
        )

    output_entries = load_output_entries(settings.output_path)
    athletes = fetch_athletes_from_convex(meet_name=settings.meet_name)
    expected_by_member = {
        str(athlete.get("memberId", "")): athlete for athlete in athletes
    }

    pdf_file = download_pdf(settings.pdf_url)
    schedule = extract_assignment_schedule_data(
        pdf_file=BytesIO(pdf_file.getvalue()), meet_name=settings.meet_name
    )
    recomputed_placements, unassigned = assign_placements(
        athletes=athletes, schedule=schedule
    )
    expected_placements = {
        str(placement["memberId"]): placement for placement in recomputed_placements
    }
    valid_pairs = valid_assignment_session_platforms(schedule)

    issues = collect_all_issues(
        output_entries=output_entries,
        expected_placements=expected_placements,
        expected_by_member=expected_by_member,
        expected_meet=settings.meet_name,
        valid_pairs=valid_pairs,
    )

    missing_sessions: list[str] = []
    missing_session_platforms: list[str] = []
    coverage_counts: list[str] = []
    if settings.schedule_path.exists():
        expected_session_platforms = load_expected_session_platforms(
            settings.schedule_path
        )
        missing_sessions, missing_session_platforms, coverage_counts = (
            collect_session_coverage(output_entries, expected_session_platforms)
        )
    else:
        coverage_counts = collect_actual_session_counts(output_entries)
        missing_sessions = []
        missing_session_platforms = []

    lines: list[str] = []
    lines.append(f"Meet name: {settings.meet_name}")
    lines.append(f"Convex athletes: {len(athletes)}")
    lines.append(f"Assignment schedule rows: {len(schedule)}")
    lines.append(f"Output rows: {len(output_entries)}")
    lines.append(f"Recomputed placements: {len(recomputed_placements)}")
    lines.append(f"Output matches Convex athlete count: {len(output_entries) == len(athletes)}")
    lines.append(
        "Output matches recomputed placements: "
        f"{len(issues['assignmentMismatch']) == 0 and len(output_entries) == len(recomputed_placements)}"
    )
    lines.append(f"Unassigned athletes: {unassigned}")
    lines.append(f"Missing sessions from schedule: {len(missing_sessions)}")
    lines.append(
        f"Missing session/platform combos from schedule: {len(missing_session_platforms)}"
    )
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
    lines.append(
        f"Review empty session/platform slots from final schedule: "
        f"{len(missing_sessions)} sessions, {len(missing_session_platforms)} combos"
    )
    lines.append(
        "Empty slots are expected when the preliminary schedule includes youth or "
        "other groups without athletes in this meet entry list."
    )
    lines.append("")

    report = "\n".join(lines).rstrip() + "\n"
    settings.report_path.write_text(report, encoding="utf-8")
    print(report, end="")
    print(f"Verified output: {settings.output_path}")
    print(f"Saved report: {settings.report_path}")

    critical_categories = (
        "unassigned",
        "sessions",
        "scheduleMembership",
        "assignmentMismatch",
        "preservedFields",
        "memberIds",
        "meets",
        "genders",
        "weightClasses",
    )
    total_issues = sum(len(issues[category]) for category in critical_categories)
    if total_issues > 0 or len(output_entries) != len(athletes):
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
