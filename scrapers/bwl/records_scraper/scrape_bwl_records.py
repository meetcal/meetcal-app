"""
British Weightlifting Records Scraper

This script scrapes weightlifting records from the British Weightlifting website,
extracts data from PNG images, and upserts the records to Supabase.
"""

import os
import re
import logging
import requests
import json
from datetime import datetime, timezone
from typing import List, Dict, Optional
from dotenv import load_dotenv
from bs4 import BeautifulSoup

# Load environment variables
load_dotenv()

# --- Configuration ---
BWL_RECORDS_URL = "https://britishweightlifting.org/competitions/results-rankings-and-records"
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_TABLE_NAME = "records"
SLACK_RECORDS_WEBHOOK_URL = os.environ.get("SLACK_BWL_RESULTS_WEBHOOK_URL")
OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY")

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)


class BWLRecordsScraper:
    """Scraper for British Weightlifting records"""

    def __init__(self):
        self.session = requests.Session()
        self.session.headers.update({
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        })

    def fetch_page(self, url: str) -> Optional[BeautifulSoup]:
        """Fetch and parse the BWL records page"""
        try:
            logging.info(f"Fetching page: {url}")
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return BeautifulSoup(response.content, 'html.parser')
        except requests.exceptions.RequestException as e:
            logging.error(f"Error fetching page: {e}")
            return None

    def find_weightlifting_dropdowns(self, soup: BeautifulSoup) -> List[Dict[str, str]]:
        """Find all weightlifting category dropdowns and their associated PNG links or tables"""
        categories = []
        
        # Look for accordion or collapsible sections containing "Weightlifting"
        # Try multiple approaches to find the sections
        
        # Approach 1: Look for elements with text matching the pattern
        weightlifting_sections = soup.find_all(
            ['h2', 'h3', 'h4', 'button', 'div', 'summary', 'details', 'p', 'strong'],
            string=re.compile(r".*(Men's|Women's).*(Under \d+|Senior|U\d+).*Weightlifting.*", re.IGNORECASE)
        )
        
        logging.info(f"Found {len(weightlifting_sections)} potential weightlifting sections")
        
        # Approach 2: Also look for links or buttons that might trigger dropdowns
        links_with_weightlifting = soup.find_all('a', string=re.compile(r'.*Weightlifting.*', re.IGNORECASE))
        weightlifting_sections.extend(links_with_weightlifting)
        
        for section in weightlifting_sections:
            section_text = section.get_text(strip=True)
            
            # Skip if doesn't match expected pattern
            if not re.search(r"(Men's|Women's).*(Under \d+|Senior|U\d+).*Weightlifting", section_text, re.IGNORECASE):
                continue
            
            logging.info(f"Processing section: {section_text}")
            
            # Find the parent container that includes both the header and content
            parent = section
            content_found = False
            
            for level in range(10):  # Look up to 10 levels
                if parent is None:
                    break
                
                # Look for PNG links within this container
                png_links = parent.find_all('a', href=re.compile(r'.*\.png$', re.IGNORECASE))
                
                # Also look for tables with record data
                tables = parent.find_all('table')
                
                if png_links:
                    for link in png_links:
                        png_url = link.get('href')
                        if png_url:
                            # Make URL absolute if it's relative
                            if not png_url.startswith('http'):
                                base_url = 'https://britishweightlifting.org'
                                png_url = base_url + png_url if png_url.startswith('/') else f"{base_url}/{png_url}"
                            
                            categories.append({
                                'category': section_text,
                                'png_url': png_url,
                                'table': None
                            })
                            logging.info(f"Found PNG link: {png_url}")
                            content_found = True
                
                if tables and not content_found:
                    for table in tables:
                        categories.append({
                            'category': section_text,
                            'png_url': None,
                            'table': table
                        })
                        logging.info(f"Found table for: {section_text}")
                        content_found = True
                        break
                
                if content_found:
                    break
                
                parent = parent.parent
        
        # Remove duplicates based on category name
        seen_categories = set()
        unique_categories = []
        for cat in categories:
            if cat['category'] not in seen_categories:
                seen_categories.add(cat['category'])
                unique_categories.append(cat)
        
        return unique_categories

    def download_image(self, url: str) -> Optional[bytes]:
        """Download PNG image from URL (legacy method, not used with OpenAI)"""
        try:
            logging.info(f"Downloading image: {url}")
            response = self.session.get(url, timeout=30)
            response.raise_for_status()
            return response.content
        except Exception as e:
            logging.error(f"Error downloading image from {url}: {e}")
            return None

    def parse_record_table(self, table, category: str) -> List[Dict]:
        """Parse record data from HTML table"""
        try:
            logging.info(f"Parsing table for category: {category}")
            
            records = []
            gender = 'men' if "Men's" in category else 'women'
            age_category = self._extract_age_category(category)
            
            # Find all rows in the table
            rows = table.find_all('tr')
            
            for row in rows[1:]:  # Skip header row
                cells = row.find_all(['td', 'th'])
                if len(cells) < 2:
                    continue
                
                # Extract data from cells
                cell_data = [cell.get_text(strip=True) for cell in cells]
                
                # Expected format: Weight Class, Snatch, C&J, Total
                if len(cell_data) >= 2:
                    weight_class = cell_data[0]
                    
                    # Skip header rows
                    if 'weight' in weight_class.lower() or 'class' in weight_class.lower():
                        continue
                    
                    snatch = self._parse_number(cell_data[1]) if len(cell_data) > 1 else None
                    cj = self._parse_number(cell_data[2]) if len(cell_data) > 2 else None
                    total = self._parse_number(cell_data[3]) if len(cell_data) > 3 else None
                    
                    if weight_class and (snatch or cj or total):
                        records.append({
                            'record_type': 'BWL',
                            'age_category': age_category,
                            'gender': gender,
                            'weight_class': weight_class,
                            'snatch_record': snatch,
                            'cj_record': cj,
                            'total_record': total
                        })
            
            logging.info(f"Parsed {len(records)} records from table")
            return records
            
        except Exception as e:
            logging.error(f"Error parsing table: {e}")
            return []

    def _parse_number(self, text: str) -> Optional[float]:
        """Parse a number from text, handling various formats"""
        if not text:
            return None
        
        # Remove common non-numeric characters
        cleaned = re.sub(r'[^\d\.]', '', text)
        
        try:
            return float(cleaned) if cleaned else None
        except ValueError:
            return None

    def parse_record_image_with_openai(self, image_url: str, category: str) -> List[Dict]:
        """Parse record data from PNG image using OpenAI Vision API"""
        try:
            logging.info(f"Parsing image with OpenAI for category: {category}")
            
            if not OPENAI_API_KEY:
                logging.error("OpenAI API key not configured")
                return []
            
            # Parse category information
            gender = 'men' if "Men's" in category else 'women'
            age_category = self._extract_age_category(category)
            
            # Prepare the prompt for OpenAI
            prompt = f"""This is a British Weightlifting records table image for {category}.

Please extract ALL the weightlifting records from this table and return them as a JSON array.

For each weight class row in the table, extract:
- weight_class: the weight category (e.g., "61kg", "73kg", "102kg", "102+kg")
- snatch: the snatch record value (just the number, or null if not visible)
- clean_and_jerk: the clean & jerk record value (just the number, or null if not visible)
- total: the total record value (just the number, or null if not visible)

Return ONLY a valid JSON array with no additional text, like this:
[
  {{"weight_class": "61kg", "snatch": 130, "clean_and_jerk": 165, "total": 295}},
  {{"weight_class": "73kg", "snatch": 145, "clean_and_jerk": 180, "total": 325}}
]

Extract ALL weight classes you see in the table."""

            # Call OpenAI Vision API
            headers = {
                "Content-Type": "application/json",
                "Authorization": f"Bearer {OPENAI_API_KEY}"
            }
            
            payload = {
                "model": "gpt-4o",  # Using gpt-4o which supports vision
                "messages": [
                    {
                        "role": "user",
                        "content": [
                            {
                                "type": "text",
                                "text": prompt
                            },
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": image_url
                                }
                            }
                        ]
                    }
                ],
                "max_tokens": 1000
            }
            
            response = requests.post(
                "https://api.openai.com/v1/chat/completions",
                headers=headers,
                json=payload,
                timeout=60
            )
            response.raise_for_status()
            
            result = response.json()
            content = result['choices'][0]['message']['content']
            
            logging.debug(f"OpenAI response: {content}")
            
            # Parse the JSON response
            # Remove markdown code blocks if present
            content = content.strip()
            if content.startswith('```'):
                content = content.split('```')[1]
                if content.startswith('json'):
                    content = content[4:]
                content = content.strip()
            
            parsed_data = json.loads(content)
            
            # Convert to our format
            records = []
            for item in parsed_data:
                record = {
                    'record_type': 'BWL',
                    'age_category': age_category,
                    'gender': gender,
                    'weight_class': item.get('weight_class'),
                    'snatch_record': item.get('snatch'),
                    'cj_record': item.get('clean_and_jerk') or item.get('cj'),
                    'total_record': item.get('total')
                }
                records.append(record)
                logging.info(f"Parsed record: {record['weight_class']} - Snatch: {record.get('snatch_record')}, C&J: {record.get('cj_record')}, Total: {record.get('total_record')}")
            
            logging.info(f"Parsed {len(records)} records from image using OpenAI")
            return records
            
        except Exception as e:
            logging.error(f"Error parsing image with OpenAI: {e}", exc_info=True)
            return []

    def parse_record_image(self, image_data: bytes, category: str) -> List[Dict]:
        """Legacy OCR method - kept for backward compatibility"""
        logging.warning("OCR method is deprecated. Use parse_record_image_with_openai instead.")
        return []

    def _extract_age_category(self, category_text: str) -> str:
        """Extract age category from category text"""
        if 'Senior' in category_text:
            return 'senior'
        elif 'Under 23' in category_text or 'U23' in category_text:
            return 'u23'
        elif 'Under 20' in category_text or 'U20' in category_text:
            return 'u20'
        elif 'Under 17' in category_text or 'U17' in category_text:
            return 'u17'
        elif 'Under 15' in category_text or 'U15' in category_text:
            return 'u15'
        elif 'Masters' in category_text:
            return 'masters'
        else:
            return 'unknown'

    def _parse_record_line(self, line: str, gender: str, age_category: str) -> Optional[Dict]:
        """Parse a single line of record data"""
        # Pattern to match: weight_class snatch cj total
        # Example: "71kg 130 179 317" or "110+kg 167 211 373"
        # Also handle: "71 kg 130 179 317" or "110+ kg 167 211 373"
        
        # Clean the line - remove extra spaces and normalize
        line = ' '.join(line.split())
        
        # Try to find numbers and weight class
        parts = line.split()
        if len(parts) < 2:
            return None
        
        weight_class = None
        numbers = []
        
        # Try to find weight class (might be split across parts)
        for i, part in enumerate(parts):
            # Check if it's a weight class or part of one
            if 'kg' in part.lower():
                # Might be "71kg" or just "kg" after "71"
                if part.lower() == 'kg' and i > 0:
                    # Check previous part for the number
                    prev = parts[i-1]
                    if re.match(r'^\d+\+?$', prev):
                        weight_class = prev + 'kg'
                else:
                    weight_class = part.strip()
                break
            elif '+' in part and i < len(parts) - 1 and 'kg' in parts[i+1].lower():
                # Handle "110+ kg" format
                weight_class = part + parts[i+1]
                break
        
        # Extract all numbers from the line (excluding the weight class number if already captured)
        for part in parts:
            # Skip if this is the weight class
            if weight_class and part in weight_class:
                continue
            # Check if it's a number
            cleaned = re.sub(r'[^\d\.]', '', part)
            if cleaned and re.match(r'^\d+(\.\d+)?$', cleaned):
                num = float(cleaned)
                # Filter out unrealistic values (weight class vs lift weights)
                if num > 30:  # Lifts are typically > 30kg
                    numbers.append(num)
        
        if not weight_class or len(numbers) < 1:
            return None
        
        # Assign numbers to snatch, cj, total
        snatch = numbers[0] if len(numbers) > 0 else None
        cj = numbers[1] if len(numbers) > 1 else None
        total = numbers[2] if len(numbers) > 2 else None
        
        return {
            'record_type': 'BWL',
            'age_category': age_category,
            'gender': gender,
            'weight_class': weight_class,
            'snatch_record': snatch,
            'cj_record': cj,
            'total_record': total
        }

    def scrape_all_records(self) -> List[Dict]:
        """Main method to scrape all weightlifting records"""
        soup = self.fetch_page(BWL_RECORDS_URL)
        if not soup:
            logging.error("Failed to fetch BWL records page")
            return []
        
        categories = self.find_weightlifting_dropdowns(soup)
        if not categories:
            logging.warning("No weightlifting categories found")
            return []
        
        logging.info(f"Found {len(categories)} weightlifting categories to process")
        
        all_records = []
        
        for cat_info in categories:
            category = cat_info['category']
            png_url = cat_info.get('png_url')
            table = cat_info.get('table')
            
            # Try to parse from table first (more reliable)
            if table:
                logging.info(f"Processing table for: {category}")
                records = self.parse_record_table(table, category)
                all_records.extend(records)
            
            # If no table or table parsing failed, try PNG with OpenAI
            elif png_url:
                logging.info(f"Processing PNG for: {category}")
                # Make URL absolute if needed
                if not png_url.startswith('http'):
                    base_url = 'https://britishweightlifting.org'
                    png_url = base_url + png_url if png_url.startswith('/') else f"{base_url}/{png_url}"
                
                # Use OpenAI to parse the image
                records = self.parse_record_image_with_openai(png_url, category)
                all_records.extend(records)
            else:
                logging.warning(f"No data source found for {category}")
        
        logging.info(f"Total records scraped: {len(all_records)}")
        return all_records


