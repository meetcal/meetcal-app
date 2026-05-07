# To run with venv:
# source venv/bin/activate && pip install -r requirements.txt && python intl_rankings_scraper.py

import argparse
import html
import logging
import os
import re
import sys
from io import BytesIO
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import pdfplumber
import requests
from dotenv import load_dotenv

from convex import ConvexClient

# ============================================================================
# CONFIGURATION
# ============================================================================
PDF_URL = "https://assets.contentstack.io/v3/assets/blteb7d012fc7ebef7f/blt522a3b18632a628e/69fba719c85432535316c9fe/2026_World_Championships_Rankings_Men_050626.pdf"
RANKINGS_PAGE_URL = "https://www.usaweightlifting.org/resources/athlete-information-and-programs/international-squad-standings"
REQUEST_HEADERS = {
    "User-Agent": "meetcal-rankings-scraper/1.0 (+https://www.usaweightlifting.org/)"
}

# Load environment variables
SCRIPT_DIR = Path(__file__).resolve().parent
REPO_ROOT = SCRIPT_DIR.parents[2]
load_dotenv(REPO_ROOT / ".env")
load_dotenv(REPO_ROOT / ".env.local", override=True)
load_dotenv()

# Convex Configuration
CONVEX_URL = os.environ.get("CONVEX_URL") or os.environ.get("EXPO_PUBLIC_CONVEX_URL")
SCRAPER_SECRET = os.environ.get("SCRAPER_SECRET")
SLACK_RANKINGS_WEBHOOK_URL = os.environ.get("SLACK_RANKINGS_WEBHOOK_URL")

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
        response = requests.get(url, headers=REQUEST_HEADERS, timeout=60)
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


def infer_meet_info_from_title(title: str, url: str = "") -> Dict[str, str]:
    """
    Infer meet metadata from USAW page card titles and PDF filenames.
    """
    combined = f"{title} {url}".replace("_", " ")
    combined_lower = combined.lower()

    meet_name = ""
    if "fisu" in combined_lower or "university" in combined_lower:
        meet_name = "Worlds"
    elif "pan am" in combined_lower or "pan american" in combined_lower:
        meet_name = "Pan Ams"
    elif "world" in combined_lower:
        meet_name = "Worlds"

    gender = ""
    if re.search(r"\bmen\b", combined, re.IGNORECASE) and not re.search(
        r"\bwomen\b", combined, re.IGNORECASE
    ):
        gender = "Men"
    elif re.search(r"\bwomen\b", combined, re.IGNORECASE):
        gender = "Women"

    age_category = ""
    if re.search(r"\bu15\b", combined, re.IGNORECASE):
        age_category = "U15"
    elif re.search(r"\bu17\b", combined, re.IGNORECASE):
        age_category = "U17"
    elif "junior" in combined_lower:
        age_category = "Junior"
    elif "youth" in combined_lower:
        age_category = "Youth"
    elif "fisu" in combined_lower or "university" in combined_lower:
        age_category = "University"
    elif "senior" in combined_lower or "world championships" in combined_lower:
        age_category = "Senior"

    return {"meet_name": meet_name, "gender": gender, "age_category": age_category}


def parse_meet_info(
    text: str, source_title: str = "", source_url: str = ""
) -> Dict[str, str]:
    """
    Parse meet information from PDF text.

    Args:
        text: Extracted PDF text

    Returns:
        Dictionary with meet_name, gender, and age_category
    """
    metadata = infer_meet_info_from_title(source_title, source_url)
    meet_name = metadata["meet_name"]
    gender = metadata["gender"]
    age_category = metadata["age_category"]
    lines = text.split("\n")

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
            if not meet_name and ("FISU" in line or "University" in line):
                meet_name = "Worlds"
            elif not meet_name and "World" in line:
                meet_name = "Worlds"
            elif not meet_name and ("Pan Am" in line or "Pan American" in line):
                meet_name = "Pan Ams"
            elif not meet_name:
                meet_name = "Worlds"  # Default to Worlds

            # Extract gender (Men or Women)
            if not gender and "Men" in line and "Women" not in line:
                gender = "Men"
            elif not gender and "Women" in line:
                gender = "Women"

            # Extract age category
            if age_category:
                pass
            elif re.search(r"\bU15\b", line, re.IGNORECASE):
                age_category = "U15"
            elif re.search(r"\bU17\b", line, re.IGNORECASE):
                age_category = "U17"
            elif "Junior" in line:
                age_category = "Junior"
            elif "Youth" in line:
                age_category = "Youth"
            elif "University" in line or "FISU" in line:
                age_category = "University"
            elif "Senior" in line or "World Championships" in line:
                age_category = "Senior"

            break

    return {"meet_name": meet_name, "gender": gender, "age_category": age_category}


