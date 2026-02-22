#!/usr/bin/env python3
"""
USAGE:
  # Setup virtual environment and install dependencies
  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
  
  # Dry-run (preview changes without updating database)
  python usamw_results_scraper.py --dry-run
  
  # Full run (update database)
  python usamw_results_scraper.py
"""

import os
import sys
import argparse
import re
import io
import tempfile
from typing import List, Dict, Any, Optional
from datetime import datetime
import requests
from dotenv import load_dotenv
import base64
from pathlib import Path

try:
    from tabulate import tabulate
except ImportError:
    print("Warning: tabulate not installed. Run: pip install tabulate")
    tabulate = None

# ============================================================================
# CONFIGURATION - Edit these values before running
# ============================================================================

MEET_NAME = "2025 Howard Cohen American Masters Championships"
MEET_DATE = "2025-12-11"  
EVENT_ID = "12"  
ADAPTIVE = False 

# List of PDF URLs to process
PDF_URLS = [
    "https://drive.google.com/file/d/1YfDvbAbt0Q2tjt6SwlK4jDzDcb8Z7BQC/view?usp=sharing",
    "https://drive.google.com/file/d/1Q--nD3M8LzCWtV46b9Kj3cLXwWTHV9Yg/view?usp=sharing",
    "https://drive.google.com/file/d/16jwBzQW6cgWICXSh3wrOKJ3TL4MkRyn3/view?usp=sharing",
    "https://drive.google.com/file/d/1s2s2sQ-JsL6Nk_8Plu9POHzimngXwtU2/view?usp=sharing",
    "https://drive.google.com/file/d/1BwvrPPfZbOOnT62L85WDJslClhUPUhPz/view?usp=sharing"

]

# ============================================================================

# PDF and image processing
try:
    import fitz  # PyMuPDF
except ImportError:
    print("Error: PyMuPDF not installed. Run: pip install PyMuPDF")
    sys.exit(1)

try:
    from PIL import Image
except ImportError:
    print("Error: Pillow not installed. Run: pip install Pillow")
    sys.exit(1)

# OpenAI
try:
    from openai import OpenAI
except ImportError:
    print("Error: openai library not installed. Run: pip install openai")
    sys.exit(1)

# Supabase
try:
    from supabase import create_client, Client
except ImportError:
    print("Error: supabase library not installed. Run: pip install supabase")
    sys.exit(1)

# Google Drive API
try:
    from google.oauth2 import service_account
    from googleapiclient.discovery import build
    from googleapiclient.http import MediaIoBaseDownload
except ImportError:
    print("Error: Google API libraries not installed. Run: pip install google-api-python-client google-auth-httplib2 google-auth-oauthlib")
    sys.exit(1)

# Load environment variables
load_dotenv()


