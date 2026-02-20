"""
IWF World Records Scraper
Scrapes world records from IWF website, saves to CSV, upserts to Supabase, and sends Discord notifications

Setup & Usage:
    # Create virtual environment
    python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

    # Run scraper (normal mode - writes to DB)
    python scraper.py
    
    # Run in dry-run mode (compares with DB but doesn't write)
    python scraper.py --dry-run
"""
import requests
from bs4 import BeautifulSoup
import csv
import os
import sys
from datetime import datetime
from typing import List, Dict, Optional
import time
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()


class IWFWorldRecordsScraper:
    """Complete scraper for IWF World Records with Supabase and Discord integration"""
    
    BASE_URL = "https://iwf.sport/results/world-records/"
    
    # Configuration for all age groups and genders to scrape
    CONFIGURATIONS = [
        {"ranking_curprog": "current", "ranking_agegroup": "Senior", "ranking_gender": "m"},
        {"ranking_curprog": "current", "ranking_agegroup": "Senior", "ranking_gender": "w"},
        {"ranking_curprog": "current", "ranking_agegroup": "Junior", "ranking_gender": "w"},
        {"ranking_curprog": "current", "ranking_agegroup": "Junior", "ranking_gender": "m"},
        {"ranking_curprog": "current", "ranking_agegroup": "Youth", "ranking_gender": "m"},
        {"ranking_curprog": "current", "ranking_agegroup": "Youth", "ranking_gender": "w"},
    ]
    
    def __init__(self, dry_run: bool = False):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        })
        
        # Environment variables
        self.supabase_url = os.getenv('SUPABASE_URL')
        self.supabase_key = os.getenv('SUPABASE_KEY')
        self.slack_webhook = os.getenv('SLACK_IWF_RECORDS_WEBHOOK_URL')
        
        # Dry run mode
        self.dry_run = dry_run
        
    def build_url(self, config: Dict[str, str]) -> str:
        """Build URL with query parameters"""
        params = "&".join([f"{k}={v}" for k, v in config.items()])
        return f"{self.BASE_URL}?{params}"
    
    def fetch_page(self, url: str) -> str:
        """Fetch page content"""
        print(f"Fetching: {url}")
        response = self.session.get(url)
        response.raise_for_status()
        return response.text
    
    def parse_record_value(self, text: str) -> Optional[float]:
        """Extract numeric value from record text (e.g., '141 kg' -> 141.0)"""
        if not text or "World Standard" in text:
            return None
        
        try:
            # Remove 'kg' and other text, get just the number
            value = text.strip().replace("kg", "").strip()
            return float(value)
        except (ValueError, AttributeError):
            return None
    
    def parse_weight_class(self, heading_text: str) -> str:
        """Extract weight class from heading (e.g., '60 kg' or '+110 kg')"""
        # Remove space between number and 'kg'
        return heading_text.strip().replace(' kg', 'kg')
    
    def scrape_page(self, config: Dict[str, str]) -> List[Dict]:
        """Scrape a single page and extract records"""
        import re
        
        url = self.build_url(config)
        html_content = self.fetch_page(url)
        soup = BeautifulSoup(html_content, 'html.parser')
        
        records = []
        
        # Determine age category and gender from config
        age_category = config['ranking_agegroup'].lower()  # e.g., "Senior" -> "senior"
        gender = 'men' if config['ranking_gender'] == 'm' else 'women'
        
        # Find all weight class sections (div with class 'results__title')
        weight_title_divs = soup.find_all('div', class_='results__title')
        
        for title_div in weight_title_divs:
            # Find the h2 tag with the weight class
            h2 = title_div.find('h2')
            if not h2:
                continue
            
            weight_class_text = h2.get_text(strip=True)
            
            # Skip if not a weight class (should contain 'kg')
            if 'kg' not in weight_class_text.lower():
                continue
            
            weight_class = self.parse_weight_class(weight_class_text)
            
            # Find the next sibling div which contains the records (class='cards')
            cards_div = title_div.find_next_sibling('div', class_='cards')
            
            if not cards_div:
                continue
            
            # Get all text from the cards div
            cards_text = cards_div.get_text()
            
            # Extract all record values using regex
            # Pattern: "Record: XXX kg" where XXX is the number
            record_matches = re.findall(r'Record:\s*(\d+(?:\.\d+)?)\s*kg', cards_text)
            
            # Initialize record values
            snatch_record = None
            cj_record = None
            total_record = None
            
            # The records appear in order: Snatch, C&J, Total
            # Split the text into sections
            snatch_section = cards_text.split('C&J')[0] if 'C&J' in cards_text else ''
            cj_section = cards_text.split('C&J')[1].split('Total')[0] if 'C&J' in cards_text and 'Total' in cards_text else ''
            total_section = cards_text.split('Total')[1] if 'Total' in cards_text else ''
            
            # Extract Snatch record (includes World Standards)
            snatch_match = re.search(r'Record:\s*(\d+(?:\.\d+)?)\s*kg', snatch_section)
            if snatch_match:
                snatch_record = int(float(snatch_match.group(1)))
            
            # Extract C&J record (includes World Standards)
            cj_match = re.search(r'Record:\s*(\d+(?:\.\d+)?)\s*kg', cj_section)
            if cj_match:
                cj_record = int(float(cj_match.group(1)))
            
            # Extract Total record (includes World Standards)
            total_match = re.search(r'Record:\s*(\d+(?:\.\d+)?)\s*kg', total_section)
            if total_match:
                total_record = int(float(total_match.group(1)))
            
            # Add record to list
            record = {
                'record_type': 'IWF',
                'age_category': age_category,
                'gender': gender,
                'weight_class': weight_class,
                'snatch_record': snatch_record,
                'cj_record': cj_record,
                'total_record': total_record,
                'created_at': datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S.%f+00')
            }
            
            records.append(record)
            print(f"  Found: IWF {age_category} {gender} {weight_class} (S:{snatch_record}, C&J:{cj_record}, T:{total_record})")
        
        return records
    
    def scrape_all(self) -> List[Dict]:
        """Scrape all configurations"""
        all_records = []
        
        for config in self.CONFIGURATIONS:
            print(f"\nScraping {config['ranking_agegroup']} {config['ranking_gender'].upper()}...")
            try:
                records = self.scrape_page(config)
                all_records.extend(records)
                time.sleep(1)  # Be nice to the server
            except Exception as e:
                print(f"Error scraping {config}: {e}")
                continue
        
        return all_records
    
    def save_to_csv(self, records: List[Dict], filename: str = 'world_records_latest.csv') -> str:
        """Save records to CSV file"""
        filepath = os.path.join(os.path.dirname(__file__) or '.', filename)
        
        with open(filepath, 'w', newline='', encoding='utf-8') as csvfile:
            fieldnames = ['record_type', 'age_category', 'gender', 'weight_class', 
                         'snatch_record', 'cj_record', 'total_record', 'created_at']
            writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
            
            writer.writeheader()
            writer.writerows(records)
        
        print(f"✅ Saved {len(records)} records to {filepath}")
        return filepath
    
    def get_existing_records(self) -> List[Dict]:
        """Fetch existing records from Supabase"""
        if not self.supabase_url or not self.supabase_key:
            return []
        
        try:
            from supabase import create_client
            
            client = create_client(self.supabase_url, self.supabase_key)
            table_name = 'records'
            
            result = client.table(table_name).select("*").execute()
            return result.data if hasattr(result, 'data') else []
            
        except Exception as e:
            print(f"Warning: Could not fetch existing records: {e}")
            return []
    
    def compare_records(self, new_records: List[Dict], existing_records: List[Dict]) -> Dict:
        """Compare new records with existing records"""
        # Create lookup key for records (including record_type to match IWF records)
        def make_key(record):
            return (record.get('record_type'), record.get('age_category'), record.get('gender'), record.get('weight_class'))
        
        existing_map = {make_key(r): r for r in existing_records}
        
        changes = {
            'new': [],
            'modified': [],
            'unchanged': []
        }
        
        for new_record in new_records:
            key = make_key(new_record)
            existing = existing_map.get(key)
            
            if not existing:
                changes['new'].append(new_record)
            else:
                # Check if values changed
                if (existing.get('snatch_record') != new_record.get('snatch_record') or
                    existing.get('cj_record') != new_record.get('cj_record') or
                    existing.get('total_record') != new_record.get('total_record')):
                    changes['modified'].append({
                        'record': new_record,
                        'old': existing
                    })
                else:
                    changes['unchanged'].append(new_record)
        
        return changes
    
    def print_dry_run_summary(self, new_records: List[Dict], changes: Dict):
        """Print detailed dry run summary"""
        print("\n" + "=" * 80)
        print("DRY RUN MODE - NO CHANGES WILL BE MADE")
        print("=" * 80)
        
        # Calculate total items that would be upserted (new + modified)
        total_to_upsert = len(changes['new']) + len(changes['modified'])
        
        print(f"\nTotal records scraped: {len(new_records)}")
        print(f"Total records that would be UPSERTED: {total_to_upsert}")
        print(f"  - New records: {len(changes['new'])}")
        print(f"  - Modified records: {len(changes['modified'])}")
        print(f"  - Unchanged records: {len(changes['unchanged'])}")
        
        if changes['new']:
            print("\n" + "-" * 80)
            print(f"NEW RECORDS TO BE INSERTED ({len(changes['new'])}):")
            print("-" * 80)
            for record in changes['new']:
                snatch = str(record['snatch_record']) if record['snatch_record'] else 'N/A'
                cj = str(record['cj_record']) if record['cj_record'] else 'N/A'
                total = str(record['total_record']) if record['total_record'] else 'N/A'
                print(f"  {record['record_type']:4} {record['age_category']:8} {record['gender']:1} {record['weight_class']:10} | "
                      f"Snatch: {snatch:>6} | C&J: {cj:>6} | Total: {total:>6}")
        
        if changes['modified']:
            print("\n" + "-" * 80)
            print(f"MODIFIED RECORDS TO BE UPDATED ({len(changes['modified'])}):")
            print("-" * 80)
            for item in changes['modified']:
                record = item['record']
                old = item['old']
                print(f"  {record['record_type']:4} {record['age_category']:8} {record['gender']:1} {record['weight_class']:10}")
                
                if old.get('snatch_record') != record.get('snatch_record'):
                    old_val = old.get('snatch_record') or 'N/A'
                    new_val = record.get('snatch_record') or 'N/A'
                    print(f"    Snatch: {old_val} → {new_val}")
                if old.get('cj_record') != record.get('cj_record'):
                    old_val = old.get('cj_record') or 'N/A'
                    new_val = record.get('cj_record') or 'N/A'
                    print(f"    C&J:    {old_val} → {new_val}")
                if old.get('total_record') != record.get('total_record'):
                    old_val = old.get('total_record') or 'N/A'
                    new_val = record.get('total_record') or 'N/A'
                    print(f"    Total:  {old_val} → {new_val}")
        
        if not changes['new'] and not changes['modified']:
            print("\n✅ No changes detected - all records are up to date!")
        
        print("\n" + "=" * 80)
    
    def upsert_to_supabase(self, records: List[Dict]) -> Dict:
        """Upsert records to Supabase table"""
        if not self.supabase_url or not self.supabase_key:
            return {"status": "skipped", "message": "Supabase credentials not configured"}
        
        try:
            from supabase import create_client
            
            client = create_client(self.supabase_url, self.supabase_key)
            table_name = 'records'
            
            # Get existing records for comparison (filter for IWF records only)
            existing_records = self.get_existing_records()
            # Filter to only IWF records for comparison
            existing_iwf_records = [r for r in existing_records if r.get('record_type') == 'IWF']
            changes = self.compare_records(records, existing_iwf_records)
            
            # If dry run, just show what would happen
            if self.dry_run:
                self.print_dry_run_summary(records, changes)
                return {
                    "status": "dry_run",
                    "records_upserted": 0,
                    "message": f"DRY RUN: Would upsert {len(records)} records "
                              f"({len(changes['new'])} new, {len(changes['modified'])} modified)",
                    "changes": changes
                }
            
            # Delete only IWF records (not all records)
            print("Clearing existing IWF records...")
            client.table(table_name).delete().eq('record_type', 'IWF').execute()
            
            # Insert new records
            print(f"Inserting {len(records)} records...")
            client.table(table_name).insert(records).execute()
            
            return {
                "status": "success",
                "records_upserted": len(records),
                "message": f"Successfully upserted {len(records)} records",
                "changes": changes
            }
            
        except ImportError:
            return {"status": "error", "message": "supabase-py library not installed"}
        except Exception as e:
            return {"status": "error", "message": f"Supabase error: {str(e)}"}
    
    def send_slack_notification(self, records_count: int, upsert_result: Dict) -> bool:
        """Send Slack notification with results"""
        if not self.slack_webhook:
            print("⚠️  Slack webhook not configured")
            return False
        
        # Don't send notifications in dry run mode
        if self.dry_run:
            print("⚠️  Skipping Slack notification in dry run mode")
            return False
        
        try:
            success = upsert_result.get('status') == 'success'
            
            if not success:
                # Send error message
                data = {
                    "text": f"⚠️ IWF World Records Scraper Error\n{upsert_result.get('message', 'Unknown error')}"
                }
                response = requests.post(self.slack_webhook, json=data)
                response.raise_for_status()
                print("✅ Slack notification sent")
                return True
            
            # Get change details
            changes = upsert_result.get('changes', {})
            new_records = changes.get('new', [])
            modified_records = changes.get('modified', [])
            new_count = len(new_records)
            modified_count = len(modified_records)
            
            # Build message text
            if new_count == 0 and modified_count == 0:
                # No changes
                message_text = "IWF scraper ran successfully. No new records or updates."
            else:
                # Build list of updated records
                message_lines = []
                
                # Summary
                message_lines.append("IWF Records Summary:\n")
                message_lines.append(f"• {new_count} new record(s) inserted")
                message_lines.append(f"• {modified_count} record(s) updated")
                
                # Updated records section
                if modified_count > 0:
                    message_lines.append("\n:memo: Updated Records\n")
                    
                    for item in modified_records:
                        record = item['record']
                        old = item['old']
                        
                        # Format: Record Type | Age Category | Gender | Weight Class
                        record_line = f"• {record['record_type']} | {record['age_category']} | {record['gender']} | {record['weight_class']}"
                        message_lines.append(record_line)
                        
                        # Build change details
                        changes_list = []
                        
                        if old.get('snatch_record') != record.get('snatch_record'):
                            old_val = old.get('snatch_record') or 'N/A'
                            new_val = record.get('snatch_record') or 'N/A'
                            changes_list.append(f"Snatch: {old_val}kg → {new_val}kg")
                        
                        if old.get('cj_record') != record.get('cj_record'):
                            old_val = old.get('cj_record') or 'N/A'
                            new_val = record.get('cj_record') or 'N/A'
                            changes_list.append(f"C&J: {old_val}kg → {new_val}kg")
                        
                        if old.get('total_record') != record.get('total_record'):
                            old_val = old.get('total_record') or 'N/A'
                            new_val = record.get('total_record') or 'N/A'
                            changes_list.append(f"Total: {old_val}kg → {new_val}kg")
                        
                        if changes_list:
                            message_lines.append(f"  {', '.join(changes_list)}")
                
                message_text = "\n".join(message_lines)
            
            # Send to Slack
            data = {
                "text": message_text
            }
            
            response = requests.post(self.slack_webhook, json=data)
            response.raise_for_status()
            
            print("✅ Slack notification sent")
            return True
            
        except Exception as e:
            print(f"❌ Slack notification failed: {e}")
            return False
    
    def run_pipeline(self) -> int:
        """Execute the complete scraping pipeline"""
        print("=" * 60)
        print("IWF World Records Scraper Pipeline")
        if self.dry_run:
            print("🔍 DRY RUN MODE ENABLED")
        print("=" * 60)
        
        # Step 1: Scrape records
        step_num = 1
        total_steps = 2 if self.dry_run else 4
        
        print(f"\n[{step_num}/{total_steps}] Scraping world records...")
        try:
            records = self.scrape_all()
            
            if not records:
                print("❌ No records found!")
                return 1
            
            print(f"✅ Scraped {len(records)} records")
            
        except Exception as e:
            print(f"❌ Error during scraping: {e}")
            return 1
        
        step_num += 1
        
        # Step 2: Compare with Supabase (dry run) or Save CSV (normal mode)
        if self.dry_run:
            print(f"\n[{step_num}/{total_steps}] Comparing with Supabase...")
            upsert_result = self.upsert_to_supabase(records)
            
            if upsert_result['status'] == 'dry_run':
                print(f"✅ {upsert_result['message']}")
            elif upsert_result['status'] == 'skipped':
                print(f"⚠️  {upsert_result['message']}")
            else:
                print(f"❌ {upsert_result['message']}")
        else:
            # Normal mode: save CSV, upsert, and notify
            print(f"\n[{step_num}/{total_steps}] Saving to CSV...")
            try:
                self.save_to_csv(records)
            except Exception as e:
                print(f"⚠️  Error saving CSV: {e}")
            
            step_num += 1
            
            # Step 3: Upsert to Supabase
            print(f"\n[{step_num}/{total_steps}] Upserting to Supabase...")
            upsert_result = self.upsert_to_supabase(records)
            
            if upsert_result['status'] == 'success':
                print(f"✅ {upsert_result['message']}")
            elif upsert_result['status'] == 'skipped':
                print(f"⚠️  {upsert_result['message']}")
            else:
                print(f"❌ {upsert_result['message']}")
            
            step_num += 1
            
            # Step 4: Send Slack notification
            print(f"\n[{step_num}/{total_steps}] Sending Slack notification...")
            self.send_slack_notification(len(records), upsert_result)
        
        # Summary
        print("\n" + "=" * 60)
        print("Pipeline Complete!")
        print("=" * 60)
        print(f"Records scraped: {len(records)}")
        if not self.dry_run:
            print(f"Supabase status: {upsert_result['status']}")
        print("=" * 60)
        
        return 0


def main():
    """Main entry point"""
    import argparse
    
    parser = argparse.ArgumentParser(
        description='IWF World Records Scraper - Scrapes, stores, and notifies about world records'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Run in dry-run mode: scrape and compare with DB but do not write changes'
    )
    
    args = parser.parse_args()
    
    scraper = IWFWorldRecordsScraper(dry_run=args.dry_run)
    return scraper.run_pipeline()


if __name__ == "__main__":
    sys.exit(main())

