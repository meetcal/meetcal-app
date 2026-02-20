#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
UMWF World Records Scraper

This scraper:
1. Downloads and parses UMWF World Records from Google Sheets (published HTML)
2. Extracts records for each age category, gender, and weight class
3. Exports to CSV
4. Upserts to Supabase
5. Sends Slack notifications

USAGE:
  # Dry-run (preview changes without updating database)
  source venv/bin/activate && python umwf_records.py --dry-run

  # Full run (update database)
  source venv/bin/activate && python umwf_records.py
"""

import os
import sys
import argparse
import csv
import re
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv
from io import StringIO

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)

# Load environment variables
load_dotenv()


# Sheet configurations
# Men's sheets - base URL with different gid values for each age category
MEN_BASE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSwEmZokL7Cv1aL8fHYLymDHR6NeEDpWqpViZnaQC8MuoIKVhugHf4uusZIAzY6jwYG5x1knY4ALqwG/pub"
MEN_SHEETS = {
    "Masters 30": 1439699993,
    "Masters 35": 13462089,
    "Masters 40": 262732551,
    "Masters 45": 2010721745,
    "Masters 50": 1445013360,
    "Masters 55": 847049674,
    "Masters 60": 1331993330,
    "Masters 65": 1717622796,
    "Masters 70": 266239647,
    "Masters 75": 1382156124,
    "Masters 80": 191193548,
}

# Women's sheets - base URL with different gid values for each age category
WOMEN_BASE_URL = "https://docs.google.com/spreadsheets/d/e/2PACX-1vSSSAfhhZJEJzA9w9Fk6pbsBI2YOtBgcVpbO6mSj6SnY0RGumjsSzCRSrnHMS-yOhli4DSK5CHBPXol/pub"
WOMEN_SHEETS = {
    "Masters 30": 1439699993,
    "Masters 35": 1137230161,
    "Masters 40": 84830211,
    "Masters 45": 675957304,
    "Masters 50": 1735680617,
    "Masters 55": 50753700,
    "Masters 60": 75329579,
    "Masters 65": 2072176452,
    "Masters 70": 570426830,
    "Masters 75": 809481028,
    "Masters 80": 1803872396,
}


class UMWFRecordsScraper:
    """Scraper for UMWF World Records from Google Sheets."""

    def __init__(self):
        """Initialize the scraper."""
        self.supabase: Optional[Client] = None
        self.slack_webhook_url: Optional[str] = None

    def setup_supabase_client(self):
        """Initialize Supabase client."""
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")

        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env")

        self.supabase = create_client(supabase_url, supabase_key)
        print("* Supabase client initialized")

    def setup_slack(self):
        """Initialize Slack webhook."""
        self.slack_webhook_url = os.getenv("SLACK_RECORDS_WEBHOOK_URL")
        if self.slack_webhook_url:
            print("* Slack webhook configured")

    def format_weight_class(self, weight_class_text: str) -> Optional[str]:
        """
        Convert weight class format from sheet to database format.

        Input formats: "60 kg Category", "110+ kg Category", "86+ kg Category"
        Output format: "60kg", "110+kg", "86+kg"
        """
        if not weight_class_text:
            return None

        # Extract the weight number and optional + sign
        match = re.search(r'(\d+)(\+)?\s*kg', weight_class_text, re.IGNORECASE)
        if match:
            weight = match.group(1)
            plus = match.group(2) or ""
            return f"{weight}{plus}kg"

        return None

    def fetch_sheet_csv(self, base_url: str, gid: int) -> Optional[str]:
        """
        Fetch CSV data from a Google Sheet tab.

        Args:
            base_url: Base URL of the published Google Sheet
            gid: Sheet ID (gid parameter)

        Returns:
            CSV content as string, or None if failed
        """
        url = f"{base_url}?gid={gid}&single=true&output=csv"

        try:
            response = requests.get(url, timeout=30)
            response.raise_for_status()
            return response.text
        except requests.exceptions.RequestException as e:
            print(f"  x Error fetching sheet gid={gid}: {e}")
            return None

    def parse_sheet_csv(self, csv_content: str, age_category: str, gender: str) -> List[Dict[str, Any]]:
        """
        Parse CSV content from a sheet tab.

        The format is:
        - Weight class rows start with empty cell, then "{weight} kg Category"
        - Lift rows: empty, "Snatch"/"Clean & Jerk"/"Total", weight_value, name/Standard, ...

        Args:
            csv_content: Raw CSV string
            age_category: Age category (e.g., "Masters 30")
            gender: "men" or "women"

        Returns:
            List of record dictionaries
        """
        records = []
        current_weight_class = None
        current_record = None

        reader = csv.reader(StringIO(csv_content))

        for row in reader:
            if len(row) < 3:
                continue

            # Check for weight class row (column 1 contains "kg Category")
            if len(row) > 1 and "kg Category" in str(row[1]):
                # Save previous record if complete
                if current_record and current_weight_class:
                    records.append(current_record)

                # Parse new weight class
                current_weight_class = self.format_weight_class(row[1])
                if current_weight_class:
                    current_record = {
                        'record_type': 'UMWF',
                        'age_category': age_category,
                        'gender': gender,
                        'weight_class': current_weight_class,
                        'snatch_record': 0,
                        'cj_record': 0,
                        'total_record': 0
                    }
                continue

            # Check for lift rows (Snatch, Clean & Jerk, Total)
            if len(row) > 2 and current_record:
                lift_type = str(row[1]).strip()
                weight_value = str(row[2]).strip()

                # Skip if weight is "Standard" or empty (no record set)
                if not weight_value or weight_value.upper() == "STANDARD":
                    continue

                try:
                    weight_int = int(float(weight_value))
                except (ValueError, TypeError):
                    continue

                if lift_type == "Snatch":
                    current_record['snatch_record'] = weight_int
                elif lift_type == "Clean & Jerk":
                    current_record['cj_record'] = weight_int
                elif lift_type == "Total":
                    current_record['total_record'] = weight_int

        # Don't forget the last record
        if current_record and current_weight_class:
            records.append(current_record)

        return records

    def extract_all_records(self) -> List[Dict[str, Any]]:
        """
        Extract records from all sheets (men and women, all age categories).

        Returns:
            List of all record dictionaries
        """
        print("Extracting UMWF World Records from Google Sheets...")
        all_records = []

        # Process men's sheets
        print("\nProcessing Men's sheets:")
        for age_category, gid in MEN_SHEETS.items():
            print(f"  Fetching {age_category}...")
            csv_content = self.fetch_sheet_csv(MEN_BASE_URL, gid)
            if csv_content:
                records = self.parse_sheet_csv(csv_content, age_category, "men")
                all_records.extend(records)
                print(f"    * Extracted {len(records)} records")

        # Process women's sheets
        print("\nProcessing Women's sheets:")
        for age_category, gid in WOMEN_SHEETS.items():
            print(f"  Fetching {age_category}...")
            csv_content = self.fetch_sheet_csv(WOMEN_BASE_URL, gid)
            if csv_content:
                records = self.parse_sheet_csv(csv_content, age_category, "women")
                all_records.extend(records)
                print(f"    * Extracted {len(records)} records")

        # Print summary
        print(f"\n* Extracted {len(all_records)} total UMWF records")

        # Count by category
        by_gender = {}
        by_age = {}
        for record in all_records:
            gender = record['gender']
            age = record['age_category']
            by_gender[gender] = by_gender.get(gender, 0) + 1
            by_age[age] = by_age.get(age, 0) + 1

        print("\nRecords by Gender:")
        for gender, count in sorted(by_gender.items()):
            print(f"  {gender}: {count}")

        print("\nRecords by Age Category:")
        for age, count in sorted(by_age.items()):
            print(f"  {age}: {count}")

        return all_records

    def export_to_csv(self, records: List[Dict[str, Any]], filename: str = "umwf_records.csv"):
        """Export records to CSV file."""
        if not records:
            print("No records to export")
            return

        fieldnames = ['record_type', 'age_category', 'gender', 'weight_class',
                     'snatch_record', 'cj_record', 'total_record']

        with open(filename, 'w', newline='') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            for record in records:
                writer.writerow({
                    'record_type': record['record_type'],
                    'age_category': record['age_category'],
                    'gender': record['gender'],
                    'weight_class': record['weight_class'],
                    'snatch_record': record['snatch_record'],
                    'cj_record': record['cj_record'],
                    'total_record': record['total_record']
                })

        print(f"* Exported {len(records)} records to {filename}")

    def dry_run(self, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Perform a dry run - show what would be inserted/updated without making changes.

        Returns:
            Dictionary with summary of changes
        """
        print("\n" + "="*60)
        print("DRY RUN - No database changes will be made")
        print("="*60 + "\n")

        if not self.supabase:
            self.setup_supabase_client()

        to_insert = []
        to_update = []
        unchanged = []

        for record in records:
            # Check if record exists
            existing = self.supabase.table('records').select('*').eq(
                'record_type', record['record_type']
            ).eq(
                'age_category', record['age_category']
            ).eq(
                'gender', record['gender']
            ).eq(
                'weight_class', record['weight_class']
            ).execute()

            if existing.data:
                # Record exists - check if update is needed
                db_record = existing.data[0]

                changed = False
                changes = {}

                if db_record.get('snatch_record') != record['snatch_record']:
                    changed = True
                    changes['snatch_record'] = {
                        'old': db_record.get('snatch_record'),
                        'new': record['snatch_record']
                    }

                if db_record.get('cj_record') != record['cj_record']:
                    changed = True
                    changes['cj_record'] = {
                        'old': db_record.get('cj_record'),
                        'new': record['cj_record']
                    }

                if db_record.get('total_record') != record['total_record']:
                    changed = True
                    changes['total_record'] = {
                        'old': db_record.get('total_record'),
                        'new': record['total_record']
                    }

                if changed:
                    to_update.append({
                        'record': record,
                        'changes': changes
                    })
                else:
                    unchanged.append(record)
            else:
                # New record
                to_insert.append(record)

        # Print summary
        print(f"Summary:")
        print(f"  New records to insert: {len(to_insert)}")
        print(f"  Records to update: {len(to_update)}")
        print(f"  Unchanged records: {len(unchanged)}")
        print(f"  Total records processed: {len(records)}\n")

        # Print details
        if to_insert:
            print("Records to INSERT:")
            for record in to_insert[:10]:  # Show first 10
                print(f"  + {record['age_category']} {record['gender']} {record['weight_class']}: "
                      f"Snatch={record['snatch_record']}, CJ={record['cj_record']}, Total={record['total_record']}")
            if len(to_insert) > 10:
                print(f"  ... and {len(to_insert) - 10} more")
            print()

        if to_update:
            print("Records to UPDATE:")
            for item in to_update[:10]:  # Show first 10
                record = item['record']
                changes = item['changes']
                change_str = ", ".join([
                    f"{k}: {v['old']} -> {v['new']}"
                    for k, v in changes.items()
                ])
                print(f"  ~ {record['age_category']} {record['gender']} {record['weight_class']}: {change_str}")
            if len(to_update) > 10:
                print(f"  ... and {len(to_update) - 10} more")
            print()

        return {
            'to_insert': to_insert,
            'to_update': to_update,
            'unchanged': unchanged,
            'total': len(records)
        }

    def upsert_to_supabase(self, records: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        Upsert records to Supabase.

        Returns:
            Dictionary with 'inserted' and 'updated' lists
        """
        if not self.supabase:
            self.setup_supabase_client()

        inserted = []
        updated = []

        for record in records:
            # Check if record exists
            existing = self.supabase.table('records').select('*').eq(
                'record_type', record['record_type']
            ).eq(
                'age_category', record['age_category']
            ).eq(
                'gender', record['gender']
            ).eq(
                'weight_class', record['weight_class']
            ).execute()

            if existing.data:
                # Update existing record
                db_record = existing.data[0]
                record_id = db_record['id']

                # Check if any values changed
                changed = False
                if db_record.get('snatch_record') != record['snatch_record']:
                    changed = True
                if db_record.get('cj_record') != record['cj_record']:
                    changed = True
                if db_record.get('total_record') != record['total_record']:
                    changed = True

                if changed:
                    self.supabase.table('records').update({
                        'snatch_record': record['snatch_record'],
                        'cj_record': record['cj_record'],
                        'total_record': record['total_record']
                    }).eq('id', record_id).execute()
                    updated.append(record)
                    print(f"  * Updated: {record['age_category']} {record['gender']} {record['weight_class']}")
            else:
                # Insert new record
                self.supabase.table('records').insert(record).execute()
                inserted.append(record)
                print(f"  * Inserted: {record['age_category']} {record['gender']} {record['weight_class']}")

        return {'inserted': inserted, 'updated': updated}

    def send_slack_notification(self, inserted: List[Dict[str, Any]], updated: List[Dict[str, Any]], is_dry_run: bool = False):
        """Send Slack notification with upsert summary."""
        if not self.slack_webhook_url:
            print("! Slack webhook not configured, skipping notification")
            return

        # Build message
        title = "UMWF World Records Update (DRY RUN)" if is_dry_run else "UMWF World Records Update"

        # Summary
        total_changes = len(inserted) + len(updated)
        if total_changes == 0:
            message = f"{title}\nNo changes detected" + (" (dry-run)" if is_dry_run else "")
        else:
            action = "would be " if is_dry_run else ""
            message = f"{title}\n*{len(inserted)}* new records {action}added, *{len(updated)}* records {action}updated".strip()

        # Inserted records
        if inserted:
            message += f"\n\n*New Records ({len(inserted)}):*\n"
            inserted_text = "\n".join([
                f"- {r['age_category']} {r['gender']} {r['weight_class']} "
                f"(Snatch={r['snatch_record']}, CJ={r['cj_record']}, Total={r['total_record']})"
                for r in inserted[:10]  # Limit to first 10
            ])
            message += inserted_text
            if len(inserted) > 10:
                message += f"\n... and {len(inserted) - 10} more"

        # Updated records
        if updated:
            message += f"\n\n*Updated Records ({len(updated)}):*\n"
            updated_text = "\n".join([
                f"- {r['age_category']} {r['gender']} {r['weight_class']}"
                for r in updated[:10]  # Limit to first 10
            ])
            message += updated_text
            if len(updated) > 10:
                message += f"\n... and {len(updated) - 10} more"

        payload = {
            "text": message
        }

        try:
            response = requests.post(self.slack_webhook_url, json=payload, timeout=30)
            response.raise_for_status()
            print("* Slack notification sent")
        except requests.exceptions.RequestException as e:
            print(f"! Failed to send Slack notification: {e}")

    def run(self, dry_run: bool = False):
        """Main execution method."""
        print("="*60)
        print("UMWF World Records Scraper")
        print("="*60 + "\n")

        # Extract records from all sheets
        records = self.extract_all_records()

        if not records:
            print("x No records extracted. Exiting.")
            return

        # Export to CSV
        self.export_to_csv(records)

        # Setup Supabase (needed for both dry-run to check existing records and full run)
        self.setup_supabase_client()

        # Setup Slack for notifications (works in both modes)
        self.setup_slack()

        # Process records
        if dry_run:
            result = self.dry_run(records)
            # Send Slack notification for dry-run
            self.send_slack_notification(
                result['to_insert'],
                [item['record'] for item in result['to_update']],
                is_dry_run=True
            )
        else:
            print("\n" + "="*60)
            print("UPDATING DATABASE")
            print("="*60 + "\n")
            result = self.upsert_to_supabase(records)
            print(f"\n* Complete: {len(result['inserted'])} inserted, {len(result['updated'])} updated")

            # Send Slack notification
            self.send_slack_notification(result['inserted'], result['updated'])


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Scrape UMWF World Records and update Supabase'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without updating database'
    )

    args = parser.parse_args()

    scraper = UMWFRecordsScraper()
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
