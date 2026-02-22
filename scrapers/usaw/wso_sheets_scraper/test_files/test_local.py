#!/usr/bin/env python3
"""
Local test script for WSO Records Scraper

This script allows you to test the scraper locally without deploying to GitHub Actions.
It has multiple test modes to verify each step of the process.
"""

import os
import sys
import json
import argparse
from typing import List, Dict, Any
from dotenv import load_dotenv

# Add parent directory to path to import scrapers
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# Load environment variables from .env file
load_dotenv()

# Import the scraper
from auto_scrapers.scraper_ohio import WSORecordsScraper


def test_fetch_data(wso_name: str, sheet_url: str):
    """Test 1: Fetch data from Google Sheet and display it."""
    print("=" * 80)
    print("TEST 1: FETCHING DATA FROM GOOGLE SHEET")
    print("=" * 80)
    
    scraper = WSORecordsScraper(wso_name, sheet_url)
    
    # Only setup Google client
    scraper.setup_google_client()
    
    # Scrape the sheet
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    
    print(f"\n✓ Successfully fetched {len(records)} records\n")
    
    # Display first 10 records
    print("Sample of records (first 10):")
    print("-" * 80)
    for i, record in enumerate(records[:10], 1):
        print(f"\n{i}. {record['wso']} | {record['age_category']} | {record['gender']} | {record['weight_class']}")
        print(f"   Snatch: {record.get('snatch_record', 'N/A')} kg")
        print(f"   C&J: {record.get('cj_record', 'N/A')} kg")
        print(f"   Total: {record.get('total_record', 'N/A')} kg")
    
    if len(records) > 10:
        print(f"\n... and {len(records) - 10} more records")
    
    # Save to JSON for inspection
    output_file = "test_scraped_data.json"
    with open(output_file, 'w') as f:
        json.dump(records, f, indent=2)
    print(f"\n✓ Full data saved to: {output_file}")
    print("\nYou can inspect this file to verify all data was scraped correctly.")
    
    return records


def test_dry_run(wso_name: str, sheet_url: str):
    """Test 2: Dry run - show what would be upserted without touching database."""
    print("\n" + "=" * 80)
    print("TEST 2: DRY RUN - PREVIEW UPSERT (NO DATABASE CHANGES)")
    print("=" * 80)
    
    scraper = WSORecordsScraper(wso_name, sheet_url)
    
    # Setup clients
    scraper.setup_google_client()
    scraper.setup_supabase_client()
    
    # Scrape the sheet
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    print(f"✓ Fetched {len(records)} records")
    
    # Query database to see what would happen
    print("\nAnalyzing what would be upserted...")
    would_insert = []
    would_update = []
    would_skip = []
    
    for record in records:
        # Query for existing record
        existing = scraper.supabase_client.table("wso_records").select("*").match({
            "wso": record["wso"],
            "age_category": record["age_category"],
            "gender": record["gender"],
            "weight_class": record["weight_class"]
        }).execute()
        
        if existing.data and len(existing.data) > 0:
            # Record exists - check if update needed
            existing_record = existing.data[0]
            changes = {}
            if existing_record.get("snatch_record") != record.get("snatch_record"):
                changes["snatch_record"] = {
                    "old": existing_record.get("snatch_record"),
                    "new": record.get("snatch_record")
                }
            if existing_record.get("cj_record") != record.get("cj_record"):
                changes["cj_record"] = {
                    "old": existing_record.get("cj_record"),
                    "new": record.get("cj_record")
                }
            if existing_record.get("total_record") != record.get("total_record"):
                changes["total_record"] = {
                    "old": existing_record.get("total_record"),
                    "new": record.get("total_record")
                }
            
            if changes:
                would_update.append({**record, "changes": changes})
            else:
                would_skip.append(record)
        else:
            # Record doesn't exist - would be inserted
            would_insert.append(record)
    
    # Display results
    print("\n" + "=" * 80)
    print("DRY RUN RESULTS")
    print("=" * 80)
    print(f"Would INSERT: {len(would_insert)} new records")
    print(f"Would UPDATE: {len(would_update)} existing records")
    print(f"Would SKIP: {len(would_skip)} unchanged records")
    
    if would_insert:
        print("\n📝 Records that would be INSERTED:")
        for record in would_insert[:10]:
            print(f"  • {record['age_category']} | {record['gender']} | {record['weight_class']}")
            print(f"    Snatch: {record.get('snatch_record')}, C&J: {record.get('cj_record')}, Total: {record.get('total_record')}")
        if len(would_insert) > 10:
            print(f"  ... and {len(would_insert) - 10} more")
    
    if would_update:
        print("\n🔄 Records that would be UPDATED:")
        for record in would_update[:10]:
            print(f"  • {record['age_category']} | {record['gender']} | {record['weight_class']}")
            for field, change in record['changes'].items():
                print(f"    - {field}: {change['old']} → {change['new']}")
        if len(would_update) > 10:
            print(f"  ... and {len(would_update) - 10} more")
    
    if would_skip:
        print(f"\n⏭️  {len(would_skip)} records would be skipped (no changes)")
    
    return {"would_insert": would_insert, "would_update": would_update, "would_skip": would_skip}


