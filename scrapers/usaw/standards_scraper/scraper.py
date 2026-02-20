#!/usr/bin/env python3
"""
Standards Scraper for USA Weightlifting

This scraper:
1. Fetches the selection procedures page
2. Finds the PDF link containing "Standards"
3. Downloads and parses the PDF
4. Extracts A/B standards for each age category, gender, and weight class
5. Upserts to Supabase

USAGE:
  # Dry-run (preview changes without updating database)
  source venv/bin/activate && python scraper.py --dry-run
  
  # Full run (update database)
  source venv/bin/activate && python scraper.py
"""

import os
import sys
import argparse
import re
import requests
from io import BytesIO
from typing import List, Dict, Any, Optional, Tuple
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


class StandardsScraper:
    """Scraper for USA Weightlifting standards PDF."""
    
    def __init__(self):
        """Initialize the scraper."""
        self.base_url = "https://www.usaweightlifting.org/resources/athlete-information-and-programs/selection-procedures"
        self.supabase: Optional[Client] = None
        self.pdf_url: Optional[str] = None
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
        self.slack_webhook_url = os.getenv("SLACK_STANDARDS_WEBHOOK_URL")
        if self.slack_webhook_url:
            print("✓ Slack webhook configured")
    
    def find_standards_pdf_url(self) -> Optional[str]:
        """
        Scrape the selection procedures page to find the PDF link containing 'Standards'.
        
        Returns:
            URL of the standards PDF, or None if not found
        """
        print(f"Fetching page: {self.base_url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        try:
            response = requests.get(self.base_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            # Find all links
            links = soup.find_all('a', href=True)
            
            # First pass: look for PDF links with "Standards" in text or href
            pdf_candidates = []
            for link in links:
                href = link.get('href', '')
                link_text = link.get_text(strip=True)
                
                # Check if it's a PDF link
                is_pdf = href.lower().endswith('.pdf') or '.pdf' in href.lower()
                
                # Check if link text or href contains "Standards" (case insensitive)
                has_standards = 'standards' in link_text.lower() or 'standards' in href.lower()
                
                if has_standards:
                    # Handle relative URLs
                    if href.startswith('http'):
                        pdf_url = href
                    elif href.startswith('/'):
                        pdf_url = f"https://www.usaweightlifting.org{href}"
                    else:
                        pdf_url = f"https://www.usaweightlifting.org/{href}"
                    
                    # Prioritize PDF links
                    if is_pdf:
                        print(f"✓ Found standards PDF: {pdf_url}")
                        return pdf_url
                    else:
                        pdf_candidates.append(pdf_url)
            
            # If we found non-PDF links with "Standards", return the first one
            if pdf_candidates:
                print(f"✓ Found standards link (may need to follow redirect): {pdf_candidates[0]}")
                return pdf_candidates[0]
            
            print("✗ No standards PDF link found")
            return None
            
        except requests.exceptions.RequestException as e:
            print(f"✗ Error fetching page: {e}")
            return None
    
    def download_pdf(self, url: str) -> BytesIO:
        """Download PDF from URL."""
        print(f"Downloading PDF from {url}...")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        response = requests.get(url, headers=headers, timeout=30)
        response.raise_for_status()
        
        print("✓ PDF downloaded")
        return BytesIO(response.content)
    
    def _parse_int(self, value: Any) -> Optional[int]:
        """Parse integer value, handling various formats."""
        if value is None:
            return None
        
        # Convert to string and clean
        value_str = str(value).strip()
        
        # Remove common non-numeric characters but keep + for weight classes
        value_str = value_str.replace('$', '').replace(',', '')
        
        # Handle empty strings
        if not value_str or value_str == '':
            return None
        
        try:
            return int(float(value_str))
        except (ValueError, TypeError):
            return None
    
    def _normalize_weight_class(self, weight_str: str) -> Optional[str]:
        """
        Normalize weight class format to match database format.
        Format: "58kg", "+86kg", etc.
        """
        if not weight_str:
            return None
        
        weight_str = str(weight_str).strip()
        
        # Remove $ signs and other formatting
        weight_str = weight_str.replace('$', '').strip()
        
        # Remove existing "kg" if present
        weight_str = weight_str.replace('kg', '').strip()
        
        # Handle + notation (e.g., "86+", "+86", "$86+$")
        if '+' in weight_str:
            # Extract the number
            match = re.search(r'(\d+)', weight_str)
            if match:
                # Format as "+86kg" (plus sign at the beginning)
                return '+' + match.group(1) + 'kg'
            # Fallback: try to extract number and add + at beginning
            num_match = re.search(r'(\d+)', weight_str.replace('+', ''))
            if num_match:
                return '+' + num_match.group(1) + 'kg'
            return weight_str.replace('+', '') + '+kg'
        
        # Check if it's a valid number
        if weight_str.replace('.', '').isdigit():
            return weight_str + 'kg'
        
        return None
    
    def _parse_age_category_and_gender(self, header: str) -> Optional[Tuple[str, str]]:
        """
        Parse table header to extract age category and gender.
        Returns lowercase values to match database format.
        
        Examples:
        - "Senior Women's A Standards" -> ("senior", "women")
        - "Junior Men's B Standards" -> ("junior", "men")
        - "Youth Women's A Standards" -> ("youth", "women")
        - "U15 Men's Standards" -> ("u15", "men")
        """
        header = header.strip()
        
        # Extract gender (lowercase)
        if "Women" in header or "Women's" in header:
            gender = "women"
        elif "Men" in header or "Men's" in header:
            gender = "men"
        else:
            return None
        
        # Extract age category (lowercase)
        if "Senior" in header:
            return ("senior", gender)
        elif "Junior" in header:
            return ("junior", gender)
        elif "Youth" in header:
            return ("youth", gender)
        elif "U15" in header or "u15" in header:
            return ("u15", gender)
        
        return None
    
    def extract_standards_from_pdf(self, pdf_file: BytesIO) -> List[Dict[str, Any]]:
        """
        Extract standards data from PDF.
        
        PDF structure:
        - Row 1: "Senior Women's A Standards" header
        - Row 2: "Category" followed by weight classes (48, 53, 58, etc.)
        - Row 3: "Total" followed by standard values
        
        Returns:
            List of standard dictionaries with keys: age_category, gender, weight_class, standard_a, standard_b
        """
        print("Extracting data from PDF...")
        standards_dict = {}  # Use dict to combine A and B standards
        
        with pdfplumber.open(pdf_file) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"  Processing page {page_num}/{len(pdf.pages)}...")
                
                # Extract tables
                tables = page.extract_tables()
                
                if not tables:
                    continue
                
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    
                    # Process table row by row
                    current_age_category = None
                    current_gender = None
                    is_a_standard = False
                    is_b_standard = False
                    weight_classes = []
                    
                    for row_idx, row in enumerate(table):
                        if not row:
                            continue
                        
                        # Get first cell
                        first_cell = str(row[0] or "").strip()
                        
                        # Check if this is a section header (e.g., "Senior Women's A Standards")
                        if "Standards" in first_cell or "Standard" in first_cell:
                            parsed = self._parse_age_category_and_gender(first_cell)
                            if parsed:
                                current_age_category, current_gender = parsed
                                # Determine if A or B standard
                                is_a_standard = "A Standard" in first_cell or ("A" in first_cell and "B Standard" not in first_cell)
                                is_b_standard = "B Standard" in first_cell
                                # U15 doesn't have A/B, treat as A
                                if "U15" in first_cell:
                                    is_a_standard = True
                                    is_b_standard = False
                                weight_classes = []  # Reset weight classes for new section
                                print(f"    Found section: {current_age_category} {current_gender} {'A' if is_a_standard else 'B' if is_b_standard else ''} Standards")
                            continue
                        
                        # Check if this is the "Category" row (contains weight classes)
                        if first_cell.lower() in ['category', 'weight']:
                            if current_age_category and current_gender:
                                # Extract weight classes from remaining columns
                                weight_classes = []
                                for cell in row[1:]:
                                    weight_class = self._normalize_weight_class(str(cell or ""))
                                    if weight_class:
                                        weight_classes.append(weight_class)
                                continue
                        
                        # Check if this is the "Total" row (contains standard values)
                        if first_cell.lower() == 'total' and current_age_category and current_gender and weight_classes:
                            # Extract standard values from remaining columns
                            for idx, cell in enumerate(row[1:], 0):
                                if idx < len(weight_classes):
                                    total_value = self._parse_int(cell)
                                    if total_value is not None:
                                        weight_class = weight_classes[idx]
                                        
                                        # Create key for this standard
                                        key = (current_age_category, current_gender, weight_class)
                                        
                                        # Get or create standard record
                                        if key not in standards_dict:
                                            standards_dict[key] = {
                                                'age_category': current_age_category,
                                                'gender': current_gender,
                                                'weight_class': weight_class,
                                                'standard_a': 0,
                                                'standard_b': 0
                                            }
                                        
                                        # Update A or B standard
                                        if is_a_standard:
                                            standards_dict[key]['standard_a'] = total_value
                                        elif is_b_standard:
                                            standards_dict[key]['standard_b'] = total_value
                            
                            # Reset for next section
                            weight_classes = []
                            continue
        
        # Convert dict to list
        standards = list(standards_dict.values())
        print(f"✓ Extracted {len(standards)} standards")
        return standards
    
    def dry_run(self, standards: List[Dict[str, Any]]) -> Dict[str, Any]:
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
        
        for standard in standards:
            # Check if record exists
            existing = self.supabase.table('standards').select('*').eq(
                'age_category', standard['age_category']
            ).eq(
                'gender', standard['gender']
            ).eq(
                'weight_class', standard['weight_class']
            ).execute()
            
            if existing.data:
                # Record exists - check if update is needed
                db_record = existing.data[0]
                
                changed = False
                changes = {}
                
                if db_record.get('standard_a') != standard['standard_a']:
                    changed = True
                    changes['standard_a'] = {
                        'old': db_record.get('standard_a'),
                        'new': standard['standard_a']
                    }
                
                if db_record.get('standard_b') != standard['standard_b']:
                    changed = True
                    changes['standard_b'] = {
                        'old': db_record.get('standard_b'),
                        'new': standard['standard_b']
                    }
                
                if changed:
                    to_update.append({
                        'record': standard,
                        'changes': changes
                    })
                else:
                    unchanged.append(standard)
            else:
                # New record
                to_insert.append(standard)
        
        # Print summary
        print(f"Summary:")
        print(f"  New records to insert: {len(to_insert)}")
        print(f"  Records to update: {len(to_update)}")
        print(f"  Unchanged records: {len(unchanged)}")
        print(f"  Total records processed: {len(standards)}\n")
        
        # Print details
        if to_insert:
            print("Records to INSERT:")
            for record in to_insert[:10]:  # Show first 10
                print(f"  + {record['age_category']} {record['gender']} {record['weight_class']}: "
                      f"A={record['standard_a']}, B={record['standard_b']}")
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
            'total': len(standards)
        }
    
    def upsert_to_supabase(self, standards: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        Upsert standards to Supabase.
        
        Returns:
            Dictionary with 'inserted' and 'updated' lists
        """
        if not self.supabase:
            self.setup_supabase_client()
        
        inserted = []
        updated = []
        
        for standard in standards:
            # Check if record exists
            existing = self.supabase.table('standards').select('*').eq(
                'age_category', standard['age_category']
            ).eq(
                'gender', standard['gender']
            ).eq(
                'weight_class', standard['weight_class']
            ).execute()
            
            if existing.data:
                # Update existing record
                db_record = existing.data[0]
                record_id = db_record['id']
                
                # Check if any values changed
                changed = False
                if db_record.get('standard_a') != standard['standard_a']:
                    changed = True
                if db_record.get('standard_b') != standard['standard_b']:
                    changed = True
                
                if changed:
                    self.supabase.table('standards').update({
                        'standard_a': standard['standard_a'],
                        'standard_b': standard['standard_b']
                    }).eq('id', record_id).execute()
                    updated.append(standard)
                    print(f"  ✓ Updated: {standard['age_category']} {standard['gender']} {standard['weight_class']}")
            else:
                # Insert new record
                self.supabase.table('standards').insert(standard).execute()
                inserted.append(standard)
                print(f"  ✓ Inserted: {standard['age_category']} {standard['gender']} {standard['weight_class']}")
        
        return {'inserted': inserted, 'updated': updated}
    
    def send_slack_notification(self, inserted: List[Dict[str, Any]], updated: List[Dict[str, Any]], is_dry_run: bool = False):
        """Send Slack notification with upsert summary."""
        if not self.slack_webhook_url:
            print("⚠ Slack webhook not configured, skipping notification")
            return
        
        # Build message
        title = "USA Weightlifting Standards Update (DRY RUN)" if is_dry_run else "USA Weightlifting Standards Update"
        
        # Summary
        total_changes = len(inserted) + len(updated)
        if total_changes == 0:
            message = f"{title}\nNo changes detected" + (" (dry-run)" if is_dry_run else "")
        else:
            action = "would be " if is_dry_run else ""
            message = f"{title}\n*{len(inserted)}* new standards {action}added, *{len(updated)}* standards {action}updated".strip()
        
        # Inserted records
        if inserted:
            message += f"\n\n*New Standards ({len(inserted)}):*\n"
            inserted_text = "\n".join([
                f"• {r['age_category']} {r['gender']} {r['weight_class']} (A={r['standard_a']}, B={r['standard_b']})"
                for r in inserted[:10]  # Limit to first 10
            ])
            message += inserted_text
            if len(inserted) > 10:
                message += f"\n... and {len(inserted) - 10} more"
        
        # Updated records
        if updated:
            message += f"\n\n*Updated Standards ({len(updated)}):*\n"
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
        print("USA Weightlifting Standards Scraper")
        print("="*60 + "\n")
        
        # Find PDF URL
        pdf_url = self.find_standards_pdf_url()
        if not pdf_url:
            print("✗ Could not find standards PDF URL. Exiting.")
            return
        
        self.pdf_url = pdf_url
        
        # Download PDF
        pdf_file = self.download_pdf(pdf_url)
        
        # Extract standards
        standards = self.extract_standards_from_pdf(pdf_file)
        
        if not standards:
            print("✗ No standards extracted from PDF. Exiting.")
            return
        
        # Setup Supabase (needed for both dry-run to check existing records and full run)
        self.setup_supabase_client()
        
        # Setup Slack for notifications (works in both modes)
        self.setup_slack()
        
        # Process standards
        if dry_run:
            result = self.dry_run(standards)
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
            result = self.upsert_to_supabase(standards)
            print(f"\n✓ Complete: {len(result['inserted'])} inserted, {len(result['updated'])} updated")
            
            # Send Slack notification
            self.send_slack_notification(result['inserted'], result['updated'])


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Scrape USA Weightlifting standards and update Supabase'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without updating database'
    )
    
    args = parser.parse_args()
    
    scraper = StandardsScraper()
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()

