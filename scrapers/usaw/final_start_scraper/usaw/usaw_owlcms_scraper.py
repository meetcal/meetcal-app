import PyPDF2
import pdfplumber
import re
import json
import csv
from pathlib import Path

def extract_text_from_pdf(pdf_path):
    """Extract all text from a PDF file using pdfplumber."""
    all_text = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                all_text.append(text)
    
    return '\n'.join(all_text)

def clean_categories(categories):
    """Clean up the categories field by removing extra spaces and organizing the data."""
    # Remove extra spaces
    categories = re.sub(r'\s+', ' ', categories).strip()
    
    # Split by '/' and clean each part
    parts = [part.strip() for part in categories.split('/')]
    
    # Join back with ' / ' separator
    return ' / '.join(parts)

def parse_start_list(text):
    """Parse the extracted text to identify competitors and their information."""
    entries = []

    # Split text into lines for processing
    lines = text.split('\n')

    # Skip header lines
    start_processing = False

    for line in lines:
        line = line.strip()
        if not line:
            continue

        # Skip header lines
        if "ContactID WSO Lot First Name Last Name" in line or "Start List presented by:" in line:
            start_processing = True
            continue

        if not start_processing:
            continue

        # Parse competitor information
        # Format: ContactID WSO Lot FirstName LastName State Year Age ClubName COMPETITIONS EntryTotal Group Session Platform Day CompTime
        # Example: 1080627Florida 660Jaylynne DeMuth FL 2009 16Volusia Barbell 16-17YO W 58 / OPEN W 58 / / / 115D 1RED 4-Dec 9:00 AM

        # Parse using state code as anchor point
        # Pattern: ContactID WSO Lot Name STATE YEAR AGE Club COMPETITIONS EntryTotal Group Session Platform Day Time
        # We'll use the pattern "2-letter-state + 4-digit-year + 1-2-digit-age" to find our anchor

        match = re.match(r'^(\d+)', line)
        if match:
            contact_id = match.group(1)

            # Find the state + year + age pattern as our anchor
            # This gives us a reliable point to extract data from
            # State is optional - some entries have it, some don't
            state_year_age_match = re.search(r'\s([A-Z]{2})?\s*(\d{4})\s+(\d{1,2})', line)
            if not state_year_age_match:
                continue

            state = state_year_age_match.group(1) if state_year_age_match.group(1) else ''
            year = state_year_age_match.group(2)
            age = state_year_age_match.group(3)

            # Extract name - everything between contact_id and state
            # Skip WSO and lot number by finding where the actual name starts
            before_state_raw = line[len(contact_id):state_year_age_match.start()]

            # Two cases:
            # 1. ContactID WSO Lot Name (e.g., "1080627Florida 660Jaylynne DeMuth")
            # 2. ContactID Lot Name (e.g., "1059150 131ALAN CANIGLIA")

            # Check if there's a space after contact_id (indicates no WSO directly attached)
            if before_state_raw and before_state_raw[0].isspace():
                # No WSO directly attached - simpler case
                # Format: " Lot Name" or " WSO Lot Name"
                before_state = before_state_raw.strip()
                # Find the lot number (first sequence of digits)
                lot_match = re.match(r'^(\d+)', before_state)
                if not lot_match:
                    continue
                # Name is everything after the lot number
                name = before_state[len(lot_match.group(1)):].strip()
            else:
                # WSO is attached to contact_id or no WSO/lot at all
                before_state = before_state_raw.strip()
                # Find all sequences of digits followed by letters
                lot_name_matches = list(re.finditer(r'(\d+)([A-Za-z])', before_state))

                if not lot_name_matches:
                    # No lot number found - entire before_state is the name
                    # This handles cases like "944Mary Macken" where there's no lot number
                    name = before_state
                else:
                    # Name starts after the last lot number
                    last_match = lot_name_matches[-1]
                    name = before_state[last_match.start() + len(last_match.group(1)):].strip()

                    # Clean up name: remove any lowercase letters at the start before first uppercase
                    # This handles corruption like "aAlyssa" -> "Alyssa" or "in9i3aAlyssa" -> "Alyssa"
                    name_clean_match = re.search(r'[A-Z]', name)
                    if name_clean_match:
                        name = name[name_clean_match.start():]

            # Everything after year age
            rest_of_line = line[state_year_age_match.end():].strip()

            # Find the COMPETITIONS field - it contains patterns like "16-17YO W 58" or "OPEN W 58"
            # The competitions field ends with a pattern like "###D" or "###C" or "###E" or "###F" (entry total + group)
            # Special case: withdrawn entries have "0W WWW WWW WWW WWW" pattern - skip these
            entry_group_match = re.search(r'(\d{1,3})([A-FW])\s+(\d+|WWW)([A-Z]+)', rest_of_line)
            if entry_group_match:
                # Skip withdrawn entries (WWW)
                if entry_group_match.group(3) == 'WWW':
                    continue
                entry_total = entry_group_match.group(1)
                group = entry_group_match.group(2)
                session = entry_group_match.group(3)
                platform = entry_group_match.group(4).capitalize()

                # Everything before the entry total is club name + competitions
                club_and_competitions = rest_of_line[:rest_of_line.find(entry_group_match.group(0))].strip()

                # Extract gender from competitions (M or W followed by a number, with or without space)
                # Patterns: "M 71", "W 58", "UMWFM65", "M65", etc.
                gender_match = re.search(r'([MW])\s*\d', club_and_competitions)
                if gender_match:
                    gender = gender_match.group(1)

                    # Find where competitions start (first occurrence of age pattern or OPEN/JUNIOR/UMWF/MIL/ADAP)
                    comp_patterns = [r'16-17YO', r'14-15YO', r'U13', r'OPEN', r'JUNIOR', r'UMWF', r'MIL', r'ADAP', r'W\d{2}', r'M\d{2}']
                    comp_start_index = len(club_and_competitions)
                    for pattern in comp_patterns:
                        comp_match = re.search(pattern, club_and_competitions)
                        if comp_match and comp_match.start() < comp_start_index:
                            comp_start_index = comp_match.start()

                    # Extract club (everything before competitions)
                    club = club_and_competitions[:comp_start_index].strip()

                    # Extract competitions/categories
                    categories = club_and_competitions[comp_start_index:].strip()
                    categories = clean_categories(categories)

                    # Extract the rest after entry/group/session/platform
                    rest_after_platform = rest_of_line[rest_of_line.find(entry_group_match.group(0)) + len(entry_group_match.group(0)):].strip()

                    # Split remaining parts for day and time
                    parts = rest_after_platform.split(maxsplit=1)
                    if len(parts) >= 2:
                        day = parts[0]
                        time = parts[1]

                        # Create entry dictionary
                        entry = {
                            'contact_id': contact_id,
                            'name': name,
                            'state': state,
                            'year': year,
                            'age': age,
                            'club': club,
                            'gender': gender,
                            'categories': categories,
                            'group': group,
                            'entryTotal': entry_total,
                            'session': session,
                            'platform': platform,
                            'day': day,
                            'time': time
                        }

                        entries.append(entry)

    return entries