def test_upsert_data(wso_name: str, sheet_url: str):
    """Test 3: Fetch data and upsert to Supabase (with change tracking)."""
    print("\n" + "=" * 80)
    print("TEST 3: UPSERTING DATA TO SUPABASE")
    print("=" * 80)
    
    scraper = WSORecordsScraper(wso_name, sheet_url)
    
    # Setup all clients
    scraper.setup_google_client()
    scraper.setup_supabase_client()
    
    # Scrape the sheet
    print("\nScraping sheet...")
    records = scraper.scrape_sheet()
    print(f"✓ Fetched {len(records)} records")
    
    # Upsert to database
    print("\nUpserting to Supabase...")
    scraper.upsert_records(records)
    
    # Display results
    print("\n" + "=" * 80)
    print("UPSERT RESULTS")
    print("=" * 80)
    print(f"✓ Inserted: {len(scraper.changes['inserted'])} new records")
    print(f"✓ Updated: {len(scraper.changes['updated'])} existing records")
    
    if scraper.changes['inserted']:
        print("\nNew records inserted:")
        for record in scraper.changes['inserted'][:5]:
            print(f"  • {record['age_category']} | {record['gender']} | {record['weight_class']}")
        if len(scraper.changes['inserted']) > 5:
            print(f"  ... and {len(scraper.changes['inserted']) - 5} more")
    
    if scraper.changes['updated']:
        print("\nRecords updated:")
        for record in scraper.changes['updated'][:5]:
            print(f"  • {record['age_category']} | {record['gender']} | {record['weight_class']}")
            for field, change in record['changes'].items():
                print(f"    - {field}: {change['old']} → {change['new']}")
        if len(scraper.changes['updated']) > 5:
            print(f"  ... and {len(scraper.changes['updated']) - 5} more")
    
    return scraper.changes


def test_discord_notification(wso_name: str, sheet_url: str):
    """Test 4: Full run with Discord notification."""
    print("\n" + "=" * 80)
    print("TEST 4: FULL RUN WITH DISCORD NOTIFICATION")
    print("=" * 80)
    
    scraper = WSORecordsScraper(wso_name, sheet_url)
    
    # Run the full scraper
    scraper.run()
    
    print("\n" + "=" * 80)
    print("✓ FULL TEST COMPLETE")
    print("=" * 80)
    print("Check your Discord channel for the notification!")


def main():
    parser = argparse.ArgumentParser(description="Local test script for WSO Records Scraper")
    parser.add_argument("--wso", default="Ohio", help="WSO name (default: Ohio)")
    parser.add_argument(
        "--sheet-url",
        default="https://docs.google.com/spreadsheets/d/1fX-Ft3PuLn8BCE2thhwPEXFTEUTN7yJGxWi7LMajAD8/view?gid=0#gid=0",
        help="Google Sheet URL"
    )
    parser.add_argument(
        "--test",
        choices=["fetch", "dry-run", "upsert", "full"],
        default="fetch",
        help="Test mode: fetch (only fetch data), dry-run (preview upsert), upsert (fetch + upsert), full (complete run with Discord)"
    )
    
    args = parser.parse_args()
    
    print("\n🧪 WSO RECORDS SCRAPER - LOCAL TEST")
    print(f"WSO: {args.wso}")
    print(f"Sheet: {args.sheet_url}")
    print(f"Test mode: {args.test}")
    
    # Check environment variables
    print("\nChecking environment variables...")
    if args.test in ["dry-run", "upsert", "full"]:
        if not os.getenv("SUPABASE_URL") or not os.getenv("SUPABASE_KEY"):
            print("❌ Error: SUPABASE_URL and SUPABASE_KEY must be set in .env file")
            sys.exit(1)
        print("✓ Supabase credentials found")
    
    if args.test == "full":
        if not os.getenv("DISCORD_WEBHOOK_URL"):
            print("❌ Error: DISCORD_WEBHOOK_URL must be set in .env file")
            sys.exit(1)
        print("✓ Discord webhook found")
    
    print()
    
    try:
        if args.test == "fetch":
            test_fetch_data(args.wso, args.sheet_url)
            print("\n✅ Test completed successfully!")
            print("\nNext steps:")
            print("1. Review the output above and check test_scraped_data.json")
            print("2. If data looks correct, run: python test_local.py --test dry-run")
        
        elif args.test == "dry-run":
            test_dry_run(args.wso, args.sheet_url)
            print("\n✅ Test completed successfully!")
            print("\nNext steps:")
            print("1. Review what would be inserted/updated above")
            print("2. If everything looks good, run: python test_local.py --test upsert")
        
        elif args.test == "upsert":
            test_upsert_data(args.wso, args.sheet_url)
            print("\n✅ Test completed successfully!")
            print("\nNext steps:")
            print("1. Check your Supabase database to verify records were inserted")
            print("2. Run again to test updates: python test_local.py --test upsert")
            print("3. When ready, test Discord: python test_local.py --test full")
        
        elif args.test == "full":
            test_discord_notification(args.wso, args.sheet_url)
            print("\n✅ Test completed successfully!")
            print("\nIf everything looks good, you're ready to deploy to GitHub Actions!")
    
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()

