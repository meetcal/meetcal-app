#!/usr/bin/env python3
# To run with venv: source venv/bin/activate && pip install -r requirements.txt && python intl_rankings_scraper.py

import os
import re
import sys
import argparse
import logging
import requests
from typing import List, Dict, Optional
from io import BytesIO
from decimal import Decimal
from dotenv import load_dotenv
import pdfplumber

# ============================================================================
# CONFIGURATION - Enter your PDF URL here
# ============================================================================
PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt96a4235abed6a89a/693ada9cb8450410db192f1f/2026_Youth_World_Championships_Women_120925.pdf"

# Load environment variables
load_dotenv()

# Supabase Configuration
SUPABASE_URL = os.environ.get("SUPABASE_URL")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY")
SUPABASE_TABLE_NAME = "intl_rankings"

# Logging Setup
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(levelname)s - %(message)s",
    handlers=[logging.StreamHandler()],
)


def download_pdf(url: str) -> Optional[BytesIO]:
    """
    Download PDF from URL and return as BytesIO object.

    Args:
        url: The URL of the PDF to download

    Returns:
        BytesIO object containing the PDF data, or None if download fails
    """
    try:
        print(f"Downloading PDF from: {url}")
        response = requests.get(url, timeout=60)
        response.raise_for_status()
        print("PDF downloaded successfully")
        return BytesIO(response.content)
    except requests.exceptions.RequestException as e:
        logging.error(f"Error downloading PDF: {e}")
        return None


def extract_text_from_pdf(pdf_file: BytesIO) -> str:
    """
    Extract all text from a PDF file using pdfplumber.

    Args:
        pdf_file: BytesIO object containing the PDF data

    Returns:
        Extracted text as a string
    """
    all_text = []

    try:
        with pdfplumber.open(pdf_file) as pdf:
            for page in pdf.pages:
                text = page.extract_text()
                if text:
                    all_text.append(text)

        return '\n'.join(all_text)
    except Exception as e:
        logging.error(f"Error extracting text from PDF: {e}")
        return ""


def parse_meet_info(text: str) -> Dict[str, str]:
    """
    Parse meet information from PDF text.

    Args:
        text: Extracted PDF text

    Returns:
        Dictionary with meet_name, gender, and age_category
    """
    lines = text.split('\n')
    meet_name = ""
    gender = ""
    age_category = ""

    # Look for title in first few lines
    for i, line in enumerate(lines[:10]):
        line = line.strip()

        # Extract meet name from title (e.g., "2026 Junior World Championships Men")
        if "Championships" in line or "Olympic" in line:
            # Determine meet name (Worlds or Pan Ams)
            if "World" in line:
                meet_name = "Worlds"
            elif "Pan Am" in line:
                meet_name = "Pan Ams"
            else:
                meet_name = "Worlds"  # Default to Worlds

            # Extract gender (Men or Women)
            if "Men" in line and "Women" not in line:
                gender = "Men"
            elif "Women" in line:
                gender = "Women"

            # Extract age category
            if "Junior" in line:
                age_category = "Junior"
            elif "Youth" in line:
                age_category = "Youth"
            elif "Senior" in line or "World Championships" in line:
                age_category = "Senior"

            break

    return {
        "meet_name": meet_name,
        "gender": gender,
        "age_category": age_category
    }


def clean_numeric_value(value: str) -> Optional[int]:
    """
    Clean and convert numeric string to integer.

    Args:
        value: String value to convert

    Returns:
        Integer value or None if conversion fails
    """
    if not value:
        return None

    # Remove whitespace
    value = value.strip()

    # Remove any non-numeric characters except dash
    value = re.sub(r'[^\d-]', '', value)

    if value and value != '-':
        try:
            return int(value)
        except ValueError:
            return None

    return None


