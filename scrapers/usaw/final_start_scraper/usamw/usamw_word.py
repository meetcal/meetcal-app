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

def parse_start_list(text):
    """Parse the extracted text to identify competitors and their information."""
    entries = []
    member_id_counter = 1066  # Start member IDs at 700
    
    lines = text.split('\n')
    
    # Skip header lines
    start_idx = 0
    for i, line in enumerate(lines):
        if 'NAME' in line and 'AGE' in line and 'WT' in line:
            start_idx = i + 1
            break
    
    i = start_idx
    while i < len(lines):
        line = lines[i].strip()
        
        # Skip empty lines
        if not line:
            i += 1
            continue
        
        # Skip header lines
        if 'NAME' in line and 'AGE' in line:
            i += 1
            continue
        
        # Skip the title/location lines
        if any(x in line for x in ['HOWARD COHEN', 'KENTUCKY EXPO', 'DEC 11-14', 'Preliminary Schedule']):
            i += 1
            continue
        
        # Try to parse as an athlete entry
        # Expected format: NAME AGE WT TOTAL TEAM EVENT
        # Example: Sara Contente W70 69 54 UNA HCAM
        # Example with multiline team: Karen King W70 77 72 Southside Deadlift HCAM
        #                                        Barbell
        
        parts = line.split()
        
        # Need at least name, age (like W70), weight, and total
        if len(parts) < 4:
            i += 1
            continue
        
        try:
            entry = {}
            
            # Find age pattern (W## or M##)
            age_pattern = re.compile(r'^([WM])(\d+)$')
            age_idx = None
            age_match = None
            
            for idx, part in enumerate(parts):
                match = age_pattern.match(part)
                if match:
                    age_idx = idx
                    age_match = match
                    break
            
            # If no age pattern found, skip this line
            if age_idx is None:
                i += 1
                continue
            
            # Extract gender and age
            gender_code = age_match.group(1)
            age = int(age_match.group(2))
            
            entry['gender'] = 'Male' if gender_code == 'M' else 'Female'
            entry['age'] = age
            
            # Name is everything before age
            name_parts = parts[:age_idx]
            entry['name'] = ' '.join(name_parts)
            
            # Check if (AD) appears anywhere in the parts (age, weight, total, or club columns)
            is_adaptive_ad = False
            ad_offset = 0
            
            # Check if (AD) is anywhere in the line parts
            if '(AD)' in parts:
                is_adaptive_ad = True
                # Check if it's right after the age (to adjust offset)
                if age_idx + 1 < len(parts) and parts[age_idx + 1] == '(AD)':
                    ad_offset = 1
            
            # Also check the next line for standalone (AD) - this catches cases where
            # (AD) is on its own line after the athlete entry
            if not is_adaptive_ad and i + 1 < len(lines):
                next_line = lines[i + 1].strip()
                if next_line == '(AD)':
                    is_adaptive_ad = True
            
            # After age (and possibly (AD)): WT TOTAL TEAM EVENT
            remaining_parts = parts[age_idx + 1 + ad_offset:]
            
            if len(remaining_parts) < 2:
                i += 1
                continue
            
            # Weight class is first after age
            weight_str = remaining_parts[0]
            
            # Try to parse weight class
            if weight_str.replace('+', '').isdigit():
                entry['weight_class'] = weight_str if not weight_str.endswith('kg') else weight_str
            else:
                # Weight might be malformed, skip
                i += 1
                continue
            
            # Check if next item is "Adap" (adaptive athlete with no total)
            if len(remaining_parts) > 1 and remaining_parts[1] == 'Adap':
                # This is an adaptive athlete with no total listed
                # Format: NAME AGE WT Adap TEAM EVENT
                entry['entry_total'] = 0
                entry['adaptive'] = 'TRUE'
                
                # Team starts after "Adap"
                team_parts = []
                for part in remaining_parts[2:]:
                    if 'HCAM' in part or part == 'Deadlift' or part == 'Americas':
                        break
                    team_parts.append(part)
                
                # Check next line for continuation of team name
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    next_parts = next_line.split()
                    # If next line doesn't start with a name pattern or age pattern, it's part of team
                    if next_parts and not any(re.match(r'^[WM]\d+$', p) for p in next_parts):
                        # Skip lines that are just "(AD)" marker
                        if next_line == '(AD)':
                            i += 1  # Skip this line
                        # Check if it's a team continuation
                        elif not any(x in next_line for x in ['HCAM', 'NAME', 'AGE']):
                            # If the line contains "Cup", take only the parts before "Cup" and "(AD)"
                            if 'Cup' in next_line:
                                for part in next_parts:
                                    if part == 'Cup' or part == '(AD)':
                                        break
                                    team_parts.append(part)
                                i += 1  # Skip next line since we consumed it
                            else:
                                # Line doesn't have Cup, add all parts
                                team_parts.extend(next_parts)
                                i += 1  # Skip next line since we consumed it
                
                entry['club'] = ' '.join(team_parts).strip()
            else:
                # Normal athlete with total (or (AD) adaptive athlete with total)
                # Set adaptive flag based on (AD) marker
                entry['adaptive'] = 'TRUE' if is_adaptive_ad else 'FALSE'
                
                # Total is next
                if len(remaining_parts) < 2:
                    i += 1
                    continue
                
                total_str = remaining_parts[1]
                if total_str.isdigit():
                    entry['entry_total'] = int(total_str)
                    # Team starts after total
                    team_start_idx = 2
                else:
                    # No valid total - athlete has no entry total listed
                    entry['entry_total'] = 0
                    # Team starts right after weight (at position 1)
                    team_start_idx = 1
                
                # Team and event are remaining
                team_parts = []
                for part in remaining_parts[team_start_idx:]:
                    if 'HCAM' in part or part == 'Deadlift' or part == 'Americas':
                        break
                    team_parts.append(part)
                
                # Check next line for continuation of team name
                if i + 1 < len(lines):
                    next_line = lines[i + 1].strip()
                    next_parts = next_line.split()
                    # If next line doesn't start with a name pattern or age pattern, it's part of team
                    if next_parts and not any(re.match(r'^[WM]\d+$', p) for p in next_parts):
                        # Skip lines that are just "(AD)" marker
                        if next_line == '(AD)':
                            i += 1  # Skip this line
                        # Check if it's a team continuation
                        elif not any(x in next_line for x in ['HCAM', 'NAME', 'AGE']):
                            # If the line contains "Cup", take only the parts before "Cup" and "(AD)"
                            if 'Cup' in next_line:
                                for part in next_parts:
                                    if part == 'Cup' or part == '(AD)':
                                        break
                                    team_parts.append(part)
                                i += 1  # Skip next line since we consumed it
                            else:
                                # Line doesn't have Cup, add all parts
                                team_parts.extend(next_parts)
                                i += 1  # Skip next line since we consumed it
                
                entry['club'] = ' '.join(team_parts).strip()
            
            if not entry['club']:
                entry['club'] = 'Unaffiliated'
            
            # Assign member ID
            entry['member_id'] = member_id_counter
            member_id_counter += 1
            
            # Set session info as null/empty
            entry['session_number'] = ''
            entry['session_platform'] = ''
            
            # Set meet name
            entry['meet'] = '2025 Howard Cohen American Masters Championships'
            
            entries.append(entry)
            
        except Exception as e:
            # Skip problematic lines
            pass
        
        i += 1
    
    print(f"\nTotal entries parsed: {len(entries)}")
    
    # Remove duplicates based on name, age, weight_class, and entry_total
    # Keep only the first occurrence of each unique combination
    seen = set()
    unique_entries = []
    duplicates_removed = 0
    
    for entry in entries:
        # Create a tuple of the key fields
        key = (entry['name'], entry['age'], entry['weight_class'], entry['entry_total'])
        if key not in seen:
            seen.add(key)
            unique_entries.append(entry)
        else:
            duplicates_removed += 1
    
    print(f"Duplicates removed: {duplicates_removed}")
    print(f"Unique entries: {len(unique_entries)}")
    
    return unique_entries

def save_to_csv(data, output_path):
    """Save the parsed data to a CSV file."""
    # Define the exact order of columns
    fieldnames = [
        'member_id', 'name', 'age', 'club', 'gender', 'weight_class', 
        'entry_total', 'session_number', 'session_platform', 'meet', 'adaptive'
    ]
    
    # Replace "UNA" with "Unaffiliated" in all entries
    for entry in data:
        if entry.get('club') == 'UNA':
            entry['club'] = 'Unaffiliated'
    
    # Write to CSV
    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
    
    print(f"Data saved to {output_path}")

def main():
    # File paths
    pdf_path = "usamw/hc-25.pdf"
    output_path = "usamw/hc-25.csv"
    
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

