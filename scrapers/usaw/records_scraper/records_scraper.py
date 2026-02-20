#!/usr/bin/env python3
"""
Records Scraper for USA Weightlifting American Records

This scraper:
1. Downloads and parses the American Records PDF
2. Extracts records for each age category, gender, and weight class
3. Exports to CSV
4. Upserts to Supabase
5. Sends Discord notifications

USAGE:
  # Dry-run (preview changes without updating database)
  source venv/bin/activate && python records_scraper.py --dry-run
  
  # Full run (update database)
  source venv/bin/activate && python records_scraper.py
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
from bs4 import BeautifulSoup

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)

# Load environment variables
load_dotenv()


class RecordsScraper:
    """Scraper for USA Weightlifting American Records."""
    
    def __init__(self):
        """Initialize the scraper."""
        self.base_url = "https://www.usaweightlifting.org/american-records"
        self.pdf_url: Optional[str] = None
        self.supabase: Optional[Client] = None
        self.slack_webhook_url: Optional[str] = None
    
    def find_records_pdf_url(self) -> Optional[str]:
        """
        Scrape the American Records page to find the PDF link.
        
        Looks for a link where:
        - The header text contains "American Records" but NOT "Former" or "Prior"
        - The button/link text is "View"
        
        Returns:
            URL of the records PDF, or None if not found
        """
        print(f"Fetching page: {self.base_url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        try:
            response = requests.get(self.base_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Debug: Print all "View" links found
            view_links = [link for link in soup.find_all('a', href=True) if link.get_text(strip=True).lower().startswith('view')]
            print(f"  Found {len(view_links)} link(s) with text starting with 'View'")
            
            # Find all links
            links = soup.find_all('a', href=True)
            
            for link in links:
                href = link.get('href', '')
                link_text = link.get_text(strip=True)
                
                # Check if link text starts with "View" (case insensitive)
                # It might be "View" or "View, opens in a new tab" etc.
                if not link_text.lower().startswith('view'):
                    continue
                
                # Check if href points to a PDF
                if not (href.lower().endswith('.pdf') or '.pdf' in href.lower()):
                    # Not a direct PDF link, might need to follow
                    pass
                
                # Look for parent or sibling elements that contain the header
                # Check parent elements for header text
                parent = link.parent
                header_found = False
                header_text = ""
                
                # Check up to 5 levels up for header text
                for level in range(5):
                    if parent:
                        parent_text = parent.get_text()
                        # Check if header contains "American Records"
                        if 'American Records' in parent_text:
                            # Check if it does NOT contain "Former" or "Prior"
                            if 'Former' not in parent_text and 'Prior' not in parent_text:
                                header_found = True
                                header_text = parent_text
                                break
                        parent = parent.parent
                
                # Also check previous siblings
                if not header_found:
                    sibling = link.find_previous_sibling()
                    for _ in range(3):
                        if sibling:
                            sibling_text = sibling.get_text()
                            if 'American Records' in sibling_text:
                                if 'Former' not in sibling_text and 'Prior' not in sibling_text:
                                    header_found = True
                                    header_text = sibling_text
                                    break
                            sibling = sibling.find_previous_sibling()
                
                if header_found:
                    # Handle relative URLs
                    if href.startswith('http'):
                        pdf_url = href
                    elif href.startswith('/'):
                        pdf_url = f"https://www.usaweightlifting.org{href}"
                    else:
                        pdf_url = f"https://www.usaweightlifting.org/{href}"
                    
                    print(f"✓ Found records PDF: {pdf_url}")
                    print(f"  Header context: {header_text[:100]}...")
                    return pdf_url
            
            # If no PDF found with "View" text, try finding PDFs directly
            print("  Trying alternative method: searching for PDF links...")
            pdf_links = soup.find_all('a', href=True)
            for link in pdf_links:
                href = link.get('href', '')
                if '.pdf' in href.lower() or href.lower().endswith('.pdf'):
                    # Check surrounding text
                    parent_text = ""
                    parent = link.parent
                    for _ in range(3):
                        if parent:
                            parent_text += " " + parent.get_text()
                            parent = parent.parent
                    
                    if 'American Records' in parent_text:
                        if 'Former' not in parent_text and 'Prior' not in parent_text:
                            if href.startswith('http'):
                                pdf_url = href
                            elif href.startswith('/'):
                                pdf_url = f"https://www.usaweightlifting.org{href}"
                            else:
                                pdf_url = f"https://www.usaweightlifting.org/{href}"
                            
                            print(f"✓ Found records PDF (alternative method): {pdf_url}")
                            return pdf_url
            
            print("✗ No records PDF link found")
            return None
            
        except requests.exceptions.RequestException as e:
            print(f"✗ Error fetching page: {e}")
            return None
    
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
    
    def kg_to_number(self, kg_string: Optional[str]) -> int:
        """Convert kg string to number."""
        if not kg_string:
            return 0
        try:
            return int(float(str(kg_string).replace('kg', '')))
        except (ValueError, TypeError):
            return 0
    
    def format_weight_class(self, weight_class: str) -> Optional[str]:
        """
        Convert weight class format to match database format.
        Handles formats like: '48', '$>86$', '109kg+', '+109kg'
        Output format: '48kg', '110+kg' (not '+110kg')
        """
        if not weight_class:
            return None
        
        weight_str = str(weight_class).strip()
        
        # Remove $ signs and other formatting
        weight_str = weight_str.replace('$', '').strip()
        
        # Handle > notation (e.g., ">86" or "$>86$")
        if '>' in weight_str:
            match = re.search(r'(\d+)', weight_str)
            if match:
                return match.group(1) + '+kg'
        
        # Handle + notation (e.g., "86+", "+86", "109kg+")
        if '+' in weight_str:
            # Remove existing kg if present
            weight_str = weight_str.replace('kg', '').strip()
            match = re.search(r'(\d+)', weight_str)
            if match:
                # Format as "110+kg" (plus sign after number)
                return match.group(1) + '+kg'
        
        # Remove existing kg if present
        weight_str = weight_str.replace('kg', '').strip()
        
        # Check if it's a valid number
        if weight_str.isdigit():
            return weight_str + 'kg'
        
        return None
    
    def normalize_age_category(self, age_group_code: str, gender: str) -> Optional[str]:
        """
        Normalize age group code from PDF to database format (lowercase).
        
        Age group codes from PDF:
        - UNI -> university
        - OPEN -> senior
        - JUNIOR or JR -> junior
        - U13 -> u13
        - U15 -> u15
        - U17 -> u17
        - M35, M40, etc. -> Masters 35, Masters 40, etc.
        - W35, W40, etc. -> Masters 35, Masters 40, etc.
        """
        age_group_code = str(age_group_code).strip().upper()
        
        if age_group_code == "UNI":
            return "university"
        elif age_group_code == "OPEN":
            return "senior"
        elif age_group_code == "JUNIOR" or age_group_code == "JR":
            return "junior"
        elif age_group_code == "U13":
            return "u13"
        elif age_group_code == "U15":
            return "u15"
        elif age_group_code == "U17":
            return "u17"
        elif age_group_code.startswith('M') and age_group_code[1:].isdigit():
            # Masters men: M35 -> "Masters 35"
            age = age_group_code[1:]
            return f"Masters {age}"
        elif age_group_code.startswith('W') and age_group_code[1:].isdigit():
            # Masters women: W35 -> "Masters 35"
            age = age_group_code[1:]
            return f"Masters {age}"
        else:
            # Unknown age groups
            return None
    
    def normalize_gender(self, gender: str) -> Optional[str]:
        """Normalize gender to lowercase."""
        gender = str(gender).strip().upper()
        if gender == "M":
            return "men"
        elif gender == "F":
            return "women"
        return None
    
    def extract_records_from_pdf(self) -> List[Dict[str, Any]]:
        """
        Extract weightlifting records from PDF table format.
        
        Returns:
            List of record dictionaries with keys: record_type, age_category, gender, 
            weight_class, snatch_record, cj_record, total_record
        """
        print("Extracting records from PDF...")
        records_dict = {}  # Key: (age_category, gender, weight_class)
        age_groups_found = set()  # Track all age groups encountered
        age_groups_skipped = set()  # Track skipped age groups
        
        try:
            response = requests.get(self.pdf_url, timeout=30)
            response.raise_for_status()
            pdf_content = io.BytesIO(response.content)
        except requests.exceptions.RequestException as e:
            print(f"Error downloading PDF: {e}")
            return []
        
        with pdfplumber.open(pdf_content) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"  Processing page {page_num}/{len(pdf.pages)}...")
                
                # Extract tables
                tables = page.extract_tables()
                
                if not tables:
                    continue
                
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    
                    # Skip header row if present
                    start_idx = 0
                    if table[0] and len(table[0]) > 0:
                        first_cell = str(table[0][0] or "").strip().upper()
                        if first_cell in ["AGEGROUP", "AGE GROUP", "AGE"]:
                            start_idx = 1
                    
                    # Process data rows
                    for row in table[start_idx:]:
                        if not row or len(row) < 5:
                            continue
                        
                        # Extract columns
                        age_group_code = str(row[0] or "").strip() if len(row) > 0 else ""
                        gender = str(row[1] or "").strip() if len(row) > 1 else ""
                        bodyweight = str(row[2] or "").strip() if len(row) > 2 else ""
                        lift = str(row[3] or "").strip() if len(row) > 3 else ""
                        record_value = str(row[4] or "").strip() if len(row) > 4 else ""
                        
                        # Skip empty rows or header rows
                        if not age_group_code or not gender or not bodyweight:
                            continue
                        
                        # Skip header row text
                        if age_group_code.upper() == "AGEGROUP":
                            continue
                        
                        # Track all age groups found
                        age_groups_found.add(age_group_code)
                        
                        # Normalize age category and gender
                        age_category = self.normalize_age_category(age_group_code, gender)
                        normalized_gender = self.normalize_gender(gender)
                        
                        if not age_category:
                            if age_group_code not in age_groups_skipped:
                                age_groups_skipped.add(age_group_code)
                                print(f"  ⚠ Skipping unknown age group: {age_group_code}")
                            continue
                        
                        if not normalized_gender:
                            print(f"  ⚠ Skipping unknown gender: {gender}")
                            continue
                        
                        # Format weight class
                        weight_class = self.format_weight_class(bodyweight)
                        if not weight_class:
                            continue
                        
                        # Parse record value (skip if "Standard" or empty)
                        if record_value.upper() == "STANDARD" or not record_value:
                            continue
                        
                        try:
                            record_weight = int(float(record_value))
                        except (ValueError, TypeError):
                            continue
                        
                        # Create key for this record
                        key = (age_category, normalized_gender, weight_class)
                        
                        # Initialize record if not exists
                        if key not in records_dict:
                            records_dict[key] = {
                                'record_type': 'USAW',
                                'age_category': age_category,
                                'gender': normalized_gender,
                                'weight_class': weight_class,
                                'snatch_record': 0,
                                'cj_record': 0,
                                'total_record': 0
                            }
                        
                        # Update lift value based on lift type
                        lift_upper = lift.upper()
                        if 'SNATCH' in lift_upper:
                            records_dict[key]['snatch_record'] = record_weight
                        elif 'CLEAN' in lift_upper and 'JERK' in lift_upper:
                            records_dict[key]['cj_record'] = record_weight
                        elif 'TOTAL' in lift_upper:
                            records_dict[key]['total_record'] = record_weight
        
        # Convert dict to list
        records = list(records_dict.values())
        
        # Print summary of age groups
        print(f"\nAge Groups Summary:")
        print(f"  Found age groups: {sorted(age_groups_found)}")
        if age_groups_skipped:
            print(f"  Skipped age groups: {sorted(age_groups_skipped)}")
        
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
    
    def export_to_csv(self, records: List[Dict[str, Any]], filename: str = "records.csv"):
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
        title = "🇺🇸 USA Weightlifting Records Update (DRY RUN)" if is_dry_run else "🇺🇸 USA Weightlifting Records Update"
        
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
        print("USA Weightlifting Records Scraper")
        print("="*60 + "\n")
        
        # Find PDF URL
        pdf_url = self.find_records_pdf_url()
        if not pdf_url:
            print("✗ Could not find records PDF URL. Exiting.")
            return
        
        self.pdf_url = pdf_url
        
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
        description='Scrape USA Weightlifting records and update Supabase'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without updating database'
    )
    
    args = parser.parse_args()
    
    scraper = RecordsScraper()
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