def discover_ranking_pdfs(page_url: str = RANKINGS_PAGE_URL) -> List[Dict[str, str]]:
    """
    Discover all USAW international rankings PDFs linked by View buttons.
    """
    try:
        print(f"Discovering rankings PDFs from: {page_url}")
        response = requests.get(page_url, headers=REQUEST_HEADERS, timeout=60)
        response.raise_for_status()
    except requests.exceptions.RequestException as e:
        logging.error(f"Error downloading rankings page: {e}")
        return []

    page_html = html.unescape(response.text)
    discovered = []
    seen = set()

    button_pattern = re.compile(
        r'"button_options":\{"button_text":"View","url":"(?P<url>https://[^"]+?\.pdf)"'
    )
    title_pattern = re.compile(r'"title":"(?P<title>[^"]+)"')

    for match in button_pattern.finditer(page_html):
        url = match.group("url")
        if url in seen:
            continue

        prefix = page_html[max(0, match.start() - 3000) : match.start()]
        title_matches = list(title_pattern.finditer(prefix))
        title = title_matches[-1].group("title") if title_matches else Path(url).name

        seen.add(url)
        discovered.append({"title": title, "url": url})

    if not discovered:
        fallback_urls = re.findall(
            r'"button_options":\{"button_text":"View","url":"(https://[^"]+?\.pdf)"',
            page_html,
        )
        for url in fallback_urls:
            if url not in seen:
                seen.add(url)
                discovered.append({"title": Path(url).name, "url": url})

    print(f"Discovered {len(discovered)} rankings PDFs")
    for item in discovered:
        print(f"  - {item['title']}: {item['url']}")
    return discovered


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


def group_label(stats: Dict[str, Any]) -> str:
    return f"{stats.get('meet')} / {stats.get('gender')} / {stats.get('ageCategory')}"


def send_slack_notification(group_results: List[Dict[str, Any]], dry_run: bool = False) -> None:
    if dry_run:
        return

    if not SLACK_RANKINGS_WEBHOOK_URL:
        logging.info("SLACK_RANKINGS_WEBHOOK_URL not configured. Skipping notification.")
        return

    changed_groups = [
        result
        for result in group_results
        if result.get("inserted", 0) + result.get("updated", 0) + result.get("deleted", 0) > 0
    ]

    if changed_groups:
        lines = ["*International rankings changed:*"]
        for result in sorted(changed_groups, key=group_label):
            changed_count = (
                int(result.get("inserted", 0))
                + int(result.get("updated", 0))
                + int(result.get("deleted", 0))
            )
            if result.get("pruned"):
                lines.append(
                    f"- {group_label(result)}: {changed_count} removed because the group is no longer on USAW"
                )
            else:
                lines.append(
                    f"- {group_label(result)}: {changed_count} changed "
                    f"({result.get('inserted', 0)} inserted, {result.get('updated', 0)} updated, "
                    f"{result.get('deleted', 0)} deleted)"
                )
        text = "\n".join(lines)
    else:
        text = "International rankings scraper completed: no rankings changed."

    try:
        response = requests.post(
            SLACK_RANKINGS_WEBHOOK_URL,
            json={"text": text},
            timeout=30,
        )
        response.raise_for_status()
        print("Slack notification sent")
    except requests.exceptions.RequestException as e:
        logging.error(f"Error sending Slack notification: {e}")


