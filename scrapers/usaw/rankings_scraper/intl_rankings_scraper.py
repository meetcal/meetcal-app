#!/usr/bin/env python3
# To run with venv: source venv/bin/activate && pip install -r requirements.txt && python intl_rankings_scraper.py

import argparse
import logging
import os
import re
import sys
from io import BytesIO
from pathlib import Path
from typing import Dict, List, Optional

import pdfplumber
import requests
from dotenv import load_dotenv

from convex import ConvexClient

# ============================================================================
# CONFIGURATION - Enter your PDF URL here
# ============================================================================
PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt03557542ac6b6fa1/6984d8eafa10bc6be0207e2e/2026_FISU_World_University_Rankings_Women_020526.pdf"

# Load environment variables
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
load_dotenv(REPO_ROOT / ".env")
load_dotenv(REPO_ROOT / ".env.local", override=True)
load_dotenv()

# Convex Configuration
CONVEX_URL = os.environ.get("CONVEX_URL") or os.environ.get("EXPO_PUBLIC_CONVEX_URL")
SCRAPER_SECRET = os.environ.get("SCRAPER_SECRET")

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

        return "\n".join(all_text)
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
    lines = text.split("\n")
    meet_name = ""
    gender = ""
    age_category = ""

    # Look for title in first few lines
    for i, line in enumerate(lines[:15]):
        line = line.strip()

        # Extract meet name from title (e.g., "2026 Junior World Championships Men")
        if any(
            keyword in line
            for keyword in [
                "Championships",
                "Olympic",
                "Rankings",
                "University",
                "FISU",
            ]
        ):
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
            elif "University" in line:
                age_category = "University"
            elif "Senior" in line or "World Championships" in line:
                age_category = "Senior"

            break

    return {"meet_name": meet_name, "gender": gender, "age_category": age_category}


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
    value = re.sub(r"[^\d-]", "", value)

    if value and value != "-":
        try:
            return int(value)
        except ValueError:
            return None

    return None


def clean_percent_value(value: str) -> Optional[float]:
    """
    Clean and convert percentage string to Decimal.

    Args:
        value: String value to convert (e.g., "95.50%")

    Returns:
        Float value or None if conversion fails
    """
    if not value:
        return None

    # Remove whitespace and % sign
    value = value.strip().replace("%", "")

    if value and value != "-":
        try:
            return float(value)
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
    lines = text.split("\n")

    # Find the header line with "Athlete Name" or similar
    header_idx = -1
    for i, line in enumerate(lines):
        if re.search(r"Athlete\s+Name", line, re.IGNORECASE) or re.search(
            r"Body\s+Weight.*Total.*%", line, re.IGNORECASE
        ):
            header_idx = i
            print(f"Found header at line {i}: {line}")
            break

    if header_idx == -1:
        logging.warning("Could not find table header in PDF")
        return rankings

    # Process lines after header
    for line in lines[header_idx + 1 :]:
        line = line.strip()

        # Skip empty lines
        if not line:
            continue

        # Stop processing when we hit the standards table
        if (
            re.match(r"^\d+\+?\s*$", line)
            or line.startswith("B Standard")
            or line.startswith("A Standard")
        ):
            logging.debug(f"Hit standards table, stopping: {line}")
            break

        # Try to match ranking line pattern
        # Pattern: Rank Name BodyWeight Total %A Age Meet WeightClass Total
        # Example: "1 Ryan McDonald 88 332 100.61% 19 2025 National Championships 60 253"
        # Body weight can be "77" or "77+"
        match = re.match(r"^(\d+)\s+(.+?)\s+(\d+\+?)\s+(\d+)\s+([\d\.]+)%", line)

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
                "age_category": meet_info.get("age_category", ""),
            }

            rankings.append(ranking_data)
            logging.debug(f"Parsed ranking: {ranking_data}")

    print(f"Parsed {len(rankings)} rankings from PDF")
    return rankings