def extract_weight_class(categories):
    """Extract weight class from categories field."""
    weight_classes = []
    pattern = r'([MW])\s+(\d+)'
    matches = re.finditer(pattern, categories)
    
    for match in matches:
        gender = match.group(1)
        weight = match.group(2)
        weight_classes.append(f"{gender}{weight}")
    
    return weight_classes

def extract_age_group(categories):
    """Extract age group from categories field."""
    age_groups = []
    patterns = [
        r'U13',
        r'14-15',
        r'16-17',
        r'JUNIOR',
        r'OPEN',
        r'35',
        r'40',
        r'45',
        r'50',
        r'55',
        r'60',
        r'65',
        r'70',
        r'UNI'
    ]
    
    for pattern in patterns:
        if re.search(pattern, categories):
            age_groups.append(pattern)
    
    return age_groups

def enrich_data(entries):
    """Add additional derived fields to the entries."""
    enriched_entries = []
    
    for entry in entries:
        # Create a copy of the entry
        enriched_entry = entry.copy()
        
        # Extract weight classes
        if 'categories' in entry:
            weight_classes = extract_weight_class(entry['categories'])
            if weight_classes:
                enriched_entry['weight_classes'] = weight_classes
        
        # Extract age groups
        if 'categories' in entry:
            age_groups = extract_age_group(entry['categories'])
            if age_groups:
                enriched_entry['age_groups'] = age_groups
        
        enriched_entries.append(enriched_entry)
    
    return enriched_entries

