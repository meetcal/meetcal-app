#!/usr/bin/env python3
"""
PDF Scraper for USAMW Qualifying Totals
Extracts qualifying totals from PDF and updates Supabase database

USAGE:
  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

  # Dry-run (preview changes without updating database)
  python scraper_qt.py --dry-run
  
  # Full run (update database)
  python scraper_qt.py
"""

import os
import sys
import argparse
import requests
import pdfplumber
import pandas as pd
from io import BytesIO
from typing import List, Dict, Any, Optional, Union
from dotenv import load_dotenv

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)

# Load environment variables
load_dotenv()

# ============================================================================
# CONFIGURATION
# ============================================================================
PDF_URL = "https://storage.googleapis.com/production-ipower-v1-0-4/354/1018354/vixoE8Rk/4ba2d2b3200843e4bce0ff7ec7738742?fileName=QT_2026.pdf"
EVENT_NAME = "IMWA Worlds"
# ============================================================================


def scrape_qt_pdf(pdf_source: Union[str, BytesIO], event_name: str) -> pd.DataFrame:
    """
    Scrape qualifying totals from PDF file or BytesIO object.
    
    Based on the PDF structure:
    - MEN table: Header row with M35, M40, M45, M50, M55, M60, M65, M70, M75, M80, M85, M90+
    - WOMEN table: Header row with W35, W40, W45, W50, W55, W60, W65, W70, W75, W80, W85, W90+
    - Data rows: First column is weight class, subsequent columns are QTs for each age category
    
    Args:
        pdf_source: Path to the PDF file or BytesIO object containing PDF data
        event_name: Name of the event to use for all records
        
    Returns:
        pandas.DataFrame with columns: event_name, gender, age_category, weight_class, qualifying_total
    """
    data = []
    
    # Open the PDF file (works with both file paths and BytesIO objects)
    with pdfplumber.open(pdf_source) as pdf:
        # Iterate through all pages
        for page_num, page in enumerate(pdf.pages):
            # Extract tables from the page
            tables = page.extract_tables()
            
            for table_idx, table in enumerate(tables):
                if not table or len(table) < 2:
                    continue
                
                # Find the header row with age categories (M35, M40, etc. or W35, W40, etc.)
                # Based on debug output: age categories start at column 3 (index 3)
                # First table is Men, second table is Women
                header_idx = None
                age_categories = []
                gender = "Men" if table_idx == 0 else "Women"  # First table is Men, second is Women
                
                for row_idx, row in enumerate(table):
                    if not row or len(row) < 4:
                        continue
                    
                    # Check if this row contains age category headers starting at column 3
                    found_categories = []
                    found_gender_prefix = None
                    for col_idx in range(3, len(row)):  # Age categories start at column 3
                        cell = row[col_idx]
                        cell_str = str(cell or "").strip()
                        # Check for M35, M40, W35, W40, etc. or M90+, W90+, etc.
                        if cell_str and len(cell_str) >= 2:
                            cell_upper = cell_str.upper()
                            if (cell_upper[0] in ['M', 'W'] and 
                                (cell_upper[1:].replace('+', '').isdigit() or 
                                 (len(cell_upper) > 2 and cell_upper[1:3].isdigit()))):
                                # Extract age number
                                age_str = cell_upper[1:].replace('+', '').strip()
                                if age_str.isdigit():
                                    found_categories.append(f"Masters {age_str}")
                                    # Determine gender from first age category prefix
                                    if found_gender_prefix is None:
                                        found_gender_prefix = cell_upper[0]
                    
                    if found_categories:
                        header_idx = row_idx
                        age_categories = found_categories
                        # Override gender based on age category prefix if found
                        if found_gender_prefix == 'W':
                            gender = "Women"
                        elif found_gender_prefix == 'M':
                            gender = "Men"
                        break
                
                # If we didn't find header, use default based on gender
                if not age_categories:
                    age_categories = ["Masters 35", "Masters 40", "Masters 45", "Masters 50",
                                    "Masters 55", "Masters 60", "Masters 65", "Masters 70",
                                    "Masters 75", "Masters 80", "Masters 85", "Masters 90"]
                    header_idx = 0
                
                # Process data rows (skip header rows)
                # Based on debug output: weight class is in column 1, QTs start at column 3
                start_row = header_idx + 1 if header_idx is not None else 1
                for row_idx in range(start_row, len(table)):
                    row = table[row_idx]
                    if not row or len(row) < 4:
                        continue
                    
                    # Weight class is in column 1 (index 1)
                    weight_class_cell = str(row[1] or "").strip()
                    if not weight_class_cell:
                        continue
                    
                    # Clean weight class
                    weight_class_clean = weight_class_cell.replace('kg', '').strip()
                    if not weight_class_clean.replace('+', '').isdigit():
                        continue
                    
                    # Format weight class (e.g., "60" -> "60kg", "110+" -> "110+kg")
                    if weight_class_clean.endswith("+"):
                        weight_class = f"{weight_class_clean}kg"
                    else:
                        weight_class = f"{weight_class_clean}kg"
                    
                    # Extract qualifying totals starting at column 3 (index 3)
                    for age_idx, age_category in enumerate(age_categories):
                        col_idx = age_idx + 3  # QTs start at column 3
                        if col_idx >= len(row):
                            break
                        
                        qt_raw = row[col_idx]
                        if qt_raw is None:
                            continue
                        
                        # Convert to integer
                        try:
                            qt_str = str(qt_raw).strip()
                            qualifying_total = int(float(qt_str))
                        except (ValueError, TypeError):
                            continue
                        
                        # Add to data list
                        data.append({
                            'event_name': event_name,
                            'gender': gender,
                            'age_category': age_category,
                            'weight_class': weight_class,
                            'qualifying_total': qualifying_total
                        })
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    if len(df) == 0:
        # If we didn't extract data, try a simpler approach
        # Parse the tables more directly based on the known structure
        return scrape_qt_pdf_simple(pdf_source, event_name)
    
    # Sort by gender, age_category, weight_class (only if DataFrame has data)
    if len(df) > 0:
        df = df.sort_values(['gender', 'age_category', 'weight_class'])
        df = df.reset_index(drop=True)
    
    return df


