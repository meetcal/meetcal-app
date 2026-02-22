#!/usr/bin/env python3
"""Test script for TN-KY scraper"""

import os
import sys
# Add parent directory to path to import scrapers
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from dotenv import load_dotenv
load_dotenv()

from auto_scrapers.scraper_tnky import WSORecordsTNKYScraper

def main():
    wso_name = "Tennessee-Kentucky"
    sheet_url = "https://docs.google.com/spreadsheets/d/11uUA0t05sEvHRjvDksC0VP1Yr2p_rC0JjHgVPEuYzhU/view?gid=867133960#gid=867133960"
    
    print(f"\n🧪 Testing TN-KY Scraper")
    print(f"WSO: {wso_name}")
    print(f"Sheet: {sheet_url}\n")
    
    scraper = WSORecordsTNKYScraper(wso_name, sheet_url)
    
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
    
    # Group by age category
    from collections import defaultdict
    by_age = defaultdict(int)
    for r in records:
        by_age[r['age_category']] += 1
    
    print("\nBreakdown by age category:")
    for age_cat in sorted(by_age.keys()):
        print(f"  {age_cat}: {by_age[age_cat]} records")
    
    # Save to JSON
    import json
    with open('test_tnky_data.json', 'w') as f:
        json.dump(records, f, indent=2)
    print(f"\n✓ Saved to test_tnky_data.json")

if __name__ == "__main__":
    main()