def save_to_csv(data, output_path):
    """Save the parsed data to a CSV file."""
    # Fields to exclude from output
    excluded_fields = ['state', 'group', 'age_groups', 'day', 'time', 'weight_classes', 'categories']
    
    # Define platform order
    platform_order = {
        'Red': 1,
        'White': 2,
        'Blue': 3,
        'Stars': 4,
        'Stripes': 5,
        'Rogue': 6
    }
    
    # Filter out the excluded fields and rename fields
    filtered_data = []
    for entry in data:
        filtered_entry = {}
        
        # Convert gender from W/M to Female/Male
        gender = 'Female' if entry.get('gender') == 'W' else 'Male'
        
        # Extract just the weight class number that follows M## or W##
        weight_class = ''
        categories = entry.get('categories', '')
        # Pattern can be "W 58", "M 71", "W 86+", "M55 71" (Masters), "W60 77" (UMWF), etc.
        # Try pattern with space first: "M 71"
        weight_match = re.search(r'[MW]\s+(\d{2,3})(\+?)', categories)
        if not weight_match:
            # Try Masters/UMWF pattern: "M55 71" or "W60 77"
            weight_match = re.search(r'[MW]\d+\s+(\d{2,3})(\+?)', categories)

        if weight_match:
            weight_num = weight_match.group(1)
            plus = weight_match.group(2)
            # Format: "+86" if superheavy, otherwise just "86"
            weight_class = ('+' + weight_num) if plus else weight_num
        
        # Check if adaptive (ADAP in categories)
        adaptive = 'true' if 'ADAP' in categories else 'false'

        # Handle empty club - set to Unaffiliated
        club = entry.get('club', '').strip()
        if not club:
            club = 'Unaffiliated'

        # Map the fields with their new names
        field_mapping = {
            'member_id': entry.get('contact_id', ''),
            'name': entry.get('name', ''),
            'age': entry.get('age', ''),
            'club': club,
            'gender': gender,
            'weight_class': weight_class,
            'entry_total': entry.get('entryTotal', ''),
            'session_number': entry.get('session', ''),
            'session_platform': entry.get('platform', ''),
            'meet': "2025 Virus Weightlifting Finals, Powered by Rogue Fitness",  # Add constant meet name
            'adaptive': adaptive
        }
        
        filtered_entry.update(field_mapping)
        filtered_data.append(filtered_entry)
    
    # Convert numeric fields to integers
    numeric_fields = ['entry_total', 'age', 'session_number', 'member_id']
    for entry in filtered_data:
        for field in numeric_fields:
            if field in entry and isinstance(entry[field], str) and entry[field].isdigit():
                entry[field] = int(entry[field])
    
    # Sort data by session number and platform
    filtered_data.sort(key=lambda x: (
        x.get('session_number', 0),
        platform_order.get(x.get('session_platform', ''), 999)
    ))
    
    # Define the exact order of columns
    fieldnames = ['member_id', 'name', 'age', 'club', 'gender', 'weight_class', 'entry_total', 'session_number', 'session_platform', 'meet', 'adaptive']
    
    # Write to CSV with specified column order
    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(filtered_data)
    
    print(f"Data saved to {output_path}")

def main():
    # File paths
    pdf_path = "cohens.pdf"
    output_path = "start_list_data.csv"  # Changed extension to .csv

    # Extract text from PDF
    print(f"Extracting text from {pdf_path}...")
    text = extract_text_from_pdf(pdf_path)

    # Save raw text for debugging
    with open("raw_text.txt", "w") as f:
        f.write(text)
    print("Raw text saved to raw_text.txt")

    # Parse the text
    print("Parsing text...")
    parsed_data = parse_start_list(text)

    # Enrich the data with additional derived fields
    print("Enriching data...")
    enriched_data = enrich_data(parsed_data)

    # Save the parsed data to CSV
    save_to_csv(enriched_data, output_path)

    print(f"Successfully processed {len(enriched_data)} entries from the PDF.")

if __name__ == "__main__":
    main() 