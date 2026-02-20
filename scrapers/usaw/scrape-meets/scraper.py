"""USAW Meet Scraper - Scrapes meets from USAW Sport80 and adds them to Notion"""
import os
import re
import json
import base64
import urllib.parse
import logging
from datetime import datetime, timezone, timedelta
from dotenv import load_dotenv
from notion_client import Client
from playwright.sync_api import sync_playwright, TimeoutError as PlaywrightTimeout

# Load environment variables
load_dotenv(dotenv_path="../../.env")

# Configuration
USAW_WIDGET_URL = "https://usaweightlifting.sport80.com/public/widget/1"
NOTION_SECRET = os.environ.get("NOTION_SECRET")
NOTION_DATABASE_ID = os.environ.get("NOTION_DATABASE_ID")

# Logging setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)


class NotionMeetManager:
    """Manages meet data in Notion database"""

    def __init__(self, api_key: str, database_id: str):
        self.client = Client(auth=api_key)
        self.database_id = database_id

    def _generate_email_body(self, meet_data: dict) -> str:
        """Generate personalized email body for meet organizer"""
        organizer_name = meet_data.get("organizer_name", "")
        meet_name = meet_data.get("meet_name", "")
        meet_date = meet_data.get("meet_date", "")

        # Format date to be more readable (remove year for brevity)
        formatted_date = ""
        if meet_date:
            try:
                date_obj = datetime.strptime(meet_date, "%Y-%m-%d")
                formatted_date = date_obj.strftime("%B %-d")  # e.g., "January 31"
            except:
                formatted_date = meet_date

        # Use first name if available
        first_name = organizer_name.split()[0] if organizer_name else ""

        email_body = f"""{first_name if first_name else organizer_name},

My name is Maddisen Mohnsen, I am a coach with Power & Grace Performance and Owner of MeetCal.

MeetCal is an app that puts the start list, meet schedule, and all data such as records, standards, and athlete meet results into a simple app. The goal of the app is to help coaches and athletes perform at their best, while making the sport more accessible.

I saw you have the {meet_name} coming up on {formatted_date} and I would love to put your meet on the app and offer a discount code to all competitors, coaches, and attendees for the app.

Putting the meet on our app is completely free and all we need is the final schedule and final start list.

You can check out how the app works by searching on iOS or Android or by clicking these links if you want to check it out first.
https://apps.apple.com/us/app/meetcal/id6741133286
https://play.google.com/store/apps/details?id=com.memohnsen.meetcal

Let me know if that's something that interests you!

-Maddisen Mohnsen, MBA, CSCS, USAW National Coach
Owner - MeetCal LLC
Instagram: @coachmohnsen | @meetcalapp"""

        return email_body

    def get_existing_meet_names(self):
        """Fetch all existing meet names from Notion to avoid duplicates"""
        existing_meets = set()

        try:
            # First, retrieve the database to get the data source ID
            database = self.client.request(
                method="GET",
                path=f"databases/{self.database_id}"
            )

            # Get the first data source ID from the database
            data_sources = database.get("data_sources", [])
            if not data_sources:
                logging.warning("No data sources found in database")
                return set()

            data_source_id = data_sources[0]["id"]
            logging.info(f"Using data source ID: {data_source_id}")

            has_more = True
            start_cursor = None

            while has_more:
                # Query the data source
                url = f"data_sources/{data_source_id}/query"
                body = {"page_size": 100}
                if start_cursor:
                    body["start_cursor"] = start_cursor

                response = self.client.request(
                    method="POST",
                    path=url,
                    body=body
                )

                for page in response.get("results", []):
                    # Extract meet name from properties
                    meet_name_prop = page.get("properties", {}).get("Meet Name", {})
                    if meet_name_prop.get("title") and len(meet_name_prop["title"]) > 0:
                        meet_name = meet_name_prop["title"][0]["plain_text"]
                        existing_meets.add(meet_name)

                has_more = response.get("has_more", False)
                start_cursor = response.get("next_cursor")

            logging.info(f"Found {len(existing_meets)} existing meets in Notion")
            return existing_meets

        except Exception as e:
            logging.warning(f"Could not fetch existing meets from Notion: {e}")
            import traceback
            logging.warning(traceback.format_exc())
            return set()

    def add_meet_to_notion(self, meet_data: dict):
        """
        Add a meet to the Notion database
        :param meet_data: Dictionary with meet information
        """
        try:
            properties = {
                "Meet Name": {
                    "title": [
                        {
                            "text": {
                                "content": meet_data.get("meet_name", "Unknown Meet")
                            }
                        }
                    ]
                }
            }

            # Add organizer name if available
            if meet_data.get("organizer_name"):
                properties["Organizer Name"] = {
                    "rich_text": [
                        {
                            "text": {
                                "content": meet_data["organizer_name"]
                            }
                        }
                    ]
                }

            # Add organizer email if available
            if meet_data.get("organizer_email"):
                properties["Organizer Email"] = {
                    "email": meet_data["organizer_email"]
                }

            # Add meet date if available
            if meet_data.get("meet_date"):
                properties["Meet Date"] = {
                    "date": {
                        "start": meet_data["meet_date"]
                    }
                }

            # Add Emailed? property with default value "No"
            properties["Emailed?"] = {
                "select": {
                    "name": "No"
                }
            }

            # Generate email body only if we have organizer name
            if meet_data.get("organizer_name"):
                email_body = self._generate_email_body(meet_data)
                if email_body:
                    properties["Email Body"] = {
                        "rich_text": [
                            {
                                "text": {
                                    "content": email_body
                                }
                            }
                        ]
                    }

            self.client.pages.create(
                parent={"database_id": self.database_id},
                properties=properties
            )

            logging.info(f"Successfully added meet: {meet_data.get('meet_name')}")
            return True

        except Exception as e:
            logging.error(f"Error adding meet to Notion: {e}")
            return False


