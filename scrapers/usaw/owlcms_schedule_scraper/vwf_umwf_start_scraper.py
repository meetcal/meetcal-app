"""
VWF/UMWF Start List Scraper - Extract athlete data from start list PDFs

SETUP:
  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

USAGE:
  # Use default URL and output file
  source venv/bin/activate && python vwf_umwf_start_scraper.py
  
  # Custom URL and output file
  source venv/bin/activate && python vwf_umwf_start_scraper.py --url "https://..." --csv output.csv
"""

import re
import requests
from io import BytesIO
from typing import List, Dict, Optional
import pdfplumber
import csv

# Default configuration
DEFAULT_PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/bltaf13d0f8e4d7f2ff/690f8f3a424c334535bc914e/2025_-_VWF_UMWF_-_Start_List.pdf"
DEFAULT_MEET_NAME = "2025 Virus Weightlifting Finals, Powered by Rogue Fitness"
DEFAULT_OUTPUT_FILE = "vwf_umwf_start_list.csv"


class VWFStartListScraper:
    """Scraper for extracting athlete data from VWF/UMWF start list PDFs"""
    
    def __init__(self):
        """Initialize the scraper"""
        pass
    
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
    
    def extract_athlete_data(self, pdf_file: BytesIO, meet_name: str) -> List[Dict]:
        """
        Extract athlete data from PDF
        
        Args:
            pdf_file: BytesIO object containing PDF data
            meet_name: Name of the meet/competition
            
        Returns:
            List of dictionaries containing athlete entries
        """
        print("Extracting data from PDF...")
        athletes = []
        
        # Track the last known header map across pages
        self.last_header_map = None
        
        with pdfplumber.open(pdf_file) as pdf:
            for page_num, page in enumerate(pdf.pages, 1):
                print(f"Processing page {page_num}/{len(pdf.pages)}...")
                
                # Extract tables from the page
                tables = page.extract_tables()
                
                if not tables:
                    print(f"No tables found on page {page_num}")
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
                    athletes.extend(entries)
        
        print(f"Extracted {len(athletes)} total athlete entries")
        return athletes
    
    def _parse_table(self, table: List[List], meet_name: str) -> List[Dict]:
        """
        Parse a table from the PDF into athlete entries
        
        Args:
            table: 2D list representing a table
            meet_name: Name of the meet
            
        Returns:
            List of athlete entry dictionaries
        """
        entries = []
        
        # Find the header row
        header_row = None
        header_row_idx = None
        
        for idx, row in enumerate(table):
            if not row:
                continue
            
            row_text = ' '.join([str(cell or '').lower() for cell in row])
            
            # Look for header keywords
            if ('first' in row_text and 'name' in row_text) or \
               ('last' in row_text and 'name' in row_text) or \
               ('state' in row_text and 'year' in row_text and 'age' in row_text):
                header_row = row
                header_row_idx = idx
                break
        
        if not header_row:
            # No header found - use the last known header from previous pages
            if self.last_header_map:
                print("  Using header map from previous page...")
                # Parse all rows using the saved header map
                for row_idx, row in enumerate(table):
                    if not row or all(cell is None or str(cell).strip() == '' for cell in row):
                        continue
                    
                    try:
                        entry = self._extract_athlete_from_row(row, self.last_header_map, meet_name)
                        if entry:
                            entries.append(entry)
                    except Exception as e:
                        # Silently skip unparseable rows on continuation pages
                        continue
            else:
                print("  Warning: Could not find header row and no previous header available")
            return entries
        
        # Create header map and save it for future pages
        header_map = self._create_header_map(header_row)
        self.last_header_map = header_map
        
        # Parse data rows
        for row_idx in range(header_row_idx + 1, len(table)):
            row = table[row_idx]
            
            if not row or all(cell is None or str(cell).strip() == '' for cell in row):
                continue
            
            try:
                entry = self._extract_athlete_from_row(row, header_map, meet_name)
                if entry:
                    entries.append(entry)
            except Exception as e:
                print(f"  Error parsing row {row}: {e}")
                continue
        
        return entries
    
    def _create_header_map(self, header_row: List) -> Dict[str, int]:
        """
        Create a mapping of column names to indices
        
        Args:
            header_row: The header row from the table
            
        Returns:
            Dictionary mapping field names to column indices
        """
        header_map = {}
        
        for idx, header in enumerate(header_row):
            if not header:
                continue
            
            header_lower = str(header).lower().strip().replace('\n', ' ')
            
            # Map columns to standardized names
            if 'first' in header_lower and 'name' in header_lower:
                header_map['first_name'] = idx
            elif 'last' in header_lower and 'name' in header_lower:
                header_map['last_name'] = idx
            elif header_lower == 'state':
                header_map['state'] = idx
            elif header_lower == 'year':
                header_map['year'] = idx
            elif header_lower == 'age':
                header_map['age'] = idx
            elif 'club' in header_lower and 'name' in header_lower:
                header_map['club'] = idx
            elif header_lower == 'event':
                header_map['event'] = idx
            elif header_lower == 'gender':
                header_map['gender'] = idx
            elif 'age' in header_lower and 'group' in header_lower:
                header_map['age_group'] = idx
            elif 'weight' in header_lower and 'class' in header_lower:
                header_map['weight_class'] = idx
            elif 'entry' in header_lower and 'total' in header_lower:
                header_map['entry_total'] = idx
            elif header_lower == 'military':
                header_map['military'] = idx
        
        return header_map
    
    def _extract_athlete_from_row(self, row: List, header_map: Dict[str, int], meet_name: str) -> Optional[Dict]:
        """
        Extract athlete data from a single row
        
        Args:
            row: The data row
            header_map: Mapping of field names to column indices
            meet_name: Name of the meet (unused, kept for compatibility)
            
        Returns:
            Dictionary containing athlete data, or None if invalid
        """
        # Extract raw values
        first_name = self._get_cell_value(row, header_map.get('first_name'))
        last_name = self._get_cell_value(row, header_map.get('last_name'))
        state = self._get_cell_value(row, header_map.get('state'))
        year = self._get_cell_value(row, header_map.get('year'))
        age = self._get_cell_value(row, header_map.get('age'))
        club = self._get_cell_value(row, header_map.get('club'))
        event = self._get_cell_value(row, header_map.get('event'))
        gender = self._get_cell_value(row, header_map.get('gender'))
        age_group = self._get_cell_value(row, header_map.get('age_group'))
        weight_class = self._get_cell_value(row, header_map.get('weight_class'))
        entry_total = self._get_cell_value(row, header_map.get('entry_total'))
        military = self._get_cell_value(row, header_map.get('military'))
        
        # Validate required fields
        if not first_name or not last_name:
            return None
        
        if not age:
            return None
        
        if not weight_class:
            return None
        
        if not entry_total:
            return None
        
        # Construct full name
        name = f"{first_name} {last_name}".strip()
        
        # Convert gender (W -> Female, M -> Male)
        gender_full = None
        if gender:
            if gender.upper() in ['W', 'F']:
                gender_full = 'Female'
            elif gender.upper() == 'M':
                gender_full = 'Male'
        
        # Determine if adaptive and clean up event name
        adaptive = False
        clean_event = event or ''
        
        if event and 'adaptive' in event.lower():
            adaptive = True
            # Remove "ADAPTIVE" and variations from the event name
            clean_event = re.sub(r'\s*ADAPTIVE\s*', ' ', event, flags=re.IGNORECASE)
            # Clean up extra spaces and leading/trailing spaces
            clean_event = ' '.join(clean_event.split()).strip()
            # Remove leading "+ " or " +" if present after removal
            clean_event = re.sub(r'^\+\s*|\s*\+$', '', clean_event).strip()
        
        # Clean up values
        age = self._clean_numeric(age)
        entry_total = self._clean_numeric(entry_total)
        weight_class = self._clean_weight_class(weight_class)
        
        # Build the entry
        entry = {
            'name': name,
            'age': age,
            'club': club or '',
            'gender': gender_full or '',
            'weight_class': weight_class,
            'entry_total': entry_total,
            'session_number': '',  # Not available in start list
            'session_platform': '',  # Not available in start list
            'meet': clean_event,  # Use cleaned event name
            'adaptive': 'true' if adaptive else 'false'
        }
        
        return entry
    
    def _get_cell_value(self, row: List, idx: Optional[int]) -> Optional[str]:
        """
        Safely get a cell value from a row
        
        Args:
            row: The row to extract from
            idx: The column index
            
        Returns:
            The cell value as a string, or None
        """
        if idx is None or idx >= len(row):
            return None
        
        value = row[idx]
        if value is None:
            return None
        
        # Clean the value
        value = str(value).strip()
        value = value.replace('\n', ' ').replace('\r', ' ')
        value = ' '.join(value.split())  # Remove extra whitespace
        
        return value if value else None
    
    def _clean_numeric(self, value: Optional[str]) -> str:
        """Clean numeric value"""
        if not value:
            return ''
        
        # Remove any non-numeric characters except negative sign and decimal
        cleaned = re.sub(r'[^\d.-]', '', value)
        return cleaned if cleaned else ''
    
    def _clean_weight_class(self, value: Optional[str]) -> str:
        """Clean weight class value"""
        if not value:
            return ''
        
        # Weight class might be like "48", "53", "86+", etc.
        value = value.strip()
        
        # Remove any trailing letters or extra characters that aren't + sign
        value = re.sub(r'[A-Za-z\s]+$', '', value)
        
        return value
    
    def export_to_csv(self, athletes: List[Dict], output_file: str):
        """
        Export athlete data to CSV file
        
        Args:
            athletes: List of athlete dictionaries
            output_file: Path to output CSV file
        """
        if not athletes:
            print("No athletes to export")
            return
        
        print(f"Exporting {len(athletes)} athletes to {output_file}...")
        
        fieldnames = [
            'name',
            'age',
            'club',
            'gender',
            'weight_class',
            'entry_total',
            'session_number',
            'session_platform',
            'meet',
            'adaptive'
        ]
        
        with open(output_file, 'w', newline='', encoding='utf-8') as csvfile:
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            writer.writeheader()
            writer.writerows(athletes)
        
        print(f"✓ Successfully exported to {output_file}")
    
    def scrape_and_export(self, pdf_url: str, meet_name: str, output_file: str):
        """
        Main method to scrape PDF and export to CSV
        
        Args:
            pdf_url: URL to the PDF file
            meet_name: Name of the meet
            output_file: Path to output CSV file
        """
        try:
            # Download PDF
            pdf_file = self.download_pdf(pdf_url)
            
            # Extract data
            athletes = self.extract_athlete_data(pdf_file, meet_name)
            
            if not athletes:
                print("WARNING: No athlete data was extracted from the PDF")
                return False
            
            # Export to CSV
            self.export_to_csv(athletes, output_file)
            
            return True
        
        except Exception as e:
            print(f"ERROR: {e}")
            import traceback
            traceback.print_exc()
            return False


def main():
    """Main entry point for CLI usage"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='Scrape VWF/UMWF start list from PDF and export to CSV',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  # Use defaults
  python vwf_umwf_start_scraper.py
  
  # Custom URL and output file
  python vwf_umwf_start_scraper.py --url "https://example.com/startlist.pdf" --csv output.csv
        """
    )
    parser.add_argument('--url', default=DEFAULT_PDF_URL, help='URL to the PDF file')
    parser.add_argument('--meet', default=DEFAULT_MEET_NAME, help='Name of the meet')
    parser.add_argument('--csv', default=DEFAULT_OUTPUT_FILE, help='Output CSV filename')
    
    args = parser.parse_args()
    
    # Show configuration
    print(f"Using URL: {args.url[:80]}...")
    print(f"Using Meet Name: {args.meet}")
    print(f"Output File: {args.csv}")
    print()
    
    scraper = VWFStartListScraper()
    success = scraper.scrape_and_export(args.url, args.meet, args.csv)
    
    if success:
        print("\n✓ Scraping completed successfully")
    else:
        print("\n✗ Scraping failed")
        exit(1)


if __name__ == '__main__':
    main()

