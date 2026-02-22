import pdfplumber
import random
import csv
import re

def extract_text_from_pdf(pdf_path):
    """Extract all text from a PDF file using pdfplumber."""
    all_text = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                all_text.append(text)
    
    return '\n'.join(all_text)

def parse_name(name):
    """Convert 'last first' to 'First Last' format."""
    parts = name.strip().split()
    if len(parts) >= 2:
        last = parts[0]
        first = ' '.join(parts[1:])
        return f"{first.title()} {last.title()}"
    return name.title()

def parse_start_list(text):
    """Parse the extracted text to identify competitors and their information."""
    entries = []
    used_member_ids = set()
    
    # Split text into lines for processing
    lines = text.split('\n')
    
    for line in lines:
        line = line.strip()
        if not line:
            continue
            
        try:
            # Use regex to parse the fixed-format line
            # Format: [M/W]## weight_class age NAME entry_total Club Name
            # Name can contain multiple parts, capture everything until we hit the entry total number
            match = re.match(r'^([MW]\d+)\s+(\d+\+?)\s+(\d+)\s+([A-Za-z\s]+?)\s+(\d+)\s+(.+)$', line)
            if not match:
                continue
                
            category, weight, age, full_name, total, club = match.groups()
            
            # Generate unique member ID
            while True:
                member_id = random.randint(2000, 3000)
                if member_id not in used_member_ids:
                    used_member_ids.add(member_id)
                    break
            
            # Parse gender from category
            gender = 'Female' if category.startswith('W') else 'Male'
            
            # Create weight class
            weight_class = weight + 'kg'
            
            # Parse the full name - it's in LAST FIRST MIDDLE format
            name_parts = full_name.strip().split()
            if len(name_parts) >= 2:
                last = name_parts[0]
                first_middle = ' '.join(name_parts[1:])
                name = f"{first_middle.title()} {last.title()}"
            else:
                name = full_name.title()
            
            # Create entry dictionary
            entry = {
                'member_id': member_id,
                'name': name,
                'age': int(age),
                'club': club.strip(),  # Club name is everything remaining
                'gender': gender,
                'weight_class': weight_class,
                'entry_total': int(total),
                'session_number': '',  # Empty as specified
                'session_platform': '',  # Empty as specified
                'meet': "USAMW Master's Nationals"  # Constant meet name
            }
            
            entries.append(entry)
            
        except (IndexError, ValueError, AttributeError) as e:
            print(f"Error parsing line: {line}")
            print(f"Error details: {str(e)}")
            continue
    
    return entries

def save_to_csv(data, output_path):
    """Save the parsed data to a CSV file."""
    # Define the exact order of columns
    fieldnames = ['member_id', 'name', 'age', 'club', 'gender', 'weight_class', 
                 'entry_total', 'session_number', 'session_platform', 'meet']
    
    def weight_class_to_number(weight_class):
        """Convert weight class string to numeric value for sorting."""
        # Remove 'kg' and convert to base number
        base = weight_class.rstrip('kg')
        # If it ends with '+', add 0.5 to make it sort after the base number
        if base.endswith('+'):
            return float(base.rstrip('+')) + 0.5
        return float(base)
    
    # Sort the data:
    # 1. Female first, then Male
    # 2. Age descending
    # 3. Weight class ascending (handling '+' classes)
    sorted_data = sorted(data, 
                        key=lambda x: (
                            x['gender'] != 'Female',  # False sorts before True, putting Female first
                            -x['age'],  # Negative for descending order
                            weight_class_to_number(x['weight_class'])  # Convert to numeric value for proper sorting
                        ))
    
    # Write to CSV with specified column order
    with open(output_path, 'w', newline='') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(sorted_data)
    
    print(f"Data saved to {output_path}")

def main():
    # File paths
    pdf_path = "../usaw/cohens.pdf"
    output_path = "cohens.csv"
    
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
