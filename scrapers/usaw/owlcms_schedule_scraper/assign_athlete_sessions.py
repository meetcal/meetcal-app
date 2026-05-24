"""
Assign athletes to preliminary schedule sessions and export Convex-ready placements.

Usage:
  python assign_athlete_sessions.py dry-run
  python assign_athlete_sessions.py dry-run --output athlete_placements_preview.ts
  python assign_athlete_sessions.py convex
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Dict, List, Optional, Sequence

import requests
from dotenv import load_dotenv

from final_scraper import (
    MEET_NAME,
    PDF_URL,
    download_pdf,
    extract_assignment_schedule_data,
    get_convex_url,
)

PRELIM_DIR = Path(__file__).with_name("prelim")
sys.path.insert(0, str(PRELIM_DIR))

from assign_sessions import find_matching_session  # noqa: E402

load_dotenv()
load_dotenv(Path(__file__).resolve().parents[3] / ".env.local")
load_dotenv(Path(__file__).resolve().parents[3] / ".env")

DEFAULT_OUTPUT_PATH = "athlete_placements_preview.ts"
CONVEX_QUERY_PATH = "athletes:getByMeet"
CONVEX_INGEST_PATH = "scraperIngestion:ingestAthlete"
REQUEST_TIMEOUT_SECONDS = 45


def fetch_athletes_from_convex(meet_name: str) -> List[dict]:
    convex_url = get_convex_url()
    if not convex_url:
        raise ValueError(
            "CONVEX_URL or EXPO_PUBLIC_CONVEX_URL is required to fetch athletes"
        )

    endpoint = f"{convex_url.rstrip('/')}/api/query"
    response = requests.post(
        endpoint,
        json={"path": CONVEX_QUERY_PATH, "args": {"meet": meet_name}},
        timeout=REQUEST_TIMEOUT_SECONDS,
    )
    response.raise_for_status()
    payload = response.json()
    value = payload.get("value", []) if isinstance(payload, dict) else []
    if not isinstance(value, list):
        raise ValueError(f"Unexpected Convex response for {CONVEX_QUERY_PATH}: {payload}")
    return value


def athlete_for_matching(convex_athlete: dict) -> dict:
    return {
        "member_id": convex_athlete.get("memberId", ""),
        "name": convex_athlete.get("name", ""),
        "age": convex_athlete.get("age"),
        "club": convex_athlete.get("club", ""),
        "gender": convex_athlete.get("gender", ""),
        "weight_class": convex_athlete.get("weightClass", ""),
        "entry_total": convex_athlete.get("entryTotal", 0),
        "meet": convex_athlete.get("meet", ""),
        "adaptive": convex_athlete.get("adaptive", False),
        "wso": convex_athlete.get("wso"),
    }


def build_placement(convex_athlete: dict, schedule: Sequence[dict]) -> dict:
    athlete = athlete_for_matching(convex_athlete)
    matching_session = find_matching_session(athlete, list(schedule))

    placement = {
        "memberId": convex_athlete.get("memberId", ""),
        "name": convex_athlete.get("name", ""),
        "age": convex_athlete.get("age"),
        "club": convex_athlete.get("club", ""),
        "gender": convex_athlete.get("gender", ""),
        "weightClass": convex_athlete.get("weightClass", ""),
        "entryTotal": convex_athlete.get("entryTotal", 0),
        "meet": convex_athlete.get("meet", ""),
        "adaptive": convex_athlete.get("adaptive", False),
    }

    wso = convex_athlete.get("wso")
    if wso:
        placement["wso"] = wso

    if matching_session:
        session_number = matching_session.get("sess")
        session_platform = matching_session.get("plat")
        if session_number not in (None, ""):
            placement["sessionNumber"] = int(float(session_number))
        if session_platform:
            placement["sessionPlatform"] = session_platform

    return placement


def assign_placements(
    athletes: Sequence[dict], schedule: Sequence[dict]
) -> tuple[List[dict], int]:
    placements: List[dict] = []
    unassigned = 0

    for athlete in athletes:
        placement = build_placement(athlete, schedule)
        if "sessionNumber" not in placement or "sessionPlatform" not in placement:
            unassigned += 1
            print(
                "WARNING: Could not assign "
                f"{placement.get('name')} "
                f"({placement.get('gender')}, {placement.get('age')}, "
                f"{placement.get('weightClass')}, {placement.get('entryTotal')})"
            )
        placements.append(placement)

    return placements, unassigned


def ts_value(value: object) -> str:
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, float) and value.is_integer():
        return str(int(value))
    if isinstance(value, (int, float)):
        return str(value)
    return json.dumps(value)


def export_ts(placements: Sequence[dict], output_path: str) -> None:
    if not placements:
        raise ValueError("No placements to write")

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

    print(f"Writing TypeScript placements: {output_path}")
    with open(output_path, "w", encoding="utf-8") as handle:
        handle.write("export type AthletePlacement = {\n")
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
        handle.write("export const athletePlacements: AthletePlacement[] = [\n")

        for index, placement in enumerate(placements):
            handle.write("  {\n")
            for field in field_order:
                if field not in placement:
                    continue
                value = placement[field]
                if field in {"sessionNumber", "sessionPlatform", "wso"} and not value:
                    continue
                handle.write(f"    {field}: {ts_value(value)},\n")
            handle.write("  }")
            handle.write(",\n" if index < len(placements) - 1 else "\n")

        handle.write("];\n")


def ingest_to_convex(placements: Sequence[dict]) -> dict:
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
    skipped = 0

    for placement in placements:
        if "sessionNumber" not in placement or "sessionPlatform" not in placement:
            skipped += 1
            continue

        payload = {
            "path": CONVEX_INGEST_PATH,
            "args": {
                "scraperSecret": scraper_secret,
                "memberId": placement["memberId"],
                "name": placement["name"],
                "age": placement["age"],
                "club": placement["club"],
                "gender": placement["gender"],
                "weightClass": placement["weightClass"],
                "entryTotal": placement["entryTotal"],
                "sessionNumber": placement["sessionNumber"],
                "sessionPlatform": placement["sessionPlatform"],
                "meet": placement["meet"],
                "adaptive": placement["adaptive"],
                **({"wso": placement["wso"]} if placement.get("wso") else {}),
            },
        }

        try:
            response = requests.post(
                endpoint, json=payload, timeout=REQUEST_TIMEOUT_SECONDS
            )
            if not response.ok:
                failed += 1
                print(
                    f"HTTP {response.status_code} for {placement['name']}: {response.text}"
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
            print(f"Convex error for {placement['name']}: {exc}")

    return {
        "total": len(placements),
        "inserted": inserted,
        "updated": updated,
        "failed": failed,
        "skippedUnassigned": skipped,
    }


def run_output_check(
    meet_name: str,
    pdf_url: str,
    output_path: str,
) -> None:
    verify_script = Path(__file__).with_name("output_check.py")
    verify_command = [
        sys.executable,
        str(verify_script),
        "--meet",
        meet_name,
        "--url",
        pdf_url,
        "--output",
        output_path,
    ]
    print("Running verification...")
    subprocess.run(verify_command, check=True)


def run(
    mode: str,
    meet_name: str,
    pdf_url: str,
    output_path: str,
    run_verification: bool,
) -> None:
    print(f"Fetching athletes from Convex for meet: {meet_name}")
    athletes = fetch_athletes_from_convex(meet_name=meet_name)
    print(f"Loaded {len(athletes)} athletes from Convex")

    pdf_file = download_pdf(pdf_url)
    schedule = extract_assignment_schedule_data(pdf_file=pdf_file, meet_name=meet_name)
    print(f"Loaded {len(schedule)} assignment schedule rows from PDF")

    placements, unassigned = assign_placements(athletes=athletes, schedule=schedule)
    assigned = len(placements) - unassigned
    print(f"Assigned {assigned}/{len(placements)} athletes")

    if mode == "dry-run":
        export_ts(placements, output_path)
        print(f"Dry run complete. Preview file: {output_path}")
        if run_verification:
            run_output_check(
                meet_name=meet_name,
                pdf_url=pdf_url,
                output_path=output_path,
            )
        return

    stats = ingest_to_convex(placements)
    print("Convex ingest complete:")
    print(stats)
    if run_verification:
        export_ts(placements, output_path)
        run_output_check(
            meet_name=meet_name,
            pdf_url=pdf_url,
            output_path=output_path,
        )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Assign Convex athletes to preliminary schedule sessions"
    )
    parser.add_argument(
        "mode",
        choices=["dry-run", "convex"],
        help="dry-run writes TypeScript placements, convex upserts athletes",
    )
    parser.add_argument(
        "--meet",
        default=MEET_NAME,
        help="Meet name used for Convex fetch and schedule parsing",
    )
    parser.add_argument(
        "--url",
        default=PDF_URL,
        help="Preliminary schedule PDF URL",
    )
    parser.add_argument(
        "--output",
        default=DEFAULT_OUTPUT_PATH,
        help="Output path for dry-run TypeScript placements",
    )
    parser.add_argument(
        "--skip-verify",
        action="store_true",
        help="Skip output_check verification after assignment",
    )
    return parser


def main() -> None:
    args = build_parser().parse_args()
    run(
        mode=args.mode,
        meet_name=args.meet,
        pdf_url=args.url,
        output_path=args.output,
        run_verification=not args.skip_verify,
    )


if __name__ == "__main__":
    main()
