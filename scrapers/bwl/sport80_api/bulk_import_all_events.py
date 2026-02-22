# bulk_import_all_events.py
import os
import requests
import logging
from datetime import datetime, timezone
import time
from dotenv import load_dotenv

# Load environment variables from .env file
load_dotenv()

from sport80 import SportEighty

# --- Configuration ---
# Supabase Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_TABLE_NAME = "lifting_results"
SUPABASE_MEET_NAME_COLUMN = "meet"

# Sport80 Configuration
BWL_DOMAIN = "https://bwl.sport80.com"

# Years to scrape - adjust these to cover all historical data you want
START_YEAR = 2014 # Adjust to earliest year you want to scrape
END_YEAR = datetime.now(timezone.utc).year

# Rate limiting to avoid overwhelming the API
DELAY_BETWEEN_EVENTS = 1  # seconds between fetching each event's results

# Slack Configuration (optional for notifications)
SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL")

# --- Logging Setup ---
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(module)s - %(message)s",
    handlers=[logging.StreamHandler()],
)


def get_nested_value(data_dict, primary_key, column_name=None, sub_key="value"):
    """
    Helper to get values from potentially nested Sport80 data.
    """
    if column_name and "columns" in data_dict:
        return data_dict.get("columns", {}).get(column_name, {}).get(sub_key)
    return data_dict.get(primary_key)


def parse_event_date(event_data_dict):
    """
    Tries to parse a date string from event data into a datetime object.
    """
    date_str = get_nested_value(event_data_dict, "date", "Start Date") or \
               get_nested_value(event_data_dict, "start_date")

    if not date_str:
        return datetime.min.replace(tzinfo=timezone.utc)

    possible_formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S",
        "%d/%m/%Y",
        "%m/%d/%Y %H:%M:%S",
        "%m/%d/%Y",
    ]
    for fmt in possible_formats:
        try:
            dt_str_part = str(date_str).split(" ")[0]
            dt = datetime.strptime(dt_str_part, fmt)
            return dt.replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            continue
    logging.warning(f"Could not parse date string: {date_str} for event.")
    return datetime.min.replace(tzinfo=timezone.utc)


