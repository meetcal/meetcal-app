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

def format_name(name):
    """Convert 'LAST, First' to 'First Last' with proper capitalization."""
    if ',' in name:
        last, first = name.split(',', 1)
        # Properly capitalize each part
        last = last.strip().title()
        first = first.strip().title()
        return f"{first} {last}"
    return name.strip().title()

def parse_start_list(text):
    """Parse the extracted text to identify competitors and their information."""
    entries = []
    skipped = []
    current_weight_class = None  # Track current weight class context
    member_id_counter = 300  # Start member IDs at 300
    
    # Valid USAW weight classes for reference
    valid_weights = [44, 48, 53, 56, 58, 60, 63, 65, 69, 71, 77, 79, 86, 88, 94, 110]
    
    # Skip the first few lines that contain headers
    lines = text.split('\n')
    start_idx = 0
    for i, line in enumerate(lines):
        if "Session Date Gndr Group Cat Lot Age Name Total Team Comps" in line:
            start_idx = i + 1
            break
    
    # Process each line
    for line in lines[start_idx:]:
        line = line.strip()
        if not line:
            continue
            
        # Skip header/schedule lines (but allow lines with competitor data after schedule info)
        if any(x in line for x in ['2025 USAW', 'owlcms', 'Session Date', 'Page']):
            continue
        
        # Skip pure schedule lines without competitor data
        if line.strip().startswith(('Weigh In', 'Start')) and ',' not in line:
            continue
            
        # Skip date lines
        if line.startswith(('Thu', 'Fri', 'Sat', 'Sun', 'Apr')):
            continue
            
        # Skip platform lines
        if any(x in line for x in ['RED F', 'RED M', 'BLUE F', 'BLUE M', 'WHITE F', 'WHITE M']):
            continue
            
        # Check for standalone weight class lines (just a number)
        if line.strip().isdigit():
            weight = int(line.strip())
            if weight in valid_weights:
                current_weight_class = f"{weight}kg"
            continue
            
        # Skip weight class only lines
        if re.match(r'^[WM]\d+$', line.strip()):
            continue
            
        try:
            parts = line.split()
            if len(parts) < 4:  # Need at least ID, name, total, and category
                continue
                
            entry = {}
            
            # Handle lines that start with GA or weight class
            start_idx = 0
            if parts[0] == 'GA':
                start_idx = 1
                if len(parts) > 1 and parts[1].startswith('U'):
                    start_idx = 2
            elif parts[0].startswith(('W', 'M')) or parts[0] in ['ADAP']:
                start_idx = 1
            
            # Find weight class from the correct column position
            # Based on header: Session Date Gndr Group Cat Lot Age Name Total Team Comps
            # The weight class is in the "Date" column (2nd position after session info)
            weight_found = False
            weight_class_idx = None
            
            # Look for valid weight class in early positions
            for i in range(min(3, len(parts))):
                if parts[i].isdigit() or (parts[i].endswith('+') and parts[i][:-1].isdigit()):
                    weight_str = parts[i].replace('+', '')
                    try:
                        weight = int(weight_str)
                        # Check if this is a valid USAW weight class
                        if weight in valid_weights or (parts[i].endswith('+') and weight in [77, 86, 94, 110]):
                            weight_class_idx = i
                            entry['weight_class'] = parts[i] + 'kg'
                            current_weight_class = entry['weight_class']  # Update context
                            weight_found = True
                            break
                    except:
                        continue
            
            # If no valid weight class found at start, use current context
            if not weight_found and current_weight_class:
                entry['weight_class'] = current_weight_class
                weight_found = True
            
            # Assign sequential member ID
            entry['member_id'] = member_id_counter
            member_id_counter += 1
            
            # Find the name (contains comma)
            name_idx = None
            for i, part in enumerate(parts):
                if ',' in part:
                    name_idx = i
                    break
            
            if name_idx is None:
                skipped.append(f"Skipped (no comma in name): {line}")
                continue
                
            # Get name (including any parts until we hit a number that looks like a total)
            name_parts = [parts[name_idx]]
            next_idx = name_idx + 1
            while next_idx < len(parts):
                # Stop if we hit a number that could be a total (30-400)
                if parts[next_idx].isdigit() and 30 <= int(parts[next_idx]) <= 400:
                    break
                # Stop if we hit obvious non-name text
                if parts[next_idx] in ['Open', 'JR', 'U13', 'U15', 'U17'] or parts[next_idx].startswith(('W', 'M')) and any(c.isdigit() for c in parts[next_idx]):
                    break
                name_parts.append(parts[next_idx])
                next_idx += 1
            entry['name'] = format_name(' '.join(name_parts))
            
            # Get age from correct column position
            # Based on header: Session Date Gndr Group Cat Lot Age Name Total Team Comps
            # Age is typically the number right before the name (after lot number)
            age_found = False
            
            # Look for age in the position right before the name
            if name_idx > 0:
                age_candidate_idx = name_idx - 1
                if age_candidate_idx >= 0 and parts[age_candidate_idx].isdigit():
                    age_candidate = int(parts[age_candidate_idx])
                    if 1 <= age_candidate <= 99:
                        entry['age'] = age_candidate
                        age_found = True
            
            # If not found right before name, look for valid age numbers before name (skip weight class and lot)
            if not age_found:
                for i in range(max(0, name_idx - 4), name_idx):
                    try:
                        if (parts[i].isdigit() and 
                            i != weight_class_idx and  # Skip weight class position
                            1 <= int(parts[i]) <= 99 and
                            (weight_class_idx is None or int(parts[i]) != int(parts[weight_class_idx]))):
                            
                            # Prefer the number closest to the name that looks like a reasonable age
                            entry['age'] = int(parts[i])
                            age_found = True
                    except (ValueError, IndexError):
                        continue
            
            if not age_found:
                skipped.append(f"Skipped (no age found): {line}")
                continue
            
            # Get entry total (first number after name that's > 30)
            total_found = False
            for part in parts[next_idx:]:
                if part.isdigit() and 30 <= int(part) <= 400:
                    entry['entry_total'] = int(part)
                    total_found = True
                    break
            
            if not total_found:
                skipped.append(f"Skipped (no total found): {line}")
                continue
            
            # Determine gender from weight class using official USAW weight categories
            def determine_gender_from_weight_class(weight_class_str):
                """Determine gender based on official USAW weight classes."""
                # Extract numeric weight from weight class (remove 'kg')
                weight_str = weight_class_str.replace('kg', '').replace('+', '')
                try:
                    weight = int(weight_str)
                except:
                    return None
                
                # Women-only weight classes (all ages)
                women_only = [44, 53, 58, 63, 69, 77, 86]
                # Men-only weight classes (all ages)  
                men_only = [65, 71, 79, 88, 94, 110]
                
                if weight in women_only or weight_class_str.endswith('+kg') and weight == 86:
                    return 'Female'
                elif weight in men_only or weight_class_str.endswith('+kg') and weight == 110:
                    return 'Male'
                elif weight == 48:
                    # 48kg: women (all ages) or men (youth only)
                    # Default to Female as it's more common
                    return 'Female'
                elif weight == 60:
                    # 60kg: men (all ages) or women (youth only)
                    # Default to Male as it's more common
                    return 'Male'
                elif weight == 56:
                    # 56kg: men youth only
                    return 'Male'
                
                # If weight class parsing found +94kg, check if it should be men
                if weight_class_str.endswith('+kg') and weight == 94:
                    return 'Male'
                
                return None
            
            # Determine gender from weight class first
            gender_from_weight = determine_gender_from_weight_class(entry['weight_class'])
            if gender_from_weight:
                entry['gender'] = gender_from_weight
            else:
                # Fallback: Look for gender indicators in competition categories
                for part in parts:
                    if part.startswith('W') and any(c.isdigit() for c in part):
                        entry['gender'] = 'Female'
                        break
                    elif part.startswith('M') and any(c.isdigit() for c in part):
                        entry['gender'] = 'Male'
                        break
            
            if not weight_found:
                skipped.append(f"Skipped (no weight class found): {line}")
                continue
            
            # Ensure gender is set - final fallback
            if 'gender' not in entry:
                # For GA entries, try to determine gender from name or context
                if 'MILMW' in parts or any(female_name in line for female_name in [', Ms', ', Mrs', 'MISS']):
                    entry['gender'] = 'Female'
                else:
                    # Default to Male if unsure
                    entry['gender'] = 'Male'
            
            # Get club (everything between total and GA/categories)
            club_parts = []
            found_total = False
            for part in parts[next_idx:]:
                if part.isdigit() and 30 <= int(part) <= 400:
                    found_total = True
                    continue
                if found_total:
                    # Stop at category markers - including Open
                    if part in ['TKOK', 'TKOK JR', 'ADAP', 'MILMM', 'MILMW', 'MIL', 'Open'] or part.startswith('U'):
                        break
                    # Also stop at age group categories like W35, M40, etc.
                    if re.match(r'^[WM]\d+', part):
                        break
                    club_parts.append(part)
            
            entry['club'] = ' '.join(club_parts).strip()
            if not entry['club']:
                entry['club'] = 'Unaffiliated'
            
            # Add empty session info
            entry['session_number'] = ''
            entry['session_platform'] = ''
            entry['meet'] = "The 2025 DMV WSO Championships"
            entry['adaptive'] = 'FALSE'
            
            entries.append(entry)
            
        except Exception as e:
            skipped.append(f"Error parsing line: {line}\nError: {str(e)}")
            continue
    
    print(f"\nTotal entries parsed: {len(entries)}")
    print(f"Total entries skipped: {len(skipped)}")
    
    if len(skipped) > 0:
        print("\nFirst 10 skipped entries:")
        for i, skip in enumerate(skipped[:10]):
            print(f"{i+1}. {skip}")
    else:
        print("✅ All entries were successfully parsed!")
    
    return entries

