import pdfplumber
import re
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

def clean_weight_class(weight_class_text):
    """Extract the weight class number that comes after gender (M or F) and add kg suffix."""
    if not weight_class_text:
        return ""
    
    # Remove all slashes and extra spaces
    cleaned = re.sub(r'/', ' ', weight_class_text)
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
    # Look for pattern: [age_group] M/F [weight_class_number]
    # Examples: "16-17yo M 56", "NAT F 69", "JR M 81", "U15 F 40+"
    weight_match = re.search(r'[MF]\s+(\d{2,3})(\+?)', cleaned)
    
    if weight_match:
        weight_number = weight_match.group(1)
        plus_sign = weight_match.group(2)
        return weight_number + plus_sign + "kg"
    
    # Fallback: look for standalone number after removing age groups
    # Remove common age group patterns first
    fallback_cleaned = re.sub(r'\b(?:U\d+|14-15yo|16-17yo|JR|U\d\d|JUNIOR|OPEN|NAT|\d+-\d+yo)\b', '', cleaned)
    number_match = re.search(r'(?<![A-Za-z])(\d{2,3})(\+?)(?![A-Za-z])', fallback_cleaned)
    
    if number_match:
        weight_number = number_match.group(1)
        plus_sign = number_match.group(2)
        return weight_number + plus_sign + "kg"
    
    return ""

