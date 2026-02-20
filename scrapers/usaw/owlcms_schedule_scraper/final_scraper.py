"""
USAGE:
  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
  
  # Run dry-run to preview changes
  source venv/bin/activate && python final_scraper.py "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/bltd2a8b2b6f421eeab/69275c41c5f9207dc07ca596/2025_-_VWF_-_START_LIST_AFTER_VFE.pdf" "2025 Virus Weightlifting Finals, Powered by Rogue Fitness" --dry-run
  
  # Export to CSV
  source venv/bin/activate && python final_scraper.py "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt15de1b02b6a6b656/6855e02a84e9fc2bb2dbdfc2/schedule_(2).pdf" "2025 USAW National Championships" --csv final_schedule.csv
"""

import os
import re
import requests
from io import BytesIO
from datetime import datetime, time as datetime_time
from typing import List, Dict, Optional
import pdfplumber
from dotenv import load_dotenv
from supabase import create_client, Client
import pandas as pd
from tabulate import tabulate

# Load environment variables
load_dotenv()


class FinalScheduleScraper:
    """Scraper for extracting FINAL schedule data from OWLCMS PDFs"""
    
    def __init__(self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None):
        """Initialize the scraper with Supabase credentials"""
        self.supabase_url = supabase_url or os.getenv('SUPABASE_URL')
        self.supabase_key = supabase_key or os.getenv('SUPABASE_KEY')
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Supabase credentials not found. Set SUPABASE_URL and SUPABASE_KEY in .env")
        
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
        self.current_date = None
    
    def download_pdf(self, url: str) -> BytesIO:
        """Download PDF from URL"""
        print(f"Downloading PDF from {url}...")
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return BytesIO(response.content)
    
    def extract_schedule_data(self, pdf_file: BytesIO, meet_name: str) -> List[Dict]:
        """Extract schedule data from PDF"""
        print("Extracting data from PDF...")
        schedule_entries = []
        
        with pdfplumber.open(pdf_file) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"Processing page {page_num}/{len(pdf.pages)}...")
                
                tables = page.extract_tables()
                
                if not tables:
                    continue
                
                for table in tables:
                    if not table or len(table) < 2:
                        continue
                    
                    entries = self._parse_table(table, meet_name)
                    schedule_entries.extend(entries)
        
        print(f"Extracted {len(schedule_entries)} schedule entries")
        return schedule_entries
    
    def _parse_table(self, table: List[List], meet_name: str) -> List[Dict]:
        """Parse a table from the PDF"""
        entries = []
        current_session = None
        current_date = self.current_date  # Use instance-level date that persists across pages
        last_start_time = None  # Track last start time to detect new sessions
        
        for row in table:
            if not row or len(row) < 7:
                continue
            
            # Extract values
            date_str = str(row[0] or '').strip()
            session_str = str(row[1] or '').strip()
            platform = str(row[2] or '').strip()
            weigh_time_str = str(row[3] or '').strip()
            start_time_str = str(row[4] or '').strip()
            weight_category = str(row[6] or '').strip()
            
            # Update current date if present
            if date_str and any(month in date_str for month in ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 
                                                                  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']):
                parsed_date = self._parse_date_from_short(date_str)
                if parsed_date:
                    current_date = parsed_date
                    self.current_date = parsed_date  # Update instance-level date
            
            # Check if this is a new session based on time change (before updating session number)
            is_new_session = False
            if (not session_str and platform == 'RED' and start_time_str and 
                last_start_time and start_time_str != last_start_time and current_session):
                # Detect session boundary: RED platform with different start time means new session
                is_new_session = True
            
            # Update current session if present
            if session_str and session_str.isdigit():
                current_session = int(session_str)
                last_start_time = None  # Reset time tracking on explicit session number
            
            # Skip if we don't have the essential data
            if not platform or platform not in ['RED', 'WHITE', 'BLUE']:
                continue
            
            if not start_time_str or not weigh_time_str:
                continue
            
            # Use local current_date which persists across rows
            if not current_date or not current_session:
                continue
            
            # Parse times
            start_time = self._parse_time(start_time_str)
            weigh_time = self._parse_time(weigh_time_str)
            
            if not start_time or not weigh_time:
                continue
            
            # Track start time for session boundary detection
            if platform == 'RED':
                last_start_time = start_time_str
            
            # Clean weight category (remove group letter like A, B, C, etc)
            weight_class = re.sub(r'\s+[A-E]$', '', weight_category).strip()
            
            # Capitalize platform for consistency
            platform = platform.capitalize()
            
            entry = {
                'date': current_date,
                'session_id': current_session,
                'start_time': start_time.strftime('%H:%M:%S'),
                'weigh_in_time': weigh_time.strftime('%H:%M:%S'),
                'platform': platform,
                'weight_class': weight_class,
                'meet': meet_name
            }
            
            entries.append(entry)
            
            # Increment session number AFTER processing this row if it was a new session
            if is_new_session:
                current_session += 1
        
        return entries
    
    def _parse_time(self, time_str: str) -> Optional[datetime_time]:
        """Parse time string into time object"""
        if not time_str:
            return None
        
        time_str = str(time_str).strip()
        
        # Try common time formats
        formats = ['%H:%M:%S', '%H:%M', '%I:%M %p', '%I:%M%p']
        
        for fmt in formats:
            try:
                dt = datetime.strptime(time_str, fmt)
                return dt.time()
            except ValueError:
                continue
        
        # Try to extract time using regex
        match = re.search(r'(\d{1,2}):(\d{2})\s*(am|pm)?', time_str.lower())
        if match:
            hour = int(match.group(1))
            minute = int(match.group(2))
            am_pm = match.group(3)
            
            if am_pm == 'pm' and hour < 12:
                hour += 12
            elif am_pm == 'am' and hour == 12:
                hour = 0
            
            return datetime_time(hour, minute)
        
        return None
    
    def _parse_date_from_short(self, date_str: str) -> Optional[str]:
        """Parse date from short format like 'Sat\\nJun 21'"""
        if not date_str:
            return None
        
        date_str = str(date_str).strip().replace('\n', ' ')
        
        # Extract month and day
        match = re.search(r'(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})', date_str)
        if match:
            month_str = match.group(1)
            day = match.group(2)
            
            # Assume current year or next year based on context
            year = 2025  # Hardcode for now, could be made dynamic
            
            month_map = {
                'Jan': 1, 'Feb': 2, 'Mar': 3, 'Apr': 4, 'May': 5, 'Jun': 6,
                'Jul': 7, 'Aug': 8, 'Sep': 9, 'Oct': 10, 'Nov': 11, 'Dec': 12
            }
            
            month = month_map.get(month_str)
            if month:
                try:
                    dt = datetime(year, month, int(day))
                    return dt.strftime('%Y-%m-%d')
                except ValueError:
                    pass
        
        return None
    
    def format_for_database(self, entries: List[Dict]) -> List[Dict]:
        """Format extracted entries to match database schema"""
        formatted = []
        
        for entry in entries:
            formatted_entry = {
                'date': entry.get('date'),
                'session_id': entry.get('session_id'),
                'start_time': entry.get('start_time'),
                'weigh_in_time': entry.get('weigh_in_time'),
                'platform': entry.get('platform'),
                'weight_class': entry.get('weight_class'),
                'meet': entry.get('meet')
            }
            
            # Only add if all required fields are present
            if all(formatted_entry.values()):
                formatted.append(formatted_entry)
        
        return formatted
    
    def dry_run(self, meet_name: str, new_entries: List[Dict]) -> Dict:
        """Perform a dry run to see what would be changed"""
        print(f"\n{'='*60}")
        print(f"DRY RUN: {meet_name}")
        print(f"{'='*60}\n")
        
        existing_response = self.supabase.table('session_schedule').select('*').eq('meet', meet_name).execute()
        existing_records = existing_response.data if existing_response.data else []
        
        print(f"Found {len(existing_records)} existing records for '{meet_name}'")
        print(f"Processing {len(new_entries)} new entries\n")
        
        # Create comparison based on unique constraint
        existing_by_key = {}
        for record in existing_records:
            key = (
                record.get('meet'),
                record.get('session_id'),
                record.get('platform'),
                record.get('weight_class')
            )
            existing_by_key[key] = record
        
        new_by_key = {}
        for entry in new_entries:
            key = (
                entry.get('meet'),
                entry.get('session_id'),
                entry.get('platform'),
                entry.get('weight_class')
            )
            new_by_key[key] = entry
        
        to_add = []
        to_update = []
        unchanged = []
        
        for key, new_entry in new_by_key.items():
            if key not in existing_by_key:
                to_add.append(new_entry)
            else:
                existing = existing_by_key[key]
                if (str(existing.get('date')) != new_entry.get('date') or
                    existing.get('start_time') != new_entry.get('start_time') or
                    existing.get('weigh_in_time') != new_entry.get('weigh_in_time')):
                    to_update.append({'existing': existing, 'new': new_entry})
                else:
                    unchanged.append(new_entry)
        
        print(f"SUMMARY:")
        print(f"  New entries to add: {len(to_add)}")
        print(f"  Existing entries to update: {len(to_update)}")
        print(f"  Unchanged entries: {len(unchanged)}")
        
        if to_add:
            print(f"\n{'='*60}")
            print(f"NEW ENTRIES TO ADD ({len(to_add)}):")
            print(f"{'='*60}")
            df = pd.DataFrame(to_add)
            print(tabulate(df, headers='keys', tablefmt='grid', showindex=False))
        
        if to_update:
            print(f"\n{'='*60}")
            print(f"ENTRIES TO UPDATE ({len(to_update)}):")
            print(f"{'='*60}")
            for item in to_update[:10]:  # Show first 10
                print(f"\nExisting: {item['existing']}")
                print(f"New:      {item['new']}")
        
        return {
            'total_new': len(new_entries),
            'total_existing': len(existing_records),
            'to_add': len(to_add),
            'to_update': len(to_update),
            'unchanged': len(unchanged)
        }
    
    def upsert_to_database(self, entries: List[Dict]) -> Dict:
        """Upsert entries to the database"""
        if not entries:
            print("No entries to upsert")
            return {'data': [], 'count': 0}
        
        # Deduplicate entries
        seen = {}
        for entry in entries:
            key = (entry['meet'], entry['session_id'], entry['platform'], entry['weight_class'])
            seen[key] = entry
        
        deduplicated = list(seen.values())
        
        if len(deduplicated) < len(entries):
            print(f"Warning: Removed {len(entries) - len(deduplicated)} duplicate entries from batch")
        
        print(f"Upserting {len(deduplicated)} entries to database...")
        
        response = self.supabase.table('session_schedule').upsert(
            deduplicated,
            on_conflict='meet,session_id,platform,weight_class'
        ).execute()
        
        print(f"Successfully upserted {len(deduplicated)} entries")
        return response
    
    def export_to_csv(self, entries: List[Dict], output_file: str):
        """Export entries to CSV file"""
        import csv
        
        if not entries:
            print("No entries to export")
            return
        
        print(f"Exporting {len(entries)} entries to {output_file}...")
        
        with open(output_file, 'w', newline='') as csvfile:
            fieldnames = ['id', 'date', 'session_id', 'start_time', 'weigh_in_time', 'platform', 'weight_class', 'meet']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            
            writer.writeheader()
            for i, entry in enumerate(entries, 1):
                # Add id field for CSV (not used in database)
                row = {'id': i, **entry}
                writer.writerow(row)
        
        print(f"✓ Successfully exported to {output_file}")
    
    def scrape_and_upsert(self, pdf_url: str, meet_name: str, dry_run: bool = False) -> Dict:
        """Main method to scrape PDF and upsert to database"""
        try:
            pdf_file = self.download_pdf(pdf_url)
            raw_entries = self.extract_schedule_data(pdf_file, meet_name)
            
            if not raw_entries:
                print("WARNING: No schedule entries were extracted from the PDF")
                return {'success': False, 'error': 'No data extracted'}
            
            formatted_entries = self.format_for_database(raw_entries)
            
            if not formatted_entries:
                print("WARNING: No valid entries after formatting")
                return {'success': False, 'error': 'No valid entries after formatting'}
            
            if dry_run:
                result = self.dry_run(meet_name, formatted_entries)
                return {'success': True, 'dry_run': True, 'stats': result}
            else:
                response = self.upsert_to_database(formatted_entries)
                return {'success': True, 'dry_run': False, 'response': response}
        
        except Exception as e:
            print(f"ERROR: {e}")
            import traceback
            traceback.print_exc()
            return {'success': False, 'error': str(e)}


def main():
    """Main entry point for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(description='Scrape OWLCMS FINAL schedule from PDF and upsert to Supabase')
    parser.add_argument('url', help='URL to the PDF file')
    parser.add_argument('meet_name', help='Name of the meet/competition')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without actually upserting')
    parser.add_argument('--csv', help='Export to CSV file instead of database (provide filename)')
    
    args = parser.parse_args()
    
    scraper = FinalScheduleScraper()
    
    if args.csv:
        # CSV export mode
        pdf_file = scraper.download_pdf(args.url)
        raw_entries = scraper.extract_schedule_data(pdf_file, args.meet_name)
        formatted_entries = scraper.format_for_database(raw_entries)
        
        if formatted_entries:
            scraper.export_to_csv(formatted_entries, args.csv)
            print("\n✓ CSV export completed successfully")
        else:
            print("\n✗ No data to export")
            exit(1)
    else:
        # Database upsert mode
        result = scraper.scrape_and_upsert(args.url, args.meet_name, dry_run=args.dry_run)
        
        if result['success']:
            print("\n✓ Operation completed successfully")
        else:
            print(f"\n✗ Operation failed: {result.get('error', 'Unknown error')}")
            exit(1)


if __name__ == '__main__':
    main()