def prune_missing_groups(active_groups: List[Dict[str, str]], dry_run: bool = False) -> List[Dict[str, Any]]:
    """
    Delete Convex intl ranking groups that are no longer present on the USAW page.
    """
    if dry_run:
        return []

    if not active_groups:
        logging.error("Refusing to prune intl rankings because no active groups were parsed.")
        return []

    if not CONVEX_URL or not SCRAPER_SECRET:
        logging.error("CONVEX_URL or SCRAPER_SECRET not configured")
        return []

    client = ConvexClient(CONVEX_URL)
    try:
        result = client.action(
            "scraperIngestion:deleteMissingIntlRankingGroups",
            {
                "scraperSecret": SCRAPER_SECRET,
                "groups": active_groups,
            },
        )
        deleted_groups = result.get("deletedGroups", [])
        for group in deleted_groups:
            print(
                "Pruned stale intl rankings group: "
                f"{group_label(group)} ({group.get('deleted', 0)} rows)"
            )
        return deleted_groups
    except Exception as e:
        logging.error(f"Error pruning stale intl ranking groups: {e}")
        return []


def upsert_to_convex(rankings: List[Dict], dry_run: bool = False) -> Dict[str, Any]:
    """
    Replace all international rankings in Convex.

    Args:
        rankings: List of ranking dictionaries
        dry_run: If True, only print what would be replaced

    Returns:
        Upsert summary
    """
    if not rankings:
        print("No rankings to upsert")
        return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}

    if dry_run:
        print("\n" + "=" * 80)
        print("DRY RUN MODE")
        print("=" * 80)
        print(f"\n{len(rankings)} RECORDS TO UPSERT:")
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
        print(f"\nSUMMARY: would upsert {len(rankings)} records")
        print("=" * 80 + "\n")
        return {
            "meet": rankings[0].get("meet"),
            "gender": rankings[0].get("gender"),
            "ageCategory": rankings[0].get("age_category"),
            "inserted": len(rankings),
            "updated": 0,
            "unchanged": 0,
            "deleted": 0,
            "pruned": False,
        }

    if not CONVEX_URL or not SCRAPER_SECRET:
        logging.error("CONVEX_URL or SCRAPER_SECRET not configured")
        return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}

    group_meet = rankings[0].get("meet")
    group_gender = rankings[0].get("gender")
    group_age_category = rankings[0].get("age_category")
    if not group_meet or not group_gender or not group_age_category:
        logging.error(
            "Cannot upsert without meet/gender/age_category. Parsed values were: "
            f"meet={group_meet}, gender={group_gender}, age_category={group_age_category}"
        )
        return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}

    for ranking in rankings:
        if (
            ranking.get("meet") != group_meet
            or ranking.get("gender") != group_gender
            or ranking.get("age_category") != group_age_category
        ):
            logging.error(
                "Parsed rankings include multiple meet/gender/age groups; aborting scoped replace."
            )
            return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}

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
            f"Upserting {len(convex_rankings)} intl rankings in Convex for "
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
        inserted = int(result.get("inserted", 0))
        updated = int(result.get("updated", 0))
        unchanged = int(result.get("unchanged", 0))
        deleted = int(result.get("deleted", 0))
        print(
            f"Successfully upserted scoped intl rankings in Convex. "
            f"Inserted: {inserted}, Updated: {updated}, Unchanged: {unchanged}, Deleted: {deleted}"
        )
        return {
            "meet": group_meet,
            "gender": group_gender,
            "ageCategory": group_age_category,
            "inserted": inserted,
            "updated": updated,
            "unchanged": unchanged,
            "deleted": deleted,
            "pruned": False,
        }
    except Exception as e:
        logging.error(f"Error replacing intl rankings in Convex: {e}")
        return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}


def scrape_rankings_pdf(
    url: str, dry_run: bool = False, source_title: str = ""
) -> Dict[str, Any]:
    """
    Main function to scrape rankings from a PDF URL.

    Args:
        url: URL of the PDF to scrape
        dry_run: If True, don't actually insert data
        source_title: Optional USAW page card title for more accurate metadata

    Returns:
        Upsert summary
    """
    # Download PDF
    pdf_file = download_pdf(url)
    if not pdf_file:
        logging.error("Failed to download PDF")
        return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}

    # Extract text
    text = extract_text_from_pdf(pdf_file)
    if not text:
        logging.error("Failed to extract text from PDF")
        return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}

    # Parse meet information
    meet_info = parse_meet_info(text, source_title=source_title, source_url=url)
    print(f"Meet info: {meet_info}")

    # Parse rankings table
    rankings = parse_rankings_table(text, meet_info)

    if not rankings:
        logging.warning("No rankings parsed from PDF")
        return {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}

    # Upsert to Convex
    result = upsert_to_convex(rankings, dry_run=dry_run)

    return result


