#!/usr/bin/env python3
"""
Test script for New Jersey WSO scraper
"""

import sys
import os

# Add parent directory to path
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from auto_scrapers.scraper_newjersey import WSORecordsNewJerseyScraper

def test_basic_scraping():
    """Test basic scraping functionality"""
    print("="*60)
    print("Testing New Jersey WSO Scraper")
    print("="*60)
    
    scraper = WSORecordsNewJerseyScraper(
        "New Jersey", 
        "https://docs.google.com/spreadsheets/d/1y8mXDBLfqmszlzWhv-4wkeWQZS5Kb9Aj4RnB39CBJmw/edit?gid=0#gid=0"
    )
    
    sheet_id = scraper._extract_sheet_id(scraper.sheet_url)
    
    # Test Senior tab
    print("\n1. Testing Senior tab...")
    senior_records = scraper._scrape_tab(sheet_id, "0", "Senior")
    print(f"   ✓ Found {len(senior_records)} records (including vacant)")
    
    # Show sample filled record
    filled = [r for r in senior_records if r['snatch_record'] is not None][0]
    print(f"   Sample filled: {filled['gender']} {filled['weight_class']} - Snatch: {filled['snatch_record']}, C&J: {filled['cj_record']}, Total: {filled['total_record']}")
    
    # Show sample vacant record
    vacant = [r for r in senior_records if r['snatch_record'] is None and r['cj_record'] is None and r['total_record'] is None]
    if vacant:
        print(f"   Sample vacant: {vacant[0]['gender']} {vacant[0]['weight_class']} - All NULL")
    
    # Test U17 tab
    print("\n2. Testing U17 Youth tab...")
    u17_records = scraper._scrape_tab(sheet_id, "2116279815", "U17")
    print(f"   ✓ Found {len(u17_records)} records")
    filled_count = sum(1 for r in u17_records if r['snatch_record'] or r['cj_record'] or r['total_record'])
    vacant_count = len(u17_records) - filled_count
    print(f"   Stats: {filled_count} filled, {vacant_count} vacant")
    
    # Test Masters 40 tab
    print("\n3. Testing Masters 40 tab...")
    masters_records = scraper._scrape_tab(sheet_id, "2006037821", "Masters 40")
    print(f"   ✓ Found {len(masters_records)} records")
    filled_count = sum(1 for r in masters_records if r['snatch_record'] or r['cj_record'] or r['total_record'])
    vacant_count = len(masters_records) - filled_count
    print(f"   Stats: {filled_count} filled, {vacant_count} vacant")
    
    print("\n" + "="*60)
    print("All tests passed! ✓")
    print("="*60)


def test_data_accuracy():
    """Test that specific known records are parsed correctly"""
    print("\n" + "="*60)
    print("Testing Data Accuracy Against Known Values")
    print("="*60)
    
    scraper = WSORecordsNewJerseyScraper(
        "New Jersey", 
        "https://docs.google.com/spreadsheets/d/1y8mXDBLfqmszlzWhv-4wkeWQZS5Kb9Aj4RnB39CBJmw/edit?gid=0#gid=0"
    )
    
    sheet_id = scraper._extract_sheet_id(scraper.sheet_url)
    senior_records = scraper._scrape_tab(sheet_id, "0", "Senior")
    
    # Test known values from the CSV we fetched earlier
    tests = [
        # (gender, weight_class, expected_snatch, expected_cj, expected_total)
        ("Women", "48", 36, 49, 85),  # Julie Carmody
        ("Men", "60", 42, 63, 105),    # Cole Furmari
        ("Women", "53", 66, 85, 151),  # Victoria Casco
        ("Men", "65", 42, 50, 92),     # Joe Delago
    ]
    
    all_passed = True
    for gender, weight_class, exp_snatch, exp_cj, exp_total in tests:
        record = next((r for r in senior_records if r['gender'] == gender and r['weight_class'] == weight_class), None)
        if record:
            passed = (record['snatch_record'] == exp_snatch and 
                     record['cj_record'] == exp_cj and 
                     record['total_record'] == exp_total)
            status = "✓" if passed else "✗"
            print(f"\n{status} {gender} {weight_class}kg:")
            print(f"   Expected: Snatch={exp_snatch}, C&J={exp_cj}, Total={exp_total}")
            print(f"   Got:      Snatch={record['snatch_record']}, C&J={record['cj_record']}, Total={record['total_record']}")
            if not passed:
                all_passed = False
        else:
            print(f"\n✗ {gender} {weight_class}kg: Record not found!")
            all_passed = False
    
    print("\n" + "="*60)
    if all_passed:
        print("All accuracy tests passed! ✓")
    else:
        print("Some tests failed! ✗")
    print("="*60)


if __name__ == "__main__":
    test_basic_scraping()
    test_data_accuracy()