def filter_already_existing_event_ids(candidate_event_ids: list[str]) -> set[str]:
    """Given a list of candidate event IDs, query Supabase to find which ones already exist."""
    if not candidate_event_ids:
        logging.info("No candidate event IDs provided to check for existence.")
        return set()

    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase URL or Key not configured for checking event IDs.")
        return set()

    # Filter by both event_id AND federation to avoid conflicts between BWL and USAW events
    # We need to get DISTINCT event_ids since each event has multiple rows (one per lifter)
    # Fetch in batches to handle large datasets
    
    existing_ids_in_db = set()
    batch_size = 5000
    offset = 0
    total_rows_fetched = 0
    
    try:
        logging.info(f"Querying Supabase for existing BWL event IDs...")
        
        while True:
            url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}?select=event_id&federation=eq.BWL&limit={batch_size}&offset={offset}"
            
            headers = {
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Accept": "application/json"
            }
            
            resp = requests.get(url, headers=headers, timeout=45)
            resp.raise_for_status()
            
            results = resp.json()
            
            if not results:
                break  # No more results
            
            total_rows_fetched += len(results)
            for row in results:
                if "event_id" in row and row["event_id"]:
                    existing_ids_in_db.add(str(row["event_id"]).strip())
            
            if len(results) < batch_size:
                break  # Last batch
            
            offset += batch_size
        
        logging.info(f"Query returned {total_rows_fetched} total rows from database")
        logging.info(f"Found {len(existing_ids_in_db)} unique BWL event IDs already in database")
        
        # Now filter to only return the candidate event IDs that exist
        candidate_ids_set = set(candidate_event_ids)
        matching_existing = existing_ids_in_db.intersection(candidate_ids_set)
        logging.info(f"Of the {len(candidate_event_ids)} candidates, {len(matching_existing)} already exist in DB")
        return matching_existing
    except requests.exceptions.RequestException as e:
        logging.error(f"Error querying Supabase for existing event IDs: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logging.error(f"Supabase response content: {e.response.text}")
        return set()
    except ValueError:
        logging.error(f"Error decoding JSON from Supabase event_id check")
        return set()


def add_meet_results_to_supabase(results_to_insert: list):
    """Insert a batch of results for a meet into Supabase."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase URL or Key not configured for adding results.")
        return None
    if not results_to_insert:
        logging.info("No results to insert.")
        return None

    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }
    try:
        resp = requests.post(url, headers=headers, json=results_to_insert, timeout=60)
        resp.raise_for_status()
        logging.info(f"Successfully inserted {len(results_to_insert)} results via Supabase API.")
        return resp
    except requests.exceptions.RequestException as e:
        logging.error(f"Error inserting meet results to Supabase: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logging.error(f"Supabase response content: {e.response.text}")
        return None


def fetch_all_events_from_sport80(api_client: SportEighty, start_year: int, end_year: int) -> list:
    """
    Fetches ALL events from Sport80 across the specified year range.
    Returns a list of all event dictionaries sorted by date (oldest first for bulk import).
    """
    all_event_dictionaries = []
    
    for year in range(start_year, end_year + 1):
        try:
            logging.info(f"Fetching event index from Sport80 for year {year}...")
            events_dict_for_year = api_client.event_index(year=year)
            if isinstance(events_dict_for_year, dict):
                all_event_dictionaries.extend(list(events_dict_for_year.values()))
                logging.info(f"Fetched {len(events_dict_for_year)} event items for {year}.")
            else:
                logging.warning(
                    f"event_index for {year} did not return a dict: {type(events_dict_for_year)}"
                )
        except Exception as e:
            logging.error(f"Error fetching Sport80 events for year {year}: {e}", exc_info=True)
            continue

    if not all_event_dictionaries:
        logging.warning("No events fetched from Sport80.")
        return []

    # Sort by date (oldest first for bulk import to maintain chronological order)
    all_event_dictionaries.sort(key=parse_event_date, reverse=False)
    
    logging.info(f"Total event items fetched and sorted: {len(all_event_dictionaries)}")
    return all_event_dictionaries


def fetch_meet_results_from_sport80(api_client: SportEighty, event_data_dict: dict) -> list:
    """
    Fetches results for a specific event.
    """
    meet_name_for_log = get_nested_value(event_data_dict, "meet") or "Unknown Event"
    try:
        if not (isinstance(event_data_dict.get("action"), list) and \
                len(event_data_dict["action"]) > 0 and \
                isinstance(event_data_dict["action"][0], dict) and \
                "route" in event_data_dict["action"][0]):
            logging.error(f"Event data for '{meet_name_for_log}' is missing 'action':'route' structure. Skipping.")
            return []

        logging.info(f"Fetching results for meet: {meet_name_for_log}")
        results_dict = api_client.event_results(event_dict=event_data_dict)
        if isinstance(results_dict, dict):
            return list(results_dict.values())
        logging.warning(f"event_results for {meet_name_for_log} did not return a dict: {type(results_dict)}")
        return []
    except Exception as e:
        logging.error(f"Error fetching results for {meet_name_for_log}: {e}", exc_info=True)
        return []


def fetch_max_id_from_supabase() -> int:
    """Fetch the highest ID value from the Supabase database."""
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase URL or Key not configured.")
        return 0

    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}?select=id&order=id.desc&limit=1"
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }
    try:
        resp = requests.get(url, headers=headers, timeout=30)
        resp.raise_for_status()
        results = resp.json()
        if results and len(results) > 0:
            return results[0]["id"]
        return 0
    except requests.exceptions.RequestException as e:
        logging.error(f"Error fetching max ID from Supabase: {e}")
        return 0
    except (ValueError, KeyError, IndexError) as e:
        logging.error(f"Error processing max ID from Supabase: {e}")
        return 0


def send_slack_notification(message: str):
    """Send a Slack notification."""
    if not SLACK_WEBHOOK_URL:
        logging.info("Slack webhook URL not configured. Skipping notification.")
        return
    
    payload = {"text": message}
    
    try:
        response = requests.post(SLACK_WEBHOOK_URL, json=payload, timeout=30)
        response.raise_for_status()
        logging.info(f"Slack notification sent successfully")
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to send Slack notification: {e}")


def main():
    logging.info("="*80)
    logging.info("Starting BULK Sport80 to Supabase import process...")
    logging.info(f"Will scrape events from {START_YEAR} to {END_YEAR}")
    logging.info("="*80)

    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.critical("SUPABASE_URL and SUPABASE_KEY must be set. Exiting.")
        return

    # Send start notification
    send_slack_notification(
        f"🚀 Started bulk import of Sport80 events ({START_YEAR}-{END_YEAR})"
    )

    sport80_api = SportEighty(subdomain=BWL_DOMAIN, return_dict=True, debug=logging.WARNING)
    
    # Fetch ALL events across all years
    all_events_data = fetch_all_events_from_sport80(sport80_api, START_YEAR, END_YEAR)

    if not all_events_data:
        logging.info("No events fetched from Sport80. Exiting.")
        send_slack_notification("⚠️ Bulk import completed: No events found")
        return
    
    logging.info(f"Total events fetched: {len(all_events_data)}")

    # Extract event IDs and prepare event details
    candidate_event_details = []
    for idx, event_data_item in enumerate(all_events_data):
        # Extract meet name - BWL uses "event" as the field name (not "meet")
        meet_name = event_data_item.get("event")
        
        event_id_str = "N/A"
        try:
            event_id_str = str(event_data_item['action'][0]['route'].split('/')[-1]).strip()
        except (KeyError, IndexError, TypeError):
            event_id_from_data = event_data_item.get("id")
            if event_id_from_data:
                event_id_str = str(event_id_from_data).strip()
        
        if event_id_str != "N/A":
            candidate_event_details.append({
                "id": event_id_str,
                "name": meet_name,
                "data": event_data_item
            })
        else:
            logging.warning(f"Could not extract valid event_id for event: {meet_name if meet_name else 'Name N/A'}")

    if not candidate_event_details:
        logging.info("No valid candidate events with IDs to process. Exiting.")
        return

    logging.info(f"Valid candidate events with IDs: {len(candidate_event_details)}")

    # Check which events already exist in the database
    candidate_ids_to_check_in_db = [details["id"] for details in candidate_event_details]
    already_existing_event_ids_in_db = filter_already_existing_event_ids(candidate_ids_to_check_in_db)
    
    logging.info(f"Checked {len(candidate_ids_to_check_in_db)} candidate event IDs.")
    logging.info(f"Found {len(already_existing_event_ids_in_db)} already existing in database.")
    logging.info(f"Will process {len(candidate_ids_to_check_in_db) - len(already_existing_event_ids_in_db)} new events.")

    max_id_in_db = fetch_max_id_from_supabase()
    next_id_for_new_rows = max_id_in_db + 1
    logging.info(f"Starting ID for new rows: {next_id_for_new_rows}")

    processed_event_ids_this_run = set()
    added_meet_names = []
    skipped_count = 0
    error_count = 0
    total_results_added = 0

    # Process each event
    for idx, event_details in enumerate(candidate_event_details, 1):
        current_event_id = event_details["id"]
        current_meet_name = event_details["name"]
        event_data_for_api = event_details["data"]

        logging.info(f"[{idx}/{len(candidate_event_details)}] Processing: '{current_meet_name}' (ID: {current_event_id})")

        if not current_meet_name:
            logging.warning(f"Skipping event with ID '{current_event_id}' due to missing meet name.")
            skipped_count += 1
            continue

        if current_event_id in already_existing_event_ids_in_db:
            logging.info(f"Event ID '{current_event_id}' already exists in database. Skipping.")
            skipped_count += 1
            continue
        
        if current_event_id in processed_event_ids_this_run:
            logging.info(f"Event ID '{current_event_id}' already processed in this run. Skipping.")
            skipped_count += 1
            continue

        # Fetch detailed results
        detailed_results_list = fetch_meet_results_from_sport80(sport80_api, event_data_for_api)

        if not detailed_results_list:
            logging.warning(f"No results found for '{current_meet_name}' (ID: {current_event_id}).")
            processed_event_ids_this_run.add(current_event_id)
            skipped_count += 1
            continue

        # Format results for Supabase
        formatted_results_for_supabase = []
        meet_date_obj = parse_event_date(event_data_for_api)
        meet_date_for_db = meet_date_obj.strftime("%Y-%m-%d") if meet_date_obj > datetime.min.replace(tzinfo=timezone.utc) else None

        for result_item in detailed_results_list:
            lifter_name = get_nested_value(result_item, "lifter", "Athlete") or get_nested_value(result_item, "name", "Name")
            age_cat = get_nested_value(result_item, "age_category", "Age Category") or get_nested_value(result_item, "age", "Age")
            body_w = get_nested_value(result_item, "body_weight_kg", "Bodyweight") or get_nested_value(result_item, "body_weight_(kg)")
            sn1 = get_nested_value(result_item, "snatch_lift_1", "Snatch 1")
            sn2 = get_nested_value(result_item, "snatch_lift_2", "Snatch 2")
            sn3 = get_nested_value(result_item, "snatch_lift_3", "Snatch 3")
            best_sn = get_nested_value(result_item, "best_snatch", "Best Snatch")
            cj1 = get_nested_value(result_item, "cj_lift_1", "Clean & Jerk 1") or get_nested_value(result_item, "c&j_lift_1")
            cj2 = get_nested_value(result_item, "cj_lift_2", "Clean & Jerk 2") or get_nested_value(result_item, "c&j_lift_2")
            cj3 = get_nested_value(result_item, "cj_lift_3", "Clean & Jerk 3") or get_nested_value(result_item, "c&j_lift_3")
            best_cj = get_nested_value(result_item, "best_cj", "Best Clean & Jerk") or get_nested_value(result_item, "best_c&j")
            total_lifted = get_nested_value(result_item, "total", "Total")

            formatted_results_for_supabase.append({
                "id": next_id_for_new_rows,
                "event_id": current_event_id,
                SUPABASE_MEET_NAME_COLUMN: current_meet_name,
                "date": meet_date_for_db,
                "name": lifter_name,
                "age": age_cat,
                "body_weight": body_w,
                "snatch1": sn1, "snatch2": sn2, "snatch3": sn3, "snatch_best": best_sn,
                "cj1": cj1, "cj2": cj2, "cj3": cj3, "cj_best": best_cj,
                "total": total_lifted,
                "federation": "BWL",
            })
            next_id_for_new_rows += 1

        # Insert to Supabase
        if formatted_results_for_supabase:
            result = add_meet_results_to_supabase(formatted_results_for_supabase)
            if result:
                added_meet_names.append(current_meet_name)
                total_results_added += len(formatted_results_for_supabase)
                logging.info(f"✓ Added {len(formatted_results_for_supabase)} results for '{current_meet_name}'")
            else:
                error_count += 1
                logging.error(f"✗ Failed to add results for '{current_meet_name}'")
        else:
            logging.warning(f"No results formatted for '{current_meet_name}'")
            skipped_count += 1
        
        processed_event_ids_this_run.add(current_event_id)
        
        # Rate limiting to be nice to the API
        time.sleep(DELAY_BETWEEN_EVENTS)

    # Final summary
    logging.info("="*80)
    logging.info("BULK IMPORT SUMMARY")
    logging.info("="*80)
    logging.info(f"Total events processed: {len(candidate_event_details)}")
    logging.info(f"Successfully added: {len(added_meet_names)} meets")
    logging.info(f"Total results added: {total_results_added}")
    logging.info(f"Skipped (already exist or no results): {skipped_count}")
    logging.info(f"Errors: {error_count}")
    logging.info("="*80)

    # Send completion notification
    summary_message = (
        f"✅ Bulk import completed!\n"
        f"• Added {len(added_meet_names)} meets\n"
        f"• Total results: {total_results_added}\n"
        f"• Skipped: {skipped_count}\n"
        f"• Errors: {error_count}"
    )
    send_slack_notification(summary_message)


if __name__ == "__main__":
    main()