def scrape_qt_pdf_simple(pdf_source: Union[str, BytesIO], event_name: str) -> pd.DataFrame:
    """
    Simpler PDF scraping approach - directly parse tables based on known structure.
    
    Based on the actual PDF structure:
    MEN: Weight classes 60, 65, 70, 75, 85, 95, 110, 110+
    WOMEN: Weight classes 49, 53, 57, 61, 69, 77, 86, 86+
    Age categories: 35, 40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90+
    """
    data = []
    
    with pdfplumber.open(pdf_source) as pdf:
        for page in pdf.pages:
            tables = page.extract_tables()
            
            # Define age categories (same for both genders)
            age_categories = ["Masters 35", "Masters 40", "Masters 45", "Masters 50",
                            "Masters 55", "Masters 60", "Masters 65", "Masters 70",
                            "Masters 75", "Masters 80", "Masters 85", "Masters 90"]
            
            for table_idx, table in enumerate(tables):
                # First table is Men, second table is Women
                gender = "Men" if table_idx == 0 else "Women"
                
                # Define expected weight classes based on gender
                if gender == "Women":
                    expected_weight_classes = ["49", "53", "57", "61", "69", "77", "86", "86+"]
                else:
                    expected_weight_classes = ["60", "65", "70", "75", "85", "95", "110", "110+"]
                if not table or len(table) < 2:
                    continue
                
                # Find header row with age categories (M35, M40, etc. or W35, W40, etc.)
                # Based on debug output: header row has age categories starting at column 3
                header_row_idx = None
                for row_idx, row in enumerate(table):
                    if not row or len(row) < 4:
                        continue
                    # Check if this row contains age category headers starting at column 3
                    found_age_cats = 0
                    found_gender_prefix = None
                    for col_idx in range(3, len(row)):  # Age categories start at column 3
                        cell = row[col_idx]
                        cell_str = str(cell or "").strip().upper()
                        if cell_str and (cell_str.startswith('M') or cell_str.startswith('W')):
                            if cell_str[1:].replace('+', '').isdigit():
                                found_age_cats += 1
                                if found_gender_prefix is None:
                                    found_gender_prefix = cell_str[0]
                    if found_age_cats >= 3:  # Found at least 3 age categories
                        header_row_idx = row_idx
                        # Override gender based on age category prefix
                        if found_gender_prefix == 'W':
                            gender = "Women"
                        elif found_gender_prefix == 'M':
                            gender = "Men"
                        break
                
                # If no header found, assume first row is header
                if header_row_idx is None:
                    header_row_idx = 0
                
                # Extract age categories from header row
                header_row = table[header_row_idx]
                extracted_age_cats = []
                # Age categories start at column 3 (index 3)
                for col_idx in range(3, len(header_row)):
                    cell = header_row[col_idx]
                    cell_str = str(cell or "").strip()
                    if cell_str:
                        # Check for M35, M40, W35, W40, etc.
                        cell_upper = cell_str.upper()
                        if (cell_upper.startswith('M') or cell_upper.startswith('W')) and len(cell_upper) >= 2:
                            age_num = cell_upper[1:].replace('+', '').strip()
                            if age_num.isdigit():
                                extracted_age_cats.append(f"Masters {age_num}")
                
                # Use extracted categories if found, otherwise use defaults
                if extracted_age_cats:
                    age_categories = extracted_age_cats
                
                # Process data rows (start after header)
                # Based on debug output: weight class is in column 1, QTs start at column 3
                for row_idx in range(header_row_idx + 1, len(table)):
                    row = table[row_idx]
                    if not row or len(row) < 4:
                        continue
                    
                    # Weight class is in column 1 (index 1)
                    weight_class_cell = str(row[1] or "").strip()
                    weight_class_raw = weight_class_cell.replace("kg", "").strip()
                    
                    # Check if weight class cell contains a number
                    if not weight_class_raw or not weight_class_raw.replace("+", "").isdigit():
                        continue
                    
                    # Parse weight class
                    if weight_class_raw.endswith("+"):
                        weight_class = f"{weight_class_raw}kg"
                    else:
                        weight_class = f"{weight_class_raw}kg"
                    
                    # Extract qualifying totals starting at column 3 (index 3)
                    for age_idx, age_category in enumerate(age_categories):
                        col_idx = age_idx + 3  # QTs start at column 3
                        if col_idx >= len(row):
                            break
                        
                        qt_raw = row[col_idx]
                        if qt_raw is None:
                            continue
                        
                        try:
                            qt_str = str(qt_raw).strip()
                            qualifying_total = int(float(qt_str))
                        except (ValueError, TypeError):
                            continue
                        
                        data.append({
                            'event_name': event_name,
                            'gender': gender,
                            'age_category': age_category,
                            'weight_class': weight_class,
                            'qualifying_total': qualifying_total
                        })
    
    df = pd.DataFrame(data)
    
    # Only sort if DataFrame has data
    if len(df) > 0:
        df = df.sort_values(['gender', 'age_category', 'weight_class'])
        df = df.reset_index(drop=True)
    else:
        print("Warning: No data extracted from PDF. Check PDF structure.")
    
    return df


