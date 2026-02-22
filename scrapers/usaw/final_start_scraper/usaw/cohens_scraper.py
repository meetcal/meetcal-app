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

def find_next_category(lines, start_index):
    """Look ahead to find the next category marker."""
    for i in range(start_index, min(start_index + 20, len(lines))):
        line = lines[i].strip()
        
        # Look for category patterns
        cat_match = re.search(r'\b([MW]\d{2})\b', line)
        if cat_match:
            return cat_match.group(1)
    
    return None

def parse_start_list(text):
    """Parse the Howard Cohen American Masters start list format."""
    entries = []
    lines = text.split('\n')
    
    current_session = None
    current_platform = None
    current_category = None
    current_weight_class = None
    
    i = 0
    while i < len(lines):
        line = lines[i].strip()
        
        # Skip empty lines and headers
        if not line or "Start List" in line or "Sess Pfm Date Group Cat Age Name Total Team" in line or "Page" in line:
            i += 1
            continue
        
        # Skip date/time/navigation lines or strip them if they're prefixes
        if line in ['Thu', 'Fri', 'Sat', 'Sun'] or re.match(r'^Dec \d{1,2}$', line):
            i += 1
            continue
        if line == 'Start' or 'DEADLIFT' in line:
            i += 1
            continue
        if re.match(r'^\d{1,2}:\d{2}\s+[AP]M$', line):
            i += 1
            continue
        
        # Strip "Weigh In" prefix if present
        if line.startswith('Weigh In '):
            line = line[9:].strip()
        
        # Strip "Start" prefix if present
        if line.startswith('Start '):
            line = line[6:].strip()
        
        # Strip time prefix if present (e.g., "9:00 AM ")
        time_prefix_match = re.match(r'^\d{1,2}:\d{2}\s+[AP]M\s+(.+)$', line)
        if time_prefix_match:
            line = time_prefix_match.group(1).strip()
        
        # Parse session and platform line (standalone)
        session_platform_match = re.match(r'^(\d+)\s+([A-Z])$', line)
        if session_platform_match:
            current_session = session_platform_match.group(1)
            current_platform = session_platform_match.group(2)
            i += 1
            continue
        
        # Pattern: "3 A M70 88" - session, platform, category, weight class
        sess_plat_cat_weight_match = re.match(r'^(\d+)\s+([A-Z])\s+([MW]\d{2})\s+(\d{2,3}|\d{2,3}\+)$', line)
        if sess_plat_cat_weight_match:
            current_session = sess_plat_cat_weight_match.group(1)
            current_platform = sess_plat_cat_weight_match.group(2)
            current_category = sess_plat_cat_weight_match.group(3)
            current_weight_class = sess_plat_cat_weight_match.group(4)
            i += 1
            continue
        
        # Pattern: "Thu W70 71 KING Karen 72 Southside Barbell Club DL"
        date_cat_weight_competitor_match = re.match(r'^(Thu|Fri|Sat|Sun)\s+([MW]\d{2})\s+(\d{2,3}|\d{2,3}\+)\s+(\d{2})\s+([A-Z\-\']+)\s+([A-Za-z\-\']+)\s+(\d{1,3})\s+(.+)$', line)
        if date_cat_weight_competitor_match:
            current_category = date_cat_weight_competitor_match.group(2)
            current_weight_class = date_cat_weight_competitor_match.group(3)
            age = date_cat_weight_competitor_match.group(4)
            last_name = date_cat_weight_competitor_match.group(5)
            first_name = date_cat_weight_competitor_match.group(6)
            total = date_cat_weight_competitor_match.group(7)
            team = date_cat_weight_competitor_match.group(8).strip()
            
            team = re.sub(r'\s+DL$', '', team)
            if team.lower() == 'unattached':
                team = 'Unaffiliated'
            
            gender = 'Female' if current_category.startswith('W') else 'Male'
            
            entry = {
                'name': f"{first_name} {last_name}",
                'age': age,
                'club': team,
                'gender': gender,
                'weight_class': current_weight_class,
                'entry_total': total,
                'session_number': current_session if current_session else '',
                'session_platform': current_platform if current_platform else '',
                'meet': "2025 Howard Cohen American Masters",
                'adaptive': 'false',
                'member_id': ''
            }
            entries.append(entry)
            i += 1
            continue
        
        # Pattern: "M85 71 87 SOUTHERLAN Robert 70 Fort Nash DL"
        cat_weight_competitor_match = re.match(r'^([MW]\d{2})\s+(\d{2,3}|\d{2,3}\+)\s+(\d{2})\s+([A-Z\-\']+)\s+([A-Za-z\-\']+)\s+(\d{1,3})\s+(.+)$', line)
        if cat_weight_competitor_match:
            current_category = cat_weight_competitor_match.group(1)
            current_weight_class = cat_weight_competitor_match.group(2)
            age = cat_weight_competitor_match.group(3)
            last_name = cat_weight_competitor_match.group(4)
            first_name = cat_weight_competitor_match.group(5)
            total = cat_weight_competitor_match.group(6)
            team = cat_weight_competitor_match.group(7).strip()
            
            team = re.sub(r'\s+DL$', '', team)
            if team.lower() == 'unattached':
                team = 'Unaffiliated'
            
            gender = 'Female' if current_category.startswith('W') else 'Male'
            
            entry = {
                'name': f"{first_name} {last_name}",
                'age': age,
                'club': team,
                'gender': gender,
                'weight_class': current_weight_class,
                'entry_total': total,
                'session_number': current_session if current_session else '',
                'session_platform': current_platform if current_platform else '',
                'meet': "2025 Howard Cohen American Masters",
                'adaptive': 'false',
                'member_id': ''
            }
            entries.append(entry)
            i += 1
            continue
        
        # Pattern: "69 73 CONTENTE Sara 54 Unattached"
        # Weight class + age + name + total + team
        # This is tricky - need to look ahead for category if not set
        weight_competitor_match = re.match(r'^(\d{2,3}|\d{2,3}\+)\s+(\d{2})\s+([A-Z\-\']+)\s+([A-Za-z\-\']+)\s+(\d{1,3})\s+(.+)$', line)
        if weight_competitor_match:
            temp_weight_class = weight_competitor_match.group(1)
            age = weight_competitor_match.group(2)
            last_name = weight_competitor_match.group(3)
            first_name = weight_competitor_match.group(4)
            total = weight_competitor_match.group(5)
            team = weight_competitor_match.group(6).strip()
            
            team = re.sub(r'\s+DL$', '', team)
            if team.lower() == 'unattached':
                team = 'Unaffiliated'
            
            # Look ahead for category if current one doesn't seem right
            # Check if the current category makes sense with the first name
            female_names = ['Sara', 'Karen', 'Mary', 'Renee', 'Luanne', 'Lynn', 'Monica', 'Heather', 'Jaime', 'Dolores', 
                          'Lisa', 'Amy', 'Laura', 'Corinne', 'Sheryl', 'Kathleen', 'Eleanor', 'Maria', 'Michelle',
                          'Terri', 'Katrina', 'Ramona', 'Susan', 'Patti', 'Jennifer', 'Pam', 'Deborah', 'Elizabeth',
                          'Melany', 'Ananda', 'Denise', 'Jenny', 'Moira', 'Anjanette', 'Katherine', 'Lori', 'Shelley',
                          'Kari', 'Abigail', 'Pamela', 'Heather', 'Michelle', 'Delores', 'Angie', 'Kristina', 'Yulia',
                          'Lauren', 'Jamie', 'Melissa', 'Erin', 'Jane', 'Shawna', 'Jessica', 'Alecia', 'Shana', 'Emily',
                          'Nicole', 'Valerie', 'Heidi', 'Megan', 'Beatrice', 'Allison', 'Kathryn', 'Jaquelin', 'Stormy',
                          'Tereka', 'Alicia', 'Karen', 'Amy', 'Natalie', 'Brandy', 'Marjorie', 'Sian', 'Holly', 'Cinthia',
                          'Meagan', 'Jacqueline', 'Whitney', 'Samantha', 'Brandie', 'Megan', 'Erica', 'Emma', 'Nadine',
                          'Brightside', 'Minnie', 'Ashley', 'Atinna', 'Lindsay', 'Amber', 'Alexandra', 'Carolina',
                          'Hanh', 'Lizeth', 'Audrey', 'Cadie', 'Norelle', 'Amanda', 'Alexandria', 'Carissa', 'LJ']
            
            is_female = first_name in female_names
            
            # If name suggests female but category is M, look ahead
            if is_female and (not current_category or current_category.startswith('M')):
                next_cat = find_next_category(lines, i + 1)
                if next_cat and next_cat.startswith('W'):
                    current_category = next_cat
                    current_weight_class = temp_weight_class
            # If name suggests male but category is W, look ahead
            elif not is_female and current_category and current_category.startswith('W'):
                next_cat = find_next_category(lines, i + 1)
                if next_cat and next_cat.startswith('M'):
                    current_category = next_cat
                    current_weight_class = temp_weight_class
            else:
                current_weight_class = temp_weight_class
            
            if not current_category:
                i += 1
                continue
            
            gender = 'Female' if current_category.startswith('W') else 'Male'
            
            entry = {
                'name': f"{first_name} {last_name}",
                'age': age,
                'club': team,
                'gender': gender,
                'weight_class': current_weight_class,
                'entry_total': total,
                'session_number': current_session if current_session else '',
                'session_platform': current_platform if current_platform else '',
                'meet': "2025 Howard Cohen American Masters",
                'adaptive': 'false',
                'member_id': ''
            }
            entries.append(entry)
            i += 1
            continue
        
        # Pattern: regular competitor line "Age LastName FirstName Total Team"
        competitor_match = re.match(r'^(\d{2})\s+([A-Z\-\']+)\s+([A-Za-z\-\']+)\s+(\d{1,3})\s+(.+)$', line)
        if competitor_match:
            age = competitor_match.group(1)
            last_name = competitor_match.group(2)
            first_name = competitor_match.group(3)
            total = competitor_match.group(4)
            team = competitor_match.group(5).strip()
            
            team = re.sub(r'\s+DL$', '', team)
            if team.lower() == 'unattached':
                team = 'Unaffiliated'
            
            if not current_category or not current_weight_class:
                i += 1
                continue
            
            gender = 'Female' if current_category.startswith('W') else 'Male'
            
            entry = {
                'name': f"{first_name} {last_name}",
                'age': age,
                'club': team,
                'gender': gender,
                'weight_class': current_weight_class,
                'entry_total': total,
                'session_number': current_session if current_session else '',
                'session_platform': current_platform if current_platform else '',
                'meet': "2025 Howard Cohen American Masters",
                'adaptive': 'false',
                'member_id': ''
            }
            entries.append(entry)
            i += 1
            continue
        
        # Check if line is just a weight class
        if re.match(r'^(\d{2,3}|\d{2,3}\+)$', line):
            current_weight_class = line
            i += 1
            continue
        
        # Check if line is just a category
        if re.match(r'^([MW]\d{2})$', line):
            current_category = line
            i += 1
            continue
        
        # Check if line has just category and weight class: "M70 88"
        cat_weight_match = re.match(r'^([MW]\d{2})\s+(\d{2,3}|\d{2,3}\+)$', line)
        if cat_weight_match:
            current_category = cat_weight_match.group(1)
            current_weight_class = cat_weight_match.group(2)
            i += 1
            continue
        
        i += 1
    
    return entries

