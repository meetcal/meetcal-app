#!/usr/bin/env python3
"""
PDF Scraper for Qualifying Totals
Extracts event data from qt.pdf and converts to CSV format
Pushes data to Supabase database

USAGE:
  # Dry-run (preview changes without updating database)
  source venv/bin/activate && python scraper.py --dry-run
  
  # Full run (update database)
  source venv/bin/activate && python scraper.py
"""

import os
import sys
import argparse
import requests
import pdfplumber
import pandas as pd
from io import BytesIO
from datetime import datetime
from typing import List, Dict, Any, Optional, Union
from dotenv import load_dotenv

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)

# Load environment variables
load_dotenv()


def scrape_qt_pdf(pdf_source: Union[str, BytesIO]):
    """
    Scrape qualifying totals from PDF file or BytesIO object.
    
    Args:
        pdf_source: Path to the PDF file or BytesIO object containing PDF data
        
    Returns:
        pandas.DataFrame with columns: event_name, gender, age_category, weight_class, qualifying_total
    """
    data = []
    
    # Event name mapping
    event_mapping = {
        'Series': 'Virus Series 2',
        'Finals': 'Virus Finals',
        'YouthNationals': 'Nationals',
        'JuniorNationals': 'Nationals',
        'Junior Nationals': 'Nationals',
        'Masters Nationals': 'Nationals',
        'MastersNationals': 'Nationals',
        'U25Nationals': 'Nationals',
        'U23Nationals': 'Nationals',
        'UniversityNationals': 'Nationals'
    }
    
    # Open the PDF file (works with both file paths and BytesIO objects)
    with pdfplumber.open(pdf_source) as pdf:
        # Iterate through all pages
        for page_num, page in enumerate(pdf.pages):
            # Extract tables from the page
            tables = page.extract_tables()
            
            for table in tables:
                if not table:
                    continue

                # Determine starting row (skip header rows on first page)
                # First page has 2 header rows: title row + column headers
                start_row = 2 if page_num == 0 else 0

                # Track QT values from merged cells
                pending_qt_values = []

                # Process all rows
                for row in table[start_row:]:
                    if not row or len(row) < 5:
                        continue

                    # Extract values (columns are always in same order)
                    # PDF now has 6 columns: Event, Age, Gender, Bodyweight, QT, Adaptive
                    # We ignore the 6th column (Adaptive)
                    event_name = row[0]
                    age_category = row[1]
                    gender = row[2]
                    weight_class = row[3]
                    qualifying_total = row[4]

                    # Skip empty rows or actual header rows
                    if not event_name or event_name == 'Event':
                        continue

                    if not all([event_name, age_category, gender, weight_class]):
                        continue

                    # Handle merged cells - QT column sometimes contains multiple values
                    # separated by newlines (one per weight class)
                    if qualifying_total and '\n' in str(qualifying_total):
                        qt_values = str(qualifying_total).split('\n')
                        qualifying_total = qt_values[0]
                        pending_qt_values = qt_values[1:]
                    elif qualifying_total is None and pending_qt_values:
                        qualifying_total = pending_qt_values.pop(0)

                    if not qualifying_total:
                        continue
                    
                    # Convert gender to full name
                    if gender == 'M':
                        gender = 'Men'
                    elif gender == 'W':
                        gender = 'Women'
                    
                    # Convert event name to full name
                    if event_name in event_mapping:
                        event_name = event_mapping[event_name]
                    
                    # Convert age category format
                    # 11&U -> U11, 13&U -> U13, etc.
                    if '&U' in age_category:
                        age_num = age_category.replace('&U', '')
                        age_category = f'U{age_num}'
                    # 14-15yo -> U15, 16-17yo -> U17
                    elif age_category == '14-15yo':
                        age_category = 'U15'
                    elif age_category == '16-17yo':
                        age_category = 'U17'
                    # Unis -> University
                    elif age_category == 'Unis':
                        age_category = 'University'
                    # Open -> Senior
                    elif age_category == 'Open':
                        age_category = 'Senior'
                    # Masters35 -> Masters 35, Masters40 -> Masters 40, etc.
                    elif age_category.startswith('Masters') and age_category != 'Masters':
                        age_num = age_category.replace('Masters', '')
                        age_category = f'Masters {age_num}'
                    
                    # Convert qualifying_total to integer
                    try:
                        qualifying_total_int = int(float(str(qualifying_total).strip()))
                    except (ValueError, TypeError):
                        continue  # Skip rows with invalid qualifying totals
                    
                    # Add to data list
                    data.append({
                        'event_name': event_name,
                        'gender': gender,
                        'age_category': age_category,
                        'weight_class': weight_class,
                        'qualifying_total': qualifying_total_int
                    })
    
    # Create DataFrame
    df = pd.DataFrame(data)
    
    # Sort by event_name, gender, age_category, weight_class
    # Define custom sort order for age categories
    age_order = ['U11', 'U13', 'U15', 'U17', 'Junior', 'U23', 'U25', 'Senior', 'University',
                 'Masters 35', 'Masters 40', 'Masters 45', 'Masters 50', 
                 'Masters 55', 'Masters 60', 'Masters 65', 'Masters 70',
                 'Masters 75', 'Masters 80', 'Masters 85']
    
    # Create categorical type for proper sorting
    df['age_category'] = pd.Categorical(df['age_category'], categories=age_order, ordered=True)
    
    # Create a numeric sort key for weight class
    def weight_sort_key(weight):
        # Extract numeric value from weight class (e.g., "60kg" -> 60, "65+kg" -> 65)
        import re
        match = re.match(r'(\d+)', str(weight))
        if match:
            return int(match.group(1))
        return 0
    
    df['weight_sort'] = df['weight_class'].apply(weight_sort_key)
    
    # Sort the dataframe
    df = df.sort_values(['event_name', 'gender', 'age_category', 'weight_sort'])
    
    # Drop the temporary sort column
    df = df.drop('weight_sort', axis=1)
    
    # Reset index
    df = df.reset_index(drop=True)
    
    return df


class QualifyingTotalsScraper:
    """Scraper for qualifying totals PDF."""
    
    # Default PDF URL
    DEFAULT_PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt6415479b24df0e62/6920ac1864580932d629f056/2026_-_New_QTs_After_August_1_(1).pdf"
    
    def __init__(self):
        """Initialize the scraper."""
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
            pdf_source: PDF file path, URL, or BytesIO object. If None, uses default URL.
            output_path: Path to save CSV output
        """
        print("="*60)
        print("Qualifying Totals Scraper")
        print("="*60 + "\n")
        
        # Determine PDF source
        if pdf_source is None:
            # Use default URL
            pdf_display = self.DEFAULT_PDF_URL
            pdf_source = self.download_pdf(self.DEFAULT_PDF_URL)
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
            df = scrape_qt_pdf(pdf_source)
            
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
        description='Scrape qualifying totals from PDF and update Supabase'
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
        help='Path to PDF file or URL. If not provided, uses default URL from USA Weightlifting.'
    )
    parser.add_argument(
        '--output',
        type=str,
        default='output.csv',
        help='Path to output CSV file (default: output.csv)'
    )
    
    args = parser.parse_args()
    
    scraper = QualifyingTotalsScraper()
    scraper.run(dry_run=args.dry_run, pdf_source=args.pdf, output_path=args.output)


if __name__ == '__main__':
    main()