def save_to_csv(data, output_path):
    """Save the parsed data to a CSV file."""
    # Define the exact order of columns
    fieldnames = [
        'member_id', 'name', 'age', 'club', 'gender', 'weight_class', 
        'entry_total', 'session_number', 'session_platform', 'meet', 'adaptive'
    ]
    
    # Write to CSV
    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
    
    print(f"Data saved to {output_path}")

def main():
    # File paths
    pdf_path = "ao1.pdf"
    output_path = "ao1.csv"
    
    # Check if PDF exists
    if not Path(pdf_path).exists():
        print(f"Error: Could not find PDF file: {pdf_path}")
        return
    
    # Extract text from PDF
    print(f"Extracting text from {pdf_path}...")
    try:
        text = extract_text_from_pdf(pdf_path)
    except Exception as e:
        print(f"Error reading PDF: {str(e)}")
        return
    
    # Save raw text for debugging
    with open("raw_text.txt", "w") as f:
        f.write(text)
    print("Raw text saved to raw_text.txt")
    
    # Parse the text
    print("Parsing text...")
    parsed_data = parse_start_list(text)
    
    if not parsed_data:
        print("Error: No entries were parsed from the PDF")
        return
    
    # Save the parsed data to CSV
    save_to_csv(parsed_data, output_path)
    
    print(f"Successfully processed {len(parsed_data)} entries from the PDF.")

if __name__ == "__main__":
    main()