class USAMWResultsScraper:
    """Scraper for USAMW competition results from Google Drive PDFs."""
    
    def __init__(self, pdf_urls: List[str], meet_name: str, meet_date: str, event_id: str, adaptive: bool = False):
        """Initialize the scraper.
        
        Args:
            pdf_urls: List of PDF URLs to process
            meet_name: Name of the competition (e.g., "2025 National Masters Championships")
            meet_date: Date of the competition in YYYY-MM-DD format (e.g., "2025-03-15")
            event_id: Event ID for this competition (e.g., "7115")
            adaptive: Whether this is an adaptive meet (default: False)
        """
        self.pdf_urls = pdf_urls
        self.meet_name = meet_name
        self.meet_date = meet_date
        self.event_id = event_id
        self.adaptive = adaptive
        self.openai_client: Optional[OpenAI] = None
        self.supabase: Optional[Client] = None
        self.slack_webhook_url: Optional[str] = None
        
    def _extract_file_id_from_url(self, url: str) -> Optional[str]:
        """Extract file ID from Google Drive URL."""
        # Handle formats:
        # https://drive.google.com/file/d/FILE_ID/view
        # https://drive.google.com/open?id=FILE_ID
        match = re.search(r'/file/d/([a-zA-Z0-9_-]+)', url)
        if match:
            return match.group(1)
        match = re.search(r'[?&]id=([a-zA-Z0-9_-]+)', url)
        if match:
            return match.group(1)
        return None
    
    def setup_openai_client(self):
        """Initialize OpenAI client."""
        api_key = os.getenv("OPENAI_API_KEY")
        if not api_key:
            raise ValueError("OPENAI_API_KEY must be set in .env")
        
        self.openai_client = OpenAI(api_key=api_key)    
    
    def setup_supabase_client(self):
        """Initialize Supabase client."""
        supabase_url = os.getenv("SUPABASE_URL")
        supabase_key = os.getenv("SUPABASE_KEY")
        
        if not supabase_url or not supabase_key:
            raise ValueError("SUPABASE_URL and SUPABASE_KEY must be set in .env")
        
        self.supabase = create_client(supabase_url, supabase_key)
        print("✓ Supabase client initialized")
    
    def setup_slack(self):
        """Initialize Slack webhook."""
        self.slack_webhook_url = os.getenv("SLACK_RESULTS_WEBHOOK_URL")
        if self.slack_webhook_url:
            print("✓ Slack webhook configured")
    
    
    def download_pdf_from_url(self, url: str) -> Optional[bytes]:
        """Download PDF from URL (Google Drive or direct link)."""
        print(f"Downloading from: {url}")
        
        # Check if it's a Google Drive URL
        file_id = self._extract_file_id_from_url(url)
        
        if file_id:
            # Google Drive file - use export download URL
            try:
                download_url = f"https://drive.google.com/uc?export=download&id={file_id}"
                response = requests.get(download_url, timeout=60)
                response.raise_for_status()
                
                # Check if we got a confirmation page (large files)
                if b'Google Drive - Virus scan warning' in response.content or b'download_warning' in response.content:
                    # Extract confirmation token
                    match = re.search(r'confirm=([^&]+)', response.text)
                    if match:
                        confirm_token = match.group(1)
                        download_url = f"https://drive.google.com/uc?export=download&id={file_id}&confirm={confirm_token}"
                        response = requests.get(download_url, timeout=60)
                        response.raise_for_status()
                
                print(f"✓ Downloaded {len(response.content)} bytes")
                return response.content
                
            except Exception as e:
                print(f"✗ Error downloading from Google Drive: {e}")
                return None
        else:
            # Direct URL
            try:
                response = requests.get(url, timeout=60)
                response.raise_for_status()
                print(f"✓ Downloaded {len(response.content)} bytes")
                return response.content
            except Exception as e:
                print(f"✗ Error downloading file: {e}")
                return None
    
    def extract_text_with_color_from_pdf(self, pdf_bytes: bytes) -> Dict[int, List[Dict]]:
        """
        Extract text with color information from PDF.
        
        Args:
            pdf_bytes: PDF file content
            
        Returns:
            Dictionary mapping page number to list of text blocks with color info
        """
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            page_data = {}
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                
                # Get text with detailed information including color
                blocks = []
                text_dict = page.get_text("dict")
                
                for block in text_dict.get("blocks", []):
                    if block.get("type") == 0:  # Text block
                        for line in block.get("lines", []):
                            for span in line.get("spans", []):
                                text = span.get("text", "").strip()
                                if text:
                                    # Get color (RGB)
                                    color = span.get("color", 0)
                                    # Convert color integer to RGB
                                    r = (color >> 16) & 255
                                    g = (color >> 8) & 255
                                    b = color & 255
                                    
                                    blocks.append({
                                        "text": text,
                                        "color_rgb": (r, g, b),
                                        "is_red": r > 200 and g < 100 and b < 100,  # Detect red text
                                        "bbox": span.get("bbox", None)
                                    })
                
                page_data[page_num + 1] = blocks
            
            doc.close()
            return page_data
            
        except Exception as e:
            print(f"✗ Error extracting text with color from PDF: {e}")
            return {}
    
    def extract_text_from_pdf(self, pdf_bytes: bytes) -> str:
        """
        Extract raw text from PDF.
        
        Args:
            pdf_bytes: PDF file content
            
        Returns:
            Extracted text as string
        """
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            text = ""
            
            for page_num in range(len(doc)):
                page = doc[page_num]
                text += page.get_text()
            
            doc.close()
            return text
            
        except Exception as e:
            print(f"✗ Error extracting text from PDF: {e}")
            return ""
    
    def pdf_to_images(self, pdf_bytes: bytes, max_pages: int = 50) -> List[Image.Image]:
        """
        Convert PDF pages to images.
        
        Args:
            pdf_bytes: PDF file content
            max_pages: Maximum number of pages to process
            
        Returns:
            List of PIL Images
        """
        images = []
        
        try:
            doc = fitz.open(stream=pdf_bytes, filetype="pdf")
            num_pages = min(len(doc), max_pages)
            
            print(f"Converting {num_pages} pages to images...")
            
            for page_num in range(num_pages):
                page = doc[page_num]
                
                # Render page at high resolution (300 DPI)
                mat = fitz.Matrix(300/72, 300/72)
                pix = page.get_pixmap(matrix=mat)
                
                # Convert to PIL Image
                img_data = pix.tobytes("png")
                img = Image.open(io.BytesIO(img_data))
                images.append(img)
            
            doc.close()
            print(f"✓ Converted {len(images)} pages")
            
        except Exception as e:
            print(f"✗ Error converting PDF to images: {e}")
        
        return images
    
    def image_to_base64(self, image: Image.Image) -> str:
        """Convert PIL Image to base64 string."""
        buffered = io.BytesIO()
        image.save(buffered, format="PNG")
        return base64.b64encode(buffered.getvalue()).decode('utf-8')
    
    def split_image_into_rows(self, image: Image.Image, min_row_height: int = 40) -> List[Image.Image]:
        """
        Split image into horizontal rows based on whitespace.
        
        Args:
            image: PIL Image to split
            min_row_height: Minimum height for a row
            
        Returns:
            List of cropped row images
        """
        # Convert to grayscale for easier analysis
        import numpy as np
        
        gray = image.convert('L')
        img_array = np.array(gray)
        
        # Find rows with content (non-white regions)
        row_has_content = []
        for y in range(img_array.shape[0]):
            # Check if row has any non-white pixels
            has_content = np.any(img_array[y, :] < 250)
            row_has_content.append(has_content)
        
        # Find boundaries of content blocks
        rows = []
        in_content = False
        start_y = 0
        
        for y, has_content in enumerate(row_has_content):
            if has_content and not in_content:
                # Start of content block
                start_y = y
                in_content = True
            elif not has_content and in_content:
                # End of content block
                if y - start_y >= min_row_height:
                    rows.append((start_y, y))
                in_content = False
        
        # Handle case where content goes to end of image
        if in_content and len(row_has_content) - start_y >= min_row_height:
            rows.append((start_y, len(row_has_content)))
        
        # Crop image into rows
        row_images = []
        for start_y, end_y in rows:
            row_img = image.crop((0, start_y, image.width, end_y))
            row_images.append(row_img)
        
        return row_images
    
    def extract_results_from_image(self, image: Image.Image, page_num: int) -> Optional[str]:
        """
        Use OpenAI Vision API to extract results from image.
        
        Returns:
            Extracted text in structured format
        """
        
        if not self.openai_client:
            self.setup_openai_client()
        
        # Convert image to base64
        base64_image = self.image_to_base64(image)
        
        # Create prompt for OpenAI
        prompt = """Extract weightlifting competition results from this image.

CRITICAL INSTRUCTIONS FOR IDENTIFYING MISSED LIFTS:
1. Look VERY CAREFULLY at the text color of each lift attempt number
2. Missed lifts will appear in RED color (not black)
3. Missed lifts may also have a SLASH or STRIKETHROUGH through the number
4. If a number is in RED or has ANY visual indication of being crossed out, it is a MISSED LIFT
5. Output missed lifts as NEGATIVE numbers (e.g., if you see red "93", output "-93")
6. Successful lifts are in BLACK text - output these as positive numbers

CRITICAL - TABLE LAYOUT UNDERSTANDING:
The table has the following columns FROM LEFT TO RIGHT:
1. Total Rank (ignore this)
2. Snatch Rank (ignore this)
3. C&J Rank (ignore this)
4. Lot Number (ignore this)
5. Last Name First Name (extract and convert to "First Last")
6. Team (ignore this)
7. Body Weight (THIS IS THE BODY WEIGHT - usually like 86.7, 79.45, 62.3)
8. Age (ignore - we get this from the header)
9. Snatch 1 (FIRST snatch attempt)
10. Snatch 2 (SECOND snatch attempt)
11. Snatch 3 (THIRD snatch attempt)
12. C&J 1 (FIRST clean & jerk attempt)
13. C&J 2 (SECOND clean & jerk attempt)
14. C&J 3 (THIRD clean & jerk attempt)
15. Total (THIS IS THE TOTAL)
16. SHMF Total (ignore this)

CRITICAL - HOW TO READ EACH ROW:
- Skip the first 4 columns (ranks and lot number)
- Column 5 is the NAME (convert "LAST First" to "First Last")
- Skip column 6 (team)
- Column 7 is BODY WEIGHT
- Skip column 8 (age - get from header instead)
- Columns 9,10,11 are SNATCH 1, SNATCH 2, SNATCH 3
- Columns 12,13,14 are C&J 1, C&J 2, C&J 3
- Column 15 is TOTAL
- BOLD NUMBERS indicate the BEST LIFT or TOTAL:
  * The best snatch will appear in BOLD in one of columns 9,10,11
  * The best C&J will appear in BOLD in one of columns 12,13,14
  * The total will appear in BOLD in column 15
  * Look for BOLD text to identify which lifts were the best
- BEST SNATCH = the BOLD number from Snatch attempts (or highest positive if no bold)
- BEST C&J = the BOLD number from C&J attempts (or highest positive if no bold)

IMPORTANT - NAME FORMAT:
- Output names in "First Last" format (e.g., "John Smith", "Mary Johnson")
- If the name appears as "SMITH John" or "SMITH, John", convert it to "John Smith"

IMPORTANT - AGE CATEGORY FORMAT:
- The age category must be formatted as: "Gender Masters (age-range) weightkg"
- Examples: "Women's Masters (45-49) 77kg", "Men's Masters (40-44) 89kg"
- If you see "Women's W65 87kg", convert to "Women's Masters (65-69) 87kg"
- If you see "Women's W55 81kg", convert to "Women's Masters (55-59) 81kg"  
- If you see "Women's W45 87+kg", convert to "Women's Masters (45-49) 87+kg"
- If you see "Women's W35 64kg", convert to "Women's Masters (35-39) 64kg"
- The format MUST be: Gender's Masters (age-age) weightkg

For each athlete, provide the following information in CSV format:
- Name (in "First Last" format)
- Age category with weight class (formatted as "Gender's Masters (age-age) weightkg")
- Body weight in kg
- Snatch attempt 1 (positive if black text, negative if red/crossed)
- Snatch attempt 2 (positive if black text, negative if red/crossed)
- Snatch attempt 3 (positive if black text, negative if red/crossed)
- Best snatch (always positive - highest successful snatch)
- Clean & Jerk attempt 1 (positive if black text, negative if red/crossed)
- Clean & Jerk attempt 2 (positive if black text, negative if red/crossed)
- Clean & Jerk attempt 3 (positive if black text, negative if red/crossed)
- Best Clean & Jerk (always positive - highest successful C&J)
- Total (always positive - sum of best snatch + best C&J)

Output format (CSV):
Name,Age Category,Body Weight,Snatch1,Snatch2,Snatch3,Snatch Best,CJ1,CJ2,CJ3,CJ Best,Total

Examples showing CORRECT column alignment:
John Smith,Men's Masters (40-44) 89kg,88.5,89,93,-96,93,115,-120,-120,115,208
Mary Johnson,Women's Masters (55-59) 81kg,79.5,25,27,28,28,33,35,37,37,65
Jane Doe,Women's Masters (65-69) 87kg,86.7,30,32,-34,32,42,44,46,46,78

CRITICAL CHECKLIST BEFORE OUTPUTTING:
✓ Name is "First Last" format (converted from "LAST First")
✓ Age category is "Gender's Masters (age-age) weightkg"
✓ Body weight is from column 7 of the table
✓ Snatch 1,2,3 are from columns 9,10,11 of the table
✓ Best snatch is the BOLD number from snatch attempts (always positive)
✓ C&J 1,2,3 are from columns 12,13,14 of the table
✓ Best C&J is the BOLD number from C&J attempts (always positive)
✓ Total is from column 15 of the table (always positive)
✓ Red/crossed lifts are negative numbers
✓ Black lifts are positive numbers
✓ BOLD numbers indicate best lifts

Only output the CSV data, no explanations. DOUBLE-CHECK COLUMN ALIGNMENT FOR EVERY ROW."""

        try:
            response = self.openai_client.chat.completions.create(
                model="gpt-4o", 
                messages=[
                    {
                        "role": "user",
                        "content": [
                            {"type": "text", "text": prompt},
                            {
                                "type": "image_url",
                                "image_url": {
                                    "url": f"data:image/png;base64,{base64_image}"
                                }
                            }
                        ]
                    }
                ],
                max_tokens=2000
            )
            
            extracted_text = response.choices[0].message.content.strip()
            return extracted_text
            
        except Exception as e:
            print(f"✗ Error calling OpenAI API: {e}")
            return None
    
    def parse_results_from_text_blocks(self, page_data: Dict[int, List[Dict]], meet_name: str, meet_date: str) -> List[Dict[str, Any]]:
        """
        Parse results from text blocks with color information (extracted directly from PDF).
        
        Args:
            page_data: Dictionary of page number to list of text blocks with color info
            meet_name: Name of the meet
            meet_date: Date of the meet
            
        Returns:
            List of result dictionaries
        """
        import re
        results = []
        
        for page_num, blocks in page_data.items():
            print(f"\n  Parsing page {page_num}...")
            
            # Group blocks into logical structure
            # We know the structure: Age Group header, then athlete data rows
            i = 0
            current_age_category = None
            
            while i < len(blocks):
                block = blocks[i]
                text = block["text"]
                
                # Check if this is an age group header (entire line in one block)
                if "Age Group" in text and "Weight Category" in text:
                    # Parse: "Age Group W65 Weight Category 87" or "Age Group M40 Weight Category 89"
                    # Also handle "Age Group M35 Weight Category 110+"
                    age_match = re.search(r'Age Group ([MW]\d+)\s+Weight Category ([\d+]+\+?)', text)
                    if age_match:
                        age_code = age_match.group(1)  # e.g., "W65" or "M40" or "M35"
                        weight_cat = age_match.group(2)  # e.g., "87" or "110+"
                        
                        # Convert age code to full format
                        code_match = re.match(r'([MW])(\d+)', age_code)
                        if code_match:
                            gender_code = code_match.group(1)  # "W" or "M"
                            age_num = int(code_match.group(2))
                            
                            # Determine gender
                            gender = "Women's" if gender_code == "W" else "Men's"
                            
                            # Determine age range (all are 5-year ranges)
                            age_range_start = (age_num // 5) * 5
                            age_range_end = age_range_start + 4
                            
                            current_age_category = f"{gender} Masters ({age_range_start}-{age_range_end}) {weight_cat}kg"
                            print(f"    Found age category: {current_age_category}")
                
                # Check if this looks like a lot number (1-4 digits followed by a name)
                if re.match(r'^\d{1,4}$', text) and current_age_category and i + 1 < len(blocks):
                    # Check if next block is a name (e.g., "GALE Jaime" or "HUGHES (ADT6) Thomas" or "BURKE Ryan")
                    next_text = blocks[i + 1]["text"]
                    if re.match(r'[A-Z]+', next_text):
                        # This is a lot number + name pattern
                        name_block = blocks[i + 1]
                        name_text = name_block["text"]
                        
                        # Parse name and remove ADT codes (only present when ADAPTIVE=True)
                        # Format can be: "HUGHES (ADT6) Thomas" or "VELEZ SOTO [ADT] Felix Osvaldo"
                        # Remove ADT codes first
                        clean_name = re.sub(r'\s*\(ADT\d*\)|\[ADT\]\s*', ' ', name_text).strip()
                        
                        # Parse "LAST First" or "LAST LAST First" or "LAST First Middle"
                        name_parts = clean_name.split()
                        if len(name_parts) >= 2:
                            # Find where the first name starts (first lowercase or mixed case word)
                            first_name_idx = len(name_parts) - 1  # Default to last word
                            for idx, part in enumerate(name_parts):
                                if not part.isupper():
                                    first_name_idx = idx
                                    break
                            
                            # Last name is everything before first name
                            last_name_parts = name_parts[:first_name_idx]
                            first_name_parts = name_parts[first_name_idx:]
                            
                            last_name = ' '.join([p.capitalize() for p in last_name_parts])
                            first_name = ' '.join(first_name_parts)
                            name = f"{first_name} {last_name}"
                        else:
                            i += 1
                            continue
                        
                        # Collect the next numeric values (body weight, age, 6 lifts, total, shmf)
                        # Starting from i + 2 (after name block)
                        values = []
                        colors = []
                        j = i + 2
                        while j < len(blocks) and len(values) < 12:
                            val_text = blocks[j]["text"]
                            is_red = blocks[j]["is_red"]
                            
                            # Check if it's a dash (skipped attempt)
                            if val_text == '-':
                                values.append('0')  # Treat dash as 0
                                colors.append(False)
                            # Check if it's a pure numeric value
                            elif re.match(r'^\d+\.?\d*$', val_text):
                                values.append(val_text)
                                colors.append(is_red)
                            #  Check if block contains numbers mixed with text (e.g., "TMSAVA 79.45" or "IRONAC 105.85 45")
                            elif re.search(r'\d+\.?\d+', val_text):
                                # Extract all numbers from this block
                                numbers = re.findall(r'\d+\.?\d*', val_text)
                                for num in numbers:
                                    if num and '.' in num or len(num) >= 2:  # Body weight or age
                                        values.append(num)
                                        colors.append(is_red)
                            
                            j += 1
                            
                            # Stop if we hit the next lot number (2-4 digits followed by name) or age group
                            if j < len(blocks):
                                check_text = blocks[j]["text"]
                                if re.match(r'^\d{2,4}$', check_text) and j + 1 < len(blocks):
                                    next_next = blocks[j + 1]["text"]
                                    if re.match(r'[A-Z]+\s+[A-Za-z]+', next_next):
                                        # Found next athlete
                                        break
                                if "Age Group" in check_text:  # Next section
                                    break
                        
                        
                        # Parse the values
                        # Expected order: body_weight, age, sn1, sn2, sn3, cj1, cj2, cj3, total, shmf
                        if len(values) >= 9:
                            try:
                                body_weight = float(values[0])
                                # Skip age (values[1])
                                sn1 = int(float(values[2])) if not colors[2] else -int(float(values[2]))
                                sn2 = int(float(values[3])) if not colors[3] else -int(float(values[3]))
                                sn3 = int(float(values[4])) if not colors[4] else -int(float(values[4]))
                                cj1 = int(float(values[5])) if not colors[5] else -int(float(values[5]))
                                cj2 = int(float(values[6])) if not colors[6] else -int(float(values[6]))
                                cj3 = int(float(values[7])) if not colors[7] else -int(float(values[7]))
                                total = int(float(values[8]))
                                
                                # Calculate best lifts (highest positive value - as integers)
                                snatch_best = max([v for v in [sn1, sn2, sn3] if v > 0], default=0)
                                cj_best = max([v for v in [cj1, cj2, cj3] if v > 0], default=0)
                                
                                result = {
                                    'event_id': self.event_id,
                                    'meet': meet_name,
                                    'date': meet_date,
                                    'name': name,
                                    'age': current_age_category,
                                    'body_weight': body_weight,
                                    'snatch1': sn1,
                                    'snatch2': sn2,
                                    'snatch3': sn3,
                                    'snatch_best': snatch_best,
                                    'cj1': cj1,
                                    'cj2': cj2,
                                    'cj3': cj3,
                                    'cj_best': cj_best,
                                    'total': total,
                                    'adaptive': self.adaptive,
                                    'federation': 'USAMW'
                                }
                                
                                results.append(result)
                                print(f"    ✓ Parsed: {name} - Total: {total}kg")
                                
                            except (ValueError, IndexError) as e:
                                print(f"    ⚠ Error parsing athlete {name}: {e}")
                        else:
                            print(f"    ⚠ Not enough values for {name} (got {len(values)}, need 9)")
                        
                        i = j
                        continue
                
                i += 1
        
        print(f"  Total results parsed from text: {len(results)}")
        return results
    
    def parse_csv_results(self, csv_text: str, meet_name: str, meet_date: str) -> List[Dict[str, Any]]:
        """
        Parse CSV text from OpenAI into structured records.
        
        Args:
            csv_text: CSV formatted text from OpenAI
            meet_name: Name of the meet
            meet_date: Date of the meet (YYYY-MM-DD)
            
        Returns:
            List of result dictionaries
        """
        results = []
        lines = csv_text.strip().split('\n')
        
        for line in lines:
            # Skip header line
            if line.startswith('Name,') or line.startswith('name,'):
                continue
            
            # Skip empty lines
            if not line.strip():
                continue
            
            # Parse CSV line
            parts = [p.strip() for p in line.split(',')]
            
            if len(parts) < 11:
                continue
            
            try:
                result = {
                    'event_id': self.event_id,
                    'meet': meet_name,
                    'date': meet_date,
                    'name': parts[0],
                    'age': parts[1],
                    'body_weight': float(parts[2]) if parts[2] else None,
                    'snatch1': float(parts[3]) if parts[3] else None,
                    'snatch2': float(parts[4]) if parts[4] else None,
                    'snatch3': float(parts[5]) if parts[5] else None,
                    'snatch_best': float(parts[6]) if parts[6] else None,
                    'cj1': float(parts[7]) if parts[7] else None,
                    'cj2': float(parts[8]) if parts[8] else None,
                    'cj3': float(parts[9]) if parts[9] else None,
                    'cj_best': float(parts[10]) if parts[10] else None,
                    'total': float(parts[11]) if len(parts) > 11 and parts[11] else None,
                    'adaptive': self.adaptive,
                    'federation': 'USAMW'
                }
                
                results.append(result)
                
            except (ValueError, IndexError) as e:
                print(f"⚠ Error parsing line: {line}")
                print(f"  Error: {e}")
                continue
        
        return results
    
    def process_pdf_url(self, url: str, index: int) -> List[Dict[str, Any]]:
        """
        Process a single PDF from URL.
        
        Returns:
            List of result records
        """
        print(f"\n{'='*60}")
        print(f"Processing PDF #{index + 1}")
        print(f"URL: {url}")
        print(f"Meet: {self.meet_name}")
        print(f"Date: {self.meet_date}")
        print(f"{'='*60}")
        
        # Download PDF
        pdf_bytes = self.download_pdf_from_url(url)
        if not pdf_bytes:
            return []
        
        # Extract text with color information directly from PDF
        print("Extracting text and color information from PDF...")
        page_data = self.extract_text_with_color_from_pdf(pdf_bytes)
        if not page_data:
            print("✗ No text data extracted")
            return []
        
        print(f"✓ Extracted text from {len(page_data)} pages")
        
        # Parse results from extracted text
        all_results = self.parse_results_from_text_blocks(page_data, self.meet_name, self.meet_date)
        
        print(f"\n✓ Total results from PDF #{index + 1}: {len(all_results)}")
        return all_results
    
    def dry_run(self, results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Perform a dry run - show what would be inserted without making changes.
        
        Returns:
            Dictionary with summary of changes
        """
        print("\n" + "="*60)
        print("DRY RUN - No database changes will be made")
        print("="*60 + "\n")
        
        if not self.supabase:
            self.setup_supabase_client()
        
        to_insert = []
        duplicates = []
        
        for result in results:
            # Check if result exists by event_id, meet, name, and federation
            try:
                existing = self.supabase.table('lifting_results').select('id, name, meet').eq(
                    'event_id', result['event_id']
                ).eq(
                    'meet', result['meet']
                ).eq(
                    'name', result['name']
                ).eq(
                    'federation', result['federation']
                ).execute()
                
                if existing.data:
                    # Duplicate found
                    duplicates.append(result)
                else:
                    # New record
                    to_insert.append(result)
            except Exception as e:
                print(f"⚠ Error checking record: {e}")
                to_insert.append(result)
        
        # Print summary
        print(f"Summary:")
        print(f"  New results to insert: {len(to_insert)}")
        print(f"  Duplicate records (will skip): {len(duplicates)}")
        print(f"  Total results processed: {len(results)}\n")
        
        # Print details
        if to_insert:
            print("Results to INSERT:")
            print()
            
            if tabulate:
                # Format as a nice table
                headers = ['name', 'age', 'body_weight', 'snatch1', 'snatch2', 'snatch3', 'snatch_best', 
                          'cj1', 'cj2', 'cj3', 'cj_best', 'total', 'adaptive', 'federation']
                table_data = []
                for result in to_insert:
                    table_data.append([
                        result['name'],
                        result['age'],
                        result['body_weight'],
                        result['snatch1'],
                        result['snatch2'],
                        result['snatch3'],
                        result['snatch_best'],
                        result['cj1'],
                        result['cj2'],
                        result['cj3'],
                        result['cj_best'],
                        result['total'], 
                        result['adaptive'],
                        result['federation']
                    ])
                print(tabulate(table_data, headers=headers, tablefmt='grid'))
            else:
                # Fallback to CSV format
                print("event_id,meet,date,name,age,body_weight,snatch1,snatch2,snatch3,snatch_best,cj1,cj2,cj3,cj_best,total,adaptive,federation")
                for result in to_insert:
                    print(f"{result['event_id']},{result['meet']},{result['date']},{result['name']},{result['age']},"
                          f"{result['body_weight']},{result['snatch1']},{result['snatch2']},{result['snatch3']},{result['snatch_best']},"
                          f"{result['cj1']},{result['cj2']},{result['cj3']},{result['cj_best']},{result['total']},"
                          f"{result['adaptive']},{result['federation']}")
            print()
        
        if duplicates:
            print("⚠ DUPLICATE Records (will NOT be inserted):")
            print()
            for dup in duplicates:
                print(f"  ✗ {dup['name']} - Event ID: {dup['event_id']}, Meet: {dup['meet']}, Federation: {dup['federation']}")
            print()
        
        return {
            'to_insert': to_insert,
            'duplicates': duplicates,
            'total': len(results)
        }
    
    def fetch_max_id_from_supabase(self) -> int:
        """Fetch the highest ID value from the Supabase database."""
        if not self.supabase:
            self.setup_supabase_client()
        
        try:
            response = self.supabase.table('lifting_results').select('id').order('id', desc=True).limit(1).execute()
            if response.data and len(response.data) > 0:
                return response.data[0]['id']
            return 0
        except Exception as e:
            print(f"⚠ Error fetching max ID from Supabase: {e}")
            return 0
    
    def insert_to_supabase(self, results: List[Dict[str, Any]]) -> Dict[str, List[Dict[str, Any]]]:
        """
        Insert results to Supabase (skips duplicates).
        
        Returns:
            Dictionary with 'inserted' and 'skipped' lists
        """
        if not self.supabase:
            self.setup_supabase_client()
        
        # Fetch the max ID to start incrementing from
        max_id = self.fetch_max_id_from_supabase()
        next_id = max_id + 1
        print(f"Starting inserts from ID: {next_id}")
        
        inserted = []
        skipped = []
        
        for result in results:
            try:
                # Check if duplicate exists (event_id, meet, name, federation)
                existing = self.supabase.table('lifting_results').select('id, name, meet').eq(
                    'event_id', result['event_id']
                ).eq(
                    'meet', result['meet']
                ).eq(
                    'name', result['name']
                ).eq(
                    'federation', result['federation']
                ).execute()
                
                if existing.data and len(existing.data) > 0:
                    # Duplicate found - skip insert
                    skipped.append(result)
                    print(f"  ✗ SKIPPED (duplicate): {result['name']} - Event ID: {result['event_id']}, Meet: {result['meet']}")
                else:
                    # Prepare data with manually assigned ID
                    data = {k: v for k, v in result.items() if k not in ['created_at']}
                    data['id'] = next_id
                    
                    # Insert new record
                    insert_response = self.supabase.table('lifting_results').insert(data).execute()
                    inserted.append(result)
                    print(f"  ✓ Inserted: {result['name']} (ID: {next_id})")
                    next_id += 1
                    
            except Exception as e:
                error_detail = str(e)
                print(f"✗ Error inserting {result.get('name', 'unknown')}: {error_detail}")
                skipped.append(result)
        
        return {'inserted': inserted, 'skipped': skipped}
    
    def send_slack_notification(self, inserted: List[Dict[str, Any]], skipped: List[Dict[str, Any]]):
        """Send Slack notification with insert summary."""
        if not self.slack_webhook_url:
            print("⚠ Slack webhook not configured, skipping notification")
            return
        
        # Build message
        title = "🇺🇸 USAMW Results Update"
        
        # Summary
        if len(inserted) == 0:
            message = f"{title}\nNo new results added"
        else:
            message = f"{title}\n*{len(inserted)}* new results added"
        
        if len(skipped) > 0:
            message += f", *{len(skipped)}* duplicates skipped"
        
        # Inserted results
        if inserted:
            message += f"\n\n*New Results ({len(inserted)}):*\n"
            inserted_text = "\n".join([
                f"• {r['name']} - {r['age']} - Total: {r['total']}kg"
                for r in inserted[:10]  # Limit to first 10
            ])
            message += inserted_text
            if len(inserted) > 10:
                message += f"\n... and {len(inserted) - 10} more"
        
        # Skipped results
        if skipped:
            message += f"\n\n*Skipped Duplicates ({len(skipped)}):*\n"
            skipped_text = "\n".join([
                f"• {r['name']} - {r['meet']}"
                for r in skipped[:10]  # Limit to first 10
            ])
            message += skipped_text
            if len(skipped) > 10:
                message += f"\n... and {len(skipped) - 10} more"
        
        payload = {
            "text": message
        }
        
        try:
            response = requests.post(self.slack_webhook_url, json=payload, timeout=30)
            response.raise_for_status()
            print("✓ Slack notification sent")
        except requests.exceptions.RequestException as e:
            print(f"⚠ Failed to send Slack notification: {e}")
    
    def run(self, dry_run: bool = False, limit_files: Optional[int] = None):
        """Main execution method."""
        print("="*60)
        print("USAMW Results Scraper")
        print("="*60 + "\n")
        
        # Setup services
        self.setup_openai_client()
        self.setup_supabase_client()
        self.setup_slack()
        
        # Check PDF URLs
        if not self.pdf_urls or not any(self.pdf_urls):
            print("✗ No PDF URLs configured. Please add URLs to PDF_URLS list.")
            return
        
        # Filter out empty URLs
        valid_urls = [url for url in self.pdf_urls if url and url.strip() and not url.startswith("YOUR_FILE_ID")]
        
        if not valid_urls:
            print("✗ No valid PDF URLs configured. Please update PDF_URLS list.")
            return
        
        print(f"Processing {len(valid_urls)} PDF(s)...\n")
        
        # Limit number of files to process (for testing)
        if limit_files:
            valid_urls = valid_urls[:limit_files]
        
        # Process each PDF
        all_results = []
        for i, url in enumerate(valid_urls):
            results = self.process_pdf_url(url, i)
            all_results.extend(results)
        
        if not all_results:
            print("\n✗ No results extracted. Exiting.")
            return
        
        print(f"\n{'='*60}")
        print(f"Total results extracted: {len(all_results)}")
        print(f"{'='*60}\n")
        
        # Process results
        if dry_run:
            result = self.dry_run(all_results)
            # Don't send Slack notification for dry-run
        else:
            print("\n" + "="*60)
            print("INSERTING TO DATABASE")
            print("="*60 + "\n")
            result = self.insert_to_supabase(all_results)
            print(f"\n✓ Complete: {len(result['inserted'])} inserted, {len(result['skipped'])} skipped (duplicates)")
            
            # Send Slack notification
            self.send_slack_notification(result['inserted'], result['skipped'])


def main():
    """Main entry point."""
    parser = argparse.ArgumentParser(
        description='Scrape USAMW results from Google Drive PDFs and update Supabase'
    )
    parser.add_argument(
        '--dry-run',
        action='store_true',
        help='Preview changes without updating database'
    )
    parser.add_argument(
        '--limit',
        type=int,
        default=None,
        help='Limit number of PDF files to process (for testing)'
    )
    
    args = parser.parse_args()
    
    # Validate configuration
    if not MEET_NAME or not MEET_DATE or not EVENT_ID or not PDF_URLS:
        print("✗ Error: Please configure MEET_NAME, MEET_DATE, EVENT_ID, and PDF_URLS at the top of this file.")
        sys.exit(1)
    
    # Validate date format
    try:
        datetime.strptime(MEET_DATE, '%Y-%m-%d')
    except ValueError:
        print(f"✗ Error: Invalid date format '{MEET_DATE}'. Use YYYY-MM-DD format.")
        sys.exit(1)
    
    print(f"Configuration:")
    print(f"  Meet: {MEET_NAME}")
    print(f"  Date: {MEET_DATE}")
    print(f"  Event ID: {EVENT_ID}")
    print(f"  Adaptive: {ADAPTIVE}")
    print(f"  PDF URLs: {len(PDF_URLS)}\n")
    
    scraper = USAMWResultsScraper(PDF_URLS, MEET_NAME, MEET_DATE, EVENT_ID, ADAPTIVE)
    scraper.run(dry_run=args.dry_run, limit_files=args.limit)


if __name__ == "__main__":
    main()

