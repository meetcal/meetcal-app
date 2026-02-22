#!/usr/bin/env python3
"""Test script for PA/WV scraper."""

import sys
import os
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auto_scrapers.scraper_pawv import WSORecordsPAWVScraper
from dotenv import load_dotenv

def main():
    """Test the PA/WV scraper."""
    load_dotenv()
    
    # Published sheet ID from the pubhtml URLs
    sheet_id = "2PACX-1vR8exp9-mwi8dpkZa9-48G-CUVuZ5rAlpOYdMCiNMka25wZ6V2XPLurpgMDtyiarqnQxYrW6dWfQ042"
    
    scraper = WSORecordsPAWVScraper("Pennsylvania-West Virginia", sheet_id)
    
    print("="*80)
    print("FETCHING PA/WV RECORDS")
    print("="*80)
    
    records = scraper.scrape_all_tabs()
    
    print(f"\nTotal records scraped: {len(records)}")
    
    # Save to file
    output_file = "test_pawv_data.json"
    with open(output_file, 'w') as f:
        json.dump(records, f, indent=2)
    
    print(f"✓ Data saved to {output_file}")
    
    # Show sample records
    print("\n--- Sample Records (first 20) ---")
    for rec in records[:20]:
        print(f"{rec['age_category']:15} | {rec['gender']:6} | {rec['weight_class']:5} | "
              f"Snatch: {str(rec.get('snatch_record') or '-'):4} | "
              f"C&J: {str(rec.get('cj_record') or '-'):4} | "
              f"Total: {str(rec.get('total_record') or '-'):4}")
    
    if len(records) > 20:
        print(f"... and {len(records) - 20} more records")
    
    # Count by age category
    print("\n--- Records by Age Category ---")
    by_age = {}
    for rec in records:
        age = rec['age_category']
        by_age[age] = by_age.get(age, 0) + 1
    
    for age, count in sorted(by_age.items()):
        print(f"  {age}: {count} records")


if __name__ == "__main__":
    main()