def parse_simple_format_data(text):
    """Parse the text from the simple space-separated format PDF."""
    entries = []
    lines = text.split('\n')
    
    # Find the header line to start processing
    header_found = False
    line_count = 0
    processed_count = 0
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
        
        # Look for the header line
        if 'ContactID' in line and 'First Name' in line and 'Last Name' in line:
            header_found = True
            continue
        
        if not header_found:
            continue
        
        # Skip empty lines or lines that don't start with a number (ContactID)
        if not re.match(r'^\d+', line):
            continue
        
        line_count += 1
        
        try:
            # Extract ContactID (first number)
            contact_match = re.match(r'^(\d+)', line)
            if not contact_match:
                print(f"Line {line_count}: No ContactID found - {line[:100]}")
                continue
            
            contact_id = contact_match.group(1)
            remaining = line[len(contact_id):].strip()
            
            # Skip WSO text (everything up to the next number which is the Lot)
            lot_match = re.search(r'\s(\d+)', remaining)
            if not lot_match:
                print(f"Line {line_count}: No Lot number found - {line[:100]}")
                continue
            
            # Skip past the lot number to get to the name
            lot_end_pos = lot_match.end()
            after_lot = remaining[lot_end_pos:].strip()
            
            # Find the state (2-letter code) to identify end of name
            state_match = re.search(r'\s([A-Z]{2})\s', after_lot)
            if not state_match:
                # Fallback: look for year pattern (4 digits) and work backwards from there
                year_pattern = re.search(r'\s(\d{4})\s', after_lot)
                if year_pattern:
                    # Extract name as everything before the year
                    year_pos = year_pattern.start()
                    name = after_lot[:year_pos].strip()
                    # Skip directly to after the year
                    after_state = after_lot[year_pattern.end():].strip()
                else:
                    # Second fallback: look for age pattern and work backwards
                    age_fallback = re.search(r'\s(\d{1,2})[A-Za-z]', after_lot)
                    if age_fallback:
                        age_pos = age_fallback.start()
                        name = after_lot[:age_pos].strip()
                        after_state = after_lot[age_pos+1:].strip()
                    else:
                        print(f"Line {line_count}: No state code, year, or age pattern found - {line[:100]}")
                        continue
            else:
                state_pos = state_match.start()
                # Extract name (everything before state)
                name = after_lot[:state_pos].strip()
                # Skip state and year, find age+club
                after_state = after_lot[state_match.end():].strip()
            
            # Skip year (4-digit number) if we haven't already
            year_match = re.match(r'(\d{4})\s+', after_state)
            if year_match:
                after_year = after_state[year_match.end():].strip()
            else:
                after_year = after_state
            
            # Handle edge case where the line might be truncated or malformed
            if len(after_year.strip()) < 5:  # Too short to contain age + club + competitions
                print(f"Line {line_count}: Line appears truncated - {line[:100]}")
                continue
            
            # Extract age and club - age is 1-2 digits, any extra digits go to club
            age_club_match = re.match(r'(\d{1,2})(\d*.+)', after_year)
            if not age_club_match:
                print(f"Line {line_count}: No age/club pattern found - {after_year[:50]}")
                continue
            
            age = age_club_match.group(1)
            # If there are extra digits after the age, they're part of the club name
            club_with_competitions = age_club_match.group(2).strip()
            
            # Special handling for cases where age might be more than 2 digits due to data issues
            # If age is more than 2 digits, take only the first 1-2 digits as age
            if len(age) > 2:
                # Take first 2 digits as age, rest goes to club
                actual_age = age[:2]
                leftover = age[2:]
                club_with_competitions = leftover + club_with_competitions
                age = actual_age
            
            # Find the competitions field by looking for patterns like "JR M 79", "U23 F 69", "NAT M 88", etc.
            # Look for competition patterns: age_group + gender + weight / slashes
            competitions_match = re.search(r'((?:U\d+|14-15yo|16-17yo|JR|U\d\d|JUNIOR|OPEN|NAT|\d+-\d+yo)\s+[MF]\s+\d+)', club_with_competitions)
            
            if competitions_match:
                competitions_start_pos = competitions_match.start()
                club = club_with_competitions[:competitions_start_pos].strip()
            else:
                # Fallback: look for any pattern with M or F followed by number
                fallback_match = re.search(r'([MF]\s+\d+)', club_with_competitions)
                if fallback_match:
                    competitions_start_pos = fallback_match.start() - 10  # Go back to capture more context
                    if competitions_start_pos < 0:
                        competitions_start_pos = 0
                    club = club_with_competitions[:competitions_start_pos].strip()
                else:
                    # If no competitions found, split at first slash or look for entry total pattern
                    slash_pos = club_with_competitions.find('/')
                    if slash_pos != -1:
                        club = club_with_competitions[:slash_pos].strip()
                        competitions_start_pos = slash_pos
                    else:
                        # Look for pattern like "260A 29" (entry_total + group + session)
                        entry_pattern = re.search(r'\s(\d{2,3}[A-Z]\s+\d+)', club_with_competitions)
                        if entry_pattern:
                            competitions_start_pos = entry_pattern.start()
                            club = club_with_competitions[:competitions_start_pos].strip()
                        else:
                            print(f"Line {line_count}: No competitions pattern found - {club_with_competitions[:50]}")
                            continue
            
            # Extract competitions (everything from start until we hit the entry total after 4 slashes)
            competitions_part = club_with_competitions[competitions_start_pos:]
            
            # Debug output for specific problematic entries
            if contact_id in ['131110', '1017324', '192277', '1008163', '1043909']:
                print(f"DEBUG Line {line_count}: ContactID {contact_id}")
                print(f"DEBUG competitions_part: '{competitions_part}'")
            
            # Look for the pattern with 4 slashes followed by entry total
            # First try: pattern with 4 slashes, entry total, session number and platform (final entries pattern)
            final_slash_pattern = re.search(r'(/\s*/\s*/\s*/\s*)(\d+)\s+(\d+)([A-Z]+)', competitions_part)
            if final_slash_pattern:
                # Extract everything before the slashes as weight class
                competitions_end = final_slash_pattern.start()
                raw_weight_class = competitions_part[:competitions_end].strip()
                entry_total = final_slash_pattern.group(2)
                session = final_slash_pattern.group(3)
                platform = final_slash_pattern.group(4).capitalize()
            else:
                # Second try: pattern with 4 slashes, entry total, group letter, session and platform (standard pattern)
                slash_pattern = re.search(r'(/\s*/\s*/\s*/\s*)(\d+)', competitions_part)
                if slash_pattern:
                    competitions_end = slash_pattern.start()
                    raw_weight_class = competitions_part[:competitions_end].strip()
                    
                    # Extract entry total and remaining fields
                    entry_total = slash_pattern.group(2)
                    
                    # Get everything after entry total
                    after_entry = competitions_part[slash_pattern.end():].strip()
                    
                    # Skip group letter, extract session and platform
                    group_match = re.match(r'([A-Z])\s+(\d+)([A-Z]+)', after_entry)
                    if group_match:
                        session = group_match.group(2)
                        platform = group_match.group(3).capitalize()
                    else:
                        # Try without group letter for final entries
                        no_group_match = re.match(r'(\d+)([A-Z]+)', after_entry)
                        if no_group_match:
                            session = no_group_match.group(1)
                            platform = no_group_match.group(2).capitalize()
                        else:
                            session = ""
                            platform = ""
                else:
                    # Fallback: look for entry total as standalone number
                    entry_match = re.search(r'\s(\d+)\s*[A-Z]\s+(\d+)([A-Z]+)', competitions_part)
                    if entry_match:
                        # Find where competitions end (before the entry total)
                        entry_start = entry_match.start()
                        raw_weight_class = competitions_part[:entry_start].strip()
                        entry_total = entry_match.group(1)
                        session = entry_match.group(2)
                        platform = entry_match.group(3).capitalize()
                    else:
                        # Final fallback: look for pattern like "360 48BLUE" (entry total + session + platform concatenated)
                        final_match = re.search(r'\s(\d+)\s+(\d+)([A-Z]+)', competitions_part)
                        if final_match:
                            # Find where competitions end (before the entry total)
                            entry_start = final_match.start()
                            raw_weight_class = competitions_part[:entry_start].strip()
                            entry_total = final_match.group(1)
                            session = final_match.group(2)
                            platform = final_match.group(3).capitalize()
                        else:
                            print(f"Line {line_count}: No entry total pattern found - {competitions_part[:50]}")
                            continue
            
            # Clean the weight class to get just the number + kg
            weight_class = clean_weight_class(raw_weight_class)
            
            # Parse gender from raw_weight_class
            gender = ""
            if ' M ' in raw_weight_class or raw_weight_class.endswith(' M'):
                gender = "Male"
            elif ' F ' in raw_weight_class or raw_weight_class.endswith(' F'):
                gender = "Female"
            
            # Create entry
            entry = {
                'member_id': contact_id,
                'name': name,
                'age': age,
                'club': club,
                'gender': gender,
                'weight_class': weight_class,
                'entry_total': entry_total,
                'session_number': session,
                'session_platform': platform,
                'meet': "2025 USA Weightlifting National Championships"
            }
            
            entries.append(entry)
            processed_count += 1
            
        except (IndexError, ValueError, AttributeError) as e:
            # Skip problematic lines and continue
            print(f"Line {line_count}: Exception {str(e)[:50]} - {line[:100]}")
            continue
    
    print(f"Processed {processed_count} out of {line_count} total data lines")
    return entries

