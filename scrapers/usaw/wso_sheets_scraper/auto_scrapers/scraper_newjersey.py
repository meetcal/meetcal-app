#!/usr/bin/env python3
"""
WSO Records Scraper - New Jersey Format

For New Jersey WSO which uses a unique side-by-side layout with:
- Women's records on the left columns (B-G)
- Men's records on the right columns (I-N)
- Each weight class has 1 row with all lifts (Snatch, C&J, Total)
- Separate tabs for each age group
- "Vacant" entries for unfilled records
"""

import os
import sys
import json
import argparse
import re
from typing import List, Dict, Any, Optional
from datetime import datetime
from collections import defaultdict

import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class WSORecordsNewJerseyScraper:
    """Scraper for New Jersey WSO weightlifting records with unique side-by-side layout."""
    
    def __init__(self, wso_name: str, sheet_url: str):
        """Initialize the scraper with WSO name and sheet URL."""
        self.wso_name = wso_name
        self.sheet_url = sheet_url
        self.changes = {"inserted": [], "updated": []}
        
        # Tab configuration (gid mapping)
        # Based on the provided URLs
        self.tabs = {
            "Senior": "0",  # Open Records (all ages) - default tab
            "Junior": "336358523",  # Junior Records (15-20)
            "U17": "2116279815",  # 16-17 Youth Records
            "U15": "1466042495",  # 14-15 Youth Records
            "U13": "1569406083",  # Under 13 Youth Records
            "Masters 35": "575793496",  # 35-39 Masters Records
            "Masters 40": "2006037821",  # 40-44 Masters Records
            "Masters 45": "1977742090",  # 45-49 Masters Records
            "Masters 50": "1673511438",  # 50-54 Masters Records
            "Masters 55": "1894823432",  # 55-59 Masters Records
            "Masters 60": "1933132040",  # 60-64 Masters Records
            "Masters 65": "127836685",  # 65-69 Masters Records
            "Masters 70": "239397826",  # 70-74 Masters Records
            "Masters 75": "2047529058",  # 75-79 Men/ 75+ Women Masters Records
            "Masters 80": "389932308",  # 80+ Men's Masters Records
        }
        
        self.supabase_client = None
        self.slack_webhook_url = None
        
    def setup_supabase_client(self):
        """Set up Supabase client."""
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY environment variables must be set")
        
        self.supabase_client: Client = create_client(supabase_url, supabase_key)
        print("✓ Supabase client initialized")
    
    def setup_slack(self):
        """Set up Slack webhook URL."""
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
        if not self.slack_webhook_url:
            raise ValueError("SLACK_WEBHOOK_URL environment variable not set")
        print("✓ Slack webhook configured")
    
    def _map_age_category(self, tab_name: str) -> str:
        """Map tab name to age category."""
        return tab_name
    
    def scrape_sheet(self) -> List[Dict[str, Any]]:
        """
        Scrape all tabs from New Jersey sheet.
        
        Returns:
            List of records matching DB schema
        """
        sheet_id = self._extract_sheet_id(self.sheet_url)
        all_records = []
        
        # Scrape each tab
        for tab_name, gid in self.tabs.items():
            if gid is None:
                print(f"⚠️  Skipping {tab_name} - gid not configured")
                continue
                
            print(f"\nScraping {tab_name} tab...")
            try:
                records = self._scrape_tab(sheet_id, gid, tab_name)
                all_records.extend(records)
                print(f"✓ Found {len(records)} records in {tab_name}")
            except Exception as e:
                print(f"✗ Error scraping {tab_name}: {e}")
                import traceback
                traceback.print_exc()
        
        # Consolidate duplicate weight class records
        consolidated_records = self._consolidate_records(all_records)
        if len(consolidated_records) != len(all_records):
            print(f"\n✓ Consolidated {len(all_records)} records into {len(consolidated_records)} (merged duplicates)")
        
        return consolidated_records
    
    def _extract_sheet_id(self, url: str) -> str:
        """Extract sheet ID from URL."""
        match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', url)
        if not match:
            raise ValueError("Invalid Google Sheets URL")
        return match.group(1)
    
    def _scrape_tab(self, sheet_id: str, gid: str, tab_name: str) -> List[Dict[str, Any]]:
        """Scrape a single tab."""
        csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&gid={gid}"
        response = requests.get(csv_url)
        
        if response.status_code != 200:
            raise Exception(f"Failed to fetch tab: {response.status_code}")
        
        # Parse CSV
        import csv
        import io
        csv_reader = csv.reader(io.StringIO(response.text))
        rows = list(csv_reader)
        
        # Parse the side-by-side layout
        records = self._parse_side_by_side(rows, tab_name)
        
        return records
    
    def _parse_side_by_side(self, rows: List[List[str]], tab_name: str) -> List[Dict[str, Any]]:
        """
        Parse New Jersey's unique side-by-side layout.
        
        Format (one row per weight class):
        [rules_text, weight_class_women, athlete_women, date_women, snatch_women, cj_women, total_women, "",
         weight_class_men, athlete_men, date_men, snatch_men, cj_men, total_men]
        
        Column indices:
        - Women: 1 (weight), 2 (athlete), 3 (date), 4 (snatch), 5 (c&j), 6 (total)
        - Men: 8 (weight), 9 (athlete), 10 (date), 11 (snatch), 12 (c&j), 13 (total)
        
        Special case: Masters 80 tab only has men's records in the left columns.
        """
        records = []
        age_category = self._map_age_category(tab_name)
        
        # Track last weight classes for handling + categories
        last_women_weight = None
        last_men_weight = None
        
        # Masters 80 is men-only, data is in left columns but should be treated as men
        is_masters_80 = tab_name == "Masters 80"
        
        for i, row in enumerate(rows):
            # Skip empty rows or header rows
            if not row or len(row) < 14:
                continue
            
            # Skip the first row (header)
            if i == 0:
                continue
            
            if is_masters_80:
                # For Masters 80, left columns are men's records
                men_record = self._parse_single_side(
                    row, 1, "Men", age_category, last_men_weight
                )
                if men_record:
                    records.append(men_record)
                    if men_record['weight_class'] and not men_record['weight_class'].endswith('+'):
                        last_men_weight = men_record['weight_class']
            else:
                # Normal side-by-side layout
                # Parse women's side (columns 1-6)
                women_record = self._parse_single_side(
                    row, 1, "Women", age_category, last_women_weight
                )
                if women_record:
                    records.append(women_record)
                    # Update last weight class if it's not a + category and not empty
                    if women_record['weight_class'] and not women_record['weight_class'].endswith('+'):
                        last_women_weight = women_record['weight_class']
                
                # Parse men's side (columns 8-13)
                men_record = self._parse_single_side(
                    row, 8, "Men", age_category, last_men_weight
                )
                if men_record:
                    records.append(men_record)
                    # Update last weight class if it's not a + category and not empty
                    if men_record['weight_class'] and not men_record['weight_class'].endswith('+'):
                        last_men_weight = men_record['weight_class']
        
        return records
    
    def _parse_single_side(self, row: List[str], col_offset: int, gender: str, 
                          age_category: str, last_weight: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Parse one side (Women or Men) of the layout.
        
        Columns (offset by col_offset):
        0: weight_class
        1: athlete
        2: date/location
        3: snatch
        4: clean and jerk
        5: total
        """
        # Get weight class from first column
        weight_class = row[col_offset].strip() if len(row) > col_offset else ""
        
        # Handle + category (empty weight class)
        if not weight_class or weight_class == "":
            if last_weight:
                weight_class = last_weight + "+"
            else:
                return None
        
        # Get athlete name
        athlete = row[col_offset + 1].strip() if len(row) > col_offset + 1 else ""
        
        # Get lift values
        snatch_val = row[col_offset + 3].strip() if len(row) > col_offset + 3 else ""
        cj_val = row[col_offset + 4].strip() if len(row) > col_offset + 4 else ""
        total_val = row[col_offset + 5].strip() if len(row) > col_offset + 5 else ""
        
        snatch = self._parse_int(snatch_val)
        cj = self._parse_int(cj_val)
        total = self._parse_int(total_val)
        
        # Create record even if athlete is "Vacant" or empty - this shows which weight classes exist
        # The NULL values indicate no records have been set yet
        return {
            'wso': self.wso_name,
            'age_category': age_category,
            'gender': gender,
            'weight_class': weight_class,
            'snatch_record': snatch,
            'cj_record': cj,
            'total_record': total
        }
    
    def _parse_int(self, value: str) -> Optional[int]:
        """Parse integer value, return None if invalid or 0."""
        if not value or value == "":
            return None
        try:
            parsed = int(float(value))
            # Convert 0 to None (empty records)
            return None if parsed == 0 else parsed
        except ValueError:
            return None
    
    def _consolidate_records(self, records: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """
        Consolidate duplicate weight class records by taking the best (non-null) value for each lift.
        
        This handles cases where multiple athletes have partial records for the same weight class.
        For example:
        - Athlete A: 71kg Men - Snatch: 90, C&J: None, Total: None
        - Athlete B: 71kg Men - Snatch: None, C&J: 117, Total: 203
        
        Result: 71kg Men - Snatch: 90, C&J: 117, Total: 203
        """
        from collections import defaultdict
        
        # Group records by (wso, age_category, gender, weight_class)
        grouped = defaultdict(list)
        for record in records:
            key = (
                record['wso'],
                record['age_category'],
                record['gender'],
                record['weight_class']
            )
            grouped[key].append(record)
        
        # Consolidate each group
        consolidated = []
        for key, group_records in grouped.items():
            if len(group_records) == 1:
                # No duplicates, use as-is
                consolidated.append(group_records[0])
            else:
                # Merge duplicates - take the best (max) value for each lift
                merged = {
                    'wso': key[0],
                    'age_category': key[1],
                    'gender': key[2],
                    'weight_class': key[3],
                    'snatch_record': None,
                    'cj_record': None,
                    'total_record': None
                }
                
                # For each lift, take the non-null value (or max if multiple non-null)
                snatch_values = [r['snatch_record'] for r in group_records if r['snatch_record'] is not None]
                cj_values = [r['cj_record'] for r in group_records if r['cj_record'] is not None]
                total_values = [r['total_record'] for r in group_records if r['total_record'] is not None]
                
                merged['snatch_record'] = max(snatch_values) if snatch_values else None
                merged['cj_record'] = max(cj_values) if cj_values else None
                merged['total_record'] = max(total_values) if total_values else None
                
                consolidated.append(merged)
        
        return consolidated
    
    def upsert_records(self, records: List[Dict[str, Any]]) -> None:
        """Upsert records to Supabase."""
        for record in records:
            existing = self.supabase_client.table("wso_records").select("*").match({
                "wso": record["wso"],
                "age_category": record["age_category"],
                "gender": record["gender"],
                "weight_class": record["weight_class"]
            }).execute()
            
            if existing.data and len(existing.data) > 0:
                existing_record = existing.data[0]
                record_id = existing_record["id"]
                
                changes = {}
                if existing_record.get("snatch_record") != record.get("snatch_record"):
                    changes["snatch_record"] = {
                        "old": existing_record.get("snatch_record"),
                        "new": record.get("snatch_record")
                    }
                if existing_record.get("cj_record") != record.get("cj_record"):
                    changes["cj_record"] = {
                        "old": existing_record.get("cj_record"),
                        "new": record.get("cj_record")
                    }
                if existing_record.get("total_record") != record.get("total_record"):
                    changes["total_record"] = {
                        "old": existing_record.get("total_record"),
                        "new": record.get("total_record")
                    }
                
                if changes:
                    self.supabase_client.table("wso_records").update(record).eq("id", record_id).execute()
                    self.changes["updated"].append({
                        "wso": record["wso"],
                        "age_category": record["age_category"],
                        "gender": record["gender"],
                        "weight_class": record["weight_class"],
                        "changes": changes
                    })
                    print(f"  ✓ Updated: {record['age_category']} {record['gender']} {record['weight_class']}")
            else:
                self.supabase_client.table("wso_records").insert(record).execute()
                self.changes["inserted"].append({
                    "wso": record["wso"],
                    "age_category": record["age_category"],
                    "gender": record["gender"],
                    "weight_class": record["weight_class"],
                    "snatch_record": record.get("snatch_record"),
                    "cj_record": record.get("cj_record"),
                    "total_record": record.get("total_record")
                })
                print(f"  ✓ Inserted: {record['age_category']} {record['gender']} {record['weight_class']}")
    
    def send_slack_notification(self) -> None:
        """Send Slack notification."""
        total_inserted = len(self.changes["inserted"])
        total_updated = len(self.changes["updated"])
        
        if total_inserted == 0 and total_updated == 0:
            message = f"📊 *{self.wso_name} WSO Records - No Changes*\n\nScraper ran successfully. No new records or updates."
            payload = {"text": message}
        else:
            message = f"📊 *{self.wso_name} WSO Records Update*\n\n*Summary:*\n• {total_inserted} new record(s) inserted\n• {total_updated} record(s) updated"
            
            if total_inserted > 0:
                message += "\n\n🆕 *New Records*\n"
                for record in self.changes["inserted"][:10]:
                    lifts = []
                    if record.get("snatch_record"):
                        lifts.append(f"Snatch: {record['snatch_record']}kg")
                    if record.get("cj_record"):
                        lifts.append(f"C&J: {record['cj_record']}kg")
                    if record.get("total_record"):
                        lifts.append(f"Total: {record['total_record']}kg")
                    
                    lifts_str = ", ".join(lifts) if lifts else "No records"
                    message += f"• *{record['age_category']}* | {record['gender']} | {record['weight_class']}\n  {lifts_str}\n"
                
                if total_inserted > 10:
                    message += f"_...and {total_inserted - 10} more_\n"
            
            if total_updated > 0:
                message += "\n📝 *Updated Records*\n"
                for record in self.changes["updated"][:10]:
                    changes_str = []
                    for field, change in record["changes"].items():
                        field_name = field.replace("_record", "").replace("cj", "C&J").title()
                        old = f"{change['old']}kg" if change['old'] else "None"
                        new = f"{change['new']}kg" if change['new'] else "None"
                        changes_str.append(f"{field_name}: {old} → {new}")
                    
                    message += f"• *{record['age_category']}* | {record['gender']} | {record['weight_class']}\n  {', '.join(changes_str)}\n"
                
                if total_updated > 10:
                    message += f"_...and {total_updated - 10} more_\n"
            
            payload = {"text": message}
        
        try:
            response = requests.post(self.slack_webhook_url, json=payload)
            response.raise_for_status()
            print("✓ Slack notification sent")
        except Exception as e:
            print(f"✗ Failed to send Slack notification: {e}")
    
    def run(self, dry_run: bool = False) -> None:
        """Main execution flow."""
        print(f"Starting scraper for {self.wso_name}")
        print(f"Sheet URL: {self.sheet_url}")
        
        if not dry_run:
            self.setup_supabase_client()
            self.setup_slack()
        else:
            print("🧪 DRY RUN MODE - No database or Slack operations")
            self.setup_supabase_client()  # Still need for comparison
        
        print("Scraping Google Sheet...")
        records = self.scrape_sheet()
        print(f"Found {len(records)} total records")
        
        if dry_run:
            print("\n🔍 Comparing with database...")
            self._dry_run_comparison(records)
        else:
            print("Upserting records to Supabase...")
            self.upsert_records(records)
            
            print("Sending Slack notification...")
            self.send_slack_notification()
        
        print("Done!")
    
    def _dry_run_comparison(self, scraped_records: List[Dict[str, Any]]):
        """Compare scraped records with database without making changes."""
        to_insert = []
        to_update = []
        
        for record in scraped_records:
            # Check if record exists in database
            existing = self.supabase_client.table("wso_records").select("*").eq(
                "wso", record["wso"]
            ).eq(
                "age_category", record["age_category"]
            ).eq(
                "gender", record["gender"]
            ).eq(
                "weight_class", record["weight_class"]
            ).execute()
            
            if existing.data:
                # Record exists, check if values changed
                db_record = existing.data[0]
                changed = False
                changes = []
                
                for field in ["snatch_record", "cj_record", "total_record"]:
                    db_val = db_record.get(field)
                    new_val = record.get(field)
                    if db_val != new_val:
                        changed = True
                        changes.append(f"{field}: {db_val} → {new_val}")
                
                if changed:
                    to_update.append({
                        "record": record,
                        "changes": changes
                    })
            else:
                # New record
                to_insert.append(record)
        
        print(f"\n📊 Dry Run Results:")
        print(f"  Records to INSERT: {len(to_insert)}")
        print(f"  Records to UPDATE: {len(to_update)}")
        print(f"  Records unchanged: {len(scraped_records) - len(to_insert) - len(to_update)}")
        
        if to_insert:
            print(f"\n➕ New records ({len(to_insert)}):")
            for rec in to_insert[:10]:  # Show first 10
                print(f"  - {rec['age_category']} {rec['gender']} {rec['weight_class']}")
            if len(to_insert) > 10:
                print(f"  ... and {len(to_insert) - 10} more")
        
        if to_update:
            print(f"\n🔄 Updated records ({len(to_update)}):")
            for item in to_update[:10]:  # Show first 10
                rec = item['record']
                print(f"  - {rec['age_category']} {rec['gender']} {rec['weight_class']}")
                for change in item['changes']:
                    print(f"    {change}")
            if len(to_update) > 10:
                print(f"  ... and {len(to_update) - 10} more")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="WSO Records Scraper (New Jersey Format)")
    parser.add_argument("--wso", required=True, help="WSO name (should be 'New Jersey')")
    parser.add_argument("--sheet-url", required=True, help="Google Sheet URL")
    parser.add_argument("--dry-run", action="store_true", help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    scraper = WSORecordsNewJerseyScraper(args.wso, args.sheet_url)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()

