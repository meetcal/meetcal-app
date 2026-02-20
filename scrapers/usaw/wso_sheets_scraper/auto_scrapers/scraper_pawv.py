#!/usr/bin/env python3
"""
WSO Records Scraper for Pennsylvania-West Virginia

PA/WV format characteristics:
- Published HTML sheets (pubhtml) instead of regular spreadsheet view
- Separate tabs for each gender + age category combination
  * Youth Men, Youth Women
  * Junior Men, Junior Women  
  * Open Men, Open Women
  * Masters Men, Masters Women
- Vertical format with sections for each age subdivision
  * Youth: "Men's 13 Under Age Group", "Men's 14-15 Age Group", "Men's 16-17 Age Group"
  * Masters: "Women's Masters (35-39)", "Women's Masters (40-44)", etc.
- Each section has weight classes (40kg, 44kg, +65kg, etc.)
- Three rows per weight class: Snatch, Clean & Jerk, Total
- Columns: Lift, Name, Team, Weight, Date, Meet, Location
- Weight value is in the "Weight" column (not embedded in row label)
"""

import os
import sys
import csv
import argparse
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)


class WSORecordsPAWVScraper:
    """Scraper for Pennsylvania-West Virginia WSO records."""
    
    def __init__(self, wso_name: str, base_sheet_id: str):
        """
        Initialize scraper.
        
        Args:
            wso_name: Name of the WSO (should be "Pennsylvania-West Virginia")
            base_sheet_id: The published sheet ID (from pubhtml URL)
        """
        self.wso_name = wso_name
        self.base_sheet_id = base_sheet_id
        self.supabase: Optional[Client] = None
        self.slack_webhook_url: Optional[str] = None
        
        # Tab configuration: gender + base age category + GID
        # Format: (gender, base_age_category, gid)
        self.tabs = [
            ("Men", "Youth", "908123897"),      # Youth Men
            ("Women", "Youth", "1470799505"),   # Youth Women
            ("Men", "Junior", "1650165633"),    # Junior Men
            ("Women", "Junior", "80509707"),    # Junior Women
            ("Men", "Senior", "1381991871"),    # Open Men
            ("Women", "Senior", "1545069771"),  # Open Women
            ("Men", "Masters", "14757518"),     # Masters Men
            ("Women", "Masters", "846901037"),  # Masters Women
        ]
    
    def setup_supabase_client(self):
        """Initialize Supabase client."""
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set")
        
        self.supabase = create_client(supabase_url, supabase_key)
        print("✓ Supabase client initialized")
    
    def setup_slack(self):
        """Initialize Slack webhook."""
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
        if self.slack_webhook_url:
            print("✓ Slack webhook configured")
    
    def fetch_csv_data(self, gid: str) -> str:
        """
        Fetch CSV data for a specific tab.
        
        Args:
            gid: The tab GID
            
        Returns:
            CSV content as string
        """
        # Published sheets use a different URL format
        csv_url = f"https://docs.google.com/spreadsheets/d/e/{self.base_sheet_id}/pub?gid={gid}&single=true&output=csv"
        
        response = requests.get(csv_url, timeout=30)
        response.raise_for_status()
        return response.text
    
    def _normalize_age_category(self, section_header: str, base_age: str) -> Optional[str]:
        """
        Parse section header to get age category.
        
        Examples:
        - "Men's 13 Under Age Group" -> "U13"
        - "Men's 14-15 Age Group" -> "U15"
        - "Men's 16-17 Age Group" -> "U17"
        - "Women's Masters (35-39)" -> "Masters 35"
        - "Women's Masters (40-44)" -> "Masters 40"
        
        For Junior/Senior tabs, there's no subdivision - just return the base age.
        """
        header = section_header.strip()
        
        # Youth subdivisions
        if "13" in header and "Under" in header:
            return "U13"
        elif "14-15" in header or "14 - 15" in header:
            return "U15"
        elif "16-17" in header or "16 - 17" in header:
            return "U17"
        
        # Masters subdivisions
        if "Masters" in header:
            # Extract age range: (35-39) -> Masters 35
            import re
            match = re.search(r'\((\d+)-\d+\)', header)
            if match:
                lower_age = match.group(1)
                return f"Masters {lower_age}"
        
        # Junior/Senior have no subdivisions
        if base_age in ["Junior", "Senior"]:
            return base_age
        
        return None
    
    def _normalize_weight_class(self, weight_str: str) -> Optional[str]:
        """
        Normalize weight class format.
        
        Examples:
        - "40kg" -> "40"
        - "+65kg" -> "65+"
        - "65+" -> "65+"
        """
        import re
        
        weight_str = weight_str.strip()
        
        # Handle "+Xkg" format
        if weight_str.startswith("+"):
            match = re.search(r'\+(\d+)', weight_str)
            if match:
                return match.group(1) + "+"
        
        # Handle "Xkg" format
        match = re.search(r'(\d+)', weight_str)
        if match:
            return match.group(1)
        
        return None
    
    def _parse_int(self, value: str) -> Optional[int]:
        """Parse integer value, return None if invalid."""
        if not value or value.strip() == "" or value.strip().upper() == "STANDARD":
            return None
        try:
            return int(float(value.strip()))
        except (ValueError, AttributeError):
            return None
    
    def scrape_tab(self, gender: str, base_age_category: str, gid: str) -> List[Dict[str, Any]]:
        """
        Scrape a single tab.
        
        Args:
            gender: "Men" or "Women"
            base_age_category: "Youth", "Junior", "Senior", or "Masters"
            gid: Tab GID
            
        Returns:
            List of record dictionaries
        """
        csv_text = self.fetch_csv_data(gid)
        lines = csv_text.strip().split('\n')
        reader = csv.reader(lines)
        rows = list(reader)
        
        records = []
        current_age_category = None
        current_weight_class = None
        current_snatch = None
        current_cj = None
        current_total = None
        
        # For Junior/Senior tabs, there's no age subdivision - just use base category
        if base_age_category in ["Junior", "Senior"]:
            current_age_category = base_age_category
        
        for i, row in enumerate(rows):
            if not row or len(row) < 4:
                continue
            
            # Check if this is an age group header
            # Format: "Men's 13 Under Age Group" or "Women's Masters (35-39)"
            # or "Junior Men's" / "Open Women's"
            first_col = row[0].strip()
            
            # For Youth/Masters, look for specific section headers
            if ("Age Group" in first_col or "Masters" in first_col) and \
               (gender in first_col or "Men's" in first_col or "Women's" in first_col):
                # This is a section header
                age_cat = self._normalize_age_category(first_col, base_age_category)
                if age_cat:
                    current_age_category = age_cat
                    # Reset weight class tracking
                    current_weight_class = None
                    current_snatch = None
                    current_cj = None
                    current_total = None
                continue
            
            # For Junior/Senior, check for simple "Junior Men's" or "Open Women's" header
            if base_age_category in ["Junior", "Senior"] and \
               (f"{base_age_category} {gender}" in first_col or 
                f"Open {gender}" in first_col or
                f"{gender}'s" in first_col):
                # This is just a label, age_category is already set
                continue
            
            # Check if this is a weight class header (e.g., "40kg", "+65kg")
            if first_col.endswith("kg") or (first_col.startswith("+") and "kg" in first_col):
                # Save previous weight class if complete
                if current_weight_class and current_age_category:
                    record = {
                        'wso': self.wso_name,
                        'age_category': current_age_category,
                        'gender': gender,
                        'weight_class': current_weight_class,
                        'snatch_record': current_snatch,
                        'cj_record': current_cj,
                        'total_record': current_total
                    }
                    records.append(record)
                
                # Start new weight class
                weight_class = self._normalize_weight_class(first_col)
                if weight_class:
                    current_weight_class = weight_class
                    current_snatch = None
                    current_cj = None
                    current_total = None
                continue
            
            # Check if this is a lift row (Snatch, Clean & Jerk, Total)
            lift_type = first_col
            if lift_type in ["Snatch", "Clean & Jerk", "Total"]:
                # Extract weight value from column 3 (index 3)
                weight_val = row[3].strip() if len(row) > 3 else ""
                parsed_weight = self._parse_int(weight_val)
                
                if lift_type == "Snatch":
                    current_snatch = parsed_weight
                elif lift_type == "Clean & Jerk":
                    current_cj = parsed_weight
                elif lift_type == "Total":
                    current_total = parsed_weight
        
        # Save last weight class if present
        if current_weight_class and current_age_category:
            record = {
                'wso': self.wso_name,
                'age_category': current_age_category,
                'gender': gender,
                'weight_class': current_weight_class,
                'snatch_record': current_snatch,
                'cj_record': current_cj,
                'total_record': current_total
            }
            records.append(record)
        
        return records
    
    def scrape_all_tabs(self) -> List[Dict[str, Any]]:
        """Scrape all tabs and return combined records."""
        all_records = []
        
        for gender, base_age, gid in self.tabs:
            print(f"  Scraping {gender} {base_age} (gid={gid})...")
            tab_records = self.scrape_tab(gender, base_age, gid)
            all_records.extend(tab_records)
            print(f"    Found {len(tab_records)} records")
        
        return all_records
    
    def upsert_to_supabase(self, records: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        Upsert records to Supabase.
        
        Returns:
            Dictionary with 'inserted' and 'updated' lists
        """
        if not self.supabase:
            raise ValueError("Supabase client not initialized")
        
        inserted = []
        updated = []
        
        for record in records:
            # Check if record exists
            existing = self.supabase.table('wso_records').select('*').eq(
                'wso', record['wso']
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
                for field in ['snatch_record', 'cj_record', 'total_record']:
                    if db_record.get(field) != record.get(field):
                        changed = True
                        break
                
                if changed:
                    self.supabase.table('wso_records').update(record).eq('id', record_id).execute()
                    updated.append(record)
                    print(f"  ✓ Updated: {record['age_category']} {record['gender']} {record['weight_class']}")
            else:
                # Insert new record
                self.supabase.table('wso_records').insert(record).execute()
                inserted.append(record)
                print(f"  ✓ Inserted: {record['age_category']} {record['gender']} {record['weight_class']}")
        
        return {'inserted': inserted, 'updated': updated}
    
    def send_slack_notification(self, inserted: List[Dict[str, Any]], updated: List[Dict[str, Any]]):
        """Send Slack notification with upsert summary."""
        if not self.slack_webhook_url:
            print("⚠ Slack webhook not configured, skipping notification")
            return
        
        # Build message for Slack (not Discord embeds)
        total_changes = len(inserted) + len(updated)
        
        if total_changes == 0:
            message = f"📊 *{self.wso_name} WSO Records - No Changes*\n\nScraper ran successfully. No new records or updates."
            payload = {"text": message}
        else:
            message = f"📊 *{self.wso_name} WSO Records Update*\n\n*Summary:*\n• {len(inserted)} new record(s) inserted\n• {len(updated)} record(s) updated"
            
            # Inserted records
            if inserted:
                message += "\n\n🆕 *New Records*\n"
                for record in inserted[:10]:
                    lifts = []
                    if record.get("snatch_record"):
                        lifts.append(f"Snatch: {record['snatch_record']}kg")
                    if record.get("cj_record"):
                        lifts.append(f"C&J: {record['cj_record']}kg")
                    if record.get("total_record"):
                        lifts.append(f"Total: {record['total_record']}kg")
                    
                    lifts_str = ", ".join(lifts) if lifts else "No records"
                    message += f"• *{record['age_category']}* | {record['gender']} | {record['weight_class']}\n  {lifts_str}\n"
                
                if len(inserted) > 10:
                    message += f"_...and {len(inserted) - 10} more_\n"
            
            # Updated records
            if updated:
                message += "\n📝 *Updated Records*\n"
                for record in updated[:10]:
                    message += f"• *{record['age_category']}* | {record['gender']} | {record['weight_class']}\n"
                
                if len(updated) > 10:
                    message += f"_...and {len(updated) - 10} more_\n"
            
            payload = {"text": message}
        
        response = requests.post(self.slack_webhook_url, json=payload, timeout=10)
        response.raise_for_status()
        print("✓ Slack notification sent")
    
    def dry_run_compare(self, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Compare scraped records with database without making changes.
        
        Returns:
            Dictionary with comparison results
        """
        if not self.supabase:
            raise ValueError("Supabase client not initialized")
        
        to_insert = []
        to_update = []
        unchanged = []
        
        for record in records:
            existing = self.supabase.table('wso_records').select('*').eq(
                'wso', record['wso']
            ).eq(
                'age_category', record['age_category']
            ).eq(
                'gender', record['gender']
            ).eq(
                'weight_class', record['weight_class']
            ).execute()
            
            if existing.data:
                db_record = existing.data[0]
                
                # Check for changes
                changed = False
                changes = []
                for field in ['snatch_record', 'cj_record', 'total_record']:
                    db_val = db_record.get(field)
                    new_val = record.get(field)
                    if db_val != new_val:
                        changed = True
                        changes.append((field, db_val, new_val))
                
                if changed:
                    to_update.append({
                        'record': record,
                        'changes': changes
                    })
                else:
                    unchanged.append(record)
            else:
                to_insert.append(record)
        
        return {
            'to_insert': to_insert,
            'to_update': to_update,
            'unchanged': unchanged
        }
    
    def run(self, dry_run: bool = False):
        """
        Main execution method.
        
        Args:
            dry_run: If True, compare with DB but don't make changes
        """
        print(f"Starting scraper for {self.wso_name}")
        print(f"Base sheet ID: {self.base_sheet_id}")
        
        # Setup
        self.setup_supabase_client()
        if not dry_run:
            self.setup_slack()
        
        # Scrape
        print("Scraping Google Sheets...")
        records = self.scrape_all_tabs()
        print(f"Found {len(records)} total records")
        
        if dry_run:
            # Dry run mode
            print("\n" + "="*80)
            print("DRY RUN MODE - Comparing with database")
            print("="*80)
            
            comparison = self.dry_run_compare(records)
            
            print(f"\nTo INSERT: {len(comparison['to_insert'])} records")
            print(f"To UPDATE: {len(comparison['to_update'])} records")
            print(f"Unchanged: {len(comparison['unchanged'])} records")
            
            if comparison['to_insert']:
                print("\n--- Records to INSERT ---")
                for rec in comparison['to_insert'][:20]:  # Show first 20
                    print(f"  {rec['age_category']:15} | {rec['gender']:6} | {rec['weight_class']:5} | "
                          f"Snatch: {str(rec.get('snatch_record') or '-'):4} | "
                          f"C&J: {str(rec.get('cj_record') or '-'):4} | "
                          f"Total: {str(rec.get('total_record') or '-'):4}")
                if len(comparison['to_insert']) > 20:
                    print(f"  ... and {len(comparison['to_insert']) - 20} more")
            
            if comparison['to_update']:
                print("\n--- Records to UPDATE ---")
                for item in comparison['to_update']:
                    rec = item['record']
                    print(f"  {rec['age_category']:15} | {rec['gender']:6} | {rec['weight_class']:5}")
                    for field, old_val, new_val in item['changes']:
                        print(f"    → {field}: {old_val} → {new_val}")
        else:
            # Real upsert
            print("Upserting records to Supabase...")
            result = self.upsert_to_supabase(records)
            
            print("Sending Slack notification...")
            self.send_slack_notification(result['inserted'], result['updated'])
            
            print("Done!")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(description="WSO Records Scraper (PA/WV Format)")
    parser.add_argument("--wso", required=True, help="WSO name (should be 'Pennsylvania-West Virginia')")
    parser.add_argument("--sheet-id", required=True, help="Published sheet ID (from pubhtml URL)")
    parser.add_argument("--dry-run", action="store_true", help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    # Load environment variables
    load_dotenv()
    
    scraper = WSORecordsPAWVScraper(args.wso, args.sheet_id)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()