def save_to_csv(data, output_path):
    """Save the parsed data to a CSV file."""
    if not data:
        print("No data to save")
        return
    
    # Define platform order for sorting
    platform_order = {
        'Red': 1,
        'White': 2,
        'Blue': 3,
        'Stars': 4,
        'Stripes': 5,
        'Rogue': 6
    }
    
    # Convert numeric fields to integers where possible
    numeric_fields = ['entry_total', 'age', 'session_number', 'member_id']
    for entry in data:
        for field in numeric_fields:
            if field in entry and isinstance(entry[field], str) and entry[field].isdigit():
                entry[field] = int(entry[field])
    
    # Sort data by session number and platform
    data.sort(key=lambda x: (
        x.get('session_number', 0) if isinstance(x.get('session_number'), int) else 0,
        platform_order.get(x.get('session_platform', ''), 999)
    ))
    
    # Define the exact order of columns
    fieldnames = ['member_id', 'name', 'age', 'club', 'gender', 'weight_class', 'entry_total', 'session_number', 'session_platform', 'meet']
    
    # Write to CSV with specified column order
    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
    
    print(f"Data saved to {output_path}")

def main():
    # File paths
    raw_text_path = "nats25.txt"
    output_path = "nats25.csv"
    
    # Check if raw text file exists
    if not Path(raw_text_path).exists():
        print(f"Raw text file {raw_text_path} not found. Please ensure the file exists.")
        return
    
    print(f"Reading data from {raw_text_path}...")
    
    # Read the raw text
    with open(raw_text_path, "r", encoding="utf-8") as f:
        text = f.read()
    
    # Parse the text
    print("Parsing text...")
    parsed_data = parse_simple_format_data(text)
    
    if not parsed_data:
        print("No data could be extracted from the raw text")
        return
    
    # Save the parsed data to CSV
    save_to_csv(parsed_data, output_path)
    
    print(f"Successfully processed {len(parsed_data)} entries from the raw text.")
    print(f"Total lines in raw text: {len([line for line in text.split('\n') if line.strip() and line[0].isdigit()])}")

if __name__ == "__main__":
    main() 