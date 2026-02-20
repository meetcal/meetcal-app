#!/usr/bin/env python3
"""Full test script for DMV scraper with dry-run, upsert, full modes"""

import os
import sys
import argparse
import json
from dotenv import load_dotenv

# Add parent directory to path to import scrapers
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

load_dotenv()

from auto_scrapers.scraper_dmv import WSORecordsDMVScraper

def test_dry_run(wso_name, sheet_url):
    """Preview what would be upserted without making changes."""
    print("=" * 80)
    print("TEST: DRY RUN - PREVIEW DATABASE CHANGES")
    print("=" * 80)
    
    scraper = WSORecordsDMVScraper(wso_name, sheet_url)
    scraper.setup_supabase_client()
    
    # Scrape
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    print(f"✓ Fetched {len(records)} records\n")
    
    # Query existing
    print("Querying existing records from database...")
    existing = scraper.supabase_client.table('wso_records').select('*').eq('wso', wso_name).execute()
    existing_records = {
        (r['wso'], r['age_category'], r['gender'], r['weight_class']): r 
        for r in existing.data
    }
    print(f"✓ Found {len(existing_records)} existing records in database\n")
    
    # Compare
    new_records = []
    updated_records = []
    unchanged_records = []
    
    for record in records:
        key = (record['wso'], record['age_category'], record['gender'], record['weight_class'])
        existing_record = existing_records.get(key)
        
        if not existing_record:
            new_records.append(record)
        else:
            changed = False
            changes = []
            
            for field in ['snatch_record', 'cj_record', 'total_record']:
                old_val = existing_record.get(field)
                new_val = record.get(field)
                if old_val != new_val:
                    changed = True
                    changes.append(f"{field}: {old_val} → {new_val}")
            
            if changed:
                updated_records.append((record, changes))
            else:
                unchanged_records.append(record)
    
    # Display
    print("=" * 80)
    print("DRY RUN SUMMARY")
    print("=" * 80)
    print(f"📊 New records to insert: {len(new_records)}")
    print(f"🔄 Records to update: {len(updated_records)}")
    print(f"✓ Unchanged records: {len(unchanged_records)}")
    print(f"📝 Total records: {len(records)}")
    
    if new_records:
        print("\n" + "=" * 80)
        print("SAMPLE NEW RECORDS (first 5)")
        print("=" * 80)
        for record in new_records[:5]:
            print(f"\n{record['age_category']} | {record['gender']} | {record['weight_class']}")
            print(f"  Snatch: {record.get('snatch_record')}, C&J: {record.get('cj_record')}, Total: {record.get('total_record')}")
        if len(new_records) > 5:
            print(f"\n... and {len(new_records) - 5} more new records")
    
    if updated_records:
        print("\n" + "=" * 80)
        print("SAMPLE UPDATED RECORDS (first 5)")
        print("=" * 80)
        for record, changes in updated_records[:5]:
            print(f"\n{record['age_category']} | {record['gender']} | {record['weight_class']}")
            for change in changes:
                print(f"  {change}")
        if len(updated_records) > 5:
            print(f"\n... and {len(updated_records) - 5} more updated records")
    
    print("\n" + "=" * 80)
    print("⚠️  DRY RUN - No changes were made to the database")
    print("=" * 80)

def main():
    parser = argparse.ArgumentParser(description='Test DMV Scraper')
    parser.add_argument('--test', choices=['fetch', 'dry-run', 'upsert', 'full'], 
                       default='dry-run', help='Test mode to run')
    args = parser.parse_args()
    
    wso_name = "DMV"
    sheet_url = "https://docs.google.com/spreadsheets/d/1vYD2H6si9FyEO-Tc24DoFZOmST0r5hCn/edit?gid=799684986#gid=799684986"
    
    print(f"\n🧪 DMV SCRAPER TEST")
    print(f"WSO: {wso_name}")
    print(f"Mode: {args.test}\n")
    
    if args.test == 'dry-run':
        test_dry_run(wso_name, sheet_url)
    else:
        print(f"Mode '{args.test}' not implemented yet. Only 'dry-run' is available.")

if __name__ == "__main__":
    main()