def check_records_for_upsert(records: List[Dict]) -> Dict:
    """Check what would be upserted without actually upserting (dry run)"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase credentials not configured")
        return {'new': [], 'updates': [], 'unchanged': []}
    
    if not records:
        logging.info("No records to check")
        return {'new': [], 'updates': [], 'unchanged': []}
    
    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    
    new_records = []
    updates = []
    unchanged = []
    
    try:
        for record in records:
            # Check if record exists
            query_url = f"{url}?record_type=eq.{record['record_type']}&age_category=eq.{record['age_category']}&gender=eq.{record['gender']}&weight_class=eq.{record['weight_class']}"
            
            get_response = requests.get(query_url, headers=headers, timeout=30)
            existing_records = get_response.json() if get_response.status_code == 200 else []
            
            if existing_records:
                existing = existing_records[0]
                # Check if values have changed
                changed = (
                    existing.get('snatch_record') != record.get('snatch_record') or
                    existing.get('cj_record') != record.get('cj_record') or
                    existing.get('total_record') != record.get('total_record')
                )
                
                if changed:
                    updates.append({
                        'record': record,
                        'existing': existing,
                        'changes': {
                            'snatch': f"{existing.get('snatch_record')} → {record.get('snatch_record')}",
                            'cj': f"{existing.get('cj_record')} → {record.get('cj_record')}",
                            'total': f"{existing.get('total_record')} → {record.get('total_record')}"
                        }
                    })
                    logging.info(f"Would UPDATE: {record['gender']} {record['age_category']} {record['weight_class']}")
                else:
                    unchanged.append(record)
                    logging.debug(f"UNCHANGED: {record['gender']} {record['age_category']} {record['weight_class']}")
            else:
                new_records.append(record)
                logging.info(f"Would INSERT: {record['gender']} {record['age_category']} {record['weight_class']}")
        
        return {
            'new': new_records,
            'updates': updates,
            'unchanged': unchanged
        }
        
    except requests.exceptions.RequestException as e:
        logging.error(f"Error checking records: {e}")
        return {'new': [], 'updates': [], 'unchanged': []}


def upsert_records_to_supabase(records: List[Dict]) -> Dict:
    """Upsert records to Supabase database"""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase credentials not configured")
        return {'inserted': 0, 'updated': 0, 'updated_details': []}
    
    if not records:
        logging.info("No records to upsert")
        return {'inserted': 0, 'updated': 0, 'updated_details': []}
    
    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
    }
    
    inserted_count = 0
    updated_count = 0
    updated_details = []
    
    try:
        for record in records:
            # Check if record exists based on unique combination
            query_url = f"{url}?record_type=eq.{record['record_type']}&age_category=eq.{record['age_category']}&gender=eq.{record['gender']}&weight_class=eq.{record['weight_class']}"
            
            get_response = requests.get(query_url, headers=headers, timeout=30)
            existing_records = get_response.json() if get_response.status_code == 200 else []
            
            if existing_records:
                # Update existing record
                existing = existing_records[0]
                existing_id = existing['id']
                update_url = f"{url}?id=eq.{existing_id}"
                
                # Check what changed
                changes = []
                if existing.get('snatch_record') != record.get('snatch_record'):
                    changes.append(f"Snatch: {existing.get('snatch_record')} → {record.get('snatch_record')}")
                if existing.get('cj_record') != record.get('cj_record'):
                    changes.append(f"C&J: {existing.get('cj_record')} → {record.get('cj_record')}")
                if existing.get('total_record') != record.get('total_record'):
                    changes.append(f"Total: {existing.get('total_record')} → {record.get('total_record')}")
                
                if changes:
                    # Add timestamp
                    record['created_at'] = datetime.now(timezone.utc).isoformat()
                    
                    response = requests.patch(update_url, headers=headers, json=record, timeout=30)
                    if response.status_code in [200, 204]:
                        logging.info(f"Updated record: {record['gender']} {record['age_category']} {record['weight_class']}")
                        updated_count += 1
                        updated_details.append({
                            'record': f"{record['gender']} {record['age_category']} {record['weight_class']}",
                            'changes': changes
                        })
                    else:
                        logging.error(f"Failed to update record: {response.text}")
                else:
                    logging.debug(f"No changes for: {record['gender']} {record['age_category']} {record['weight_class']}")
            else:
                # Insert new record
                record['created_at'] = datetime.now(timezone.utc).isoformat()
                
                response = requests.post(url, headers=headers, json=record, timeout=30)
                if response.status_code == 201:
                    logging.info(f"Inserted record: {record['gender']} {record['age_category']} {record['weight_class']}")
                    inserted_count += 1
                else:
                    logging.error(f"Failed to insert record: {response.text}")
        
        return {
            'inserted': inserted_count,
            'updated': updated_count,
            'updated_details': updated_details
        }
        
    except requests.exceptions.RequestException as e:
        logging.error(f"Error upserting records to Supabase: {e}")
        return {
            'inserted': inserted_count,
            'updated': updated_count,
            'updated_details': updated_details
        }


def send_slack_notification(upsert_results: Dict):
    """Send Slack notification with scraping results"""
    if not SLACK_RECORDS_WEBHOOK_URL:
        logging.info("Slack webhook URL not configured. Skipping notification.")
        return
    
    inserted = upsert_results.get('inserted', 0)
    updated = upsert_results.get('updated', 0)
    updated_details = upsert_results.get('updated_details', [])
    
    message = f"🇬🇧 BWL Records Scraper Completed\n"
    message += f"• New records inserted: {inserted}\n"
    message += f"• Existing records updated: {updated}\n"
    message += f"• Total records processed: {inserted + updated}\n"
    
    if updated_details:
        message += f"\n📝 Updated Records:\n"
        for detail in updated_details[:10]:  # Show first 10 updates
            message += f"  • {detail['record']}\n"
            for change in detail['changes']:
                message += f"    - {change}\n"
        if len(updated_details) > 10:
            message += f"  ... and {len(updated_details) - 10} more updates\n"
    
    payload = {"text": message}
    
    try:
        response = requests.post(SLACK_RECORDS_WEBHOOK_URL, json=payload, timeout=30)
        response.raise_for_status()
        logging.info(f"Slack notification sent successfully")
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to send Slack notification: {e}")


def dry_run():
    """Dry run - scrape and check what would be upserted without actually upserting"""
    logging.info("Starting BWL Records Scraper (DRY RUN MODE)...")
    
    # Initialize scraper
    scraper = BWLRecordsScraper()
    
    # Scrape records
    records = scraper.scrape_all_records()
    
    if not records:
        logging.warning("No records scraped. Exiting.")
        return
    
    # Check what would be upserted
    check_results = check_records_for_upsert(records)
    
    # Print summary
    print("\n" + "=" * 80)
    print("DRY RUN SUMMARY")
    print("=" * 80)
    print(f"Total records scraped: {len(records)}")
    print(f"New records that would be inserted: {len(check_results['new'])}")
    print(f"Existing records that would be updated: {len(check_results['updates'])}")
    print(f"Unchanged records: {len(check_results['unchanged'])}")
    
    # CSV Preview Header
    print("\n" + "=" * 80)
    print("CSV PREVIEW (First 5 records that would be upserted)")
    print("=" * 80)
    print("id,record_type,age_category,gender,weight_class,snatch_record,cj_record,total_record,created_at")
    
    # Show first 5 records in CSV format
    all_to_upsert = check_results['new'] + [u['record'] for u in check_results['updates']]
    for i, rec in enumerate(all_to_upsert[:5], 1):
        print(f"<auto>,{rec['record_type']},{rec['age_category']},{rec['gender']},"
              f"{rec['weight_class']},{rec.get('snatch_record')},{rec.get('cj_record')},"
              f"{rec.get('total_record')},<timestamp>")
    
    if len(all_to_upsert) > 5:
        print(f"... and {len(all_to_upsert) - 5} more records")
    
    # Human-readable table
    print("\n" + "=" * 80)
    print("HUMAN READABLE FORMAT - ALL RECORDS TO BE UPSERTED")
    print("=" * 80)
    print(f"{'#':<4} {'Type':<6} {'Category':<10} {'Gender':<8} {'Weight':<10} "
          f"{'Snatch':>7} {'C&J':>7} {'Total':>7}")
    print("-" * 80)
    
    if check_results['new']:
        print("\n>>> NEW INSERTS <<<")
        for i, rec in enumerate(check_results['new'], 1):
            print(f"{i:<4} {rec['record_type']:<6} {rec['age_category']:<10} "
                  f"{rec['gender']:<8} {rec['weight_class']:<10} "
                  f"{rec.get('snatch_record', 'N/A'):>7} "
                  f"{rec.get('cj_record', 'N/A'):>7} "
                  f"{rec.get('total_record', 'N/A'):>7}")
    
    if check_results['updates']:
        print("\n>>> UPDATES <<<")
        for i, update in enumerate(check_results['updates'], 1):
            rec = update['record']
            print(f"{i:<4} {rec['record_type']:<6} {rec['age_category']:<10} "
                  f"{rec['gender']:<8} {rec['weight_class']:<10} "
                  f"{rec.get('snatch_record', 'N/A'):>7} "
                  f"{rec.get('cj_record', 'N/A'):>7} "
                  f"{rec.get('total_record', 'N/A'):>7}")
            print(f"     Changes: {update['changes']}")
    
    if check_results['unchanged']:
        print(f"\n>>> {len(check_results['unchanged'])} UNCHANGED RECORDS (not shown) <<<")
    
    print("\n" + "=" * 80)
    print("DRY RUN COMPLETE - No changes made to database")
    print("=" * 80 + "\n")


def main():
    """Main execution function"""
    logging.info("Starting BWL Records Scraper...")
    
    # Initialize scraper
    scraper = BWLRecordsScraper()
    
    # Scrape records
    records = scraper.scrape_all_records()
    
    if not records:
        logging.warning("No records scraped. Exiting.")
        send_slack_notification({'inserted': 0, 'updated': 0, 'updated_details': []})
        return
    
    # Upsert to Supabase
    upsert_results = upsert_records_to_supabase(records)
    
    # Send Slack notification
    send_slack_notification(upsert_results)
    
    total = upsert_results['inserted'] + upsert_results['updated']
    logging.info(f"🇬🇧 BWL Records Scraper completed. Inserted: {upsert_results['inserted']}, Updated: {upsert_results['updated']}, Total: {total}")


if __name__ == "__main__":
    import sys
    if len(sys.argv) > 1 and sys.argv[1] == "--dry-run":
        dry_run()
    else:
        main()