def clean_percent_value(value: str) -> Optional[Decimal]:
    """
    Clean and convert percentage string to Decimal.

    Args:
        value: String value to convert (e.g., "95.50%")

    Returns:
        Decimal value or None if conversion fails
    """
    if not value:
        return None

    # Remove whitespace and % sign
    value = value.strip().replace('%', '')

    if value and value != '-':
        try:
            return Decimal(value)
        except:
            return None

    return None


def get_weight_class_from_bodyweight(body_weight: int, gender: str) -> str:
    """
    Determine weight class from body weight.

    Args:
        body_weight: Body weight in kg
        gender: 'Men' or 'Women'

    Returns:
        Weight class string (e.g., "81" or "87+")
    """
    if gender == "Men":
        if body_weight <= 60:
            return "60"
        elif body_weight <= 65:
            return "65"
        elif body_weight <= 71:
            return "71"
        elif body_weight <= 79:
            return "79"
        elif body_weight <= 88:
            return "88"
        elif body_weight <= 94:
            return "94"
        elif body_weight <= 110:
            return "110"
        else:
            return "110+"
    else:
        if body_weight <= 48:
            return "48"
        elif body_weight <= 53:
            return "53"
        elif body_weight <= 58:
            return "58"
        elif body_weight <= 64:
            return "64"
        elif body_weight <= 71:
            return "71"
        elif body_weight <= 76:
            return "76"
        elif body_weight <= 81:
            return "81"
        elif body_weight <= 87:
            return "87"
        else:
            return "87+"


def parse_rankings_table(text: str, meet_info: Dict[str, str]) -> List[Dict]:
    """
    Parse rankings data from PDF text.

    The table format is expected to be:
    Rank | Athlete Name | Body Weight | Total | % of A Standard | ...

    Args:
        text: Extracted PDF text
        meet_info: Dictionary with meet metadata

    Returns:
        List of dictionaries containing ranking data
    """
    rankings = []
    lines = text.split('\n')

    # Find the header line with "Athlete Name" or similar
    header_idx = -1
    for i, line in enumerate(lines):
        if re.search(r'Athlete\s+Name', line, re.IGNORECASE) or \
           re.search(r'Body\s+Weight.*Total.*%', line, re.IGNORECASE):
            header_idx = i
            print(f"Found header at line {i}: {line}")
            break

    if header_idx == -1:
        logging.warning("Could not find table header in PDF")
        return rankings

    # Process lines after header
    for line in lines[header_idx + 1:]:
        line = line.strip()

        # Skip empty lines
        if not line:
            continue

        # Stop processing when we hit the standards table
        if re.match(r'^\d+\+?\s*$', line) or line.startswith('B Standard') or line.startswith('A Standard'):
            logging.debug(f"Hit standards table, stopping: {line}")
            break

        # Try to match ranking line pattern
        # Pattern: Rank Name BodyWeight Total %A Age Meet WeightClass Total
        # Example: "1 Ryan McDonald 88 332 100.61% 19 2025 National Championships 60 253"
        # Body weight can be "77" or "77+"
        match = re.match(
            r'^(\d+)\s+(.+?)\s+(\d+\+?)\s+(\d+)\s+([\d\.]+)%',
            line
        )

        if match:
            ranking = int(match.group(1))
            name = match.group(2).strip()
            body_weight_str = match.group(3)  # Keep as string (may have +)
            total = clean_numeric_value(match.group(4))
            percent_a = clean_percent_value(match.group(5))

            # Weight class is just the body weight string
            weight_class = body_weight_str

            ranking_data = {
                "meet": meet_info.get("meet_name", ""),
                "ranking": ranking,
                "name": name,
                "weight_class": weight_class,
                "total": total,
                "percent_a": percent_a,
                "gender": meet_info.get("gender", ""),
                "age_category": meet_info.get("age_category", "")
            }

            rankings.append(ranking_data)
            logging.debug(f"Parsed ranking: {ranking_data}")

    print(f"Parsed {len(rankings)} rankings from PDF")
    return rankings


