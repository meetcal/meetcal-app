"""
OWLCMS Schedule Scraper - Extract schedule data from PDF files

SETUP:
  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

USAGE:
  # Use defaults from configuration - standard columns only
  source venv/bin/activate && python prelim_scraper.py --csv output.csv
  
  # Use defaults from configuration - ALL columns
  source venv/bin/activate && python prelim_scraper.py --all-columns --csv full_output.csv
  
  # Dry-run to preview database changes
  source venv/bin/activate && python prelim_scraper.py --dry-run
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

# ============================================================================
# CONFIGURATION - Set your meet details here
# ============================================================================
DEFAULT_PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt79f72e0801fb072f/6987896bb7bf25825f6df479/2026_-_VWS1_-_Preliminary_Schedule.pdf"
DEFAULT_MEET_NAME = "2026 VIRUS Weightlifting Series 1"
DEFAULT_CSV_START_ID = 123
DEFAULT_CSV_ID_INCREMENT = 1
# ============================================================================


class ScheduleScraper:
    """Scraper for extracting schedule data from OWLCMS PDFs"""
    
    def __init__(self, supabase_url: Optional[str] = None, supabase_key: Optional[str] = None, all_columns: bool = False):
        """
        Initialize the scraper with Supabase credentials
        
        Args:
            supabase_url: Supabase project URL (defaults to SUPABASE_URL env var)
            supabase_key: Supabase API key (defaults to SUPABASE_KEY env var)
            all_columns: If True, extract all columns from PDF tables
        """
        self.supabase_url = supabase_url or os.getenv('SUPABASE_URL')
        self.supabase_key = supabase_key or os.getenv('SUPABASE_KEY')
        self.all_columns = all_columns
        
        if not self.supabase_url or not self.supabase_key:
            raise ValueError("Supabase credentials not found. Set SUPABASE_URL and SUPABASE_KEY in .env")
        
        self.supabase: Client = create_client(self.supabase_url, self.supabase_key)
    
    def download_pdf(self, url: str) -> BytesIO:
        """
        Download PDF from URL
        
        Args:
            url: URL to the PDF file
            
        Returns:
            BytesIO object containing the PDF data
        """
        print(f"Downloading PDF from {url}...")
        response = requests.get(url, timeout=30)
        response.raise_for_status()
        return BytesIO(response.content)
    
    def extract_schedule_data(self, pdf_file: BytesIO, meet_name: str) -> List[Dict]:
        """
        Extract schedule data from PDF
        
        Args:
            pdf_file: BytesIO object containing PDF data
            meet_name: Name of the meet/competition
            
        Returns:
            List of dictionaries containing schedule entries
        """
        print("Extracting data from PDF...")
        schedule_entries = []
        
        # Track date and session across all tables and pages
        self.current_date = None
        self.current_session = None
        
        with pdfplumber.open(pdf_file) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"Processing page {page_num}/{len(pdf.pages)}...")
                
                # Extract tables from the page
                tables = page.extract_tables()
                
                if not tables:
                    # Try extracting text if no tables found
                    text = page.extract_text()
                    if text:
                        print(f"No tables found on page {page_num}, text extraction:")
                        print(text[:500])  # Print first 500 chars for debugging
                    continue
                
                print(f"  Found {len(tables)} table(s) on page {page_num}")
                
                # Process each table
                for table_idx, table in enumerate(tables, 1):
                    if not table or len(table) < 2:
                        print(f"  Skipping table {table_idx} (too small)")
                        continue
                    
                    # Parse the table data
                    entries = self._parse_table(table, meet_name)
                    print(f"  Table {table_idx}: extracted {len(entries)} entries")
                    schedule_entries.extend(entries)
        
        print(f"Extracted {len(schedule_entries)} total schedule entries")
        return schedule_entries
    
    def _parse_table(self, table: List[List], meet_name: str) -> List[Dict]:
        """
        Parse a table from the PDF into schedule entries
        
        Args:
            table: 2D list representing a table
            meet_name: Name of the meet
            
        Returns:
            List of schedule entry dictionaries
        """
        entries = []
        
        # Store last known headers for tables without explicit headers
        if not hasattr(self, '_last_known_headers'):
            self._last_known_headers = None
        
        # A table can have MULTIPLE header rows (multiple date sections)
        # We need to find ALL headers and process each section separately
        header_sections = []
        
        for idx, row in enumerate(table):
            if not row or all(cell is None or str(cell).strip() == '' for cell in row):
                continue
            
            row_text = ' '.join([str(cell or '').lower() for cell in row])
            
            # Look for common header keywords - must have multiple keywords to be a real header
            keywords_found = sum([
                'sess' in row_text,
                'date' in row_text,
                'plat' in row_text,
                'weigh' in row_text,
                'weight' in row_text and 'category' in row_text,
                'time' in row_text,
                'gender' in row_text,
                'meet' in row_text
            ])
            
            if keywords_found >= 3:  # Must have at least 3 matching keywords (reduced from 4)
                # Look for date in rows BEFORE this header (within 3 rows)
                date_for_section = None
                for look_back in range(1, min(4, idx + 1)):
                    prev_row = table[idx - look_back]
                    if prev_row:
                        prev_text = ' '.join([str(cell or '').strip() for cell in prev_row])
                        if any(month in prev_text for month in ['January', 'February', 'March', 'April', 'May', 'June', 
                                                                  'July', 'August', 'September', 'October', 'November', 'December']):
                            date_for_section = prev_text
                            break
                
                header_sections.append({
                    'header_row': row, 
                    'start_idx': idx + 1,
                    'date_text': date_for_section
                })
                
                # Store this as the last known header
                self._last_known_headers = row
        
        # Process rows BEFORE the first header (if any exist)
        if header_sections and header_sections[0]['start_idx'] > 1:
            # Parse rows before first header using the same header structure
            pre_header_rows = table[0:header_sections[0]['start_idx'] - 1]
            if pre_header_rows:
                # Don't pass date_text - let it use self.current_date which was carried over from previous table
                # Pre-header rows are usually continuation from previous page
                entries.extend(self._parse_with_headers(pre_header_rows, header_sections[0]['header_row'], meet_name, None))
        
        # Process each section
        if header_sections:
            for i, section in enumerate(header_sections):
                # Determine where this section ends (next header or end of table)
                end_idx = header_sections[i + 1]['start_idx'] - 1 if i + 1 < len(header_sections) else len(table)
                data_rows = table[section['start_idx']:end_idx]
                
                entries.extend(self._parse_with_headers(data_rows, section['header_row'], meet_name, section.get('date_text')))
        else:
            # No header found - try to use last known headers from previous table
            if self._last_known_headers:
                print("No clear header row found, using headers from previous table...")
                entries.extend(self._parse_with_headers(table, self._last_known_headers, meet_name, None))
            else:
                # Try to parse without explicit headers
                print("No clear header row found, attempting pattern-based parsing...")
                entries.extend(self._parse_without_headers(table, meet_name))
        
        return entries
    
    def _parse_with_headers(self, data_rows: List[List], headers: List, meet_name: str, date_text: Optional[str] = None) -> List[Dict]:
        """Parse table data using identified headers"""
        entries = []
        
        # If all_columns mode, use a different approach
        if self.all_columns:
            return self._parse_all_columns(data_rows, headers, meet_name, date_text)
        
        # Normalize headers
        header_map = {}
        for idx, header in enumerate(headers):
            if header:
                header_lower = str(header).lower().strip().replace('\n', ' ')
                # Map to column indices - order matters! Check specific combinations first
                if 'weight' in header_lower and 'category' in header_lower:
                    header_map['weight_class_idx'] = idx
                elif header_lower == 'weigh':  # Exact match for weigh-in time column
                    header_map['weigh_idx'] = idx
                elif 'date' in header_lower:
                    header_map['date_idx'] = idx
                elif 'sess' in header_lower:
                    header_map['session_idx'] = idx
                elif 'plat' in header_lower:
                    header_map['platform_idx'] = idx
                elif 'time' in header_lower:
                    header_map['time_idx'] = idx
        
        
        # When starting a new table with headers, look for a fresh date
        # First try the date_text passed in (from before the header)
        # Then scan the data rows
        local_date = None
        local_session = None
        
        # Try parsing date_text first (from row before header)
        if date_text:
            parsed_date = self._parse_date_from_text(date_text)
            if parsed_date:
                local_date = parsed_date
                self.current_date = parsed_date
        
        # If no date yet, scan the initial rows to find the date in the Date column
        if not local_date:
            date_idx = header_map.get('date_idx', 0)
            for row in data_rows[:10]:  # Check first 10 rows for date
                if not row or len(row) <= date_idx:
                    continue
                date_cell = str(row[date_idx] or '').strip()
                if date_cell and any(month in date_cell for month in ['January', 'February', 'March', 'April', 'May', 'June', 
                                                                        'July', 'August', 'September', 'October', 'November', 'December']):
                    parsed_date = self._parse_date_from_text(date_cell)
                    if parsed_date:
                        local_date = parsed_date
                        self.current_date = parsed_date
                        break
        
        for row in data_rows:
            if not row or all(cell is None or str(cell).strip() == '' for cell in row):
                continue
            
            # Check if this row contains a date (like "Wednesday June 25, 2025")
            # This can happen when dates appear mid-table without a header
            row_text = ' '.join([str(cell or '').strip() for cell in row])
            if any(month in row_text for month in ['January', 'February', 'March', 'April', 'May', 'June', 
                                                     'July', 'August', 'September', 'October', 'November', 'December']):
                # Check if this looks like a date row (has day of week)
                if any(day in row_text for day in ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']):
                    parsed_date = self._parse_date_from_text(row_text)
                    if parsed_date:
                        local_date = parsed_date
                        self.current_date = parsed_date
                        continue  # Skip this row, it's just a date header
            
            try:
                # Use local_date if we found one, otherwise fall back to instance level
                entry = self._extract_entry_from_row(
                    row, header_map, meet_name, 
                    local_date or self.current_date, 
                    local_session or self.current_session
                )
                if entry:
                    # Update tracking
                    if entry.get('date'):
                        local_date = entry['date']
                        self.current_date = entry['date']
                    if entry.get('session_id'):
                        local_session = entry['session_id']
                        self.current_session = entry['session_id']
                    entries.append(entry)
            except Exception as e:
                print(f"Error parsing row {row}: {e}")
                continue
        
        return entries
    
    def _parse_all_columns(self, data_rows: List[List], headers: List, meet_name: str, date_text: Optional[str] = None) -> List[Dict]:
        """Parse table data extracting ALL columns"""
        entries = []
        
        # Clean and normalize headers
        clean_headers = []
        session_idx = None
        for idx, header in enumerate(headers):
            if header:
                # Clean header text
                header_text = str(header).strip().replace('\n', ' ').replace('  ', ' ')
                clean_headers.append(header_text)
                # Track which column is the session column
                if 'sess' in header_text.lower():
                    session_idx = idx
            else:
                clean_headers.append(f"column_{idx}")
        
        # Track current date and session across rows
        local_date = None
        local_session = None
        previous_date = None
        
        # Try parsing date_text first (from row before header)
        if date_text:
            parsed_date = self._parse_date_from_text(date_text)
            if parsed_date:
                local_date = parsed_date
                self.current_date = parsed_date
                previous_date = parsed_date
        
        for row in data_rows:
            if not row or all(cell is None or str(cell).strip() == '' for cell in row):
                continue
            
            # Check if this row contains a date
            row_text = ' '.join([str(cell or '').strip() for cell in row])
            if any(month in row_text for month in ['January', 'February', 'March', 'April', 'May', 'June', 
                                                     'July', 'August', 'September', 'October', 'November', 'December']):
                # Check if this looks like a date row
                if any(day in row_text for day in ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']):
                    parsed_date = self._parse_date_from_text(row_text)
                    if parsed_date:
                        # Date changed - reset session tracking
                        if previous_date and parsed_date != previous_date:
                            local_session = None
                            self.current_session = None
                        local_date = parsed_date
                        self.current_date = parsed_date
                        previous_date = parsed_date
                        continue  # Skip this row, it's just a date header
            
            try:
                # Create entry with all columns
                entry = {'meet': meet_name}
                
                # Add date if available
                if local_date or self.current_date:
                    current_entry_date = local_date or self.current_date
                    entry['date'] = current_entry_date
                    
                    # If date changed from previous date, reset session
                    if previous_date and current_entry_date != previous_date:
                        local_session = None
                        self.current_session = None
                        previous_date = current_entry_date
                
                # Check if this row has a session number
                if session_idx is not None and session_idx < len(row):
                    session_value = str(row[session_idx] or '').strip()
                    if session_value and session_value.isdigit():
                        local_session = session_value
                        self.current_session = session_value
                
                # Extract all column values
                for idx, (header, value) in enumerate(zip(clean_headers, row)):
                    if value is not None and str(value).strip():
                        # Clean the value - remove newlines and extra spaces
                        clean_value = str(value).strip().replace('\n', ' ').replace('\r', ' ')
                        # Replace multiple spaces with single space
                        clean_value = ' '.join(clean_value.split())
                        
                        # Use header as key, make it lowercase and replace spaces with underscores
                        key = header.lower().replace(' ', '_').replace('/', '_').replace('-', '_')
                        
                        # Special handling for "Meet" column - extract actual meet type
                        if 'meet' in key and key != 'meet':
                            # This might be age_group or meet type column
                            if 'finals' in clean_value.lower() or 'umwf' in clean_value.lower() or 'u13' in clean_value.lower():
                                entry['meet_type'] = clean_value
                            else:
                                entry[key] = clean_value
                        # Handle special cases for time formatting
                        elif 'time' in key or 'weigh' in key:
                            parsed_time = self._parse_time(clean_value)
                            if parsed_time:
                                entry[key] = parsed_time.strftime('%H:%M:%S')
                            else:
                                entry[key] = clean_value
                        # Handle date columns
                        elif 'date' in key and clean_value:
                            if any(month in clean_value for month in ['January', 'February', 'March', 'April', 'May', 'June', 
                                                                        'July', 'August', 'September', 'October', 'November', 'December']):
                                parsed_date = self._parse_date_from_text(clean_value)
                                if parsed_date:
                                    entry['date'] = parsed_date
                                    local_date = parsed_date
                                    self.current_date = parsed_date
                            else:
                                entry[key] = clean_value
                        else:
                            entry[key] = clean_value
                
                # Add the current session if not already in entry
                if 'sess' not in entry and (local_session or self.current_session):
                    entry['sess'] = local_session or self.current_session
                
                # Only add entry if it has some meaningful data (more than just meet and date)
                if len(entry) > 2:
                    entries.append(entry)
                    
            except Exception as e:
                print(f"Error parsing row {row}: {e}")
                continue
        
        return entries
    
    def _parse_without_headers(self, table: List[List], meet_name: str) -> List[Dict]:
        """Parse table data without explicit headers using pattern matching"""
        entries = []
        
        for row in table:
            if not row or len(row) < 4:
                continue
            
            try:
                # Try to identify date, time, session, platform, weight class patterns
                entry = self._extract_entry_from_row_pattern(row, meet_name)
                if entry:
                    entries.append(entry)
            except Exception as e:
                print(f"Error parsing row {row}: {e}")
                continue
        
        return entries
    
    def _extract_entry_from_row(self, row: List, header_map: Dict, meet_name: str, 
                                 current_date: Optional[str] = None, 
                                 current_session: Optional[int] = None) -> Optional[Dict]:
        """Extract a single entry from a row using header mapping"""
        
        # Get indices from header map
        date_idx = header_map.get('date_idx', 0)
        session_idx = header_map.get('session_idx', 1)
        platform_idx = header_map.get('platform_idx', 2)
        weigh_idx = header_map.get('weigh_idx', 3)
        time_idx = header_map.get('time_idx', 4)
        weight_class_idx = header_map.get('weight_class_idx', 7)
        
        # Extract raw values
        date_str = str(row[date_idx] or '').strip() if date_idx < len(row) else ''
        session_str = str(row[session_idx] or '').strip() if session_idx < len(row) else ''
        platform = str(row[platform_idx] or '').strip() if platform_idx < len(row) else ''
        weigh_time_str = str(row[weigh_idx] or '').strip() if weigh_idx < len(row) else ''
        start_time_str = str(row[time_idx] or '').strip() if time_idx < len(row) else ''
        weight_class = str(row[weight_class_idx] or '').strip() if weight_class_idx < len(row) else ''
        
        # Skip rows that don't have essential data
        if not platform or platform not in ['Red', 'White', 'Blue', 'Stars', 'Stripes', 'Rogue']:
            return None
        
        if not start_time_str or not weigh_time_str:
            return None
        
        # Use current date/session if not provided in this row
        if date_str and any(month in date_str for month in ['January', 'February', 'March', 'April', 'May', 'June', 
                                                              'July', 'August', 'September', 'October', 'November', 'December']):
            parsed_date = self._parse_date_from_text(date_str)
            if parsed_date:
                current_date = parsed_date
        
        if session_str and session_str.isdigit():
            current_session = int(session_str)
        
        # Must have date and session to create entry
        if not current_date or not current_session:
            return None
        
        # Parse times
        start_time = self._parse_time(start_time_str)
        weigh_time = self._parse_time(weigh_time_str)
        
        if not start_time or not weigh_time:
            return None
        
        # Preserve trailing flight/session letters (e.g. "69kg & 63+kg E")
        weight_class = weight_class.strip()
        
        return {
            'date': current_date,
            'session_id': current_session,
            'start_time': start_time.strftime('%H:%M:%S'),
            'weigh_in_time': weigh_time.strftime('%H:%M:%S'),
            'platform': platform,
            'weight_class': weight_class,
            'meet': meet_name
        }
    
    def _extract_entry_from_row_pattern(self, row: List, meet_name: str) -> Optional[Dict]:
        """Extract a single entry from a row using pattern matching"""
        # This is a placeholder - actual implementation depends on PDF structure
        return None
    
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
    
    def _parse_date(self, date_str: str) -> Optional[str]:
        """Parse date string into YYYY-MM-DD format"""
        if not date_str:
            return None
        
        date_str = str(date_str).strip()
        
        # Try common date formats
        formats = ['%Y-%m-%d', '%m/%d/%Y', '%m/%d/%y', '%B %d, %Y', '%b %d, %Y']
        
        for fmt in formats:
            try:
                dt = datetime.strptime(date_str, fmt)
                return dt.strftime('%Y-%m-%d')
            except ValueError:
                continue
        
        return None
    
    def _parse_date_from_text(self, date_str: str) -> Optional[str]:
        """Parse date from text format like 'Saturday June 21, 2025'"""
        if not date_str:
            return None
        
        date_str = str(date_str).strip()
        
        # Try to extract month day year pattern
        match = re.search(r'([A-Z][a-z]+)\s+(\d{1,2}),?\s+(\d{4})', date_str)
        if match:
            month_str = match.group(1)
            day = match.group(2)
            year = match.group(3)
            
            try:
                dt = datetime.strptime(f"{month_str} {day} {year}", "%B %d %Y")
                return dt.strftime('%Y-%m-%d')
            except ValueError:
                pass
        
        # Fallback to regular parsing
        return self._parse_date(date_str)
    
    def format_for_database(self, entries: List[Dict]) -> List[Dict]:
        """
        Format extracted entries to match database schema
        
        Args:
            entries: List of raw schedule entries
            
        Returns:
            List of formatted entries ready for database insertion
        """
        # If all_columns mode, return entries as-is (they're already formatted)
        if self.all_columns:
            return [entry for entry in entries if entry]
        
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
        """
        Perform a dry run to see what would be changed
        
        Args:
            meet_name: Name of the meet
            new_entries: List of new entries to be upserted
            
        Returns:
            Dictionary with statistics about what would change
        """
        print(f"\n{'='*60}")
        print(f"DRY RUN: {meet_name}")
        print(f"{'='*60}\n")
        
        # Query existing records for this meet
        existing_response = self.supabase.table('session_schedule').select('*').eq('meet', meet_name).execute()
        existing_records = existing_response.data if existing_response.data else []
        
        print(f"Found {len(existing_records)} existing records for '{meet_name}'")
        print(f"Processing {len(new_entries)} new entries\n")
        
        # Create a comparison
        existing_by_key = {}
        for record in existing_records:
            key = (
                record.get('date'),
                record.get('session_id'),
                record.get('platform'),
                record.get('weight_class')
            )
            existing_by_key[key] = record
        
        new_by_key = {}
        for entry in new_entries:
            key = (
                entry.get('date'),
                entry.get('session_id'),
                entry.get('platform'),
                entry.get('weight_class')
            )
            new_by_key[key] = entry
        
        # Determine what would be added/updated
        to_add = []
        to_update = []
        unchanged = []
        
        for key, new_entry in new_by_key.items():
            if key not in existing_by_key:
                to_add.append(new_entry)
            else:
                existing = existing_by_key[key]
                # Check if values differ
                if (existing.get('start_time') != new_entry.get('start_time') or
                    existing.get('weigh_in_time') != new_entry.get('weigh_in_time')):
                    to_update.append({
                        'existing': existing,
                        'new': new_entry
                    })
                else:
                    unchanged.append(new_entry)
        
        # Display summary
        print(f"SUMMARY:")
        print(f"  New entries to add: {len(to_add)}")
        print(f"  Existing entries to update: {len(to_update)}")
        print(f"  Unchanged entries: {len(unchanged)}")
        
        # Show details
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
            for item in to_update:
                print(f"\nExisting:")
                print(f"  {item['existing']}")
                print(f"New:")
                print(f"  {item['new']}")
        
        if unchanged:
            print(f"\n{'='*60}")
            print(f"UNCHANGED ENTRIES ({len(unchanged)}):")
            print(f"{'='*60}")
            df = pd.DataFrame(unchanged)
            print(tabulate(df, headers='keys', tablefmt='grid', showindex=False))
        
        return {
            'total_new': len(new_entries),
            'total_existing': len(existing_records),
            'to_add': len(to_add),
            'to_update': len(to_update),
            'unchanged': len(unchanged),
            'details': {
                'to_add': to_add,
                'to_update': to_update,
                'unchanged': unchanged
            }
        }
    
    def upsert_to_database(self, entries: List[Dict]) -> Dict:
        """
        Upsert entries to the database
        
        Args:
            entries: List of formatted entries
            
        Returns:
            Response from Supabase
        """
        if not entries:
            print("No entries to upsert")
            return {'data': [], 'count': 0}
        
        # Deduplicate entries based on unique constraint
        seen = {}
        for entry in entries:
            key = (entry['meet'], entry['session_id'], entry['platform'], entry['weight_class'])
            seen[key] = entry
        
        deduplicated = list(seen.values())
        
        if len(deduplicated) < len(entries):
            print(f"Warning: Removed {len(entries) - len(deduplicated)} duplicate entries from batch")
        
        print(f"Upserting {len(deduplicated)} entries to database...")
        
        # Unique constraint is meet + session_id + platform + weight_class
        response = self.supabase.table('session_schedule').upsert(
            deduplicated,
            on_conflict='meet,session_id,platform,weight_class'
        ).execute()
        
        print(f"Successfully upserted {len(deduplicated)} entries")
        return response
    
    def export_to_csv(self, entries: List[Dict], output_file: str, start_id: int = DEFAULT_CSV_START_ID, id_increment: int = DEFAULT_CSV_ID_INCREMENT):
        """Export entries to CSV file"""
        import csv
        
        if not entries:
            print("No entries to export")
            return
        
        if id_increment == 0:
            raise ValueError("id_increment cannot be 0")
        
        print(f"Exporting {len(entries)} entries to {output_file}...")
        print(f"CSV IDs: start={start_id}, increment={id_increment}")
        
        with open(output_file, 'w', newline='') as csvfile:
            if self.all_columns:
                # Collect all unique column names from all entries
                all_fieldnames = set()
                for entry in entries:
                    all_fieldnames.update(entry.keys())
                
                # Sort fieldnames for consistent ordering, but keep important ones first
                priority_fields = ['id', 'date', 'meet', 'sess', 'plat', 'weigh', 'time']
                fieldnames = ['id']
                
                # Add priority fields first (if they exist)
                for field in priority_fields:
                    matching = [f for f in all_fieldnames if field in f.lower() and f != 'id']
                    fieldnames.extend(sorted(matching))
                    all_fieldnames -= set(matching)
                
                # Add remaining fields alphabetically
                fieldnames.extend(sorted(all_fieldnames))
                
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames, extrasaction='ignore')
                
                writer.writeheader()
                for idx, entry in enumerate(entries):
                    row_id = start_id + (idx * id_increment)
                    row = {'id': row_id, **entry}
                    writer.writerow(row)
            else:
                # Standard mode with fixed columns
                fieldnames = ['id', 'date', 'session_id', 'start_time', 'weigh_in_time', 'platform', 'weight_class', 'meet']
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
                
                writer.writeheader()
                for idx, entry in enumerate(entries):
                    row_id = start_id + (idx * id_increment)
                    row = {'id': row_id, **entry}
                    writer.writerow(row)
        
        print(f"✓ Successfully exported to {output_file}")
    
    def scrape_and_upsert(self, pdf_url: str, meet_name: str, dry_run: bool = False) -> Dict:
        """
        Main method to scrape PDF and upsert to database
        
        Args:
            pdf_url: URL to the PDF file
            meet_name: Name of the meet
            dry_run: If True, only show what would be changed without actually upserting
            
        Returns:
            Dictionary with results
        """
        try:
            # Download PDF
            pdf_file = self.download_pdf(pdf_url)
            
            # Extract data
            raw_entries = self.extract_schedule_data(pdf_file, meet_name)
            
            if not raw_entries:
                print("WARNING: No schedule entries were extracted from the PDF")
                print("This might mean the PDF format is different than expected.")
                return {'success': False, 'error': 'No data extracted'}
            
            # Format for database
            formatted_entries = self.format_for_database(raw_entries)
            
            if not formatted_entries:
                print("WARNING: No valid entries after formatting")
                return {'success': False, 'error': 'No valid entries after formatting'}
            
            # Dry run or actual upsert
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
    
    parser = argparse.ArgumentParser(
        description='Scrape OWLCMS schedule from PDF and upsert to Supabase',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Use defaults from configuration (at top of file)
  python prelim_scraper.py --csv output.csv
  
  # Start CSV IDs at 1000 and increment by 1
  python prelim_scraper.py --csv output.csv --start-id 1000
  
  # Start CSV IDs at 500 and increment by 5
  python prelim_scraper.py --csv output.csv --start-id 500 --id-increment 5
  
  # Override with custom URL and meet name
  python prelim_scraper.py "https://example.com/schedule.pdf" "My Meet 2025" --csv output.csv
  
  # Extract all columns
  python prelim_scraper.py --all-columns --csv full_output.csv
        """
    )
    parser.add_argument('url', nargs='?', default=DEFAULT_PDF_URL, help=f'URL to the PDF file (default: configured in script)')
    parser.add_argument('meet_name', nargs='?', default=DEFAULT_MEET_NAME, help=f'Name of the meet/competition (default: configured in script)')
    parser.add_argument('--dry-run', action='store_true', help='Preview changes without actually upserting')
    parser.add_argument('--csv', help='Export to CSV file instead of database (provide filename)')
    parser.add_argument('--all-columns', action='store_true', help='Extract all columns from the PDF table')
    parser.add_argument('--start-id', type=int, default=DEFAULT_CSV_START_ID, help=f'Starting ID for CSV export (default: {DEFAULT_CSV_START_ID})')
    parser.add_argument('--id-increment', type=int, default=DEFAULT_CSV_ID_INCREMENT, help=f'ID increment step for CSV export (default: {DEFAULT_CSV_ID_INCREMENT})')
    
    args = parser.parse_args()
    
    # Show what configuration is being used
    print(f"Using URL: {args.url[:80]}...")
    print(f"Using Meet Name: {args.meet_name}")
    if args.all_columns:
        print("Mode: Extracting ALL columns")
    else:
        print("Mode: Extracting standard columns only")
    print()
    
    scraper = ScheduleScraper(all_columns=args.all_columns)
    
    if args.csv:
        # CSV export mode
        pdf_file = scraper.download_pdf(args.url)
        raw_entries = scraper.extract_schedule_data(pdf_file, args.meet_name)
        formatted_entries = scraper.format_for_database(raw_entries)
        
        if formatted_entries:
            scraper.export_to_csv(
                formatted_entries,
                args.csv,
                start_id=args.start_id,
                id_increment=args.id_increment
            )
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
