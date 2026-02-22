#!/usr/bin/env python3
"""
Local test script for Flat Format WSO Records Scraper

For Georgia, DMV, and Pacific Northwest WSOs

Usage:
    python test_flat.py                    # Default: fetch test
    python test_flat.py --test dry-run     # Preview database changes
    python test_flat.py --test upsert      # Test database upsert
    python test_flat.py --test full        # Full flow with Discord
"""

import os
import sys
import json
import argparse
from dotenv import load_dotenv

# Add parent directory to path to import scrapers
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment variables
load_dotenv()

# Import the scraper
from auto_scrapers.scraper_ga_pnw import WSORecordsFlatScraper


def test_fetch_data(wso_name: str, sheet_url: str):
    """Test: Fetch data from Google Sheet and display it."""
    print("=" * 80)
    print("TEST: FETCHING DATA FROM GOOGLE SHEET")
    print("=" * 80)
    
    scraper = WSORecordsFlatScraper(wso_name, sheet_url)
    
    # Scrape the sheet
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    
    print(f"\n✓ Successfully fetched {len(records)} records\n")
    
    # Display first 10 records
    print("Sample of records (first 10):")
    print("-" * 80)
    for i, record in enumerate(records[:10], 1):
        print(f"\n{i}. {record['wso']} | {record['age_category']} | {record['gender']} | {record['weight_class']}")
        print(f"   Snatch: {record.get('snatch_record')} kg")
        print(f"   C&J: {record.get('cj_record')} kg")
        print(f"   Total: {record.get('total_record')} kg")
    
    if len(records) > 10:
        print(f"\n... and {len(records) - 10} more records")
    
    # Save to JSON for inspection
    output_file = f"test_{wso_name.lower().replace(' ', '_')}_data.json"
    with open(output_file, 'w') as f:
        json.dump(records, f, indent=2)
    print(f"\n✓ Full data saved to: {output_file}")
    
    return records


def test_dry_run(wso_name: str, sheet_url: str):
    """Test: Preview what would be upserted without making changes."""
    print("=" * 80)
    print("TEST: DRY RUN - PREVIEW DATABASE CHANGES")
    print("=" * 80)
    
    scraper = WSORecordsFlatScraper(wso_name, sheet_url)
    scraper.setup_supabase_client()
    
    # Scrape the sheet
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    print(f"✓ Fetched {len(records)} records\n")
    
    # Query existing records from database
    print("Querying existing records from database...")
    existing = scraper.supabase_client.table('wso_records').select('*').eq('wso', wso_name).execute()
    existing_records = {
        (r['wso'], r['age_category'], r['gender'], r['weight_class']): r 
        for r in existing.data
    }
    print(f"✓ Found {len(existing_records)} existing records in database\n")
    
    # Compare and categorize changes
    new_records = []
    updated_records = []
    unchanged_records = []
    
    for record in records:
        key = (record['wso'], record['age_category'], record['gender'], record['weight_class'])
        existing_record = existing_records.get(key)
        
        if not existing_record:
            new_records.append(record)
        else:
            # Check if any values changed
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
    
    # Display summary
    print("=" * 80)
    print("DRY RUN SUMMARY")
    print("=" * 80)
    print(f"📊 New records to insert: {len(new_records)}")
    print(f"🔄 Records to update: {len(updated_records)}")
    print(f"✓ Unchanged records: {len(unchanged_records)}")
    print(f"📝 Total records: {len(records)}")
    
    # Show samples
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


def test_upsert(wso_name: str, sheet_url: str):
    """Test: Upsert data to database."""
    print("=" * 80)
    print("TEST: UPSERT DATA TO DATABASE")
    print("=" * 80)
    
    scraper = WSORecordsFlatScraper(wso_name, sheet_url)
    scraper.setup_supabase_client()
    
    # Scrape and upsert
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    print(f"✓ Fetched {len(records)} records\n")
    
    print("Upserting to database...")
    scraper.upsert_records(records)
    
    print("\n✅ Upsert completed!")
    print(f"📊 New records: {len(scraper.changes['inserted'])}")
    print(f"🔄 Updated records: {len(scraper.changes['updated'])}")


def test_full(wso_name: str, sheet_url: str):
    """Test: Full flow with Discord notification."""
    print("=" * 80)
    print("TEST: FULL FLOW (SCRAPE + UPSERT + DISCORD)")
    print("=" * 80)
    
    scraper = WSORecordsFlatScraper(wso_name, sheet_url)
    scraper.setup_supabase_client()
    scraper.setup_discord()
    
    # Scrape
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    print(f"✓ Fetched {len(records)} records\n")
    
    # Upsert
    print("Upserting to database...")
    scraper.upsert_records(records)
    print(f"✓ Upserted {len(scraper.changes['inserted'])} new, {len(scraper.changes['updated'])} updated\n")
    
    # Send Discord notification
    print("Sending Discord notification...")
    scraper.send_discord_notification()
    print("✓ Discord notification sent!\n")
    
    print("✅ Full flow completed successfully!")


def main():
    parser = argparse.ArgumentParser(description='Test WSO Records Scraper (Flat Format)')
    parser.add_argument('--test', choices=['fetch', 'dry-run', 'upsert', 'full'], 
                       default='fetch', help='Test mode to run')
    parser.add_argument('--wso', default='Georgia', help='WSO name to test')
    args = parser.parse_args()
    
    # WSO sheet URLs
    wso_urls = {
        'Georgia': 'https://docs.google.com/spreadsheets/d/1HM1H51pUmhoWDdSUp2RT-mCaUX2a8NB7aUSYVwWT0AU/edit?gid=908416148#gid=908416148',
        'DMV': 'https://docs.google.com/spreadsheets/d/1vYD2H6si9FyEO-Tc24DoFZOmST0r5hCn/edit?gid=799684986#gid=799684986',
        'Pacific Northwest': 'https://docs.google.com/spreadsheets/d/1pmZ1j3KJyms0Dlk3xz_VVf6mWq6tqdZj/edit?gid=1648178012#gid=1648178012'
    }
    
    wso_name = args.wso
    sheet_url = wso_urls.get(wso_name)
    
    if not sheet_url:
        print(f"Error: Unknown WSO '{wso_name}'. Available: {', '.join(wso_urls.keys())}")
        sys.exit(1)
    
    print("\n🧪 WSO RECORDS SCRAPER - LOCAL TEST (FLAT FORMAT)")
    print(f"WSO: {wso_name}")
    print(f"Sheet: {sheet_url}")
    print(f"Mode: {args.test}\n")
    
    try:
        if args.test == 'fetch':
            test_fetch_data(wso_name, sheet_url)
            print("\n✅ Test completed successfully!")
            print("\nNext steps:")
            print("1. Review the output above and check the JSON file")
            print("2. Run: python test_flat.py --test dry-run")
        elif args.test == 'dry-run':
            test_dry_run(wso_name, sheet_url)
            print("\n✅ Dry run completed!")
            print("\nNext steps:")
            print("1. Review the changes above")
            print("2. Run: python test_flat.py --test upsert")
        elif args.test == 'upsert':
            test_upsert(wso_name, sheet_url)
            print("\n✅ Upsert completed!")
            print("\nNext steps:")
            print("1. Verify data in Supabase")
            print("2. Run: python test_flat.py --test full")
        elif args.test == 'full':
            test_full(wso_name, sheet_url)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

