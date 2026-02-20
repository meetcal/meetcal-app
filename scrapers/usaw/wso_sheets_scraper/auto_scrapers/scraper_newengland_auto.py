#!/usr/bin/env python3
"""
New England WSO Records - Automated Multi-PDF Scraper

This script automatically scrapes the New England WSO records page,
extracts all PDF URLs, and processes them using the PDF scraper.

USAGE:
  Dry-run (test without making changes):
    source venv/bin/activate && python scraper_newengland_auto.py --dry-run
  
  Live run (upsert to database):
    source venv/bin/activate && python scraper_newengland_auto.py
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
from scraper_pdf_newengland import WSORecordsNewEnglandScraper


class NewEnglandAutoScraper:
    """Automated scraper that fetches all PDF URLs and processes them."""
    
    def __init__(self, dry_run: bool = False):
        """
        Initialize auto scraper.
        
        Args:
            dry_run: If True, compare with database without making changes
        """
        self.records_page_url = "https://www.newenglandweightlifting.com/records"
        self.wso_name = "New England"
        self.dry_run = dry_run
        self.slack_webhook_url = os.getenv("SLACK_WEBHOOK_URL")
    
    def fetch_pdf_urls(self) -> List[Dict[str, str]]:
        """
        Fetch the records page and extract all PDF URLs.
        
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
        
        # Extract all PDF URLs from the page
        # Look for links ending in .pdf
        pdf_pattern = r'href="(https://www\.newenglandweightlifting\.com/_files/ugd/[a-zA-Z0-9_/]+\.pdf)"'
        pdf_urls = re.findall(pdf_pattern, html_content)
        
        # Remove duplicates while preserving order
        seen = set()
        unique_urls = []
        for url in pdf_urls:
            if url not in seen:
                seen.add(url)
                unique_urls.append(url)
        
        # Try to categorize PDFs based on surrounding text or patterns
        # For now, we'll just number them
        pdf_info = []
        for i, url in enumerate(unique_urls, 1):
            # Try to extract a meaningful name from the URL or context
            category = self._categorize_pdf(url, html_content)
            pdf_info.append({
                'category': category or f"PDF {i}",
                'url': url
            })
        
        print(f"✓ Found {len(pdf_info)} unique PDF URLs")
        return pdf_info
    
    def _categorize_pdf(self, pdf_url: str, html_content: str) -> str:
        """
        Try to categorize the PDF based on surrounding HTML context.
        
        Args:
            pdf_url: The PDF URL to categorize
            html_content: Full HTML content of the page
        
        Returns:
            Category name or None
        """
        # Look for text near the PDF link
        # The pattern is: section header text, then eventually a "See Records" button with the PDF link
        
        # Find the position of this PDF URL in the HTML
        url_pos = html_content.find(pdf_url)
        if url_pos == -1:
            return None
        
        # Look backwards in the HTML for section headers
        # Common patterns: "Open Men's Records", "Junior Women's Records", etc.
        search_text = html_content[max(0, url_pos - 1000):url_pos]
        
        # Look for common record type patterns
        patterns = [
            r'(Open Men[\'s]* Records?)',
            r'(Junior Men[\'s]* Records?)',
            r'(Youth Men[\'s]* Records?)',
            r'(Masters Men[\'s]* Records?)',
            r'(Open Women[\'s]* Records?)',
            r'(Junior Women[\'s]* Records?)',
            r'(Youth Women[\'s]* Records?)',
            r'(Masters Women[\'s]* Records?)',
        ]
        
        for pattern in patterns:
            match = re.search(pattern, search_text, re.IGNORECASE)
            if match:
                return match.group(1).strip()
        
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
        print(f"NEW ENGLAND WSO - AUTOMATED SCRAPER {'(DRY RUN)' if self.dry_run else ''}")
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
                scraper = WSORecordsNewEnglandScraper(self.wso_name, pdf_url)
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
        description="Automated scraper for New England WSO Records (processes all PDFs)",
        epilog="Example: python scraper_newengland_auto.py --dry-run"
    )
    parser.add_argument("--dry-run", action="store_true", 
                       help="Compare with database without making changes")
    
    args = parser.parse_args()
    
    load_dotenv()
    
    scraper = NewEnglandAutoScraper(dry_run=args.dry_run)
    scraper.run()


if __name__ == "__main__":
    main()

