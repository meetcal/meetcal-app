#!/usr/bin/env python3
"""
New York WSO Records - Automated Multi-PDF Scraper

This script automatically scrapes the New York WSO records page,
extracts PDF URLs from the "Current Records" section, and processes them using the PDF scraper.

USAGE:
  Dry-run (test without making changes):
    source venv/bin/activate && python scraper_newyork_auto.py --dry-run
  
  Live run (upsert to database):
    source venv/bin/activate && python scraper_newyork_auto.py
"""

import os
import sys
import argparse
import requests
import re
from typing import List, Dict
from datetime import datetime
from dotenv import load_dotenv

# Import the PDF scraper
import sys
import os
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'manual_scrapers'))
from scraper_pdf_newyork import WSORecordsNewYorkScraper


class NewYorkAutoScraper:
    """Automated scraper that fetches all PDF URLs and processes them."""
    
    def __init__(self, dry_run: bool = False):
        """
        Initialize auto scraper.
        
        Args:
            dry_run: If True, compare with database without making changes
        """
        self.records_page_url = "https://www.nywso.com/state-records"
        self.wso_name = "New York"
        self.dry_run = dry_run
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
    
    def fetch_pdf_urls(self) -> List[Dict[str, str]]:
        """
        Fetch the records page and extract PDF URLs from "Current Records" section ONLY.
        
        Returns:
            List of dicts with 'category' and 'url' keys
        """
        print(f"Fetching records page: {self.records_page_url}")
        
        headers = {
            'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'
        }
        
        response = requests.get(self.records_page_url, headers=headers, timeout=30)
        response.raise_for_status()
        
        html_content = response.text
        
        # Strategy: Find the "Current Records" section, extract only PDFs from that section
        # The page has sections: "Current Records" and "State Meet Records"
        # We only want PDFs from "Current Records"
        
        # Find the "Current Records" heading/section
        current_records_start = html_content.find('id="current-records"')
        if current_records_start == -1:
            # Try alternate patterns
            current_records_start = html_content.find('Current Records')
        
        # Find where "State Meet Records" section starts (to know where to stop)
        state_meet_start = html_content.find('State Meet Records')
        
        if current_records_start == -1:
            print("⚠ Could not find 'Current Records' section, extracting first 5 PDFs")
            current_records_section = html_content[:state_meet_start if state_meet_start != -1 else len(html_content)]
        else:
            # Extract only the "Current Records" section
            if state_meet_start != -1 and state_meet_start > current_records_start:
                current_records_section = html_content[current_records_start:state_meet_start]
            else:
                # If we can't find State Meet Records, take a reasonable chunk after Current Records
                current_records_section = html_content[current_records_start:current_records_start + 10000]
        
        # Now extract PDF URLs only from the Current Records section
        pdf_pattern = r'href="(https://www\.nywso\.com/_files/ugd/[a-zA-Z0-9_/]+\.pdf)"'
        pdf_urls = re.findall(pdf_pattern, current_records_section)
        
        # Remove duplicates while preserving order
        seen_urls = set()
        unique_urls = []
        for url in pdf_urls:
            if url not in seen_urls:
                seen_urls.add(url)
                unique_urls.append(url)
        
        # Map each URL to a category
        pdf_info = []
        target_categories = ['Youth', 'Junior', 'Senior', 'Masters Men', 'Masters Women']
        
        for url in unique_urls:
            category = self._categorize_pdf_in_section(url, current_records_section)
            if category:
                pdf_info.append({
                    'category': category,
                    'url': url
                })
            
            # Stop once we have all 5 categories
            if len(pdf_info) >= 5:
                break
        
        # If we didn't get exactly 5, assign remaining PDFs to remaining categories
        if len(pdf_info) < 5 and len(unique_urls) >= 5:
            assigned_categories = [p['category'] for p in pdf_info]
            remaining_categories = [c for c in target_categories if c not in assigned_categories]
            
            for i, url in enumerate(unique_urls[len(pdf_info):]):
                if i < len(remaining_categories):
                    pdf_info.append({
                        'category': remaining_categories[i],
                        'url': url
                    })
        
        print(f"✓ Found {len(pdf_info)} PDF URLs from Current Records section")
        return pdf_info
    
    def _categorize_pdf_in_section(self, pdf_url: str, section_html: str) -> str:
        """
        Try to categorize the PDF based on surrounding HTML context within a section.
        
        Args:
            pdf_url: The PDF URL to categorize
            section_html: HTML content of the section containing this PDF
        
        Returns:
            Category name or None
        """
        # Find the position of this PDF URL in the section
        url_pos = section_html.find(pdf_url)
        if url_pos == -1:
            return None
        
        # Look backwards for category indicators (within 1500 chars)
        search_start = max(0, url_pos - 1500)
        search_text = section_html[search_start:url_pos + 200]
        
        # Check for Masters Men/Women first (more specific)
        if re.search(r'Masters\s*(?:<[^>]*>)*\s*Men', search_text, re.IGNORECASE):
            return 'Masters Men'
        if re.search(r'Masters\s*(?:<[^>]*>)*\s*Women', search_text, re.IGNORECASE):
            return 'Masters Women'
        
        # Then check for other categories
        if re.search(r'\bYouth\b', search_text, re.IGNORECASE):
            return 'Youth'
        if re.search(r'\bJunior\b', search_text, re.IGNORECASE):
            return 'Junior'
        if re.search(r'\bSenior\b', search_text, re.IGNORECASE):
            return 'Senior'
        
        return None
    
    def _categorize_pdf(self, pdf_url: str, html_content: str) -> str:
        """
        Try to categorize the PDF based on surrounding HTML context.
        
        Args:
            pdf_url: The PDF URL to categorize
            html_content: Full HTML content of the page
        
        Returns:
            Category name or None
        """
        # Find the position of this PDF URL in the HTML
        url_pos = html_content.find(pdf_url)
        if url_pos == -1:
            return None
        
        # Look backwards and forwards for category indicators
        search_start = max(0, url_pos - 2000)
        search_end = min(len(html_content), url_pos + 500)
        search_text = html_content[search_start:search_end]
        
        # Look for category patterns
        # NY uses: "Youth", "Junior", "Senior", "Masters Men", "Masters Women"
        
        # Check for Masters Men/Women first (more specific)
        if re.search(r'Masters\s*(?:<[^>]*>)*\s*Men', search_text, re.IGNORECASE):
            return 'Masters Men'
        if re.search(r'Masters\s*(?:<[^>]*>)*\s*Women', search_text, re.IGNORECASE):
            return 'Masters Women'
        
        # Then check for other categories
        if re.search(r'\bYouth\b', search_text, re.IGNORECASE):
            return 'Youth'
        if re.search(r'\bJunior\b', search_text, re.IGNORECASE):
            return 'Junior'
        if re.search(r'\bSenior\b', search_text, re.IGNORECASE):
            return 'Senior'
        
        return None
    
    def send_summary_notification(self, total_pdfs: int, results: List[Dict]):
        """Send a summary Slack notification for all PDFs processed."""
        if not self.slack_webhook_url:
            print("⚠ Slack webhook not configured, skipping notification")
            return
        
        total_inserted = sum(len(r.get('inserted', [])) for r in results)
        total_updated = sum(len(r.get('updated', [])) for r in results)
        
        # Build message
        title = f"{self.wso_name} WSO Records - Automated Scrape Complete"
        
        if self.dry_run:
            message = f"*{title}*\n\n*DRY RUN* - Processed {total_pdfs} PDF files"
        else:
            message = (
                f"*{title}*\n\n"
                f"Processed *{total_pdfs}* PDF files\n"
                f"*{total_inserted}* new records, *{total_updated}* updated records"
            )
        
        # Add details for each PDF
        for result in results:
            category = result['category']
            if self.dry_run:
                message += (
                    f"\n\n*{category}*\n"
                    f"Would insert: {result.get('to_insert', 0)}\n"
                    f"Would update: {result.get('to_update', 0)}\n"
                    f"Unchanged: {result.get('unchanged', 0)}"
                )
            else:
                inserted = len(result.get('inserted', []))
                updated = len(result.get('updated', []))
                message += f"\n\n*{category}*\n✓ Inserted: {inserted}, Updated: {updated}"
        
        payload = {"text": message}
        
        try:
            response = requests.post(self.slack_webhook_url, json=payload, timeout=10)
            response.raise_for_status()
            print("✓ Slack summary notification sent")
        except Exception as e:
            print(f"⚠ Failed to send Slack notification: {e}")
    
    def run(self):
        """Main execution method."""
        print("=" * 80)
        print(f"NEW YORK WSO - AUTOMATED SCRAPER {'(DRY RUN)' if self.dry_run else ''}")
        print("=" * 80)
        print()
        
        # Fetch all PDF URLs
        pdf_info = self.fetch_pdf_urls()
        
        if not pdf_info:
            print("⚠ No PDF URLs found on the records page")
            return
        
        print()
        print("PDFs to process:")
        for info in pdf_info:
            print(f"  • {info['category']}: {info['url']}")
        print()
        
        # Process each PDF
        results = []
        for i, info in enumerate(pdf_info, 1):
            category = info['category']
            pdf_url = info['url']
            
            print(f"\n{'='*80}")
            print(f"Processing {i}/{len(pdf_info)}: {category}")
            print(f"{'='*80}\n")
            
            try:
                scraper = WSORecordsNewYorkScraper(self.wso_name, pdf_url)
                scraper.setup_supabase_client()
                
                # Don't set up Discord for individual PDFs (we'll send one summary)
                
                scraper.download_pdf()
                
                print(f"Scraping PDF: {category}...")
                records = scraper.scrape_pdf()
                print(f"Found {len(records)} records")
                
                if self.dry_run:
                    comparison = scraper.dry_run_compare(records)
                    results.append({
                        'category': category,
                        'to_insert': len(comparison['to_insert']),
                        'to_update': len(comparison['to_update']),
                        'unchanged': len(comparison['unchanged'])
                    })
                    
                    print(f"\n  To INSERT: {len(comparison['to_insert'])} records")
                    print(f"  To UPDATE: {len(comparison['to_update'])} records")
                    print(f"  Unchanged: {len(comparison['unchanged'])} records")
                else:
                    result = scraper.upsert_to_supabase(records)
                    results.append({
                        'category': category,
                        'inserted': result['inserted'],
                        'updated': result['updated']
                    })
                    
                    print(f"\n  ✓ Inserted: {len(result['inserted'])} records")
                    print(f"  ✓ Updated: {len(result['updated'])} records")
                
                scraper.cleanup()
                
            except Exception as e:
                print(f"✗ Error processing {category}: {e}")
                import traceback
                traceback.print_exc()
                results.append({
                    'category': category,
                    'error': str(e)
                })
        
        # Send summary notification
        if not self.dry_run:
            print(f"\n{'='*80}")
            print("Sending summary notification...")
            print(f"{'='*80}\n")
            self.send_summary_notification(len(pdf_info), results)
        
        # Print final summary
        print(f"\n{'='*80}")
        print("FINAL SUMMARY")
        print(f"{'='*80}")
        print(f"Total PDFs processed: {len(pdf_info)}")
        
        if self.dry_run:
            total_insert = sum(r.get('to_insert', 0) for r in results)
            total_update = sum(r.get('to_update', 0) for r in results)
            total_unchanged = sum(r.get('unchanged', 0) for r in results)
            print(f"Would INSERT: {total_insert} records")
            print(f"Would UPDATE: {total_update} records")
            print(f"Unchanged: {total_unchanged} records")
        else:
            total_inserted = sum(len(r.get('inserted', [])) for r in results)
            total_updated = sum(len(r.get('updated', [])) for r in results)
            print(f"Total INSERTED: {total_inserted} records")
            print(f"Total UPDATED: {total_updated} records")
        
        errors = [r for r in results if 'error' in r]
        if errors:
            print(f"\n⚠ Errors: {len(errors)}")
            for err in errors:
                print(f"  • {err['category']}: {err['error']}")
        
        print(f"\n✅ Complete!")


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description="Automated scraper for New York WSO Records (processes all Current Records PDFs)",
        epilog="Example: python scraper_newyork_auto.py --dry-run"
    )
    parser.add_argument("--dry-run", action="store_true", 
                       help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    load_dotenv()
    
    scraper = NewYorkAutoScraper(dry_run=args.dry_run)
    scraper.run()


if __name__ == "__main__":
    main()

