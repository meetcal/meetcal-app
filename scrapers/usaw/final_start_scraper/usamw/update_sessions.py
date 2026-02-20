import csv
from pathlib import Path

def parse_weight_class_range(weight_class_str):
    """
    Parse weight class range from schedule format.
    Examples: 'M80 All', 'W50 48-58', 'W40 86+', 'M35 94-110+'
    Returns list of (gender, age, weight_min, weight_max, is_plus)
    """
    parts = weight_class_str.split(' & ')
    ranges = []
    
    for part in parts:
        tokens = part.strip().split()
        
        # First token should be age group (e.g., 'M80', 'W50')
        age_token = tokens[0]
        gender_code = age_token[0]  # M or W
        age = int(age_token[1:])
        
        # Second token is weight range or 'All'
        if len(tokens) > 1:
            weight_info = tokens[1]
        else:
            weight_info = 'All'
        
        if weight_info == 'All':
            # All weight classes
            ranges.append((gender_code, age, 0, 9999, False))
        elif '-' in weight_info:
            # Range like '48-58' or '94-110+'
            if weight_info.endswith('+'):
                weight_parts = weight_info[:-1].split('-')
                weight_min = int(weight_parts[0])
                weight_max = int(weight_parts[1])
                # This session includes the + class
                ranges.append((gender_code, age, weight_min, 9999, True))
            else:
                weight_parts = weight_info.split('-')
                weight_min = int(weight_parts[0])
                weight_max = int(weight_parts[1])
                ranges.append((gender_code, age, weight_min, weight_max, False))
        elif weight_info.endswith('+'):
            # Just '86+' or similar
            weight_min = int(weight_info[:-1])
            ranges.append((gender_code, age, weight_min, 9999, True))
        else:
            # Single weight
            try:
                weight = int(weight_info)
                ranges.append((gender_code, age, weight, weight, False))
            except:
                # If we can't parse it, default to All
                ranges.append((gender_code, age, 0, 9999, False))
    
    return ranges

def load_schedule(schedule_file):
    """Load schedule and create session mapping."""
    session_map = []
    
    with open(schedule_file, 'r') as f:
        reader = csv.DictReader(f)
        for row in reader:
            session_id = int(row['session_id'])
            platform = row['platform']
            weight_class_desc = row['weight_class']
            
            # Parse the weight class description
            ranges = parse_weight_class_range(weight_class_desc)
            
            for gender_code, age, weight_min, weight_max, is_plus in ranges:
                session_map.append({
                    'session_id': session_id,
                    'platform': platform,
                    'gender_code': gender_code,
                    'age': age,
                    'weight_min': weight_min,
                    'weight_max': weight_max,
                    'is_plus': is_plus
                })
    
    return session_map

def extract_weight_value(weight_class_str):
    """Extract numeric weight from weight class string like '69kg' or '86+'."""
    # Remove 'kg' if present
    weight_str = weight_class_str.replace('kg', '').strip()
    
    # Check if it's a plus class
    is_plus = weight_str.endswith('+')
    if is_plus:
        weight_str = weight_str[:-1]
    
    try:
        weight = int(weight_str)
        return weight, is_plus
    except:
        return None, False

def find_session(athlete, session_map):
    """Find the session for an athlete based on age, gender, and weight."""
    gender_code = 'M' if athlete['gender'] == 'Male' else 'W'
    age = int(athlete['age'])
    weight, is_plus = extract_weight_value(athlete['weight_class'])
    
    if weight is None:
        return None, None
    
    # Find matching session
    for session in session_map:
        # Check gender code match
        if session['gender_code'] != gender_code:
            continue
        
        # Check if age matches exactly
        if session['age'] != age:
            continue
        
        # Check if this is an "All" session (weight_max = 9999 and weight_min = 0)
        if session['weight_min'] == 0 and session['weight_max'] == 9999:
            # This session accepts all weight classes for this age/gender
            return session['session_id'], session['platform']
        
        # Check weight range for specific weight classes
        if is_plus:
            # Athlete is in a + class
            # Match if session covers + classes starting at or below this weight
            if weight >= session['weight_min'] and session['weight_max'] == 9999:
                return session['session_id'], session['platform']
        else:
            # Athlete is in a regular weight class
            if session['weight_min'] <= weight <= session['weight_max']:
                return session['session_id'], session['platform']
    
    return None, None

def update_csv_with_sessions(input_csv, schedule_file, output_csv):
    """Update CSV with session numbers and platforms."""
    
    # Load schedule
    print("Loading schedule...")
    session_map = load_schedule(schedule_file)
    print(f"Loaded {len(session_map)} session mappings")
    
    # Read input CSV
    print(f"\nReading {input_csv}...")
    athletes = []
    with open(input_csv, 'r') as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for row in reader:
            athletes.append(row)
    
    print(f"Processing {len(athletes)} athletes...")
    
    # Update each athlete with session info
    updated_count = 0
    not_found = []
    
    for athlete in athletes:
        session_id, platform = find_session(athlete, session_map)
        
        if session_id:
            athlete['session_number'] = session_id
            athlete['session_platform'] = platform
            updated_count += 1
        else:
            not_found.append(f"{athlete['name']} ({athlete['age']}, {athlete['gender']}, {athlete['weight_class']})")
    
    # Sort athletes by session number
    print(f"\nSorting by session number...")
    athletes.sort(key=lambda x: int(x['session_number']) if x['session_number'] else 9999)
    
    # Write output CSV
    print(f"Writing to {output_csv}...")
    with open(output_csv, 'w', newline='') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(athletes)
    
    print(f"\n✓ Updated {updated_count} athletes with session information")
    
    if not_found:
        print(f"\n⚠ Could not find sessions for {len(not_found)} athletes:")
        for athlete in not_found[:10]:
            print(f"  - {athlete}")
        if len(not_found) > 10:
            print(f"  ... and {len(not_found) - 10} more")
    
    print(f"\n✓ Output saved to {output_csv}")

def main():
    # File paths
    input_csv = "hc-25.csv"
    schedule_file = "hc-schedule.txt"
    output_csv = "hc-25-with-sessions.csv"
    
    # Check files exist
    if not Path(input_csv).exists():
        print(f"Error: {input_csv} not found")
        return
    
    if not Path(schedule_file).exists():
        print(f"Error: {schedule_file} not found")
        return
    
    # Update CSV
    update_csv_with_sessions(input_csv, schedule_file, output_csv)

if __name__ == "__main__":
    main()

