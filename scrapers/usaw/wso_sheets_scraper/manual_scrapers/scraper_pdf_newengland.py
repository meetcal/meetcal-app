#!/usr/bin/env python3
"""
PDF Scraper for New England WSO Records

This scraper handles New England's table-structured PDF format.
Uses pdfplumber's table extraction for reliable parsing.

PDF Format:
- Proper table structure with columns: Class, Lift, Name, Representing, Location/Meet, Weight, Date
- Each weight class has 3 rows: Snatch, C&J, Total
- "Standard" in Name column indicates qualifying standard (still counts as record until beaten)
- Multiple sections for different age/gender categories

USAGE:
  Dry-run (test without making changes):
    source venv/bin/activate && python scraper_pdf_newengland.py --wso "New England" --pdf-url "https://www.newenglandweightlifting.com/_files/ugd/e5901f_19d48447ffc04c05a9220272a13219ca.pdf" --dry-run
"""

import os
import sys
import argparse
import requests
import pdfplumber
from typing import List, Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)


class WSORecordsNewEnglandScraper:
    """Scraper for New England WSO records (table-structured PDF)."""
    
    def __init__(self, wso_name: str, pdf_url: str):
        """
        Initialize scraper.
        
        Args:
            wso_name: Name of the WSO (should be "New England")
            pdf_url: URL to the PDF file
        """
        self.wso_name = wso_name
        self.pdf_url = pdf_url
        self.supabase: Optional[Client] = None
        self.slack_webhook_url: Optional[str] = None
        self.pdf_path = "temp_wso_records.pdf"
    
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
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
        if self.slack_webhook_url:
            print("✓ Slack webhook configured")
    
    def download_pdf(self):
        """Download PDF from URL."""
        print(f"Downloading PDF from {self.pdf_url}...")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        response = requests.get(self.pdf_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        with open(self.pdf_path, 'wb') as f:
            f.write(response.content)
        
        print(f"✓ PDF downloaded to {self.pdf_path}")
    
    def _normalize_weight_class(self, weight_str: str) -> Optional[str]:
        """Normalize weight class format."""
        if not weight_str:
            return None
        
        weight_str = str(weight_str).strip()
        
        # Handle 110+ or +110
        if "+" in weight_str:
            return weight_str.replace("+", "") + "+" if not weight_str.endswith("+") else weight_str
        
        return weight_str
    
    def _parse_int(self, value: str) -> Optional[int]:
        """Parse integer value, return None if invalid or 0."""
        if not value or value == "" or value == "0":
            return None
        
        try:
            parsed = int(float(str(value).strip()))
            return None if parsed == 0 else parsed
        except (ValueError, AttributeError):
            return None
    
    def _parse_section_header(self, header: str) -> tuple:
        """
        Parse section header to extract age category and gender.
        
        Examples:
        - "Open Men's Records" -> ("Senior", "Men")
        - "Open Women's Records" -> ("Senior", "Women")
        - "Junior Men's Records" -> ("Junior", "Men")
        - "Youth 16-17 Men's Records" -> ("U17", "Men")
        - "Masters 35-39 Men's Records" -> ("Masters 35", "Men")
        """
        header = header.strip()
        
        # Extract gender
        if "Men" in header:
            gender = "Men"
        elif "Women" in header:
            gender = "Women"
        else:
            return None, None
        
        # Extract age category
        if "Open" in header:
            return "Senior", gender
        elif "Junior" in header:
            return "Junior", gender
        elif "Youth" in header or "16-17" in header or "16/17" in header:
            if "16-17" in header or "16/17" in header or "U17" in header:
                return "U17", gender
            elif "14-15" in header or "14/15" in header or "U15" in header:
                return "U15", gender
            elif "13" in header or "U13" in header or "13U" in header:
                return "U13", gender
        elif "Masters" in header:
            # Extract age: "Masters 35-39" -> "Masters 35"
            import re
            match = re.search(r'(\d+)\s*-\s*\d+', header)
            if match:
                return f"Masters {match.group(1)}", gender
        
        return None, None
    
    def scrape_pdf(self) -> List[Dict[str, Any]]:
        """
        Scrape records from PDF using table extraction.
        
        Returns:
            List of record dictionaries
        """
        records = []
        
        with pdfplumber.open(self.pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"  Processing page {page_num}...")
                
                # Extract tables
                tables = page.extract_tables()
                
                if not tables:
                    continue
                
                for table in tables:
                    current_age_category = None
                    current_gender = None
                    current_weight_class = None
                    current_snatch = None
                    current_cj = None
                    current_total = None
                    
                    for row in table:
                        if not row or len(row) < 2:
                            continue
                        
                        # Check if this is a section header row
                        first_cell = str(row[0] or "").strip()
                        if "Records" in first_cell:
                            age_cat, gender = self._parse_section_header(first_cell)
                            if age_cat and gender:
                                current_age_category = age_cat
                                current_gender = gender
                            continue
                        
                        # Skip header row
                        if first_cell == "Class" or first_cell == "Lift":
                            continue
                        
                        # Check if this row starts a new weight class
                        if first_cell and first_cell.replace("+", "").replace(" ", "").isdigit():
                            # Save previous weight class if complete
                            if current_weight_class and current_age_category and current_gender:
                                record = {
                                    'wso': self.wso_name,
                                    'age_category': current_age_category,
                                    'gender': current_gender,
                                    'weight_class': current_weight_class,
                                    'snatch_record': current_snatch,
                                    'cj_record': current_cj,
                                    'total_record': current_total
                                }
                                records.append(record)
                            
                            # Start new weight class
                            current_weight_class = self._normalize_weight_class(first_cell)
                            current_snatch = None
                            current_cj = None
                            current_total = None
                        
                        # Parse lift data
                        # Columns: Class, Lift, Name, Representing, Location/Meet, Weight, Date
                        if len(row) >= 6:
                            lift_type = str(row[1] or "").strip()
                            name = str(row[2] or "").strip()
                            weight_value = str(row[5] or "").strip()
                            
                            # "Open" means no record set yet (treat as NULL)
                            # "Standard" with a weight value means qualifying standard (treat as actual record)
                            # Empty weight means no record (treat as NULL)
                            if name.upper() == "OPEN" or not weight_value:
                                weight_value = None
                            else:
                                weight_value = self._parse_int(weight_value)
                            
                            # Assign to appropriate lift type
                            if "Snatch" in lift_type:
                                current_snatch = weight_value
                            elif "C&J" in lift_type or "Clean" in lift_type:
                                current_cj = weight_value
                            elif "Total" in lift_type:
                                current_total = weight_value
                    
                    # Save last weight class
                    if current_weight_class and current_age_category and current_gender:
                        record = {
                            'wso': self.wso_name,
                            'age_category': current_age_category,
                            'gender': current_gender,
                            'weight_class': current_weight_class,
                            'snatch_record': current_snatch,
                            'cj_record': current_cj,
                            'total_record': current_total
                        }
                        records.append(record)
        
        return records
    
    def upsert_to_supabase(self, records: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """Upsert records to Supabase."""
        if not self.supabase:
            raise ValueError("Supabase client not initialized")
        
        inserted = []
        updated = []
        
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
                record_id = db_record['id']
                
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
                self.supabase.table('wso_records').insert(record).execute()
                inserted.append(record)
                print(f"  ✓ Inserted: {record['age_category']} {record['gender']} {record['weight_class']}")
        
        return {'inserted': inserted, 'updated': updated}
    
    def send_slack_notification(self, inserted: List[Dict[str, Any]], updated: List[Dict[str, Any]]):
        """Send Slack notification with upsert summary."""
        if not self.slack_webhook_url:
            print("⚠ Slack webhook not configured, skipping notification")
            return
        
        # Build message
        title = f"{self.wso_name} WSO Records Update (PDF)"
        total_changes = len(inserted) + len(updated)
        
        if total_changes == 0:
            message = f"*{title}*\n\nNo changes detected"
        else:
            message = f"*{title}*\n\n*{len(inserted)}* new records, *{len(updated)}* updated records"
        
        if inserted:
            message += f"\n\n*New Records ({len(inserted)}):*\n"
            inserted_text = "\n".join([
                f"• {r['age_category']} {r['gender']} {r['weight_class']}"
                for r in inserted[:10]
            ])
            message += inserted_text
            if len(inserted) > 10:
                message += f"\n... and {len(inserted) - 10} more"
        
        if updated:
            message += f"\n\n*Updated Records ({len(updated)}):*\n"
            updated_text = "\n".join([
                f"• {r['age_category']} {r['gender']} {r['weight_class']}"
                for r in updated[:10]
            ])
            message += updated_text
            if len(updated) > 10:
                message += f"\n... and {len(updated) - 10} more"
        
        payload = {"text": message}
        
        response = requests.post(self.slack_webhook_url, json=payload, timeout=10)
        response.raise_for_status()
        print("✓ Slack notification sent")
    
    def cleanup(self):
        """Remove temporary PDF file."""
        if os.path.exists(self.pdf_path):
            os.remove(self.pdf_path)
            print(f"✓ Cleaned up {self.pdf_path}")
    
    def dry_run_compare(self, records: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Compare scraped records with database without making changes."""
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
        """Main execution method."""
        try:
            print(f"{'='*80}")
            print(f"WSO PDF SCRAPER - {self.wso_name}")
            print(f"{'='*80}")
            print(f"PDF URL: {self.pdf_url}\n")
            
            self.setup_supabase_client()
            if not dry_run:
                self.setup_slack()
            
            self.download_pdf()
            
            print("\nScraping PDF...")
            records = self.scrape_pdf()
            print(f"Found {len(records)} total records")
            
            if dry_run:
                print("\n" + "="*80)
                print("DRY RUN MODE - Comparing with database")
                print("="*80)
                
                comparison = self.dry_run_compare(records)
                
                print(f"\nTo INSERT: {len(comparison['to_insert'])} records")
                print(f"To UPDATE: {len(comparison['to_update'])} records")
                print(f"Unchanged: {len(comparison['unchanged'])} records")
                
                if comparison['to_insert']:
                    print("\n--- Records to INSERT ---")
                    for rec in comparison['to_insert'][:20]:
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
                print("\nUpserting records to Supabase...")
                result = self.upsert_to_supabase(records)
                
                print("\nSending Slack notification...")
                self.send_slack_notification(result['inserted'], result['updated'])
                
                print("\n✅ Done!")
                print(f"  Inserted: {len(result['inserted'])} records")
                print(f"  Updated: {len(result['updated'])} records")
            
        finally:
            self.cleanup()


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="PDF Scraper for New England WSO Records",
        epilog="Example: python scraper_pdf_newengland.py --wso 'New England' --pdf-url 'https://example.com/records.pdf' --dry-run"
    )
    parser.add_argument("--wso", required=True, help="WSO name (should be 'New England')")
    parser.add_argument("--pdf-url", required=True, help="URL to the PDF file")
    parser.add_argument("--dry-run", action="store_true", help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    load_dotenv()
    
    scraper = WSORecordsNewEnglandScraper(args.wso, args.pdf_url)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()