def save_to_csv(data, output_path):
    """Save the parsed data to a CSV file."""
    # Define platform order
    platform_order = {
        'A': 1,
        'B': 2,
        'C': 3,
        'D': 4,
        'E': 5,
        'F': 6
    }
    
    # Convert numeric fields to integers
    for entry in data:
        if entry.get('entry_total') and str(entry['entry_total']).isdigit():
            entry['entry_total'] = int(entry['entry_total'])
        if entry.get('age') and str(entry['age']).isdigit():
            entry['age'] = int(entry['age'])
        if entry.get('session_number') and str(entry['session_number']).isdigit():
            entry['session_number'] = int(entry['session_number'])
    
    # Sort data by session number and platform
    data.sort(key=lambda x: (
        x.get('session_number', 0) if isinstance(x.get('session_number'), int) else 0,
        platform_order.get(x.get('session_platform', ''), 999)
    ))
    
    # Define the exact order of columns
    fieldnames = ['member_id', 'name', 'age', 'club', 'gender', 'weight_class', 'entry_total', 'session_number', 'session_platform', 'meet', 'adaptive']
    
    # Write to CSV with specified column order
    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(data)
    
    print(f"Data saved to {output_path}")

def main():
    # File paths
    pdf_path = "cohens.pdf"
    output_path = "start_list_data.csv"

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

    # Save the parsed data to CSV
    save_to_csv(parsed_data, output_path)

    print(f"Successfully processed {len(parsed_data)} entries from the PDF.")

if __name__ == "__main__":
    main()
