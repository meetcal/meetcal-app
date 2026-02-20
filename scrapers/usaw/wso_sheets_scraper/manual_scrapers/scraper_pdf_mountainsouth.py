#!/usr/bin/env python3
"""
PDF Scraper for Mountain South WSO Records

This scraper handles Mountain South's table-structured PDF format.
Uses pdfplumber's table extraction for reliable parsing.

PDF Format:
- Table structure with columns: CAT, ATHLETE (First/Last), STATE, KG, DATE, EVENT, LOCATION
- Each weight class has 3 sections: Snatch, Clean & Jerk, Total
- Age/gender categories in section headers (e.g., "OPEN MEN", "JUNIOR MEN U20", "MASTERS MEN 35-39")
- Separate PDFs for Men and Women

USAGE:
  Dry-run (test without making changes):
    source venv/bin/activate && python scraper_pdf_mountainsouth.py --wso "Mountain South" --pdf-url "https://mountainsouth.org/wp-content/uploads/2025/10/Mountain-South-WSO-Records-2025-10-19-MEN.pdf" --dry-run
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


class WSORecordsMountainSouthScraper:
    """Scraper for Mountain South WSO records (table-structured PDF)."""
    
    def __init__(self, wso_name: str, pdf_url: str):
        """
        Initialize scraper.
        
        Args:
            wso_name: Name of the WSO (should be "Mountain South")
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
        - "OPEN MEN - SNATCH" -> ("Senior", "Men")
        - "JUNIOR MEN U20 - SNATCH" -> ("Junior", "Men")
        - "YOUTH MEN U17 - SNATCH" -> ("U17", "Men")
        - "MASTERS MEN 35-39 - SNATCH" -> ("Masters 35", "Men")
        """
        header = header.strip().upper()
        
        # Extract gender
        if "MEN" in header and "WOMEN" not in header:
            gender = "Men"
        elif "WOMEN" in header:
            gender = "Women"
        else:
            return None, None
        
        # Extract age category
        if "OPEN" in header:
            return "Senior", gender
        elif "JUNIOR" in header:
            return "Junior", gender
        elif "YOUTH" in header or "U17" in header or "U15" in header or "U13" in header:
            # Try to extract specific youth category
            if "U17" in header or "17" in header:
                return "U17", gender
            elif "U15" in header or "15" in header:
                return "U15", gender
            elif "U13" in header or "13" in header:
                return "U13", gender
            return "Youth", gender
        elif "MASTERS" in header:
            # Extract age: "MASTERS MEN 35-39" -> "Masters 35"
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
        current_records = {}  # Key: (age_cat, gender, weight_class), Value: {snatch, cj, total}
        
        with pdfplumber.open(self.pdf_path) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"  Processing page {page_num}...")
                
                # Extract text to find section headers
                text = page.extract_text()
                if not text:
                    continue
                
                lines = text.split('\n')
                
                current_age_category = None
                current_gender = None
                current_lift_type = None  # "SNATCH", "CLEAN & JERK", or "TOTAL"
                
                for line in lines:
                    line = line.strip()
                    
                    # Check for section headers (e.g., "OPEN MEN - SNATCH")
                    if " - SNATCH" in line or " - CLEAN & JERK" in line or " - TOTAL" in line:
                        age_cat, gender = self._parse_section_header(line)
                        if age_cat and gender:
                            current_age_category = age_cat
                            current_gender = gender
                            
                            if "SNATCH" in line:
                                current_lift_type = "SNATCH"
                            elif "CLEAN" in line:
                                current_lift_type = "CLEAN_JERK"
                            elif "TOTAL" in line:
                                current_lift_type = "TOTAL"
                        continue
                    
                    # Skip header lines
                    if "CAT" in line and "ATHLETE" in line:
                        continue
                    if "Beginning 6/1/2025" in line:
                        continue
                    
                    # Parse data lines (weight class followed by optional record data)
                    # Format: "60 FirstName LastName STATE KG DATE EVENT LOCATION"
                    # or just: "60" (empty record)
                    parts = line.split()
                    if len(parts) > 0 and current_age_category and current_gender and current_lift_type:
                        # First part should be weight class
                        weight_class_str = parts[0]
                        if weight_class_str.replace("+", "").isdigit():
                            weight_class = self._normalize_weight_class(weight_class_str)
                            
                            # Initialize record if not exists
                            key = (current_age_category, current_gender, weight_class)
                            if key not in current_records:
                                current_records[key] = {
                                    'snatch': None,
                                    'cj': None,
                                    'total': None
                                }
                            
                            # Try to extract KG value (4th element typically)
                            kg_value = None
                            if len(parts) >= 4:
                                # Try to find the KG value (should be a number)
                                for i in range(1, min(len(parts), 6)):
                                    try:
                                        kg_value = self._parse_int(parts[i])
                                        if kg_value:
                                            break
                                    except:
                                        continue
                            
                            # Store value in appropriate lift type
                            if current_lift_type == "SNATCH":
                                current_records[key]['snatch'] = kg_value
                            elif current_lift_type == "CLEAN_JERK":
                                current_records[key]['cj'] = kg_value
                            elif current_lift_type == "TOTAL":
                                current_records[key]['total'] = kg_value
        
        # Convert to list of records
        for (age_cat, gender, weight_class), values in current_records.items():
            record = {
                'wso': self.wso_name,
                'age_category': age_cat,
                'gender': gender,
                'weight_class': weight_class,
                'snatch_record': values['snatch'],
                'cj_record': values['cj'],
                'total_record': values['total']
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
        description="PDF Scraper for Mountain South WSO Records",
        epilog="Example: python scraper_pdf_mountainsouth.py --wso 'Mountain South' --pdf-url 'https://mountainsouth.org/wp-content/uploads/2025/10/Mountain-South-WSO-Records-2025-10-19-MEN.pdf' --dry-run"
    )
    parser.add_argument("--wso", required=True, help="WSO name (should be 'Mountain South')")
    parser.add_argument("--pdf-url", required=True, help="URL to the PDF file")
    parser.add_argument("--dry-run", action="store_true", help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    load_dotenv()
    
    scraper = WSORecordsMountainSouthScraper(args.wso, args.pdf_url)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()

