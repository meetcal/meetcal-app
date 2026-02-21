# update_supabase_from_sport80.py
import os
import requests
import logging
from datetime import datetime, timezone
from dotenv import load_dotenv
from convex import ConvexClient

# Load environment variables from .env file
load_dotenv()

# Assuming your sport80 library is in a package named 'sport80_scraper'
# located in the same parent directory as this script, or installed.
# If sport80.py and its package are in the current directory:
# from sport80_scraper import SportEighty
# If sport80.py is directly in the same directory (not as a package):
# from sport80 import SportEighty
from sport80 import SportEighty # Adjust if your structure differs

# --- Configuration ---
# Convex Configuration
CONVEX_URL = os.environ.get("CONVEX_URL")
SCRAPER_SECRET = os.environ.get("SCRAPER_SECRET")

# Sport80 Configuration
USAW_DOMAIN = "https://bwl.sport80.com"

# Slack Configuration
SLACK_WEBHOOK_URL = os.environ.get("SLACK_BWL_RESULTS_WEBHOOK_URL")

# --- Logging Setup ---
# GitHub Actions will capture stdout/stderr, so basic config is usually fine.
# The sport80 library also has its own logging/print statements.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(module)s - %(message)s",
    handlers=[logging.StreamHandler()],
)


def get_nested_value(data_dict, primary_key, column_name=None, sub_key="value"):
    """
    Helper to get values from potentially nested Sport80 data.
    Example: data_dict.get('columns', {}).get('Event', {}).get('value')
    Or: data_dict.get('name')
    """
    if column_name and "columns" in data_dict:
        return data_dict.get("columns", {}).get(column_name, {}).get(sub_key)
    return data_dict.get(primary_key)


def parse_event_date(event_data_dict):
    """
    Tries to parse a date string from event data into a datetime object.
    Sport80 API might return dates in various fields or formats.
    """
    date_str = get_nested_value(event_data_dict, "date", "Start Date") or \
               get_nested_value(event_data_dict, "start_date")

    if not date_str:
        return datetime.min.replace(
            tzinfo=timezone.utc
        ) # Default for sorting

    possible_formats = [
        "%Y-%m-%d %H:%M:%S",
        "%Y-%m-%d",
        "%d/%m/%Y %H:%M:%S", # Common UK/EU format
        "%d/%m/%Y",
        "%m/%d/%Y %H:%M:%S", # Common US format
        "%m/%d/%Y",
    ]
    for fmt in possible_formats:
        try:
            # Take only date part if time is included
            dt_str_part = str(date_str).split(" ")[0]
            dt = datetime.strptime(dt_str_part, fmt)
            return dt.replace(tzinfo=timezone.utc) # Assume UTC
        except (ValueError, TypeError):
            continue
    logging.warning(f"Could not parse date string: {date_str} for event.")
    return datetime.min.replace(tzinfo=timezone.utc)


def add_meet_results_to_convex(client: ConvexClient, results_to_insert: list):
    """Upsert a batch of results for a meet into Convex via ingestLiftingResult."""
    if not results_to_insert:
        logging.info("No results to insert.")
        return

    success_count = 0
    for result in results_to_insert:
        try:
            client.action("scraperIngestion:ingestLiftingResult", result)
            success_count += 1
        except Exception as e:
            logging.error(f"Error upserting result for '{result.get('name')}' in Convex: {e}")

    logging.info(f"Successfully upserted {success_count}/{len(results_to_insert)} results via Convex.")


def fetch_recent_events_from_sport80(api_client: SportEighty, num_events: int = 30) -> list:
    """
    Fetches recent events from Sport80 from current and previous year,
    sorts them by date, and returns the most recent 'num_events'.
    """
    all_event_dictionaries = []
    current_year = datetime.now(timezone.utc).year
    years_to_check = [current_year, current_year - 1]

    for year in years_to_check:
        try:
            logging.info(f"Fetching event index from Sport80 for year {year}...")
            # SportEighty.event_index returns a dict: {0: event1, 1: event2, ...}
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

    all_event_dictionaries.sort(key=parse_event_date, reverse=True)
    
    logging.info(f"Total event items fetched and sorted: {len(all_event_dictionaries)}")
    return all_event_dictionaries[:num_events]


