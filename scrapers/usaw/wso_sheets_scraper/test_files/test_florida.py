#!/usr/bin/env python3
"""
Basic test script for Florida WSO scraper
"""

import sys
import os
import json

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auto_scrapers.scraper_florida import WSORecordsFloridaScraper

def main():
    print("\n🧪 Testing Florida Scraper")
    print("WSO: Florida")
    print("Sheet: https://docs.google.com/spreadsheets/d/16sNrOTnGrGeXE4L5skgCfE5vLTA7ggpaHWfMQNh0DfQ/view?gid=490899077#gid=490899077")
    
    scraper = WSORecordsFloridaScraper(
        "Florida",
        "https://docs.google.com/spreadsheets/d/16sNrOTnGrGeXE4L5skgCfE5vLTA7ggpaHWfMQNh0DfQ/view?gid=490899077#gid=490899077"
    )
    
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    
    print(f"\n✓ Successfully fetched {len(records)} records")
    
    # Show sample records
    print(f"\nSample records (first 10):")
    print("=" * 80)
    for i, rec in enumerate(records[:10], 1):
        print(f"{i}. {rec['age_category']:15} | {rec['gender']:6} | {rec['weight_class']:5}")
        print(f"   Snatch: {rec.get('snatch_record')}, C&J: {rec.get('cj_record')}, Total: {rec.get('total_record')}")
    
    if len(records) > 10:
        print(f"\n... and {len(records) - 10} more records")
    
    # Show breakdown by age category
    from collections import Counter
    age_counts = Counter(r['age_category'] for r in records)
    print(f"\nBreakdown by age category:")
    for age, count in sorted(age_counts.items()):
        print(f"  {age}: {count} records")
    
    # Save to file for inspection
    output_file = "test_florida_data.json"
    with open(output_file, 'w') as f:
        json.dump(records, f, indent=2)
    print(f"\n✓ Saved to {output_file}")

if __name__ == "__main__":
    main()