def upsert_to_convex(rankings: List[Dict], dry_run: bool = False) -> int:
    """
    Replace all international rankings in Convex.

    Args:
        rankings: List of ranking dictionaries
        dry_run: If True, only print what would be replaced

    Returns:
        Number of records inserted
    """
    if not rankings:
        print("No rankings to upsert")
        return 0

    if dry_run:
        print("\n" + "=" * 80)
        print("DRY RUN MODE")
        print("=" * 80)
        print(f"\n{len(rankings)} RECORDS TO REPLACE:")
        print("-" * 80)
        for ranking in rankings:
            print(f"Rank #{ranking['ranking']} - {ranking['name']}")
            print(
                f"  Weight Class: {ranking['weight_class']}, Total: {ranking['total']} kg"
            )
            print(f"  % of A Standard: {ranking['percent_a']}%")
            print(
                f"  Gender: {ranking['gender']}, Age Category: {ranking['age_category']}, Meet: {ranking['meet']}"
            )
            print("-" * 80)
        print(f"\nSUMMARY: would replace {len(rankings)} records")
        print("=" * 80 + "\n")
        return len(rankings)

    if not CONVEX_URL or not SCRAPER_SECRET:
        logging.error("CONVEX_URL or SCRAPER_SECRET not configured")
        return 0

    group_meet = rankings[0].get("meet")
    group_gender = rankings[0].get("gender")
    group_age_category = rankings[0].get("age_category")
    if not group_meet or not group_gender or not group_age_category:
        logging.error(
            "Cannot upsert without meet/gender/age_category. Parsed values were: "
            f"meet={group_meet}, gender={group_gender}, age_category={group_age_category}"
        )
        return 0

    for ranking in rankings:
        if (
            ranking.get("meet") != group_meet
            or ranking.get("gender") != group_gender
            or ranking.get("age_category") != group_age_category
        ):
            logging.error(
                "Parsed rankings include multiple meet/gender/age groups; aborting scoped replace."
            )
            return 0

    client = ConvexClient(CONVEX_URL)
    convex_rankings = [
        {
            "meet": ranking.get("meet"),
            "ranking": ranking.get("ranking"),
            "name": ranking.get("name"),
            "weightClass": ranking.get("weight_class"),
            "total": ranking.get("total"),
            "percentA": ranking.get("percent_a"),
            "gender": ranking.get("gender"),
            "ageCategory": ranking.get("age_category"),
        }
        for ranking in rankings
    ]

    try:
        print(
            f"Replacing {len(convex_rankings)} intl rankings in Convex for "
            f"{group_meet} / {group_gender} / {group_age_category}..."
        )
        result = client.action(
            "scraperIngestion:replaceIntlRankingsForGroup",
            {
                "scraperSecret": SCRAPER_SECRET,
                "meet": group_meet,
                "gender": group_gender,
                "ageCategory": group_age_category,
                "rankings": convex_rankings,
            },
        )
        deleted = int(result.get("deleted", 0))
        inserted = int(result.get("inserted", 0))
        print(
            f"Successfully replaced scoped intl rankings in Convex. "
            f"Deleted: {deleted}, Inserted: {inserted}"
        )
        return inserted
    except Exception as e:
        logging.error(f"Error replacing intl rankings in Convex: {e}")
        return 0


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

    # Upsert to Convex
    num_inserted = upsert_to_convex(rankings, dry_run=dry_run)

    return num_inserted


def main():
    """Main entry point for the scraper."""
    parser = argparse.ArgumentParser(
        description="Scrape international weightlifting rankings from PDF files"
    )
    parser.add_argument(
        "url",
        nargs="?",
        default=PDF_URL,
        help="URL of the PDF to scrape (optional, uses PDF_URL from file if not provided)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Run in dry-run mode (don't actually insert data)",
    )
    parser.add_argument("--debug", action="store_true", help="Enable debug logging")

    args = parser.parse_args()

    if args.debug:
        logging.getLogger().setLevel(logging.DEBUG)

    # Validate Convex configuration
    if not args.dry_run and (not CONVEX_URL or not SCRAPER_SECRET):
        logging.error(
            "Missing env vars. Set CONVEX_URL (or EXPO_PUBLIC_CONVEX_URL) and SCRAPER_SECRET locally before running."
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