def check_existing_ranking(meet: str, ranking: int, name: str, gender: str, age_category: str) -> Optional[Dict]:
    """
    Check if a ranking already exists in Supabase and if name matches.

    Args:
        meet: Meet name
        ranking: Ranking number
        name: Athlete name
        gender: Gender (Men or Women)
        age_category: Age category (Junior, Youth, Senior)

    Returns:
        None if doesn't exist, Dict with id and name if exists
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase URL or Key not configured")
        return None

    # Use PostgREST query parameters
    url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}"
    params = {
        "meet": f"eq.{meet}",
        "ranking": f"eq.{ranking}",
        "gender": f"eq.{gender}",
        "age_category": f"eq.{age_category}",
        "select": "id,name"
    }

    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
    }

    try:
        response = requests.get(url, params=params, headers=headers, timeout=30)
        response.raise_for_status()
        results = response.json()

        if len(results) > 0:
            return results[0]  # Return the existing record
        return None
    except requests.exceptions.RequestException as e:
        logging.error(f"Error checking existing ranking: {e}")
        return None


def upsert_to_supabase(rankings: List[Dict], dry_run: bool = False) -> int:
    """
    Upsert rankings to Supabase.

    Args:
        rankings: List of ranking dictionaries
        dry_run: If True, don't actually insert data

    Returns:
        Number of records inserted/updated
    """
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error("Supabase URL or Key not configured")
        return 0

    if not rankings:
        print("No rankings to upsert")
        return 0

    # Check for existing rankings and separate into new/update
    new_rankings = []
    update_rankings = []

    for ranking_data in rankings:
        existing = check_existing_ranking(
            ranking_data["meet"],
            ranking_data["ranking"],
            ranking_data["name"],
            ranking_data["gender"],
            ranking_data["age_category"]
        )

        if existing:
            # Check if name is different
            if existing["name"] != ranking_data["name"]:
                print(
                    f"Ranking {ranking_data['ranking']} for {ranking_data['meet']} "
                    f"exists but name changed: '{existing['name']}' -> '{ranking_data['name']}' - will update"
                )
                ranking_data["id"] = existing["id"]  # Add id for update
                update_rankings.append(ranking_data)
            else:
                print(
                    f"Ranking {ranking_data['ranking']} for {ranking_data['meet']} "
                    f"already exists with same name - skipping"
                )
        else:
            new_rankings.append(ranking_data)

    if not new_rankings and not update_rankings:
        print("All rankings already exist in database with no changes")
        return 0

    if dry_run:
        print("\n" + "=" * 80)
        print("DRY RUN MODE")
        print("=" * 80)

        if new_rankings:
            print(f"\n{len(new_rankings)} NEW RECORDS TO INSERT:")
            print("-" * 80)
            for ranking in new_rankings:
                print(f"Rank #{ranking['ranking']} - {ranking['name']}")
                print(f"  Weight Class: {ranking['weight_class']}, Total: {ranking['total']} kg")
                print(f"  % of A Standard: {ranking['percent_a']}%")
                print(f"  Gender: {ranking['gender']}, Age Category: {ranking['age_category']}, Meet: {ranking['meet']}")
                print("-" * 80)

        if update_rankings:
            print(f"\n{len(update_rankings)} RECORDS TO UPDATE:")
            print("-" * 80)
            for ranking in update_rankings:
                print(f"Rank #{ranking['ranking']} - {ranking['name']} (ID: {ranking['id']})")
                print(f"  Weight Class: {ranking['weight_class']}, Total: {ranking['total']} kg")
                print(f"  % of A Standard: {ranking['percent_a']}%")
                print(f"  Gender: {ranking['gender']}, Age Category: {ranking['age_category']}, Meet: {ranking['meet']}")
                print("-" * 80)

        print(f"\nSUMMARY: {len(new_rankings)} inserts, {len(update_rankings)} updates")
        print("=" * 80 + "\n")
        return len(new_rankings) + len(update_rankings)

    # Prepare headers
    headers = {
        "apikey": SUPABASE_KEY,
        "Authorization": f"Bearer {SUPABASE_KEY}",
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
    }

    total_affected = 0

    # Insert new rankings
    if new_rankings:
        url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}"
        try:
            json_rankings = []
            for ranking in new_rankings:
                json_ranking = ranking.copy()
                if json_ranking.get("percent_a"):
                    json_ranking["percent_a"] = float(json_ranking["percent_a"])
                json_rankings.append(json_ranking)

            response = requests.post(url, headers=headers, json=json_rankings, timeout=60)
            response.raise_for_status()

            print(f"Successfully inserted {len(new_rankings)} new rankings to Supabase")
            total_affected += len(new_rankings)
        except requests.exceptions.RequestException as e:
            logging.error(f"Error inserting to Supabase: {e}")
            if hasattr(e, 'response') and e.response is not None:
                logging.error(f"Response: {e.response.text}")

    # Update existing rankings
    if update_rankings:
        for ranking in update_rankings:
            url = f"{SUPABASE_URL}/rest/v1/{SUPABASE_TABLE_NAME}?id=eq.{ranking['id']}"
            try:
                json_ranking = ranking.copy()
                if json_ranking.get("percent_a"):
                    json_ranking["percent_a"] = float(json_ranking["percent_a"])
                # Remove id from update payload
                del json_ranking["id"]

                response = requests.patch(url, headers=headers, json=json_ranking, timeout=60)
                response.raise_for_status()

                print(f"Successfully updated ranking {ranking['ranking']} (ID: {ranking['id']})")
                total_affected += 1
            except requests.exceptions.RequestException as e:
                logging.error(f"Error updating ranking {ranking['ranking']}: {e}")
                if hasattr(e, 'response') and e.response is not None:
                    logging.error(f"Response: {e.response.text}")

    return total_affected


def scrape_rankings_pdf(url: str, dry_run: bool = False) -> int:
    """
    Main function to scrape rankings from a PDF URL.

    Args:
        url: URL of the PDF to scrape
        dry_run: If True, don't actually insert data

    Returns:
        Number of records inserted/updated
    """
    # Download PDF
    pdf_file = download_pdf(url)
    if not pdf_file:
        logging.error("Failed to download PDF")
        return 0

    # Extract text
    text = extract_text_from_pdf(pdf_file)
    if not text:
        logging.error("Failed to extract text from PDF")
        return 0

    # Parse meet information
    meet_info = parse_meet_info(text)
    print(f"Meet info: {meet_info}")

    # Parse rankings table
    rankings = parse_rankings_table(text, meet_info)

    if not rankings:
        logging.warning("No rankings parsed from PDF")
        return 0

    # Upsert to Supabase
    num_inserted = upsert_to_supabase(rankings, dry_run=dry_run)

    return num_inserted


def main():
    """Main entry point for the scraper."""
    parser = argparse.ArgumentParser(
        description="Scrape international weightlifting rankings from PDF files"
    )
    parser.add_argument(
        "url",
        nargs='?',
        default=PDF_URL,
        help="URL of the PDF to scrape (optional, uses PDF_URL from file if not provided)"
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run in dry-run mode (don't actually insert data)"
    )
    parser.add_argument(
        "--debug",
        action="store_true",
        help="Enable debug logging"
    )

    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate Supabase configuration
    if not SUPABASE_URL or not SUPABASE_KEY:
        logging.error(
            "SUPABASE_URL and SUPABASE_KEY must be set in environment variables"
        )
        sys.exit(1)

    # Run scraper
    print(f"Using PDF URL: {args.url}")
    num_inserted = scrape_rankings_pdf(args.url, dry_run=args.dry_run)

    if args.dry_run:
        print(f"DRY RUN complete - {num_inserted} records would be inserted")
    else:
        print(f"Scraping complete - {num_inserted} records inserted")


if __name__ == "__main__":
    main()
