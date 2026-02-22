#!/usr/bin/env python3
"""
import_all.py — Import all Supabase data into Convex.

Prerequisites:
    pip install convex requests python-dotenv

Usage:
    # Full import (all tables)
    python migration/import_all.py

    # Single table
    python migration/import_all.py --table lifting_results

    # Resume from a specific table (skip earlier ones)
    python migration/import_all.py --from lifting_results

    # Dry run (shows counts without importing)
    python migration/import_all.py --dry-run

Environment variables:
    SUPABASE_URL        Your Supabase project URL
    SUPABASE_KEY        Your Supabase service role key (not anon key)
    CONVEX_URL          Your Convex deployment URL
    SCRAPER_SECRET      Shared secret set in Convex environment variables
"""

import argparse
import os
import sys
import time
from typing import Generator

import requests
from convex import ConvexClient
from dotenv import load_dotenv

from transform import transform_row

load_dotenv()
load_dotenv(".env.local", override=False)

SUPABASE_URL = os.environ.get("SUPABASE_URL") or os.environ["EXPO_PUBLIC_SUPABASE_URL"]
SUPABASE_KEY = os.environ["SUPABASE_KEY"]
CONVEX_URL = os.environ.get("CONVEX_URL") or os.environ["EXPO_PUBLIC_CONVEX_URL"]
SCRAPER_SECRET = os.environ["SCRAPER_SECRET"]

SUPABASE_HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
}

PAGE_SIZE = 1000
RATE_LIMIT_EVERY = 50
RATE_LIMIT_SLEEP = 0.05  # seconds

TABLE_ORDER = [
    "standards",
    "records",
    "wso_records",
    "world_records",
    "qualifying_totals",
    "meets",
    "session_schedule",
    "athletes",
    "lifting_results",
    "intl_rankings",
    "saved_sessions",
    "notification_preferences",
]

INGEST_ACTIONS = {
    "athletes": "scraperIngestion:ingestAthlete",
    "intl_rankings": "scraperIngestion:ingestIntlRanking",
    "lifting_results": "scraperIngestion:ingestLiftingResult",
    "meets": "scraperIngestion:ingestMeet",
    "notification_preferences": "notificationPreferences:upsert",
    "qualifying_totals": "scraperIngestion:ingestQualifyingTotal",
    "records": "scraperIngestion:ingestRecord",
    "saved_sessions": "savedSessions:upsert",
    "session_schedule": "scraperIngestion:ingestSessionSchedule",
    "standards": "scraperIngestion:ingestStandard",
    "wso_records": "scraperIngestion:ingestWSORecord",
    "world_records": "scraperIngestion:ingestWorldRecord",
}

# These tables call public mutations (not scraperIngestion actions), so use client.mutation()
# All other tables call scraperIngestion:* actions, so use client.action()
MUTATION_TABLES = {"notification_preferences", "saved_sessions"}

NO_SECRET_TABLES = {"notification_preferences", "saved_sessions"}


def stream_supabase_rows(table: str, after_id: int = 0) -> Generator[dict, None, None]:
    """Stream rows from a Supabase table one page at a time.

    If after_id > 0, only rows with id > after_id are fetched (for resuming).
    """
    offset = 0
    while True:
        if after_id > 0:
            url = (
                f"{SUPABASE_URL}/rest/v1/{table}"
                f"?select=*&id=gt.{after_id}&order=id.asc&limit={PAGE_SIZE}&offset={offset}"
            )
        else:
            url = (
                f"{SUPABASE_URL}/rest/v1/{table}"
                f"?select=*&limit={PAGE_SIZE}&offset={offset}"
            )
        resp = requests.get(url, headers=SUPABASE_HEADERS)
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            break
        yield from rows
        if len(rows) < PAGE_SIZE:
            break
        offset += PAGE_SIZE


def count_supabase_rows(table: str) -> int:
    url = f"{SUPABASE_URL}/rest/v1/{table}?select=*&limit=1"
    resp = requests.get(
        url,
        headers={**SUPABASE_HEADERS, "Prefer": "count=exact"},
    )
    resp.raise_for_status()
    content_range = resp.headers.get("Content-Range", "")
    try:
        return int(content_range.split("/")[-1])
    except (ValueError, IndexError):
        return -1


