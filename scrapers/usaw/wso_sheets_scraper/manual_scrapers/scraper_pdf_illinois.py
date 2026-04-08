#!/usr/bin/env python3
"""
PDF scraper for Illinois WSO records.
"""

import argparse
import os
import re
import sys
from typing import TYPE_CHECKING, Any, Dict, List, Optional, Tuple

import requests
from PyPDF2 import PdfReader
from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

if TYPE_CHECKING:
    from convex import ConvexClient


class WSORecordsIllinoisScraper:
    def __init__(self, wso_name: str, pdf_url: str):
        self.wso_name = wso_name
        self.pdf_url = pdf_url
        self.convex_client: Optional[Any] = None
        self.slack_webhook_url: Optional[str] = None
        self.pdf_path = "temp_illinois_wso_records.pdf"

    def setup_convex_client(self):
        from convex import ConvexClient

        convex_url = os.getenv("CONVEX_URL")
        if not convex_url:
            raise ValueError("CONVEX_URL must be set")
        self.convex_client = ConvexClient(convex_url)
        print("Convex client initialized")

    def setup_slack(self):
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
        if self.slack_webhook_url:
            print("Slack webhook configured")

    def download_pdf(self):
        print(f"Downloading PDF from {self.pdf_url}...")
        response = requests.get(
            self.pdf_url,
            headers={
                "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
            },
            timeout=30,
        )
        response.raise_for_status()
        with open(self.pdf_path, "wb") as file:
            file.write(response.content)
        print(f"PDF downloaded to {self.pdf_path}")

    def extract_pdf_text(self) -> str:
        reader = PdfReader(self.pdf_path)
        pages = []
        for page in reader.pages:
            text = page.extract_text() or ""
            pages.append(text)
        return "\n".join(pages)

    def _clean_text(self, text: str) -> str:
        lines = []
        for raw_line in text.splitlines():
            line = raw_line.strip()
            if not line:
                continue
            line = re.sub(r"^Illinois State Records \u00b7 \d+", "", line).strip()
            if not line:
                continue
            if line.startswith("-- ") and " of " in line:
                continue
            if line in {
                "ILLINOIS STATE RECORDS",
                "Olympic Weightlifting \u00b7 Men & Women",
                "Public reference edition \u00b7 Event and date shown for each record \u00b7 Ties preserved",
            }:
                continue
            if line.startswith("Through "):
                continue
            if line.startswith("Notes:"):
                break
            lines.append(line)
        return "\n".join(lines)

    def _normalize_weight_class(self, raw_weight_class: str) -> str:
        normalized = raw_weight_class.strip().lower().replace("kg", "")
        normalized = normalized.replace(" ", "")
        if normalized.endswith("+"):
            return normalized[:-1] + "+"
        return normalized

    def _extract_lift_values(self, block: str) -> Tuple[Optional[int], Optional[int], Optional[int]]:
        values = [int(value) for value in re.findall(r"(\d+)\s*kg\s*(?:-|\u2014)", block)]
        collapsed: List[int] = []
        for value in values:
            if not collapsed or collapsed[-1] != value:
                collapsed.append(value)
        padded = (collapsed + [None, None, None])[:3]
        return padded[0], padded[1], padded[2]

    def _build_record(
        self,
        age_category: str,
        gender: str,
        weight_class: str,
        block: str,
    ) -> Optional[Dict[str, Any]]:
        snatch, cj, total = self._extract_lift_values(block)
        if snatch is None and cj is None and total is None:
            return None
        return {
            "wso": self.wso_name,
            "age_category": age_category,
            "gender": gender,
            "weight_class": self._normalize_weight_class(weight_class),
            "snatch_record": snatch,
            "cj_record": cj,
            "total_record": total,
        }

    def _map_age_heading(self, heading: str) -> Optional[str]:
        mapped = {
            "U11": "U11",
            "U13": "U13",
            "14-15": "U15",
            "16-17": "U17",
            "Junior": "Junior",
            "Open": "Senior",
        }
        return mapped.get(heading)

    def _parse_standard_sections(self, section_text: str, gender: str) -> List[Dict[str, Any]]:
        records: List[Dict[str, Any]] = []
        age_matches = list(re.finditer(r"(?m)^(U11|U13|14[\u2013-]15|16[\u2013-]17|Junior|Open)$", section_text))
        for index, match in enumerate(age_matches):
            raw_heading = match.group(1).replace("\u2013", "-")
            age_category = self._map_age_heading(raw_heading)
            if not age_category:
                continue
            segment_start = match.end()
            segment_end = age_matches[index + 1].start() if index + 1 < len(age_matches) else len(section_text)
            segment = section_text[segment_start:segment_end]
            weight_matches = list(re.finditer(r"(?m)^(\d+\+?kg)", segment))
            for weight_index, weight_match in enumerate(weight_matches):
                block_start = weight_match.start()
                block_end = weight_matches[weight_index + 1].start() if weight_index + 1 < len(weight_matches) else len(segment)
                block = segment[block_start:block_end]
                record = self._build_record(age_category, gender, weight_match.group(1), block)
                if record:
                    records.append(record)
        return records

    def _parse_masters_section(self, section_text: str, gender: str) -> List[Dict[str, Any]]:
        records: List[Dict[str, Any]] = []
        masters_matches = list(
            re.finditer(r"(?m)^(\d{2}[\u2013-]\d{2})\s*\u00b7\s*(\d+\+?kg)", section_text)
        )
        for index, match in enumerate(masters_matches):
            start_age = match.group(1).replace("\u2013", "-").split("-")[0]
            age_category = f"Masters {start_age}"
            block_start = match.start()
            block_end = masters_matches[index + 1].start() if index + 1 < len(masters_matches) else len(section_text)
            block = section_text[block_start:block_end]
            record = self._build_record(age_category, gender, match.group(2), block)
            if record:
                records.append(record)
        return records

    def scrape_pdf(self) -> List[Dict[str, Any]]:
        cleaned_text = self._clean_text(self.extract_pdf_text())
        gender_matches = list(re.finditer(r"(?m)^(MEN|WOMEN)$", cleaned_text))
        records: List[Dict[str, Any]] = []

        for index, match in enumerate(gender_matches):
            gender = "Men" if match.group(1) == "MEN" else "Women"
            section_start = match.end()
            section_end = gender_matches[index + 1].start() if index + 1 < len(gender_matches) else len(cleaned_text)
            section = cleaned_text[section_start:section_end]

            masters_match = re.search(r"(?m)^Masters$", section)
            if masters_match:
                standard_section = section[:masters_match.start()]
                masters_section = section[masters_match.end():]
            else:
                standard_section = section
                masters_section = ""

            records.extend(self._parse_standard_sections(standard_section, gender))
            if masters_section:
                records.extend(self._parse_masters_section(masters_section, gender))

        return records

    def replace_in_convex(self, records: List[Dict[str, Any]]) -> Dict[str, int]:
        if not self.convex_client:
            raise ValueError("Convex client not initialized")

        scraper_secret = os.getenv("SCRAPER_SECRET")
        if not scraper_secret:
            raise ValueError("SCRAPER_SECRET must be set")

        payload_records = []
        for record in records:
            payload_record = {
                "ageCategory": record["age_category"],
                "gender": record["gender"],
                "weightClass": record["weight_class"],
            }
            if record.get("snatch_record") is not None:
                payload_record["snatchRecord"] = record["snatch_record"]
            if record.get("cj_record") is not None:
                payload_record["cjRecord"] = record["cj_record"]
            if record.get("total_record") is not None:
                payload_record["totalRecord"] = record["total_record"]
            payload_records.append(payload_record)

        payload = {
            "scraperSecret": scraper_secret,
            "wso": self.wso_name,
            "records": payload_records,
        }
        return self.convex_client.action("scraperIngestion:replaceWSORecordSet", payload)

    def send_slack_notification(self, result: Dict[str, int], record_count: int):
        if not self.slack_webhook_url:
            print("Slack webhook not configured, skipping notification")
            return

        title = f"{self.wso_name} WSO Records Update (PDF)"
        message = (
            f"*{title}*\n\n"
            f"Processed *{record_count}* current record rows\n"
            f"*{result['inserted']}* inserted, *{result['updated']}* updated, "
            f"*{result['deleted']}* deleted, *{result['unchanged']}* unchanged"
        )

        response = requests.post(
            self.slack_webhook_url,
            json={"text": message},
            timeout=10,
        )
        response.raise_for_status()
        print("Slack notification sent")

    def cleanup(self):
        if os.path.exists(self.pdf_path):
            os.remove(self.pdf_path)
            print(f"Cleaned up {self.pdf_path}")

    def run(self, dry_run: bool = False):
        try:
            print("=" * 80)
            print(f"ILLINOIS WSO PDF SCRAPER{' (DRY RUN)' if dry_run else ''}")
            print("=" * 80)
            print(f"PDF URL: {self.pdf_url}")
            print()

            if not dry_run:
                self.setup_convex_client()
                self.setup_slack()

            self.download_pdf()
            records = self.scrape_pdf()

            if not records:
                raise ValueError("No Illinois WSO records were parsed from the PDF")

            print(f"Parsed {len(records)} records")

            if dry_run:
                print("Sample records:")
                for record in records[:10]:
                    print(
                        f"  {record['age_category']:10} | {record['gender']:5} | "
                        f"{record['weight_class']:5} | {record.get('snatch_record') or '-':>3} | "
                        f"{record.get('cj_record') or '-':>3} | {record.get('total_record') or '-':>3}"
                    )
                if len(records) > 10:
                    print(f"  ... and {len(records) - 10} more")
                return

            result = self.replace_in_convex(records)
            print(
                f"Sync result: inserted={result['inserted']}, updated={result['updated']}, "
                f"deleted={result['deleted']}, unchanged={result['unchanged']}"
            )
            self.send_slack_notification(result, len(records))
        finally:
            self.cleanup()


def main():
    parser = argparse.ArgumentParser(description="PDF scraper for Illinois WSO records")
    parser.add_argument("--wso", required=True, help="WSO name")
    parser.add_argument("--pdf-url", required=True, help="PDF URL")
    parser.add_argument("--dry-run", action="store_true", help="Parse without updating Convex")
    args = parser.parse_args()

    load_dotenv()

    scraper = WSORecordsIllinoisScraper(args.wso, args.pdf_url)
    scraper.run(dry_run=args.dry_run)


if __name__ == "__main__":
    main()