def scrape_meets_with_playwright():
    """Scrape meets from USAW using Playwright"""
    logging.info("Launching browser...")

    meets = []

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        context = browser.new_context(
            viewport={'width': 1920, 'height': 1080},
            user_agent='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        )
        page = context.new_page()

        try:
            # Calculate date range (today to 3 weeks from now)
            today = datetime.now(timezone.utc)
            three_months = today + timedelta(days=21)

            from_date = today.strftime("%Y-%m-%d")
            to_date = three_months.strftime("%Y-%m-%d")

            # Build filter JSON and encode it properly
            filter_dict = {"event_from_date": from_date, "event_to_date": to_date}
            filter_json = json.dumps(filter_dict, separators=(',', ':'))
            filter_b64 = base64.b64encode(filter_json.encode()).decode()

            # Use the exact widget URL format
            url = f"https://usaweightlifting.sport80.com/public/widget/1?filters={urllib.parse.quote(filter_b64, safe='')}"

            logging.info(f"Navigating to widget page for {from_date} to {to_date}...")
            logging.info(f"URL: {url}")
            page.goto(url, wait_until='networkidle', timeout=30000)

            # Wait for Vue app to render and load data
            page.wait_for_timeout(8000)

            # Collect meets from all pages (handle pagination)
            all_text_blocks = []
            current_page = 1
            max_pages = 10  # Safety limit to prevent infinite loops

            while current_page <= max_pages:
                logging.info(f"Scraping page {current_page}...")

                # Find all meet cards/listings on current page
                page_blocks = page.evaluate('''() => {
                    const results = [];
                    // Find all elements that might contain meet info
                    const cards = document.querySelectorAll('.v-card, [class*="card"], [class*="row"]');

                    cards.forEach(card => {
                        const text = card.innerText;
                        // Check if this looks like a meet listing (has a date pattern)
                        if (text.match(/\\d{1,2}\\/\\d{1,2}\\/\\d{4}/)) {
                            results.push({
                                text: text,
                                html: card.outerHTML.substring(0, 500)
                            });
                        }
                    });
                    return results;
                }''')

                all_text_blocks.extend(page_blocks)
                logging.info(f"Found {len(page_blocks)} meets on page {current_page}")

                # Try to find and click next page button
                try:
                    # Look for Next button with aria-label (similar to manual scraper)
                    next_button = page.query_selector('button[aria-label="Next page"]:not([disabled])')

                    # If not found, try looking for a button with "Next" text or chevron icon
                    if not next_button:
                        next_button = page.query_selector('button:has-text("Next"):not([disabled])')

                    # If still not found, try numbered button
                    if not next_button:
                        next_page_num = current_page + 1
                        next_button = page.query_selector(f'button:has-text("{next_page_num}"):not([disabled])')

                    if next_button and next_button.is_visible():
                        logging.info(f"Found next button, clicking to go to page {current_page + 1}...")

                        next_button.click()

                        # Wait for page transition (similar to manual scraper)
                        page.wait_for_timeout(2000)

                        # Wait for cards to be present (ensures content is loaded)
                        try:
                            page.wait_for_selector('.v-card, [class*="card"], [class*="row"]', timeout=10000)
                            logging.info(f"Successfully navigated to page {current_page + 1}")
                            current_page += 1
                        except:
                            logging.warning(f"Timed out waiting for content on page {current_page + 1}, stopping pagination")
                            break
                    else:
                        logging.info("No more pages found (next button not visible or not found)")
                        break
                except Exception as e:
                    logging.info(f"Pagination ended: {e}")
                    break

            logging.info(f"Found {len(all_text_blocks)} total potential meet listings across all pages")

            # Parse each text block to extract meet info
            meets_basic_info = []
            for i, block in enumerate(all_text_blocks):
                try:
                    text = block['text']
                    lines = text.split('\n')

                    # First line is usually the meet name
                    meet_name = lines[0].strip() if lines else ""

                    # Filter out invalid meet names and online qualifiers
                    invalid_names = ['select filters', 'filters', '1', '2', '3', 'login', 'enter now', 'search', 'location']
                    if not meet_name or meet_name.lower() in invalid_names or len(meet_name) < 5:
                        continue

                    # Skip online qualifiers
                    if 'online qualifier' in meet_name.lower():
                        logging.info(f"Skipping online qualifier: {meet_name}")
                        continue

                    # Skip adaptive athletes meets
                    if 'adaptive athletes' in meet_name.lower():
                        logging.info(f"Skipping adaptive athletes meet: {meet_name}")
                        continue

                    # Skip Rogue Fitness sponsored meets
                    if 'powered by rogue fitness' in meet_name.lower():
                        logging.info(f"Skipping Rogue Fitness meet: {meet_name}")
                        continue

                    # Extract date - usually in next few lines
                    meet_date = None
                    for line in lines[1:4]:
                        if '/' in line and '-' in line:
                            # Format: "MM/DD/YYYY - MM/DD/YYYY"
                            try:
                                start_date_str = line.split("-")[0].strip()
                                meet_date = datetime.strptime(start_date_str, "%m/%d/%Y").strftime("%Y-%m-%d")
                                break
                            except:
                                pass

                    # Skip meets that have already started (before today)
                    if meet_date:
                        try:
                            meet_date_obj = datetime.strptime(meet_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
                            if meet_date_obj < today:
                                logging.info(f"Skipping past meet: {meet_name} ({meet_date})")
                                continue
                        except:
                            pass

                    meets_basic_info.append({
                        "meet_name": meet_name,
                        "meet_date": meet_date
                    })
                    logging.info(f"Found: {meet_name} ({meet_date or 'No date'})")

                except Exception as e:
                    logging.error(f"Error parsing meet block {i}: {e}")
                    continue

            logging.info(f"Collected {len(meets_basic_info)} meets. Scraping organizer info...")

            # Now scrape organizer info by visiting each meet detail page
            for idx, basic_info in enumerate(meets_basic_info):
                meet_name = basic_info["meet_name"]
                meet_date = basic_info["meet_date"]

                organizer_name = None
                organizer_email = None
                navigated_to_detail = False

                # Try to navigate to the detail page using the button
                try:
                    # Re-query for the button (in case page changed)
                    buttons = page.query_selector_all('button.s80-btn')
                    button_found = False

                    for btn in buttons:
                        try:
                            btn_parent_text = btn.evaluate('el => el.parentElement.parentElement.innerText')
                            if meet_name in btn_parent_text:
                                button_found = True
                                logging.info(f"Clicking button for: {meet_name}")

                                # Click and wait for navigation
                                btn.click()
                                navigated_to_detail = True
                                page.wait_for_load_state('domcontentloaded', timeout=10000)
                                page.wait_for_timeout(3000)

                                # Extract organizer info
                                page_content = page.content()

                                # Look for email
                                email_match = re.search(r'[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}', page_content)
                                if email_match:
                                    organizer_email = email_match.group(0)
                                    logging.info(f"Found email: {organizer_email}")

                                # Look for organizer name
                                page_text = page.inner_text('body')
                                lines = page_text.split('\n')

                                for i, line in enumerate(lines):
                                    if 'contact' in line.lower() or 'organizer' in line.lower() or 'meet director' in line.lower():
                                        for name_line in lines[i+1:i+4]:
                                            name_line = name_line.strip()
                                            if name_line and '@' not in name_line and len(name_line) > 3:
                                                skip_words = ['email', 'phone', 'address', 'location', 'venue', 'contact', 'name', 'information']
                                                if not any(word in name_line.lower() for word in skip_words):
                                                    organizer_name = name_line
                                                    logging.info(f"Found organizer: {organizer_name}")
                                                    break
                                        if organizer_name:
                                            break

                                break
                        except:
                            continue

                    if not button_found:
                        logging.warning(f"No 'Enter Now' button found for: {meet_name} - skipping this meet")
                        continue

                except PlaywrightTimeout as e:
                    logging.warning(f"Playwright timeout getting organizer for {meet_name}: {e} - adding meet with null organizer info")
                except Exception as e:
                    # Only catch Playwright-specific errors; re-raise others
                    if 'playwright' in type(e).__module__.lower():
                        logging.warning(f"Playwright error getting organizer for {meet_name}: {e} - adding meet with null organizer info")
                    else:
                        raise
                finally:
                    # Always go back to list page if we navigated to detail page
                    if navigated_to_detail:
                        try:
                            page.go_back()
                            page.wait_for_load_state('domcontentloaded', timeout=10000)
                            page.wait_for_timeout(2000)
                            logging.info(f"Navigated back to list page after {meet_name}")
                        except Exception as e:
                            logging.error(f"Error navigating back to list page: {e}")

                # Add meet (with or without organizer info depending on whether button was found)
                meets.append({
                    "meet_name": meet_name,
                    "meet_date": meet_date,
                    "organizer_name": organizer_name,
                    "organizer_email": organizer_email
                })

                logging.info(f"Scraped: {meet_name} (Email: {organizer_email or 'None'}, Org: {organizer_name or 'None'})")

        except PlaywrightTimeout:
            logging.error("Timeout waiting for page to load")
        except Exception as e:
            logging.error(f"Error during scraping: {e}")
        finally:
            context.close()
            browser.close()

    return meets


def main():
    """Main function to scrape USAW meets and add to Notion"""
    logging.info("Starting USAW meet scraper...")

    if not NOTION_SECRET or not NOTION_DATABASE_ID:
        logging.critical("NOTION_SECRET and NOTION_DATABASE_ID must be set. Exiting.")
        return

    # Initialize Notion manager
    notion_manager = NotionMeetManager(api_key=NOTION_SECRET, database_id=NOTION_DATABASE_ID)

    # Get existing meets from Notion
    existing_meets = notion_manager.get_existing_meet_names()

    # Scrape meets using Playwright
    meets = scrape_meets_with_playwright()

    if not meets:
        logging.info("No meets found. Exiting.")
        return

    # Process each meet
    new_meets_added = 0
    for meet_info in meets:
        meet_name = meet_info.get("meet_name", "")

        # Skip if already exists
        if meet_name in existing_meets:
            logging.info(f"Meet already exists: {meet_name}")
            continue

        # Add to Notion
        if notion_manager.add_meet_to_notion(meet_info):
            new_meets_added += 1
            existing_meets.add(meet_name)  # Add to set to prevent duplicates in this run

    logging.info(f"Finished! Added {new_meets_added} new meets to Notion.")


if __name__ == "__main__":
    main()