def import_table(client: ConvexClient, table: str, dry_run: bool, after_id: int = 0) -> dict:
    action = INGEST_ACTIONS.get(table)
    if not action:
        print(f"  [SKIP] No ingest action configured for '{table}'")
        return {"skipped": True}

    total = count_supabase_rows(table)
    if after_id > 0:
        print(f"  Total rows in Supabase: ~{total} (resuming after id={after_id})")
    else:
        print(f"  Total rows in Supabase: ~{total}")

    if dry_run:
        print(f"  [DRY RUN] Would import ~{total} rows via {action}")
        return {"rows": total, "imported": 0, "errors": 0}

    imported = 0
    errors = 0
    start = time.time()

    for i, raw_row in enumerate(stream_supabase_rows(table, after_id=after_id)):
        try:
            convex_row = transform_row(table, raw_row)

            if table not in NO_SECRET_TABLES:
                convex_row["scraperSecret"] = SCRAPER_SECRET

            if table in MUTATION_TABLES:
                client.mutation(action, convex_row)
            else:
                client.action(action, convex_row)
            imported += 1

            if imported % 500 == 0:
                elapsed = time.time() - start
                rate = imported / elapsed if elapsed > 0 else 0
                remaining = (total - imported) / rate if rate > 0 else 0
                print(
                    f"    ... {imported:,}/{total:,} "
                    f"({rate:.0f} rows/s, ~{remaining/60:.1f}m remaining)"
                )

            if i > 0 and i % RATE_LIMIT_EVERY == 0:
                time.sleep(RATE_LIMIT_SLEEP)

        except Exception as e:
            errors += 1
            print(f"  [ERROR] Row {i}: {e}", file=sys.stderr)
            if errors > 20:
                print("  Too many errors - stopping.", file=sys.stderr)
                break

    elapsed = time.time() - start
    print(f"  Done: {imported:,} imported, {errors} errors in {elapsed:.0f}s")
    return {"rows": total, "imported": imported, "errors": errors}


def main():
    parser = argparse.ArgumentParser(description="Import Supabase data into Convex")
    parser.add_argument("--table", help="Import only this specific table")
    parser.add_argument(
        "--from",
        dest="from_table",
        help="Resume from this table (skip all tables before it)",
    )
    parser.add_argument("--dry-run", action="store_true", help="Preview only, no writes")
    parser.add_argument(
        "--after-id",
        dest="after_id",
        type=int,
        default=0,
        help="Only import rows with id > this value (for resuming lifting_results)",
    )
    args = parser.parse_args()

    client = ConvexClient(CONVEX_URL)

    if args.table:
        if args.table not in TABLE_ORDER:
            print(f"Unknown table: {args.table}")
            print(f"Valid tables: {', '.join(TABLE_ORDER)}")
            sys.exit(1)
        tables = [args.table]
    elif args.from_table:
        if args.from_table not in TABLE_ORDER:
            print(f"Unknown table: {args.from_table}")
            sys.exit(1)
        start_idx = TABLE_ORDER.index(args.from_table)
        tables = TABLE_ORDER[start_idx:]
        print(f"Resuming from '{args.from_table}' ({len(tables)} tables remaining)")
    else:
        tables = TABLE_ORDER

    summary = {}
    for table in tables:
        print(f"\n{'=' * 60}")
        print(f"Importing: {table}")
        print(f"{'=' * 60}")
        after_id = args.after_id if table == "lifting_results" else 0
        result = import_table(client, table, dry_run=args.dry_run, after_id=after_id)
        summary[table] = result

    print(f"\n{'=' * 60}")
    print("IMPORT SUMMARY")
    print(f"{'=' * 60}")
    total_imported = 0
    total_errors = 0
    for table, result in summary.items():
        if result.get("skipped"):
            print(f"  {table}: SKIPPED")
        else:
            rows = result.get("rows", 0)
            imported = result.get("imported", 0)
            errors = result.get("errors", 0)
            total_imported += imported
            total_errors += errors
            status = "OK" if errors == 0 else f"ERRORS: {errors}"
            print(f"  {table}: {imported:,}/{rows:,} ({status})")

    print(f"\nTotal imported: {total_imported:,}, Total errors: {total_errors}")
    if total_errors > 0:
        sys.exit(1)


if __name__ == "__main__":
    main()
