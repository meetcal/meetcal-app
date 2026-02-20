#!/usr/bin/env python3
"""
WSO Records Scraper - TN-KY Format
"""

import os
import sys
import json
import argparse
import re
from typing import List, Dict, Any
from datetime import datetime
from collections import defaultdict

import requests
from supabase import create_client, Client
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class WSORecordsTNKYScraper:
    """Scraper for TN-KY WSO weightlifting records with horizontal layout."""
    
    def __init__(self, wso_name: str, sheet_url: str):
        """Initialize the scraper with WSO name and sheet URL."""
        self.wso_name = wso_name
        self.sheet_url = sheet_url
        self.changes = {"inserted": [], "updated": []}
        
        # Initialize clients
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
    
    def _normalize_age_category(self, section_header: str) -> tuple:
        """
        Parse section header to extract age category and gender.
        
        Examples:
        - "YOUTH: MEN 13 & Under" -> ("U13", "Men")
        - "YOUTH: WOMEN 14-17 YO" -> ("U17", "Women") 
        - "SENIORS: MEN 15 years old <" -> ("Senior", "Men")
        - "MASTERS: MEN 35-39 years old" -> ("Masters 35", "Men")
        """
        header = section_header.strip().upper()
        
        # Extract gender
        if "WOMEN" in header:
            gender = "Women"
        elif "MEN" in header:
            gender = "Men"
        else:
            return None, None
        
        # Extract age category
        # Youth 13 & Under -> U13
        if "13" in header and "UNDER" in header:
            return "U13", gender
        
        # Youth 14-17 -> U17
        if "14-17" in header or "14 - 17" in header:
            return "U17", gender
        
        # Seniors (15 years old <)
        if "SENIOR" in header:
            return "Senior", gender
        
        # Junior
        if "JUNIOR" in header:
            return "Junior", gender
        
        # Masters (35-39, 40-44, etc.)
        if "MASTER" in header:
            # Extract age range
            match = re.search(r'(\d+)\s*-\s*(\d+)', header)
            if match:
                lower_age = match.group(1)
                return f"Masters {lower_age}", gender
        
        return None, None
    
    def scrape_sheet(self) -> List[Dict[str, Any]]:
        """
        Scrape data from TN-KY Google Sheet in horizontal format.
        
        Returns:
            List of records with structure matching DB schema
        """
        # Extract sheet ID from URL
        match = re.search(r'/spreadsheets/d/([a-zA-Z0-9-_]+)', self.sheet_url)
        if not match:
            raise ValueError("Invalid Google Sheets URL")
        
        sheet_id = match.group(1)
        
        # Extract gid if present
        gid_match = re.search(r'[#&]gid=(\d+)', self.sheet_url)
        if gid_match:
            sheet_name = gid_match.group(1)
        else:
            sheet_name = "0"
        
        # Fetch CSV data
        csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&gid={sheet_name}"
        response = requests.get(csv_url)
        
        if response.status_code != 200:
            raise Exception(f"Failed to fetch sheet: {response.status_code}")
        
        # Parse CSV into rows
        import csv
        import io
        csv_reader = csv.reader(io.StringIO(response.text))
        rows = list(csv_reader)
        
        # Process rows
        records = []
        current_age_category = None
        current_gender = None
        
        i = 0
        while i < len(rows):
            row = rows[i]
            
            # Check if this is a section header (contains age group info)
            if row and row[0]:
                # Combine first cell with column 2 for full header
                # (TN-KY puts age info in column 2)
                first_cell = row[0].strip()
                age_info = row[2].strip() if len(row) > 2 else ""
                full_header = f"{first_cell} {age_info}"
                
                # Try to parse as section header
                age_cat, gender = self._normalize_age_category(full_header)
                if age_cat and gender:
                    current_age_category = age_cat
                    current_gender = gender
                    
                    # Check if current row has weight classes (first section case)
                    # or if next row has weight classes (all other sections)
                    has_weights_in_current = any('KG' in str(cell).upper() for cell in row[1:9])
                    
                    if has_weights_in_current:
                        # First section: weight classes are in the same row as header
                        weight_row = row
                        weight_classes = self._parse_weight_classes(weight_row)
                    elif i + 1 < len(rows):
                        # Other sections: next row has weight classes
                        i += 1
                        weight_row = rows[i]
                        weight_classes = self._parse_weight_classes(weight_row)
                    else:
                        weight_classes = []
                    
                    # Process the data rows (SNATCH, Name, Date, C&J, Name, Date, TOTAL, Name, Date)
                    if i + 9 < len(rows):
                        snatch_data = self._parse_lift_rows(rows[i+1:i+4], weight_classes)
                        cj_data = self._parse_lift_rows(rows[i+4:i+7], weight_classes)
                        total_data = self._parse_lift_rows(rows[i+7:i+10], weight_classes)
                        
                        # Combine into records
                        for weight_class in weight_classes:
                            if weight_class:
                                record = {
                                    'wso': self.wso_name,
                                    'age_category': current_age_category,
                                    'gender': current_gender,
                                    'weight_class': weight_class,
                                    'snatch_record': snatch_data.get(weight_class),
                                    'cj_record': cj_data.get(weight_class),
                                    'total_record': total_data.get(weight_class)
                                }
                                records.append(record)
                        
                        i += 9  # Skip the 9 data rows we just processed
            
            i += 1
        
        return records
    
    def _parse_weight_classes(self, row: List[str]) -> List[str]:
        """Extract weight classes from header row."""
        weight_classes = []
        for cell in row[1:]:  # Skip first column
            cell = cell.strip()
            if cell and 'KG' in cell.upper():
                # Extract weight class - look for pattern like "44 KG" or "65+ KG" or "65+KG"
                # Handle special case: "13 & Under 44 KG" should extract "44"
                match = re.search(r'(\d+\+?)\s*KG', cell, re.IGNORECASE)
                if match:
                    weight = match.group(1)
                    weight_classes.append(weight)
                else:
                    weight_classes.append(None)
            else:
                weight_classes.append(None)
        return weight_classes
    
    def _parse_lift_rows(self, three_rows: List[List[str]], weight_classes: List[str]) -> Dict[str, int]:
        """
        Parse three rows (value, name, date) for a lift type.
        Returns dict of {weight_class: value}
        """
        if len(three_rows) < 3:
            return {}
        
        value_row = three_rows[0]
        result = {}
        
        for idx, weight_class in enumerate(weight_classes):
            if weight_class and idx + 1 < len(value_row):
                value_str = value_row[idx + 1].strip()
                if value_str:
                    try:
                        value = int(float(value_str))
                        result[weight_class] = value
                    except ValueError:
                        pass
        
        return result
    
    def upsert_records(self, records: List[Dict[str, Any]]) -> None:
        """Upsert records to Supabase (same as other scrapers)."""
        for record in records:
            # Query for existing record
            existing = self.supabase_client.table("wso_records").select("*").match({
                "wso": record["wso"],
                "age_category": record["age_category"],
                "gender": record["gender"],
                "weight_class": record["weight_class"]
            }).execute()
            
            if existing.data and len(existing.data) > 0:
                # Record exists - check if update needed
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
                # Insert new record
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
        """Send Slack notification (same as other scrapers)."""
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
        print(f"Found {len(records)} records")
        
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
            for rec in to_insert[:5]:  # Show first 5
                print(f"  - {rec['age_category']} {rec['gender']} {rec['weight_class']}")
            if len(to_insert) > 5:
                print(f"  ... and {len(to_insert) - 5} more")
        
        if to_update:
            print(f"\n🔄 Updated records ({len(to_update)}):")
            for item in to_update[:5]:  # Show first 5
                rec = item['record']
                print(f"  - {rec['age_category']} {rec['gender']} {rec['weight_class']}")
                for change in item['changes']:
                    print(f"    {change}")
            if len(to_update) > 5:
                print(f"  ... and {len(to_update) - 5} more")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="WSO Records Scraper (TN-KY Format)")
    parser.add_argument("--wso", required=True, help="WSO name (should be 'Tennessee-Kentucky')")
    parser.add_argument("--sheet-url", required=True, help="Google Sheet URL")
    parser.add_argument("--dry-run", action="store_true", help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    scraper = WSORecordsTNKYScraper(args.wso, args.sheet_url)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
