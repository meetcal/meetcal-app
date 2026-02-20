#!/usr/bin/env python3
"""
WSO Records Scraper - Flat Format

For WSOs that use flat CSV format (Georgia, DMV, Pacific Northwest)
where each row represents a single lift record.
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


class WSORecordsFlatScraper:
    """Scraper for WSO weightlifting records in flat CSV format."""
    
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
    
    def _normalize_age_group(self, age_group: str) -> str:
        """
        Normalize age group to match Ohio convention.
        
        Conversions:
        - JR, JR ADAP -> Junior, Junior ADAP
        - Open, Open ADAP, OPEN -> Senior, Senior ADAP
        - M35, W35 -> Masters 35 (M/W prefix removed, gender is separate)
        - M40 ADAP -> Masters 40 ADAP
        - U11, U13, U15, U17 -> keep as is
        """
        age_group = age_group.strip()
        age_group_upper = age_group.upper()
        
        # Handle JR -> Junior (case-insensitive)
        if age_group_upper.startswith('JR'):
            return age_group.replace('JR', 'Junior', 1).replace('jr', 'Junior', 1)
        
        # Handle Open/OPEN -> Senior (case-insensitive)
        if age_group_upper.startswith('OPEN'):
            # Preserve suffix (e.g., " ADAP") if present
            import re
            match = re.match(r'^(open)(.*)$', age_group, re.IGNORECASE)
            if match:
                suffix = match.group(2)
                return f"Senior{suffix}"
        
        # Handle M35, M40, W35, W40, etc. -> Masters 35, Masters 40
        # Pattern: M/W followed by digits
        import re
        match = re.match(r'^[MW](\d+)(.*)$', age_group, re.IGNORECASE)
        if match:
            age_num = match.group(1)
            suffix = match.group(2)  # e.g., " ADAP"
            return f"Masters {age_num}{suffix}"
        
        # Return as-is for U11, U13, U15, U17, etc.
        return age_group
    
    def scrape_sheet(self) -> List[Dict[str, Any]]:
        """
        Scrape data from Google Sheet in flat CSV format.
        
        Returns:
            List of records with structure:
            {
                'wso': str,
                'age_category': str,
                'gender': str,
                'weight_class': str,
                'snatch_record': int or None,
                'cj_record': int or None,
                'total_record': int or None
            }
        """
        # Extract sheet ID from URL
        sheet_id = self.sheet_url.split('/d/')[1].split('/')[0]
        
        # Try to get sheet name from URL or use default
        if 'gid=' in self.sheet_url:
            # For now, we'll use "Current Records" as default
            sheet_name = "Current Records"
        else:
            sheet_name = "Current Records"
        
        # Fetch CSV data
        csv_url = f"https://docs.google.com/spreadsheets/d/{sheet_id}/gviz/tq?tqx=out:csv&sheet={sheet_name}"
        response = requests.get(csv_url)
        
        if response.status_code != 200:
            raise Exception(f"Failed to fetch sheet: {response.status_code}")
        
        # Parse CSV
        import csv
        import io
        csv_data = csv.DictReader(io.StringIO(response.text))
        
        # Group records by age_category + gender + weight_class
        grouped = defaultdict(lambda: {'snatch': None, 'cj': None, 'total': None})
        
        for row in csv_data:
            # Extract fields
            age_group_raw = row.get('ageGroup', '').strip()
            gender_raw = row.get('gender', '').strip()
            weight_min = row.get('bodyWeightMin', '').strip()
            weight_max = row.get('bodyWeightMax', '').strip()
            lift_type = row.get('lift', '').strip()
            record_value = row.get('record', '').strip()
            
            # Skip empty rows
            if not age_group_raw or not gender_raw:
                continue
            
            # Convert gender: F -> Women, M -> Men
            gender = "Women" if gender_raw == "F" else "Men" if gender_raw == "M" else None
            if not gender:
                continue
            
            # Normalize age group to match Ohio convention
            age_group = self._normalize_age_group(age_group_raw)
            
            # Skip ADAP (adaptive) records
            if 'ADAP' in age_group:
                continue
            
            # Determine weight class:
            # If bodyWeightMax is empty but bodyWeightMin has a value, it means ">X" (e.g., >63)
            # Otherwise use bodyWeightMax
            if not weight_max and weight_min:
                # Empty max means "greater than min" -> use min with + suffix
                weight_class = weight_min + "+"
            elif weight_max:
                # Use max value, replace > with + suffix
                weight_class = weight_max.replace(">", "") + "+" if ">" in weight_max else weight_max
            else:
                # Both empty - skip this record
                continue
            
            # Parse record value
            record_int = None
            if record_value:
                try:
                    record_int = int(float(record_value))
                except ValueError:
                    pass
            
            # Create unique key
            key = (age_group, gender, weight_class)
            
            # Store the lift value (case-insensitive matching)
            lift_type_lower = lift_type.lower()
            if lift_type_lower == "snatch":
                grouped[key]['snatch'] = record_int
            elif lift_type_lower in ["clean & jerk", "clean and jerk", "c&j", "cleanjerk"]:
                grouped[key]['cj'] = record_int
            elif lift_type_lower == "total":
                grouped[key]['total'] = record_int
        
        # Convert grouped data to list of records
        records = []
        for (age_cat, gender, weight_class), lifts in grouped.items():
            records.append({
                'wso': self.wso_name,
                'age_category': age_cat,
                'gender': gender,
                'weight_class': weight_class,
                'snatch_record': lifts['snatch'],
                'cj_record': lifts['cj'],
                'total_record': lifts['total']
            })
        
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
    parser = argparse.ArgumentParser(description="WSO Records Scraper (Flat Format)")
    parser.add_argument("--wso", required=True, help="WSO name (e.g., 'Georgia', 'DMV', 'Pacific Northwest')")
    parser.add_argument("--sheet-url", required=True, help="Google Sheet URL")
    
    args = parser.parse_args()
    
    scraper = WSORecordsFlatScraper(args.wso, args.sheet_url)
    scraper.run()


if __name__ == "__main__":
    main()

