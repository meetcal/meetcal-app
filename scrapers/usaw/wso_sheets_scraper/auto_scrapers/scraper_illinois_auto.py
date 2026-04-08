#!/usr/bin/env python3
"""
Automated scraper for Illinois WSO records.
"""

import argparse
import html
import os
import re
import sys
from urllib.parse import urljoin

import requests
from dotenv import load_dotenv

sys.path.insert(
    0,
    os.path.join(
        os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "manual_scrapers"
    ),
)

from scraper_pdf_illinois import WSORecordsIllinoisScraper


class IllinoisAutoScraper:
    def __init__(self, dry_run: bool = False):
        self.records_page_url = "https://www.illinoisweightlifting.com/"
        self.wso_name = "Illinois"
        self.dry_run = dry_run

    def fetch_pdf_url(self) -> str:
        print(f"Fetching records page: {self.records_page_url}")
        response = requests.get(
            self.records_page_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            },
            timeout=30,
        )
        response.raise_for_status()

        page_html = html.unescape(response.text)
        section_start = page_html.find("Illinois State Records")
        section = page_html[section_start : section_start + 25000] if section_start != -1 else page_html

        patterns = [
            r'<a[^>]+href="([^"]+\.pdf)"[^>]*>\s*View(?:\s+the)?\s+Records\s*</a>',
            r'href="([^"]*Illinois_State_Records[^"]+\.pdf)"',
        ]

        for pattern in patterns:
            match = re.search(pattern, section, re.IGNORECASE)
            if match:
                pdf_url = urljoin(self.records_page_url, match.group(1))
                print(f"Found Illinois records PDF: {pdf_url}")
                return pdf_url

        raise ValueError("Could not find the Illinois records PDF URL on the page")

    def run(self):
        print("=" * 80)
        print(f"ILLINOIS WSO - AUTOMATED SCRAPER{' (DRY RUN)' if self.dry_run else ''}")
        print("=" * 80)
        print()

        pdf_url = self.fetch_pdf_url()
        scraper = WSORecordsIllinoisScraper(self.wso_name, pdf_url)
        scraper.run(dry_run=self.dry_run)


def main():
    parser = argparse.ArgumentParser(description="Automated scraper for Illinois WSO records")
    parser.add_argument("--dry-run", action="store_true", help="Parse without updating Convex")
    args = parser.parse_args()

    load_dotenv()

    scraper = IllinoisAutoScraper(dry_run=args.dry_run)
    scraper.run()


if __name__ == "__main__":
    main()