def scrape_rankings_page(
    page_url: str, dry_run: bool = False
) -> Tuple[int, Dict[str, int], int, List[Dict[str, Any]]]:
    """
    Scrape every rankings PDF linked from the USAW international standings page.

    Returns:
        Tuple of (processed PDFs, totals, failed PDFs, per-group results)
    """
    pdfs = discover_ranking_pdfs(page_url)
    if not pdfs:
        return (0, {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}, 1, [])

    processed = 0
    totals = {"inserted": 0, "updated": 0, "unchanged": 0, "deleted": 0}
    failed = 0
    group_results = []
    active_groups_by_key = {}

    for index, pdf in enumerate(pdfs, start=1):
        title = pdf.get("title", "")
        url = pdf["url"]
        print("\n" + "=" * 80)
        print(f"Scraping PDF {index}/{len(pdfs)}: {title or url}")
        print("=" * 80)

        result = scrape_rankings_pdf(url, dry_run=dry_run, source_title=title)
        touched = (
            int(result.get("inserted", 0))
            + int(result.get("updated", 0))
            + int(result.get("unchanged", 0))
        )
        if touched <= 0:
            failed += 1
            logging.error(f"No rankings inserted for PDF: {title or url}")
        else:
            processed += 1
            for key in totals:
                totals[key] += int(result.get(key, 0))
            group_results.append(result)
            meet = result.get("meet")
            gender = result.get("gender")
            age_category = result.get("ageCategory")
            if meet and gender and age_category:
                active_groups_by_key[(meet, gender, age_category)] = {
                    "meet": meet,
                    "gender": gender,
                    "ageCategory": age_category,
                }

    if failed == 0 and processed > 0:
        pruned_groups = prune_missing_groups(
            list(active_groups_by_key.values()), dry_run=dry_run
        )
        for group in pruned_groups:
            deleted = int(group.get("deleted", 0))
            totals["deleted"] += deleted
            group_results.append(
                {
                    "meet": group.get("meet"),
                    "gender": group.get("gender"),
                    "ageCategory": group.get("ageCategory"),
                    "inserted": 0,
                    "updated": 0,
                    "unchanged": 0,
                    "deleted": deleted,
                    "pruned": True,
                }
            )

    return (processed, totals, failed, group_results)


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
        "--all",
        action="store_true",
        help="Discover and scrape every View-button PDF from the USAW rankings page",
    )
    parser.add_argument(
        "--page-url",
        default=RANKINGS_PAGE_URL,
        help="USAW rankings page URL to discover PDFs from when using --all",
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
    if args.all:
        processed, totals, failed, group_results = scrape_rankings_page(
            args.page_url, dry_run=args.dry_run
        )
        print(
            "Scraping complete - "
            f"PDFs processed: {processed}, "
            f"inserted: {totals['inserted']}, "
            f"updated: {totals['updated']}, "
            f"unchanged: {totals['unchanged']}, "
            f"deleted: {totals['deleted']}, "
            f"failed PDFs: {failed}"
        )
        send_slack_notification(group_results, dry_run=args.dry_run)
        if failed or processed == 0:
            sys.exit(1)
        return

    print(f"Using PDF URL: {args.url}")
    result = scrape_rankings_pdf(args.url, dry_run=args.dry_run)

    if args.dry_run:
        print(
            f"DRY RUN complete - {result.get('inserted', 0)} records would be upserted"
        )
    else:
        print(
            "Scraping complete - "
            f"inserted: {result.get('inserted', 0)}, "
            f"updated: {result.get('updated', 0)}, "
            f"unchanged: {result.get('unchanged', 0)}, "
            f"deleted: {result.get('deleted', 0)}"
        )
        send_slack_notification([result], dry_run=args.dry_run)
        touched = (
            int(result.get("inserted", 0))
            + int(result.get("updated", 0))
            + int(result.get("unchanged", 0))
        )
        if touched <= 0:
            sys.exit(1)


if __name__ == "__main__":
    main()