class USAMWQTScraper:
    """Scraper for USAMW qualifying totals PDF."""
    
    def __init__(self, pdf_url: str, event_name: str):
        """Initialize the scraper."""
        self.pdf_url = pdf_url
        self.event_name = event_name
        self.supabase: Optional[Client] = None
    
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
    
    def setup_supabase_client(self):
        """Initialize Supabase client."""
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env")
        
        self.supabase = create_client(supabase_url, supabase_key)
        print("✓ Supabase client initialized")
    
    def df_to_records(self, df: pd.DataFrame) -> List[Dict[str, Any]]:
        """Convert DataFrame to list of records for database insertion."""
        records = []
        for _, row in df.iterrows():
            records.append({
                'event_name': str(row['event_name']),
                'gender': str(row['gender']),
                'age_category': str(row['age_category']),
                'weight_class': str(row['weight_class']),
                'qualifying_total': int(row['qualifying_total'])
            })
        return records
    
    def dry_run(self, records: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        Preview changes without updating database.
        
        Returns:
            Dictionary with 'to_insert', 'to_update', and 'unchanged' lists
        """
        if not self.supabase:
            self.setup_supabase_client()
        
        to_insert = []
        to_update = []
        unchanged = []
        
        print("\n" + "="*60)
        print("DRY RUN - Previewing changes")
        print("="*60 + "\n")
        
        for record in records:
            # Check if record exists
            existing = self.supabase.table('qualifying_totals').select('*').eq(
                'event_name', record['event_name']
            ).eq(
                'gender', record['gender']
            ).eq(
                'age_category', record['age_category']
            ).eq(
                'weight_class', record['weight_class']
            ).execute()
            
            if existing.data:
                # Record exists - check if update is needed
                db_record = existing.data[0]
                
                if db_record.get('qualifying_total') != record['qualifying_total']:
                    to_update.append({
                        'record': record,
                        'changes': {
                            'qualifying_total': {
                                'old': db_record.get('qualifying_total'),
                                'new': record['qualifying_total']
                            }
                        }
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
                print(f"  + {record['event_name']} | {record['age_category']} {record['gender']} "
                      f"{record['weight_class']}: {record['qualifying_total']}")
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
                print(f"  ~ {record['event_name']} | {record['age_category']} {record['gender']} "
                      f"{record['weight_class']}: {change_str}")
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
        Upsert qualifying totals to Supabase.
        
        Returns:
            Dictionary with 'inserted' and 'updated' lists
        """
        if not self.supabase:
            self.setup_supabase_client()
        
        inserted = []
        updated = []
        
        print("\n" + "="*60)
        print("UPDATING DATABASE")
        print("="*60 + "\n")
        
        for record in records:
            # Check if record exists
            existing = self.supabase.table('qualifying_totals').select('*').eq(
                'event_name', record['event_name']
            ).eq(
                'gender', record['gender']
            ).eq(
                'age_category', record['age_category']
            ).eq(
                'weight_class', record['weight_class']
            ).execute()
            
            if existing.data:
                # Update existing record
                db_record = existing.data[0]
                record_id = db_record['id']
                
                # Check if value changed
                if db_record.get('qualifying_total') != record['qualifying_total']:
                    self.supabase.table('qualifying_totals').update({
                        'qualifying_total': record['qualifying_total']
                    }).eq('id', record_id).execute()
                    updated.append(record)
                    print(f"  ✓ Updated: {record['event_name']} | {record['age_category']} "
                          f"{record['gender']} {record['weight_class']}: {record['qualifying_total']}")
            else:
                # Insert new record
                self.supabase.table('qualifying_totals').insert(record).execute()
                inserted.append(record)
                print(f"  ✓ Inserted: {record['event_name']} | {record['age_category']} "
                      f"{record['gender']} {record['weight_class']}: {record['qualifying_total']}")
        
        return {'inserted': inserted, 'updated': updated}
    
    def run(self, dry_run: bool = False, pdf_source: Optional[Union[str, BytesIO]] = None, output_path: str = 'output.csv'):
        """
        Main execution method.
        
        Args:
            dry_run: If True, preview changes without updating database
            pdf_source: PDF file path or BytesIO object. If None, uses configured URL.
            output_path: Path to save CSV output
        """
        print("="*60)
        print("USAMW Qualifying Totals Scraper")
        print("="*60 + "\n")
        print(f"Event: {self.event_name}")
        print(f"PDF URL: {self.pdf_url}\n")
        
        # Determine PDF source
        if pdf_source is None:
            # Use configured URL
            pdf_display = self.pdf_url
            pdf_source = self.download_pdf(self.pdf_url)
        elif isinstance(pdf_source, str) and pdf_source.startswith('http'):
            # It's a URL, download it
            pdf_display = pdf_source
            pdf_source = self.download_pdf(pdf_source)
        else:
            # It's a file path or BytesIO
            pdf_display = pdf_source if isinstance(pdf_source, str) else "provided PDF"
        
        print(f"Scraping data from {pdf_display}...")
        
        try:
            # Scrape the PDF
            df = scrape_qt_pdf(pdf_source, self.event_name)
            
            if len(df) == 0:
                print("Error: No data extracted from PDF")
                sys.exit(1)
            
            # Save to CSV
            df.to_csv(output_path, index=False)
            
            print(f"✓ Successfully scraped {len(df)} rows")
            print(f"✓ Data saved to {output_path}")
            
            # Convert to records
            records = self.df_to_records(df)
            
            # Setup Supabase (needed for both dry-run and full run)
            self.setup_supabase_client()
            
            # Process records
            if dry_run:
                result = self.dry_run(records)
                print(f"\n✓ Dry run complete: {len(result['to_insert'])} to insert, "
                      f"{len(result['to_update'])} to update")
            else:
                result = self.upsert_to_supabase(records)
                print(f"\n✓ Complete: {len(result['inserted'])} inserted, "
                      f"{len(result['updated'])} updated")
            
            # Display first few rows
            print("\nFirst 5 rows:")
            print(df.head())
            
        except FileNotFoundError:
            print(f"Error: Could not find PDF file")
            sys.exit(1)
        except Exception as e:
            print(f"Error: {e}")
            import traceback
            traceback.print_exc()
            sys.exit(1)


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Scrape USAMW qualifying totals from PDF and update Supabase'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without updating database'
    )
    parser.add_argument(
        '--pdf',
        type=str,
        default=None,
        help='Path to PDF file or URL. If not provided, uses configured URL.'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='output.csv',
        help='Path to output CSV file (default: output.csv)'
    )
    
    args = parser.parse_args()
    
    scraper = USAMWQTScraper(PDF_URL, EVENT_NAME)
    scraper.run(dry_run=args.dry_run, pdf_source=args.pdf, output_path=args.output)


if __name__ == '__main__':
    main()

