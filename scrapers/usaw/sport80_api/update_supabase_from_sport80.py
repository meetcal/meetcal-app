# update_supabase_from_sport80.py
import os
import requests
import logging
from datetime import datetime, timezone

from sport80 import SportEighty
from convex import ConvexClient

CONVEX_URL = os.environ.get("CONVEX_URL")
SCRAPER_SECRET = os.environ.get("SCRAPER_SECRET")
USAW_DOMAIN = "https://usaweightlifting.sport80.com"
SLACK_WEBHOOK_URL = os.environ.get("SLACK_WEBHOOK_URL")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(module)s - %(message)s",
    handlers=[logging.StreamHandler()],
)


def get_nested_value(data_dict, primary_key, column_name=None, sub_key="value"):
    if column_name and "columns" in data_dict:
        return data_dict.get("columns", {}).get(column_name, {}).get(sub_key)
    return data_dict.get(primary_key)


def parse_event_date(event_data_dict):
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


def add_meet_results_to_convex(client: ConvexClient, results_to_insert: list):
    if not results_to_insert:
        logging.info("No results to insert.")
        return {"inserted": 0, "updated": 0, "unchanged": 0}

    inserted_count = 0
    updated_count = 0
    unchanged_count = 0
    for result in results_to_insert:
        try:
            ingest_result = client.action("scraperIngestion:ingestLiftingResult", result)
            if ingest_result.get("wasInsert"):
                inserted_count += 1
            elif ingest_result.get("wasChanged"):
                updated_count += 1
            else:
                unchanged_count += 1
        except Exception as e:
            logging.error(f"Error upserting result for '{result.get('name')}' in Convex: {e}")

    logging.info(
        "Processed %s results via Convex: %s inserted, %s updated, %s unchanged.",
        len(results_to_insert),
        inserted_count,
        updated_count,
        unchanged_count,
    )
    return {
        "inserted": inserted_count,
        "updated": updated_count,
        "unchanged": unchanged_count,
    }


def fetch_recent_events_from_sport80(api_client: SportEighty, num_events: int = 30) -> list:
    all_event_dictionaries = []
    current_year = datetime.now(timezone.utc).year
    years_to_check = [current_year, current_year - 1]

    for year in years_to_check:
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

    all_event_dictionaries.sort(key=parse_event_date, reverse=True)
    logging.info(f"Total event items fetched and sorted: {len(all_event_dictionaries)}")
    return all_event_dictionaries[:num_events]


def fetch_meet_results_from_sport80(api_client: SportEighty, event_data_dict: dict) -> list:
    meet_name_for_log = get_nested_value(event_data_dict, "name", "Event") or "Unknown Event"
    try:
        if not (isinstance(event_data_dict.get("action"), list) and
                len(event_data_dict["action"]) > 0 and
                isinstance(event_data_dict["action"][0], dict) and
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


def send_slack_notification(inserted_meet_names: list[str], updated_meet_names: list[str]):
    total_changes = len(inserted_meet_names) + len(updated_meet_names)
    if total_changes == 0:
        logging.info("No database changes; skipping Slack notification.")
        return

    if not SLACK_WEBHOOK_URL:
        logging.info("Slack webhook URL not configured. Skipping notification.")
        return

    message = (
        f"USAW Meet Results Update\n"
        f"{len(inserted_meet_names)} new meet result set(s) added, "
        f"{len(updated_meet_names)} meet result set(s) updated"
    )
    if inserted_meet_names:
        inserted_meet_list = "\n".join([f"• {name}" for name in inserted_meet_names])
        message += f"\n\nNew Meets\n{inserted_meet_list}"
    if updated_meet_names:
        updated_meet_list = "\n".join([f"• {name}" for name in updated_meet_names])
        message += f"\n\nUpdated Meets\n{updated_meet_list}"

    payload = {"text": message}
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
    recent_sport80_events_data = fetch_recent_events_from_sport80(sport80_api, num_events=30)

    if not recent_sport80_events_data:
        logging.info("No recent events fetched from Sport80. Exiting.")
        return
    logging.info(f"Fetched {len(recent_sport80_events_data)} event(s) from Sport80.")

    candidate_event_details = []
    for event_data_item in recent_sport80_events_data:
        meet_name = get_nested_value(event_data_item, "meet")
        event_id_str = "N/A"
        try:
            event_id_str = str(event_data_item['action'][0]['route'].split('/')[-1]).strip()
        except (KeyError, IndexError, TypeError):
            event_id_from_data = event_data_item.get("id")
            if event_id_from_data:
                event_id_str = str(event_id_from_data).strip()

        if not meet_name:
            logging.warning(f"Event data missing 'meet' field. Event ID: {event_id_str}.")

        if event_id_str != "N/A":
            candidate_event_details.append({"id": event_id_str, "name": meet_name, "data": event_data_item})
        else:
            logging.warning(f"Could not extract valid event_id for event: {meet_name or 'Name N/A'}.")

    if not candidate_event_details:
        logging.info("No valid candidate events with IDs to process. Exiting.")
        return

    processed_event_ids_this_run = set()
    inserted_meet_names = []
    updated_meet_names = []

    for event_details in candidate_event_details:
        current_event_id = event_details["id"]
        current_meet_name = event_details["name"]
        event_data_for_api = event_details["data"]

        logging.info(f"Processing candidate: Meet Name='{current_meet_name}', Event ID='{current_event_id}'")

        if not current_meet_name:
            logging.warning(f"Skipping event with ID '{current_event_id}' due to missing meet name.")
            continue

        if current_event_id in processed_event_ids_this_run:
            logging.info(f"Event ID '{current_event_id}' already processed this run. Skipping.")
            continue

        logging.info(f"Processing meet for Convex upsert: '{current_meet_name}' (Event ID: {current_event_id})")
        detailed_results_list = fetch_meet_results_from_sport80(sport80_api, event_data_for_api)

        if not detailed_results_list:
            processed_event_ids_this_run.add(current_event_id)
            continue

        formatted_results_for_convex = []
        meet_date_obj = parse_event_date(event_data_for_api)
        meet_date_for_db = meet_date_obj.strftime("%Y-%m-%d") if meet_date_obj > datetime.min.replace(tzinfo=timezone.utc) else "1970-01-01"

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
                "federation": "USAW",
            })

        if formatted_results_for_convex:
            upsert_summary = add_meet_results_to_convex(client, formatted_results_for_convex)
            if upsert_summary["inserted"] > 0:
                inserted_meet_names.append(current_meet_name)
            elif upsert_summary["updated"] > 0:
                updated_meet_names.append(current_meet_name)
            logging.info(
                "Processed %s results for '%s' (ID: %s): %s inserted, %s updated, %s unchanged.",
                len(formatted_results_for_convex),
                current_meet_name,
                current_event_id,
                upsert_summary["inserted"],
                upsert_summary["updated"],
                upsert_summary["unchanged"],
            )
        else:
            logging.warning(f"No results formatted for meet: '{current_meet_name}' (ID: {current_event_id}).")

        processed_event_ids_this_run.add(current_event_id)

    logging.info(
        "Finished Sport80 to Convex sync. %s meet(s) inserted, %s meet(s) updated.",
        len(inserted_meet_names),
        len(updated_meet_names),
    )
    send_slack_notification(inserted_meet_names, updated_meet_names)


if __name__ == "__main__":
    main()
