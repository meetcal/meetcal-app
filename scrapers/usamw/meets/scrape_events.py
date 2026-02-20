#!/usr/bin/env python3
"""
USAMW Events Scraper
SETUP:
  # Create virtual environment
  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

  # Dry-run mode (preview what would be inserted without updating database)
  python scrape_events.py --dry-run
  
  # Full run (actually update database)
  python scrape_events.py
"""

import os
import sys
import re
import argparse
import requests
from typing import List, Dict, Any, Optional
from datetime import datetime
from dotenv import load_dotenv
from bs4 import BeautifulSoup

try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)

# Load environment variables
load_dotenv()


class USAMWEventsScraper:
    """Scraper for USAMW events."""
    
    def __init__(self):
        """Initialize the scraper."""
        self.base_url = "https://usamastersweightlifting.com/events"
        self.supabase: Optional[Client] = None
        self.slack_webhook_url: Optional[str] = None
        
    def setup_supabase_client(self):
        """Initialize Supabase client."""
        supabase_url = os.getenv('SUPABASE_URL')
        supabase_key = os.getenv('SUPABASE_KEY')
        
        if not supabase_url or not supabase_key:
            print("Warning: Supabase credentials not provided. Database updates will be skipped.")
            return
        
        try:
            self.supabase = create_client(supabase_url, supabase_key)
            print("Supabase client initialized successfully")
        except Exception as e:
            print(f"Error initializing Supabase client: {e}")
            self.supabase = None
    
    def get_state_abbreviation(self, state_name: str) -> str:
        """Convert state name to two-letter abbreviation."""
        state_map = {
            'Alabama': 'AL', 'Alaska': 'AK', 'Arizona': 'AZ', 'Arkansas': 'AR',
            'California': 'CA', 'Colorado': 'CO', 'Connecticut': 'CT', 'Delaware': 'DE',
            'Florida': 'FL', 'Georgia': 'GA', 'Hawaii': 'HI', 'Idaho': 'ID',
            'Illinois': 'IL', 'Indiana': 'IN', 'Iowa': 'IA', 'Kansas': 'KS',
            'Kentucky': 'KY', 'Louisiana': 'LA', 'Maine': 'ME', 'Maryland': 'MD',
            'Massachusetts': 'MA', 'Michigan': 'MI', 'Minnesota': 'MN', 'Mississippi': 'MS',
            'Missouri': 'MO', 'Montana': 'MT', 'Nebraska': 'NE', 'Nevada': 'NV',
            'New Hampshire': 'NH', 'New Jersey': 'NJ', 'New Mexico': 'NM', 'New York': 'NY',
            'North Carolina': 'NC', 'North Dakota': 'ND', 'Ohio': 'OH', 'Oklahoma': 'OK',
            'Oregon': 'OR', 'Pennsylvania': 'PA', 'Rhode Island': 'RI', 'South Carolina': 'SC',
            'South Dakota': 'SD', 'Tennessee': 'TN', 'Texas': 'TX', 'Utah': 'UT',
            'Vermont': 'VT', 'Virginia': 'VA', 'Washington': 'WA', 'West Virginia': 'WV',
            'Wisconsin': 'WI', 'Wyoming': 'WY', 'District of Columbia': 'DC'
        }
        return state_map.get(state_name, state_name)
    
    def map_time_zone(self, state: str) -> str:
        """Map state to time zone."""
        time_zone_map = {
            'AL': 'America/Chicago', 'AK': 'America/Anchorage', 'AZ': 'America/Phoenix',
            'AR': 'America/Chicago', 'CA': 'America/Los_Angeles', 'CO': 'America/Denver',
            'CT': 'America/New_York', 'DE': 'America/New_York', 'FL': 'America/New_York',
            'GA': 'America/New_York', 'HI': 'Pacific/Honolulu', 'ID': 'America/Denver',
            'IL': 'America/Chicago', 'IN': 'America/New_York', 'IA': 'America/Chicago',
            'KS': 'America/Chicago', 'KY': 'America/New_York', 'LA': 'America/Chicago',
            'ME': 'America/New_York', 'MD': 'America/New_York', 'MA': 'America/New_York',
            'MI': 'America/New_York', 'MN': 'America/Chicago', 'MS': 'America/Chicago',
            'MO': 'America/Chicago', 'MT': 'America/Denver', 'NE': 'America/Chicago',
            'NV': 'America/Los_Angeles', 'NH': 'America/New_York', 'NJ': 'America/New_York',
            'NM': 'America/Denver', 'NY': 'America/New_York', 'NC': 'America/New_York',
            'ND': 'America/Chicago', 'OH': 'America/New_York', 'OK': 'America/Chicago',
            'OR': 'America/Los_Angeles', 'PA': 'America/New_York', 'RI': 'America/New_York',
            'SC': 'America/New_York', 'SD': 'America/Chicago', 'TN': 'America/Chicago',
            'TX': 'America/Chicago', 'UT': 'America/Denver', 'VT': 'America/New_York',
            'VA': 'America/New_York', 'WA': 'America/Los_Angeles', 'WV': 'America/New_York',
            'WI': 'America/Chicago', 'WY': 'America/Denver', 'DC': 'America/New_York'
        }
        return time_zone_map.get(state, 'America/New_York')
    
    def parse_date_range(self, date_text: str) -> tuple:
        """Parse date range from text like 'March 25-29, 2026' or 'Feb 6-8, 2026'."""
        try:
            # Pattern for "Month DD-DD, YYYY" or "Month DD, YYYY"
            # Also handles abbreviated months like "Feb", "Sep", "Dec"
            pattern = r'(\w+)\s+(\d+)(?:-(\d+))?,\s+(\d{4})'
            match = re.search(pattern, date_text)
            
            if match:
                month_name = match.group(1).strip()
                start_day = int(match.group(2))
                end_day = int(match.group(3)) if match.group(3) else start_day
                year = int(match.group(4))
                
                # Month map with both full and abbreviated names (case-insensitive)
                month_map = {
                    # Full names
                    'january': 1, 'february': 2, 'march': 3, 'april': 4,
                    'may': 5, 'june': 6, 'july': 7, 'august': 8,
                    'september': 9, 'october': 10, 'november': 11, 'december': 12,
                    # Abbreviated names
                    'jan': 1, 'feb': 2, 'mar': 3, 'apr': 4,
                    'may': 5, 'jun': 6, 'jul': 7, 'aug': 8,
                    'sep': 9, 'sept': 9, 'oct': 10, 'nov': 11, 'dec': 12
                }
                
                # Convert to lowercase for case-insensitive matching
                month_name_lower = month_name.lower()
                month_num = month_map.get(month_name_lower)
                
                if month_num is None:
                    print(f"Warning: Could not parse month '{month_name}' from date '{date_text}'")
                    return None, None
                
                start_date = f"{year}-{month_num:02d}-{start_day:02d}"
                end_date = f"{year}-{month_num:02d}-{end_day:02d}"
                
                return start_date, end_date
        except Exception as e:
            print(f"Error parsing date range '{date_text}': {e}")
        
        return None, None
    
    def parse_location(self, location_text: str) -> Dict[str, str]:
        """Parse location text to extract city and state/country."""
        # Common patterns:
        # "Little Rock, Arkansas" -> city: "Little Rock", state: "AR"
        # "Savannah, GA" -> city: "Savannah", state: "GA"
        # "Valley Forge, PA" -> city: "Valley Forge", state: "PA"
        # "El Salvador" (country only) -> city: "El Salvador", state: "El Salvador"
        # "Athens, Greece" -> city: "Athens", state: "Greece"
        # "Kansai, Japan" -> city: "Kansai", state: "Japan"
        # "Corbera de Llobregat, Spain" -> city: "Corbera de Llobregat", state: "Spain"
        
        location_text = location_text.strip()
        
        # Check if it's a country only (no comma)
        if ',' not in location_text:
            # Could be a country name like "El Salvador"
            return {
                'city': location_text,
                'state': location_text,  # Put country in state column
                'venue_name': 'TBD',
                'venue_street': 'TBD',
                'venue_zip': 'TBD'
            }
        
        parts = [p.strip() for p in location_text.split(',')]
        
        if len(parts) >= 2:
            city = parts[0]
            state_or_country = parts[1]
            
            # Check if it's a US state (try to get abbreviation)
            state_abbr = self.get_state_abbreviation(state_or_country)
            
            # If state_abbr is the same as input and longer than 2 chars, it's likely a country
            if state_abbr == state_or_country and len(state_or_country) > 2:
                # It's a country - put it in the state column
                return {
                    'city': city,
                    'state': state_or_country,  # Country name goes in state column
                    'venue_name': 'TBD',
                    'venue_street': 'TBD',
                    'venue_zip': 'TBD'
                }
            
            # It's a US state - use the abbreviation
            return {
                'city': city,
                'state': state_abbr,
                'venue_name': 'TBD',
                'venue_street': 'TBD',
                'venue_zip': 'TBD'
            }
        
        return {
            'city': location_text,
            'state': location_text,  # If no comma, treat as country
            'venue_name': 'TBD',
            'venue_street': 'TBD',
            'venue_zip': 'TBD'
        }
    
    def scrape_events(self) -> List[Dict[str, Any]]:
        """Scrape events from the USAMW events page."""
        print(f"Fetching page: {self.base_url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        try:
            response = requests.get(self.base_url, headers=headers, timeout=30)
            response.raise_for_status()
            
            soup = BeautifulSoup(response.content, 'html.parser')
            
            events = []
            
            # Parse the page by extracting all text and looking for event patterns
            # Events typically have: Event Name, Date Range, Location
            # Based on the website structure, we'll parse line by line
            # Extract all text and parse line by line
            all_text = soup.get_text(separator='\n')
            lines = [line.strip() for line in all_text.split('\n') if line.strip()]
            
            # Skip navigation and footer content
            skip_patterns = [
                'Home', 'Events', 'Menu', 'Follow us', 'About us', 'Pages', 'Address',
                'Mastersweightliftingusa@', '7232 Varnedoe Drive', 'Olympic Weightlifting',
                'Facebook', 'Instagram', 'YouTube'
            ]
            
            i = 0
            while i < len(lines):
                line = lines[i]
                
                # Skip if it matches skip patterns
                if any(pattern.lower() in line.lower() for pattern in skip_patterns):
                    i += 1
                    continue
                
                # Look for event names - they contain "Masters", "USA Masters", "IMWA", "Pan American", etc.
                # Event names typically:
                # - Start with a year (2026, 2027) or a proper noun (USA, IMWA, Pan, HC)
                # - Are between 15-100 characters (not too short, not too long/descriptive)
                # - Don't start with lowercase words like "What:", "and", "Where:", etc.
                # - Don't contain common description words at the start
                # - Don't contain sentence-like patterns (multiple lowercase words in a row)
                
                # Skip lines that are clearly descriptions or partial text
                skip_starts = [
                    'Location', 'Enter', 'Info', 'Tickets', 'Ranking', 'What:', 'Where:', 
                    'and ', 'From ', 'Enjoy ', 'Roundtrip', 'Athletes', 'Participate',
                    'Prices', 'Free ', 'Where:', 'What:'
                ]
                
                if any(line.startswith(skip) for skip in skip_starts):
                    i += 1
                    continue
                
                # Check if it looks like an event name
                is_valid_event = (
                    len(line) >= 15 and len(line) <= 100 and  # Reasonable length
                    ('Masters' in line or 'IMWA' in line or 'Pan American' in line or 'HC American' in line) and
                    # Skip training camps and cruises
                    'training camp' not in line.lower() and
                    'cruise' not in line.lower() and
                    # Event names typically start with year or proper noun (USA, IMWA, etc.)
                    (re.search(r'^\d{4}', line) or  # Starts with year like "2026"
                     re.search(r'^(USA|IMWA|Pan|HC|Master)', line)) and  # Starts with proper noun
                    # Exclude lines that look like descriptions (too many lowercase words, sentence-like)
                    not re.search(r'^(what|where|when|how|enjoy|participate|athletes|roundtrip|prices|free)', line.lower()) and
                    # Exclude lines with too many lowercase words at the start (likely descriptions)
                    not re.search(r'^[a-z]+\s+[a-z]+\s+[a-z]+', line.lower())
                )
                
                if is_valid_event:
                    
                    event_name = line
                    date_text = None
                    location_text = None
                    venue_name = None
                    
                    # Look ahead for date, location, and venue (within next 8 lines)
                    for j in range(i + 1, min(i + 8, len(lines))):
                        next_line = lines[j]
                        
                        # Skip empty or action lines
                        if (not next_line or 
                            next_line.startswith('Enter') or 
                            next_line.startswith('Info') or
                            next_line.startswith('Tickets') or
                            next_line.startswith('Ranking')):
                            continue
                        
                        # Date pattern: "March 25-29, 2026" or "Feb 6-8, 2026" or "May 27-31, 2026"
                        if re.search(r'\w+\s+\d+-\d+,\s+\d{4}', next_line) or re.search(r'\w+\s+\d+,\s+\d{4}', next_line):
                            if not date_text:
                                date_text = next_line
                        # Location: "Location" keyword or direct city/state pattern
                        elif 'Location' in next_line:
                            location_part = next_line.replace('Location', '').strip()
                            if location_part:
                                location_text = location_part
                            # Check next line if location is on separate line
                            elif j + 1 < len(lines):
                                potential_location = lines[j + 1]
                                if potential_location and not re.search(r'\d{4}', potential_location):
                                    location_text = potential_location
                        # Direct location pattern: "City, State" or "City, Country"
                        elif re.search(r'^[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*,\s*[A-Z]', next_line) and not date_text:
                            if not location_text:
                                location_text = next_line
                        # Venue name (often appears before location, contains words like "Center", "Convention", etc.)
                        elif (not venue_name and 
                              ('Convention' in next_line or 'Center' in next_line or 'Hotel' in next_line or 
                               'Marriott' in next_line or 'Inn' in next_line)):
                            venue_name = next_line
                    
                    # If we found a date, we have a valid event
                    if date_text:
                        # Check for duplicates (same name, date, and location)
                        is_duplicate = False
                        for existing_event in events:
                            if (existing_event['name'] == event_name and 
                                existing_event['date_text'] == date_text and
                                existing_event['location_text'] == (location_text or 'Unknown')):
                                is_duplicate = True
                                break
                        
                        if not is_duplicate:
                            events.append({
                                'name': event_name,
                                'date_text': date_text,
                                'location_text': location_text or 'Unknown',
                                'venue_name': venue_name
                            })
                            print(f"  Found: {event_name} - {date_text} - {location_text or 'Unknown'}")
                
                i += 1
            
            print(f"\nFound {len(events)} unique events")
            return events
            
        except Exception as e:
            print(f"Error scraping events: {e}")
            return []
    
    def transform_events(self, events: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Transform scraped events to match Supabase schema."""
        transformed = []
        
        for event in events:
            name = event.get('name', '').strip()
            date_text = event.get('date_text', '')
            location_text = event.get('location_text', '')
            venue_name = event.get('venue_name')
            
            if not name or not date_text:
                print(f"Skipping event with missing data: {name}")
                continue
            
            # Parse dates
            start_date, end_date = self.parse_date_range(date_text)
            if not start_date or not end_date:
                print(f"Skipping event with invalid date: {name} - {date_text}")
                continue
            
            # Parse location
            location = self.parse_location(location_text)
            
            # Determine time zone
            time_zone = self.map_time_zone(location['state']) if location['state'] else 'America/New_York'
            
            # Use provided venue name or fall back to event name
            final_venue_name = venue_name or location.get('venue_name') or name
            
            transformed_event = {
                'name': name,
                'venue_name': final_venue_name or 'TBD',
                'venue_street': location.get('venue_street') or 'TBD',
                'venue_city': location.get('city') or 'TBD',
                'venue_state': location.get('state') or 'TBD',
                'venue_zip': location.get('venue_zip') or 'TBD',
                'time_zone': time_zone,
                'start_date': start_date,
                'end_date': end_date,
                'status': 'upcoming',
                'federation': 'USAMW'
            }
            
            transformed.append(transformed_event)
        
        return transformed
    
    def meet_exists(self, meet: Dict[str, Any]) -> bool:
        """Check if meet already exists in Supabase."""
        if not self.supabase:
            return False
        
        try:
            response = self.supabase.table('meets').select('id').eq('name', meet['name']).limit(1).execute()
            return len(response.data) > 0
        except Exception as e:
            print(f"Error checking if meet exists: {e}")
            return False
    
    def dry_run(self, events: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """Preview what would be inserted without actually updating the database."""
        if not self.supabase:
            print("Supabase client not initialized. Cannot check existing events.")
            return {'inserted': [], 'skipped': []}
        
        inserted = []
        skipped = []
        
        print("\n" + "="*60)
        print("DRY RUN - PREVIEW (No database changes will be made)")
        print("="*60 + "\n")
        
        for event in events:
            if self.meet_exists(event):
                print(f"  ⊘ Would skip (exists): {event['name']}")
                skipped.append(event)
            else:
                print(f"  ✓ Would insert: {event['name']}")
                print(f"      Venue: {event.get('venue_name', 'N/A')}")
                print(f"      Location: {event.get('venue_city', 'N/A')}, {event.get('venue_state', 'N/A')}")
                print(f"      Dates: {event.get('start_date', 'N/A')} to {event.get('end_date', 'N/A')}")
                inserted.append(event)
        
        return {'inserted': inserted, 'skipped': skipped}
    
    def upsert_to_supabase(self, events: List[Dict[str, Any]], dry_run: bool = False) -> Dict[str, List[Dict[str, Any]]]:
        """Upsert events to Supabase."""
        if dry_run:
            return self.dry_run(events)
        
        if not self.supabase:
            print("Supabase client not initialized. Skipping database update.")
            return {'inserted': [], 'skipped': []}
        
        inserted = []
        skipped = []
        
        print("\n" + "="*60)
        print("UPDATING DATABASE")
        print("="*60 + "\n")
        
        for event in events:
            if self.meet_exists(event):
                print(f"  ⊘ Skipped (exists): {event['name']}")
                skipped.append(event)
                continue
            
            try:
                self.supabase.table('meets').insert(event).execute()
                print(f"  ✓ Inserted: {event['name']}")
                inserted.append(event)
            except Exception as e:
                print(f"  ✗ Error inserting {event['name']}: {e}")
        
        return {'inserted': inserted, 'skipped': skipped}
    
    def send_slack_notification(self, inserted: List[Dict[str, Any]], skipped: List[Dict[str, Any]], is_dry_run: bool = False):
        """Send Slack notification with results."""
        if not self.slack_webhook_url:
            print("Slack webhook URL not configured. Skipping notification.")
            return
        
        try:
            title = "*USAMW Events Scraper Update (DRY RUN)*" if is_dry_run else "*USAMW Events Scraper Update*"
            action = "would be " if is_dry_run else ""
            
            message = f"{title}\n\n"
            message += f"{len(inserted)} event(s) {action}added to Supabase\n"
            
            if inserted:
                message += "\nEvents added:\n"
                for event in inserted:
                    message += f"• {event['name']}\n"
            
            if skipped:
                message += f"\n{len(skipped)} event(s) skipped (already exist)\n"
            
            payload = {'text': message}
            
            response = requests.post(self.slack_webhook_url, json=payload, timeout=30)
            response.raise_for_status()
            print("Slack notification sent successfully")
        except Exception as e:
            print(f"Failed to send Slack notification: {e}")
    
    def run(self, dry_run: bool = False):
        """Run the scraper."""
        print("="*60)
        print(f"USAMW EVENTS SCRAPER{' (DRY RUN)' if dry_run else ''}")
        print("="*60 + "\n")
        
        # Setup Supabase (needed for both dry-run to check existing events and full run)
        self.setup_supabase_client()
        
        # Get Slack webhook URL
        self.slack_webhook_url = os.getenv('SLACK_WEBHOOK_URL')
        
        # Scrape events
        events = self.scrape_events()
        
        if not events:
            print("No events found")
            return
        
        # Transform events
        transformed_events = self.transform_events(events)
        
        if not transformed_events:
            print("No valid events after transformation")
            return
        
        print(f"\nProcessed {len(transformed_events)} valid events")
        
        # Upsert to Supabase (or dry-run)
        results = self.upsert_to_supabase(transformed_events, dry_run=dry_run)
        
        # Send Slack notification
        self.send_slack_notification(results['inserted'], results['skipped'], is_dry_run=dry_run)
        
        print(f"\n✓ Scraper completed successfully")
        if dry_run:
            print(f"  - Would insert: {len(results['inserted'])}")
            print(f"  - Would skip: {len(results['skipped'])}")
        else:
            print(f"  - Inserted: {len(results['inserted'])}")
            print(f"  - Skipped: {len(results['skipped'])}")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Scrape USAMW events and update Supabase'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without updating database'
    )
    
    args = parser.parse_args()
    
    scraper = USAMWEventsScraper()
    scraper.run(dry_run=args.dry_run)


if __name__ == '__main__':
    main()

