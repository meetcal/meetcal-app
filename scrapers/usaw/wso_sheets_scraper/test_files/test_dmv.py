#!/usr/bin/env python3
"""Test script for DMV scraper"""

import os
import sys
from dotenv import load_dotenv

# Add parent directory to path to import scrapers
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from auto_scrapers.scraper_dmv import WSORecordsDMVScraper

def main():
    wso_name = "DMV"
    sheet_url = "https://docs.google.com/spreadsheets/d/1vYD2H6si9FyEO-Tc24DoFZOmST0r5hCn/edit?gid=799684986#gid=799684986"
    
    print(f"\n🧪 Testing DMV Scraper")
    print(f"WSO: {wso_name}")
    print(f"Sheet: {sheet_url}\n")
    
    scraper = WSORecordsDMVScraper(wso_name, sheet_url)
    
    # Just scrape and show results
    print("Scraping sheet...")
    records = scraper.scrape_sheet()
    
    print(f"\n✓ Successfully fetched {len(records)} records\n")
    
    # Show first 10
    print("Sample records (first 10):")
    print("=" * 80)
    for i, record in enumerate(records[:10], 1):
        print(f"{i}. {record['age_category']} | {record['gender']} | {record['weight_class']}")
        print(f"   Snatch: {record.get('snatch_record')}, C&J: {record.get('cj_record')}, Total: {record.get('total_record')}")
    
    if len(records) > 10:
        print(f"\n... and {len(records) - 10} more records")
    
    # Save to JSON
    import json
    with open('test_dmv_data.json', 'w') as f:
        json.dump(records, f, indent=2)
    print(f"\n✓ Saved to test_dmv_data.json")

if __name__ == "__main__":
    main()