def fetch_meet_results_from_sport80(api_client: SportEighty, event_data_dict: dict) -> list:
    """
    Fetches results for a specific event.
    The event_data_dict MUST contain the necessary structure for event_id extraction
    (i.e., event_data_dict['action'][0]['route']) as used by the library.
    """
    meet_name_for_log = get_nested_value(event_data_dict, "name", "Event") or "Unknown Event"
    try:
        # Check if the critical 'action' key exists for ID extraction by the library
        if not (isinstance(event_data_dict.get("action"), list) and \
                len(event_data_dict["action"]) > 0 and \
                isinstance(event_data_dict["action"][0], dict) and \
                "route" in event_data_dict["action"][0]):
            logging.error(f"Event data for '{meet_name_for_log}' is missing 'action':'route' structure needed for fetching results. Skipping.")
            logging.debug(f"Problematic event_data_dict: {str(event_data_dict)[:500]}") # Log part of the dict
            return []

        logging.info(f"Fetching results for meet: {meet_name_for_log}")
        # SportEighty.event_results returns a dict: {0: result1, 1: result2, ...}
        results_dict = api_client.event_results(event_dict=event_data_dict)
        if isinstance(results_dict, dict):
            return list(results_dict.values()) # Return list of result row dictionaries
        logging.warning(f"event_results for {meet_name_for_log} did not return a dict: {type(results_dict)}")
        return []
    except Exception as e:
        logging.error(f"Error fetching results for {meet_name_for_log}: {e}", exc_info=True)
        return []


def send_slack_notification(added_meet_names: list[str]):
    """Send a Slack notification with the names of meets added and timestamp."""
    if not SLACK_WEBHOOK_URL:
        logging.info("Slack webhook URL not configured. Skipping notification.")
        return

    # Get current timestamp in a readable format
    current_time = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    
    # Create the message
    if not added_meet_names:
        message = f"🇬🇧 No new BWL meet results added to Supabase"
    elif len(added_meet_names) == 1:
        message = f"🇬🇧 1 BWL Meet Added to Supabase:\n• {added_meet_names[0]}"
    else:
        meet_list = "\n".join([f"• {name}" for name in added_meet_names])
        message = f"🇬🇧 {len(added_meet_names)} BWL Meets Added to Supabase:\n{meet_list}"
    
    payload = {
        "text": message
    }
    
    try:
        response = requests.post(SLACK_WEBHOOK_URL, json=payload, timeout=30)
        response.raise_for_status()
        logging.info(f"Slack notification sent successfully: {message}")
    except requests.exceptions.RequestException as e:
        logging.error(f"Failed to send Slack notification: {e}")
        if hasattr(e, 'response') and e.response is not None:
            logging.error(f"Slack webhook response: {e.response.text}")


