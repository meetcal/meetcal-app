#!/usr/bin/env python3
"""
WSO Records Scraper - Florida Format

For Florida WSO which uses a side-by-side layout with:
- Men's records on the left columns
- Women's records on the right columns  
- Each weight class has 3 rows: Snatch, C&J, Total
- Separate tabs for each age group (U13, U15, U17, Junior, Senior, Masters 35-90+)
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
from convex import ConvexClient

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from utils import wso_record_ingest_args
from dotenv import load_dotenv

# Load environment variables
load_dotenv()


class WSORecordsFloridaScraper:
    """Scraper for Florida WSO weightlifting records with side-by-side layout."""
    
    def __init__(self, wso_name: str, sheet_url: str):
        """Initialize the scraper with WSO name and sheet URL."""
        self.wso_name = wso_name
        self.sheet_url = sheet_url
        self.changes = {"inserted": [], "updated": []}
        
        # Tab configuration (gid mapping)
        # Florida has separate tabs for each age group
        self.tabs = {
            "U13": "490899077",  # U13 Youth State Records
            "U15": "1300164988",  # U15 Youth - need to find GID
            "U17": "1950298087",  # U17 Youth - need to find GID
            "Junior": "660284224",  # Junior - need to find GID
            "Senior": "662417948",  # Senior - need to find GID
            "Masters 35": "1222085467",  # 35 Master - need to find GID
            "Masters 40": "1267986954",  # 40 Master - need to find GID
            "Masters 45": "411054882",  # 45 Master - need to find GID
            "Masters 50": "1758139651",  # 50 Master - need to find GID
            "Masters 55": "1041309770",  # 55 Master - need to find GID
            "Masters 60": "1879007867",  # 60 Master - need to find GID
            "Masters 65": "1005330611",  # 65 Master - need to find GID
            "Masters 70": "1193133330",  # 70 Master - need to find GID
            "Masters 75": "373452428",  # 75 Master - need to find GID
            "Masters 80": "851164639",  # 80 Master - need to find GID
            "Masters 85": "1894058438",  # 85 Master - need to find GID
            "Masters 90": "575067900",  # 90+ Master - need to find GID
        }
        
        self.convex_client = None
        self.scraper_secret = None
        self.slack_webhook_url = None
        
    def setup_convex_client(self):
        """Set up Convex client."""
        self.convex_client = ConvexClient(os.getenv("CONVEX_URL"))
        self.scraper_secret = os.getenv("SCRAPER_SECRET")
        print("✓ Convex client initialized")
    
    def setup_slack(self):
        """Set up Slack webhook URL."""
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
        if not self.slack_webhook_url:
            raise ValueError("SLACK_WEBHOOK_URL environment variable not set")
        print("✓ Slack webhook configured")
    
    def _map_age_category(self, tab_name: str) -> str:
        """Map tab name to age category.
        
        For Florida, each tab is already a specific age group,
        so we just return the tab name directly.
        """
        return tab_name
    
    def scrape_sheet(self) -> List[Dict[str, Any]]:
        """
        Scrape all tabs from Florida sheet.
        
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
        
        return all_records
    
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
        Parse side-by-side layout where Men are on left, Women are on right.
        
        Format:
        Row: [weight_class, "Snatch", value, athlete, club, date, location, "", 
              weight_class, "Snatch", value, athlete, club, date, location]
        
        For Florida, each tab is a single age group (no sections within tabs).
        """
        records = []
        age_category = self._map_age_category(tab_name)
        
        # Track last weight classes for handling + categories
        last_men_weight = None
        last_women_weight = None
        
        i = 0
        while i < len(rows):
            row = rows[i]
            
            # Skip empty rows
            if not row or len(row) < 10:
                i += 1
                continue
            
            # Check if this is a weight class row (has lift type in column 1 or 7)
            men_lift = row[1].strip() if len(row) > 1 else ""
            women_lift = row[7].strip() if len(row) > 7 else ""
            
            # If we have a "Snatch" in either position, this starts a weight class
            if men_lift == "Snatch" or women_lift == "Snatch":
                # Parse men's side (columns 0-5)
                men_record = self._parse_side(row, 0, "Men", age_category, i, rows, last_men_weight)
                if men_record:
                    records.append(men_record)
                    # Update last weight class if it's not a + category
                    if not men_record['weight_class'].endswith('+'):
                        last_men_weight = men_record['weight_class']
                
                # Parse women's side (columns 6-11)
                women_record = self._parse_side(row, 6, "Women", age_category, i, rows, last_women_weight)
                if women_record:
                    records.append(women_record)
                    # Update last weight class if it's not a + category
                    if not women_record['weight_class'].endswith('+'):
                        last_women_weight = women_record['weight_class']
            
            i += 1
        
        return records
    
    def _parse_side(self, start_row: List[str], col_offset: int, gender: str, 
                   base_age: str, row_idx: int, all_rows: List[List[str]], 
                   last_weight: Optional[str] = None) -> Optional[Dict[str, Any]]:
        """
        Parse one side (Men or Women) of the layout.
        
        Columns (offset by col_offset):
        0: weight_class
        1: "Snatch"
        2: value
        3: athlete
        4: club
        5: date
        6: location
        """
        # Get weight class from first column
        weight_class = start_row[col_offset].strip() if len(start_row) > col_offset else ""
        
        # If weight class is empty but we have a last weight, this is the + category
        if not weight_class or weight_class == "":
            if last_weight:
                weight_class = last_weight + "+"
            else:
                return None
        
        # Determine age category (refine based on weight class for Youth)
        age_category = self._determine_age_category(base_age, weight_class, row_idx, all_rows)
        
        # Get Snatch value
        snatch_val = start_row[col_offset + 2].strip() if len(start_row) > col_offset + 2 else ""
        snatch = self._parse_int(snatch_val)
        
        # Get C&J value (next row)
        cj = None
        total = None
        
        if row_idx + 1 < len(all_rows):
            cj_row = all_rows[row_idx + 1]
            cj_val = cj_row[col_offset + 2].strip() if len(cj_row) > col_offset + 2 else ""
            cj = self._parse_int(cj_val)
        
        # Get Total value (row after C&J)
        if row_idx + 2 < len(all_rows):
            total_row = all_rows[row_idx + 2]
            total_val = total_row[col_offset + 2].strip() if len(total_row) > col_offset + 2 else ""
            total = self._parse_int(total_val)
        
        return {
            'wso': self.wso_name,
            'age_category': age_category,
            'gender': gender,
            'weight_class': weight_class,
            'snatch_record': snatch,
            'cj_record': cj,
            'total_record': total
        }
    
    def _determine_age_category(self, base_age: str, weight_class: str, 
                                row_idx: int, all_rows: List[List[str]]) -> str:
        """
        Determine specific age category.
        
        For Youth tab, need to distinguish U13 vs U17 based on position in sheet.
        For Masters, need to extract age group from context.
        """
        if base_age == "Youth":
            # Youth tab has two sections: 13 & Under and 14-17
            # Check section headers in previous rows
            for i in range(max(0, row_idx - 10), row_idx):
                if i < len(all_rows):
                    row = all_rows[i]
                    row_text = " ".join(row).upper()
                    if "13" in row_text and "UNDER" in row_text:
                        return "U13"
                    elif "14-17" in row_text or "14 - 17" in row_text:
                        return "U17"
            
            # Default based on typical weight class ranges
            # U13: lighter weights (36-65 for women, 40-65+ for men)
            # U17: heavier weights (40-77+ for women, 48-94+ for men)
            try:
                weight_num = int(weight_class.replace("+", ""))
                if weight_num <= 65:
                    return "U13"
                else:
                    return "U17"
            except:
                return "U13"  # Default
        
        elif base_age == "Masters":
            # Look for age group in nearby rows
            for i in range(max(0, row_idx - 5), row_idx):
                if i < len(all_rows):
                    row = all_rows[i]
                    row_text = " ".join(row)
                    # Look for patterns like "35-39", "40-44", etc.
                    match = re.search(r'(\d{2})\s*-\s*(\d{2})', row_text)
                    if match:
                        lower_age = match.group(1)
                        return f"Masters {lower_age}"
            return "Masters 35"  # Default
        
        return base_age
    
    def _parse_int(self, value: str) -> Optional[int]:
        """Parse integer value, return None if invalid or 0."""
        if not value or value == "":
            return None
        try:
            parsed = int(float(value))
            # Convert 0 to None (Florida uses 0 for empty records)
            return None if parsed == 0 else parsed
        except ValueError:
            return None
    
    def upsert_records(self, records: List[Dict[str, Any]]) -> None:
        """Upsert records to Convex."""
        for record in records:
            self.convex_client.action("scraperIngestion:ingestWSORecord", wso_record_ingest_args(record, self.scraper_secret))
            print(f"  ✓ Upserted: {record['age_category']} {record['gender']} {record['weight_class']}")
    
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
        
        self.setup_convex_client()

        if not dry_run:
            self.setup_slack()
        else:
            print("🧪 DRY RUN MODE - No Slack operations")
        
        print("Scraping Google Sheet...")
        records = self.scrape_sheet()
        print(f"Found {len(records)} total records")
        
        if not dry_run:
            print("Upserting records to Convex...")
            self.upsert_records(records)
            
            print("Sending Slack notification...")
            self.send_slack_notification()
        
        print("Done!")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="WSO Records Scraper (Florida Format)")
    parser.add_argument("--wso", required=True, help="WSO name (should be 'Florida')")
    parser.add_argument("--sheet-url", required=True, help="Google Sheet URL")
    parser.add_argument("--dry-run", action="store_true", help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    scraper = WSORecordsFloridaScraper(args.wso, args.sheet_url)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
