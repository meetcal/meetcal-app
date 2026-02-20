#!/usr/bin/env python3
"""
USAMW Masters Records Scraper

USAGE:
  # Dry-run (preview changes without updating database)
  source venv/bin/activate && python masters_records.py --dry-run
  
  # Full run (update database)
  source venv/bin/activate && python masters_records.py
"""

import os
import sys
import argparse
import csv
import io
import re
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv
import pdfplumber

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)

# Load environment variables
load_dotenv()


class USAMWMastersRecordsScraper:
    """Scraper for USAMW Masters Records."""
    
    def __init__(self, pdf_url: str):
        """Initialize the scraper."""
        self.pdf_url = pdf_url
        self.supabase: Optional[Client] = None
        self.slack_webhook_url: Optional[str] = None
    
    def setup_supabase_client(self):
        """Initialize Supabase client."""
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env")
        
        self.supabase = create_client(supabase_url, supabase_key)
        print("✓ Supabase client initialized")
    
    def setup_slack(self):
        """Initialize Slack webhook."""
        self.slack_webhook_url = os.getenv("SLACK_RECORDS_WEBHOOK_URL")
        if self.slack_webhook_url:
            print("✓ Slack webhook configured")
    
    def format_weight_class(self, weight_class: str) -> Optional[str]:
        """
        Convert weight class format to match database format.
        Input: '60', '110+' or similar
        Output: '60kg', '110+kg'
        """
        if not weight_class:
            return None
        
        weight_str = str(weight_class).strip()
        
        # Remove $ signs and other formatting
        weight_str = weight_str.replace('$', '').strip()
        
        # Handle + notation (e.g., "110+")
        if '+' in weight_str:
            weight_str = weight_str.replace('kg', '').strip()
            match = re.search(r'(\d+)', weight_str)
            if match:
                return match.group(1) + '+kg'
        
        # Remove existing kg if present
        weight_str = weight_str.replace('kg', '').strip()
        
        # Check if it's a valid number
        if weight_str.isdigit():
            return weight_str + 'kg'
        
        return None
    
    def normalize_age_category(self, age_group_text: str, gender: str) -> Optional[str]:
        """
        Normalize age group from PDF to database format.
        
        Examples from PDF:
        - "M 35 - 39" -> "Masters 35"
        - "M 40-44" -> "Masters 40"
        - "M 90+" -> "Masters 90"
        - "W 35-39" -> "Masters 35"
        - etc.
        """
        age_group_text = str(age_group_text).strip()
        
        # Match pattern like "M 35 - 39" or "W 40-44" (with optional spaces around hyphen)
        match = re.match(r'[MW]\s*(\d+)\s*-\s*\d+', age_group_text)
        if match:
            age = match.group(1)
            return f"Masters {age}"
        
        # Match pattern like "M 90+" or "W 90+"
        match = re.match(r'[MW]\s*(\d+)\+', age_group_text)
        if match:
            age = match.group(1)
            return f"Masters {age}"
        
        return None
    
    def normalize_gender(self, text: str) -> Optional[str]:
        """
        Determine gender from text.
        
        In the PDF, the gender is usually in the section header like:
        "USA National Masters Men M 35-39"
        """
        text_upper = str(text).upper()
        if 'MEN' in text_upper and 'WOMEN' not in text_upper:
            return "men"
        elif 'WOMEN' in text_upper:
            return "women"
        return None
    
    def extract_records_from_pdf(self) -> List[Dict[str, Any]]:
        """
        Extract USAMW masters records from PDF table format.
        
        Returns:
            List of record dictionaries with keys: record_type, age_category, gender, 
            weight_class, snatch_record, cj_record, total_record
        """
        print("Extracting USAMW masters records from PDF...")
        records_dict = {}  # Key: (age_category, gender, weight_class)
        
        try:
            response = requests.get(self.pdf_url, timeout=30)
            response.raise_for_status()
            pdf_content = io.BytesIO(response.content)
        except requests.exceptions.RequestException as e:
            print(f"Error downloading PDF: {e}")
            return []
        
        current_gender = None
        current_age_group = None

        age_categories_by_page_sets = {
            12: [
                "Masters 35",
                "Masters 40",
                "Masters 45",
                "Masters 50",
                "Masters 55",
                "Masters 60",
                "Masters 65",
                "Masters 70",
                "Masters 75",
                "Masters 80",
                "Masters 85",
                "Masters 90",
            ],
            11: [
                "Masters 35",
                "Masters 40",
                "Masters 45",
                "Masters 50",
                "Masters 55",
                "Masters 60",
                "Masters 65",
                "Masters 70",
                "Masters 75",
                "Masters 80",
                "Masters 85",
            ],
        }
        
        with pdfplumber.open(pdf_content) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"  Processing page {page_num}/{len(pdf.pages)}...")
                
                # Extract text to find section headers
                text = page.extract_text()
                lines = text.split('\n') if text else []
                
                # Look for section headers like "USA National Masters Men M 35-39"
                page_age_group = None
                for line in lines[:10]:  # Check first 10 lines of each page
                    gender = self.normalize_gender(line)
                    if gender:
                        current_gender = gender
                    
                    age_cat = self.normalize_age_category(line, current_gender or "")
                    if age_cat:
                        page_age_group = age_cat
                        print(f"    Found section: {page_age_group} {current_gender}")

                page_age_categories = age_categories_by_page_sets.get(len(pdf.pages))
                if not page_age_group and page_age_categories:
                    page_age_group = page_age_categories[page_num - 1]
                    print(f"    Using page-based age category: {page_age_group} {current_gender}")

                if page_age_group:
                    current_age_group = page_age_group

                # Parse rows from text lines (new format)
                line_records_found = 0
                for line in lines:
                    if not line:
                        continue
                    if line.startswith("USA National Masters"):
                        continue
                    if line.startswith("December"):
                        continue
                    if line.startswith("Cat Lift Record"):
                        continue

                    match = re.match(
                        r'^(?P<cat>\d+\+?)\s+(?P<lift>SNA|SNATCH|CnJ|C&J|TOT|TOTAL)\s+(?P<record>\d+)\b',
                        line,
                        re.IGNORECASE
                    )
                    if not match:
                        continue

                    weight_class = self.format_weight_class(match.group('cat'))
                    if not weight_class:
                        continue

                    # Must have current gender and age group
                    if not current_gender or not current_age_group:
                        continue

                    try:
                        record_weight = int(float(match.group('record')))
                    except (ValueError, TypeError):
                        continue

                    key = (current_age_group, current_gender, weight_class)
                    if key not in records_dict:
                        records_dict[key] = {
                            'record_type': 'USAMW',
                            'age_category': current_age_group,
                            'gender': current_gender,
                            'weight_class': weight_class,
                            'snatch_record': 0,
                            'cj_record': 0,
                            'total_record': 0
                        }

                    lift_upper = match.group('lift').upper()
                    if 'SNA' in lift_upper or 'SNATCH' in lift_upper:
                        records_dict[key]['snatch_record'] = record_weight
                    elif 'CNJ' in lift_upper or 'C&J' in lift_upper or 'CLEAN' in lift_upper:
                        records_dict[key]['cj_record'] = record_weight
                    elif 'TOT' in lift_upper or 'TOTAL' in lift_upper:
                        records_dict[key]['total_record'] = record_weight

                    line_records_found += 1

                if line_records_found > 0:
                    continue

                # Fallback to table extraction (old format)
                tables = page.extract_tables(table_settings={
                    'vertical_strategy': 'text',
                    'horizontal_strategy': 'text',
                })
                
                if not tables:
                    continue
                
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    
                    # Process data rows
                    for row in table:
                        if not row or len(row) < 3:
                            continue
                        
                        # Expected columns: Cat | Lift | Record | Family Name | Given Name | Team | Date | Site | ...
                        # Note: Columns might be split, so we take first 3 which are most reliable
                        cat = str(row[0] or "").strip()
                        lift = str(row[1] or "").strip()
                        record_value = str(row[2] or "").strip()
                        
                        # Skip header rows
                        if cat.upper() == "CAT" or lift.upper() == "LIFT":
                            continue
                        
                        # Skip empty rows
                        if not cat or not lift or not record_value:
                            continue
                        
                        # Parse weight class from Cat column
                        weight_class_match = re.search(r'(\d+\+?)', cat)
                        if not weight_class_match:
                            continue
                        
                        weight_class_raw = weight_class_match.group(1)
                        weight_class = self.format_weight_class(weight_class_raw)
                        
                        if not weight_class:
                            continue
                        
                        # Must have current gender and age group
                        if not current_gender or not current_age_group:
                            continue
                        
                        # Parse record value
                        try:
                            record_weight = int(float(record_value))
                        except (ValueError, TypeError):
                            continue
                        
                        # Create key for this record
                        key = (current_age_group, current_gender, weight_class)
                        
                        # Initialize record if not exists
                        if key not in records_dict:
                            records_dict[key] = {
                                'record_type': 'USAMW',
                                'age_category': current_age_group,
                                'gender': current_gender,
                                'weight_class': weight_class,
                                'snatch_record': 0,
                                'cj_record': 0,
                                'total_record': 0
                            }
                        
                        # Update lift value based on lift type
                        lift_upper = lift.upper()
                        if 'SNA' in lift_upper or 'SNATCH' in lift_upper:
                            records_dict[key]['snatch_record'] = record_weight
                        elif 'CNJ' in lift_upper or 'C&J' in lift_upper or 'CLEAN' in lift_upper:
                            records_dict[key]['cj_record'] = record_weight
                        elif 'TOT' in lift_upper or 'TOTAL' in lift_upper:
                            records_dict[key]['total_record'] = record_weight
        
        # Convert dict to list
        records = list(records_dict.values())
        
        # Count records by age category
        age_category_counts = {}
        for record in records:
            age_cat = record['age_category']
            age_category_counts[age_cat] = age_category_counts.get(age_cat, 0) + 1
        
        print(f"\nRecords by Age Category:")
        for age_cat, count in sorted(age_category_counts.items()):
            print(f"  {age_cat}: {count} records")
        
        print(f"\n✓ Extracted {len(records)} total records")
        return records
    
    def export_to_csv(self, records: List[Dict[str, Any]], filename: str = "usamw_masters_records.csv"):
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
        
        print(f"✓ Exported {len(records)} records to {filename}")
    
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
                    print(f"  ✓ Updated: {record['age_category']} {record['gender']} {record['weight_class']}")
            else:
                # Insert new record
                self.supabase.table('records').insert(record).execute()
                inserted.append(record)
                print(f"  ✓ Inserted: {record['age_category']} {record['gender']} {record['weight_class']}")
        
        return {'inserted': inserted, 'updated': updated}
    
    def send_slack_notification(self, inserted: List[Dict[str, Any]], updated: List[Dict[str, Any]], is_dry_run: bool = False):
        """Send Slack notification with upsert summary."""
        if not self.slack_webhook_url:
            print("⚠ Slack webhook not configured, skipping notification")
            return
        
        # Build message
        title = "🏋️ USAMW Masters Records Update (DRY RUN)" if is_dry_run else "🏋️ USAMW Masters Records Update"
        
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
                f"• {r['age_category']} {r['gender']} {r['weight_class']} "
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
                f"• {r['age_category']} {r['gender']} {r['weight_class']}"
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
            print("✓ Slack notification sent")
        except requests.exceptions.RequestException as e:
            print(f"⚠ Failed to send Slack notification: {e}")
    
    def run(self, dry_run: bool = False):
        """Main execution method."""
        print("="*60)
        print("USAMW Masters Records Scraper")
        print("="*60 + "\n")
        
        # Extract records
        records = self.extract_records_from_pdf()
        
        if not records:
            print("✗ No records extracted from PDF. Exiting.")
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
            print(f"\n✓ Complete: {len(result['inserted'])} inserted, {len(result['updated'])} updated")
            
            # Send Slack notification
            self.send_slack_notification(result['inserted'], result['updated'])


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Scrape USAMW Masters records and update Supabase'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without updating database'
    )
    parser.add_argument(
        '--pdf-url',
        type=str,
        default="https://storage.googleapis.com/production-ipower-v1-0-4/354/1018354/vixoE8Rk/f65c21bd9e714f2489f72387176e8f79?fileName=NM20251214-WOMEN.pdf",
        help='URL of the USAMW Masters Records PDF'
    )
    
    args = parser.parse_args()
    
    scraper = USAMWMastersRecordsScraper(args.pdf_url)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
