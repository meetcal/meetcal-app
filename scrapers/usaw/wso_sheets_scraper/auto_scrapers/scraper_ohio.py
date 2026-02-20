#!/usr/bin/env python3
"""
WSO Records Scraper

Scrapes weightlifting records from Google Sheets and upserts to Supabase.
Sends Discord notifications for changes.
"""

import os
import sys
import json
import argparse
import re
from typing import List, Dict, Any, Tuple
from datetime import datetime

import gspread
from google.oauth2.service_account import Credentials
import requests
from supabase import create_client, Client


class WSORecordsScraper:
    """Scraper for WSO weightlifting records."""
    
    def __init__(self, wso_name: str, sheet_url: str):
        """Initialize the scraper with WSO name and sheet URL."""
        self.wso_name = wso_name
        self.sheet_url = sheet_url
        self.changes = {"inserted": [], "updated": []}
        
        # Initialize clients
        self.google_client = None
        self.supabase_client = None
        self.slack_webhook_url = None
        
    def setup_google_client(self):
        """Set up Google Sheets client with service account or anonymous access."""
        service_account_json = os.getenv("GOOGLE_SERVICE_ACCOUNT_JSON")
        
        if service_account_json:
            # Use service account if provided
            service_account_info = json.loads(service_account_json)
            scopes = [
                "https://www.googleapis.com/auth/spreadsheets.readonly",
                "https://www.googleapis.com/auth/drive.readonly"
            ]
            credentials = Credentials.from_service_account_info(
                service_account_info, scopes=scopes
            )
            self.google_client = gspread.authorize(credentials)
            self.use_public_api = False
            print("✓ Google Sheets client initialized (authenticated)")
        else:
            # Use public API for public sheets
            self.google_client = None
            self.use_public_api = True
            print("✓ Using public Google Sheets API (no authentication)")
    
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
    
    def scrape_sheet(self) -> List[Dict[str, Any]]:
        """
        Scrape data from Google Sheet.
        
        Returns:
            List of records with structure:
            {
                'wso': str,
                'age_category': str,
                'gender': str,
                'weight_class': str,
                'snatch_record': float or None,
                'cj_record': float or None,
                'total_record': float or None
            }
        """
        # Extract sheet ID from URL
        sheet_id = self.sheet_url.split('/d/')[1].split('/')[0]
        
        if self.use_public_api:
            # Use public API via direct HTTP requests
            return self._scrape_sheet_public(sheet_id)
        else:
            # Use authenticated gspread client
            return self._scrape_sheet_authenticated(sheet_id)
    
    def _scrape_sheet_authenticated(self, sheet_id: str) -> List[Dict[str, Any]]:
        """Scrape using authenticated gspread client."""
        # Open the spreadsheet
        spreadsheet = self.google_client.open_by_key(sheet_id)
        
        # Get all worksheets (tabs)
        worksheets = spreadsheet.worksheets()
        
        all_records = []
        
        # Tab names typically follow pattern: "Youth Women", "Youth Men", etc.
        # Parse each tab
        for worksheet in worksheets:
            tab_name = worksheet.title
            print(f"  Processing tab: {tab_name}")
            
            # Parse age category and gender from tab name
            age_category, gender = self._parse_tab_name(tab_name)
            if not age_category or not gender:
                continue
            
            # Get worksheet data
            all_values = worksheet.get_all_values()
            
            # Parse the tab data
            records = self._parse_tab_data(all_values, age_category, gender)
            all_records.extend(records)
            print(f"    Found {len(records)} records")
        
        return all_records
    
    def _scrape_sheet_public(self, sheet_id: str) -> List[Dict[str, Any]]:
        """Scrape using public Google Sheets API."""
        # Get sheet metadata to find all tabs
        meta_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/edit#gid=0"
        
        # For now, we'll try common tab names
        # Public API access requires knowing the sheet names ahead of time
        tab_names = [
            "Youth Women", "Youth Men",
            "Junior Women", "Junior Men",
            "Senior Women", "Senior Men",
            "Masters Women", "Masters Men"
        ]
        
        all_records = []
        
        for tab_name in tab_names:
            print(f"  Trying tab: {tab_name}")
            
            # Parse age category and gender from tab name
            age_category, gender = self._parse_tab_name(tab_name)
            if not age_category or not gender:
                continue
            
            # Fetch data from public API
            try:
                # Use CSV export for public sheets
                csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={tab_name}"
                response = requests.get(csv_url)
                
                if response.status_code == 200:
                    # Parse CSV data
                    import csv
                    import io
                    csv_data = csv.reader(io.StringIO(response.text))
                    all_values = list(csv_data)
                    
                    # Parse the tab data
                    records = self._parse_tab_data(all_values, age_category, gender)
                    all_records.extend(records)
                    print(f"    Found {len(records)} records")
                else:
                    print(f"    Tab not found or not accessible")
            except Exception as e:
                print(f"    Error fetching tab: {e}")
        
        return all_records
    
    def _parse_tab_name(self, tab_name: str) -> Tuple[str, str]:
        """Parse age category and gender from tab name."""
        # Examples: "Youth Women", "Youth Men", "Junior Women", "Masters Men"
        if "Youth" in tab_name:
            age_category = "Youth"
        elif "Junior" in tab_name:
            age_category = "Junior"
        elif "Senior" in tab_name:
            age_category = "Senior"
        elif "Masters" in tab_name:
            age_category = "Masters"
        else:
            print(f"    Skipping unknown tab: {tab_name}")
            return None, None
        
        if "Women" in tab_name:
            gender = "Women"
        elif "Men" in tab_name:
            gender = "Men"
        else:
            print(f"    Skipping tab with unknown gender: {tab_name}")
            return None, None
        
        return age_category, gender
    
    def _parse_tab_data(self, all_values: List[List[str]], age_category: str, gender: str) -> List[Dict[str, Any]]:
        """
        Parse worksheet tab data.
        
        Args:
            all_values: 2D list of cell values from worksheet
            age_category: Age category (e.g., "Youth", "Junior", "Senior")
            gender: Gender (e.g., "Women")
        
        Returns:
            List of parsed records
        """
        
        records = []
        seen_combinations = set()  # Track age_subdivision + weight_class to avoid duplicates
        
        # For Junior and Senior, use the category name directly since they don't have subdivisions
        if age_category in ["Junior", "Senior"]:
            current_age_subdivision = age_category
        else:
            current_age_subdivision = None
        current_weight_class = None
        current_snatch = None
        current_cj = None
        current_total = None
        
        def save_current_record():
            """Helper to save the current record if complete."""
            if current_weight_class and current_age_subdivision:
                # Create a unique key to check for duplicates
                unique_key = (current_age_subdivision, current_weight_class)
                
                # Only save if we haven't seen this combination before
                if unique_key not in seen_combinations:
                    records.append({
                        'wso': self.wso_name,
                        'age_category': current_age_subdivision,
                        'gender': gender,
                        'weight_class': current_weight_class,
                        'snatch_record': current_snatch,
                        'cj_record': current_cj,
                        'total_record': current_total
                    })
                    seen_combinations.add(unique_key)
        
        def parse_age_subdivision(text: str) -> str:
            """Convert age subdivision text to standard format."""
            text = text.strip()
            
            # Handle "13 and Under" -> U13
            if "and under" in text.lower():
                age = text.split()[0]
                return f"U{age}"
            
            # For Masters categories, handle "35-39", "35 - 39" -> "Masters 35"
            if age_category == "Masters":
                # Handle "35-39" or "35 - 39" -> Masters 35 (use lower bound)
                if "-" in text:
                    parts = text.split("-")
                    if len(parts) == 2:
                        lower_age = parts[0].strip()
                        return f"Masters {lower_age}"
                if " - " in text:
                    parts = text.split(" - ")
                    if len(parts) == 2:
                        lower_age = parts[0].strip()
                        return f"Masters {lower_age}"
            else:
                # For Youth/Junior categories, handle "14-15" -> U15 (use upper bound)
                if "-" in text:
                    parts = text.split("-")
                    if len(parts) == 2:
                        upper_age = parts[1].strip()
                        return f"U{upper_age}"
                
                # Handle "14 - 15" -> U15 (with spaces)
                if " - " in text:
                    parts = text.split(" - ")
                    if len(parts) == 2:
                        upper_age = parts[1].strip()
                        return f"U{upper_age}"
            
            # Handle "Total" or other generic categories
            if text.lower() == "total":
                return "Total"
            
            # Return as-is if we can't parse it
            return text
        
        # Process all rows starting from row 0 to catch everything
        for i, row in enumerate(all_values):
            if not row or len(row) == 0:
                continue
            
            first_col = row[0].strip() if len(row) > 0 else ""
            second_col = row[1].strip() if len(row) > 1 else ""
            
            if not first_col:
                continue
            
            # Handle special case: first row with merged header
            # Examples: "Ohio WSO... Lift 13 and Under 36 kg" or "... Lift 35 - 39 48 kg"
            if i == 0 and "lift" in first_col.lower():
                # Try to extract age subdivision and weight class from first row
                
                # Check for "X and under" pattern
                if "and under" in first_col.lower():
                    parts = first_col.lower().split("and under")
                    if len(parts) >= 1:
                        words = parts[0].strip().split()
                        for word in reversed(words):
                            if word.isdigit():
                                current_age_subdivision = f"U{word}"
                                break
                
                # Check for age range patterns like "35 - 39" or "14-15"
                age_range_match = re.search(r'(\d+)\s*-\s*(\d+)', first_col)
                if age_range_match:
                    lower_age = age_range_match.group(1)
                    upper_age = age_range_match.group(2)
                    
                    # Determine if it's Masters (35+) or Youth
                    if int(lower_age) >= 35:
                        # Masters - use lower bound
                        current_age_subdivision = f"Masters {lower_age}"
                    else:
                        # Youth/Junior - use upper bound
                        current_age_subdivision = f"U{upper_age}"
                
                # Extract weight class if present (number before "kg")
                if "kg" in first_col.lower():
                    kg_match = re.search(r'(\d+)\s*kg', first_col.lower())
                    if kg_match:
                        weight_num = kg_match.group(1)
                        current_weight_class = weight_num  # Store without " kg" to match database
                
                continue
            
            # Skip obvious header rows
            if first_col.lower() in ["lift", "athlete", "team", "weight", "date", "meet", "location"]:
                continue
            
            # Check if this is a lift row (Snatch, Clean & Jerk, or Total)
            if first_col.lower() in ["snatch", "clean & jerk", "clean and jerk", "c&j", "total"]:
                # Extract weight value from column D (index 3)
                weight_value = None
                if len(row) > 3 and row[3].strip():
                    try:
                        # Convert to int (weights are always whole numbers in kg)
                        weight_value = int(float(row[3].strip()))
                    except ValueError:
                        pass
                
                # Store the lift value
                lift_type = first_col.lower()
                if lift_type == "snatch":
                    current_snatch = weight_value
                elif lift_type in ["clean & jerk", "clean and jerk", "c&j"]:
                    current_cj = weight_value
                elif lift_type == "total":
                    current_total = weight_value
                    # After total, save the record
                    save_current_record()
                    # Reset for next weight class
                    current_weight_class = None
                    current_snatch = None
                    current_cj = None
                    current_total = None
            
            # Check if this is a weight class row
            elif "kg" in first_col.lower():
                # Save previous record if exists
                save_current_record()
                
                # Start new weight class (remove " kg" suffix to match database format)
                current_weight_class = first_col.replace(" kg", "").replace("kg", "").strip()
                current_snatch = None
                current_cj = None
                current_total = None
            
            # Check if this is an age subdivision row (text in col A, empty col B)
            elif not second_col:
                # This is likely an age subdivision
                # Parse and normalize the age subdivision
                parsed = parse_age_subdivision(first_col)
                # Only update if it looks like a valid age category
                if parsed and parsed != first_col:
                    current_age_subdivision = parsed
                    current_weight_class = None
        
        # Don't forget the last record
        save_current_record()
        
        return records
    
    def upsert_records(self, records: List[Dict[str, Any]]) -> None:
        """
        Upsert records to Supabase.
        
        Tracks changes (inserts vs updates) in self.changes.
        
        Args:
            records: List of records to upsert
        """
        for record in records:
            # Query for existing record with same unique key
            existing = self.supabase_client.table("wso_records").select("*").match({
                "wso": record["wso"],
                "age_category": record["age_category"],
                "gender": record["gender"],
                "weight_class": record["weight_class"]
            }).execute()
            
            if existing.data and len(existing.data) > 0:
                # Record exists - check if update is needed
                existing_record = existing.data[0]
                record_id = existing_record["id"]
                
                # Compare values to see what changed
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
                    # Update the record
                    self.supabase_client.table("wso_records").update(record).eq("id", record_id).execute()
                    
                    # Track the update
                    self.changes["updated"].append({
                        "wso": record["wso"],
                        "age_category": record["age_category"],
                        "gender": record["gender"],
                        "weight_class": record["weight_class"],
                        "changes": changes
                    })
                    print(f"  ✓ Updated: {record['age_category']} {record['gender']} {record['weight_class']}")
            else:
                # Record doesn't exist - insert it
                self.supabase_client.table("wso_records").insert(record).execute()
                
                # Track the insertion
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
        """Send Slack notification with change summary."""
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
    
    def run(self) -> None:
        """Main execution flow."""
        print(f"Starting scraper for {self.wso_name}")
        print(f"Sheet URL: {self.sheet_url}")
        
        # Setup clients
        self.setup_google_client()
        self.setup_supabase_client()
        self.setup_slack()
        
        # Scrape data
        print("Scraping Google Sheet...")
        records = self.scrape_sheet()
        print(f"Found {len(records)} records")
        
        # Upsert to database
        print("Upserting records to Supabase...")
        self.upsert_records(records)
        
        # Send notification
        print("Sending Slack notification...")
        self.send_slack_notification()
        
        print("Done!")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="WSO Records Scraper")
    parser.add_argument("--wso", required=True, help="WSO name (e.g., 'Ohio')")
    parser.add_argument("--sheet-url", required=True, help="Google Sheet URL")
    
    args = parser.parse_args()
    
    scraper = WSORecordsScraper(args.wso, args.sheet_url)
    scraper.run()


if __name__ == "__main__":
    main()