def main():
    logging.info("Starting Sport80 to Convex sync process...")

    if not CONVEX_URL or not SCRAPER_SECRET:
        logging.critical("CONVEX_URL and SCRAPER_SECRET must be set. Exiting.")
        return

    client = ConvexClient(CONVEX_URL)

    sport80_api = SportEighty(subdomain=USAW_DOMAIN, return_dict=True, debug=logging.WARNING)
    # Keeping num_events=1 for this test, can be changed back to 30 later.
    recent_sport80_events_data = fetch_recent_events_from_sport80(sport80_api, num_events=20)

    if not recent_sport80_events_data:
        logging.info("No recent events fetched from Sport80. Exiting.")
        return
    logging.info(f"Fetched {len(recent_sport80_events_data)} event(s) from Sport80.")

    candidate_event_details = []
    for event_data_item in recent_sport80_events_data:
        # BWL uses "event" as the field name (not "meet")
        meet_name = event_data_item.get("event")
        event_id_str = "N/A"
        try:
            event_id_str = str(event_data_item['action'][0]['route'].split('/')[-1]).strip()
        except (KeyError, IndexError, TypeError):
            # Fallback if the primary path for event_id is not found
            event_id_from_data = event_data_item.get("id") # sport80 library might put it here
            if event_id_from_data:
                event_id_str = str(event_id_from_data).strip()
        
        if not meet_name:
            logging.warning(f"Event data missing 'meet' field. Event ID: {event_id_str}. Data: {str(event_data_item)[:200]}")

        if event_id_str != "N/A":
            candidate_event_details.append({"id": event_id_str, "name": meet_name, "data": event_data_item})
        else:
            logging.warning(f"Could not extract a valid event_id for event: {meet_name if meet_name else 'Name N/A'}. Data: {str(event_data_item)[:200]}")

    if not candidate_event_details:
        logging.info("No valid candidate events with IDs to process after initial parsing. Exiting.")
        return

    processed_event_ids_this_run = set() # To prevent re-processing if Sport80 API sends duplicates in one batch
    added_meet_names = []  # Track the names of meets that were successfully added

    for event_details in candidate_event_details:
        current_event_id = event_details["id"]
        current_meet_name = event_details["name"]
        event_data_for_api = event_details["data"]

        logging.info(f"Processing candidate: Meet Name='{current_meet_name}', Event ID='{current_event_id}'")

        if not current_meet_name: # Final check for meet name
            logging.warning(f"Skipping event with ID '{current_event_id}' due to missing meet name after all parsing attempts.")
            continue

        if current_event_id in processed_event_ids_this_run:
            logging.info(f"Event ID '{current_event_id}' ('{current_meet_name}') was already processed in this script run. Skipping.")
            continue

        logging.info(f"Processing meet for Convex upsert: '{current_meet_name}' (Event ID: {current_event_id})")
        
        detailed_results_list = fetch_meet_results_from_sport80(sport80_api, event_data_for_api)

        if not detailed_results_list:
            logging.warning(f"No detailed results found/fetched for '{current_meet_name}' (ID: {current_event_id}). Adding ID to processed list to prevent re-check this run.")
            processed_event_ids_this_run.add(current_event_id)
            continue

        formatted_results_for_convex = []
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

            formatted_results_for_convex.append({
                "scraperSecret": SCRAPER_SECRET,
                "eventId": current_event_id,
                "meet": current_meet_name,
                "date": meet_date_for_db,
                "name": lifter_name,
                "age": age_cat,
                "bodyWeight": float(body_w) if body_w is not None else None,
                "snatch1": float(sn1) if sn1 is not None else None,
                "snatch2": float(sn2) if sn2 is not None else None,
                "snatch3": float(sn3) if sn3 is not None else None,
                "snatchBest": float(best_sn) if best_sn is not None else None,
                "cj1": float(cj1) if cj1 is not None else None,
                "cj2": float(cj2) if cj2 is not None else None,
                "cj3": float(cj3) if cj3 is not None else None,
                "cjBest": float(best_cj) if best_cj is not None else None,
                "total": float(total_lifted) if total_lifted is not None else None,
                "adaptive": False,
                "federation": "BWL",
            })

        if formatted_results_for_convex:
            add_meet_results_to_convex(client, formatted_results_for_convex)
            added_meet_names.append(current_meet_name)  # Add the meet name to our list
            logging.info(f"Successfully upserted {len(formatted_results_for_convex)} results for '{current_meet_name}' (ID: {current_event_id}).")
        else:
            logging.warning(f"No results formatted for Convex for meet: '{current_meet_name}' (ID: {current_event_id}).")
        
        processed_event_ids_this_run.add(current_event_id) # Add here after attempting to process

    logging.info(f"Finished Sport80 to Convex sync. Upserted results for {len(added_meet_names)} meet(s).")

    # Send Slack notification with meet names
    send_slack_notification(added_meet_names)

if __name__ == "__main__":
    main()
