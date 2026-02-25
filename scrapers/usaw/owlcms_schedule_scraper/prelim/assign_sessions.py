"""
Session Assignment Script - Assigns athletes to sessions based on schedule

SETUP:
  python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt

USAGE:
  source venv/bin/activate && python assign_sessions.py --start-list ao1-athletes.csv --schedule full_output.csv --output assigned_athletes.csv
"""

import csv
import argparse
import re
from typing import List, Dict, Optional, Tuple


MEET_NAME = "2026 VIRUS Weightlifting Series 1"


def parse_age_group(age_group_str: str) -> Tuple[Optional[str], Optional[int], Optional[int]]:
    """
    Parse age group string to extract gender prefix and age range
    
    Examples:
        "W60 48kg - 86+kg" -> ('W', 60, 64)
        "M45 71kg - 79kg" -> ('M', 45, 49)
        "W30 - W35 58kg A" -> ('W', 30, 39)
        "M70 - M80 65kg - 110kg" -> ('M', 70, 84)
        "W65 - W75 48kg - 86+kg" -> ('W', 65, 79) [covers W65, W70, W75]
        "W65, W70, W75 48kg - 86+kg" -> ('W', 65, 79) [covers W65, W70, W75]
    
    Returns:
        Tuple of (gender_prefix, min_age, max_age)
    """
    if not age_group_str:
        return None, None, None
    
    # Extract gender prefix (W or M)
    gender_match = re.search(r'^([WM])', age_group_str)
    if not gender_match:
        return None, None, None
    
    gender = gender_match.group(1)
    
    # Look for age patterns
    # Pattern 1: Comma-separated age groups like "W65, W70, W75" or "M70, M75, M80"
    comma_match = re.findall(r'[WM](\d+)(?:,|(?=\s+\d+kg))', age_group_str)
    if len(comma_match) >= 2:
        # Multiple age groups separated by commas
        ages = [int(a) for a in comma_match]
        min_age = min(ages)
        max_age = max(ages) + 4  # Last age group includes +4 years
        return gender, min_age, max_age
    
    # Pattern 2: W30 - W35 or M65 - M75 (explicit range covering multiple 5-year groups)
    range_match = re.search(r'^[WM](\d+)\s*-\s*[WM](\d+)', age_group_str)
    if range_match:
        min_age = int(range_match.group(1))
        max_age_start = int(range_match.group(2))
        # W65 - W75 means 65-79 (includes W65:65-69, W70:70-74, W75:75-79)
        max_age = max_age_start + 4
        return gender, min_age, max_age
    
    # Pattern 3: W60 or M45 (single age group, represents 5-year range)
    single_age = re.search(r'^[WM](\d+)\s', age_group_str)
    if single_age:
        age = int(single_age.group(1))
        # Age groups are in 5-year ranges: 30-34, 35-39, 40-44, 45-49, etc.
        min_age = age
        max_age = age + 4
        return gender, min_age, max_age
    
    return None, None, None


def parse_weight_range(weight_str: str) -> Tuple[Optional[float], Optional[float]]:
    """
    Parse weight class string to extract min and max weights
    
    Examples:
        "69kg" -> (69.0, 69.0)
        "86+" or "86+kg" -> (86.0, 999.0)
        "69kg - 77kg" -> (69.0, 77.0)
        "48kg - 86+kg" -> (48.0, 999.0)
        "44kg & 48kg A" -> (44.0, 48.0)
        "48kg - 53kg" -> (48.0, 53.0)
        "W45 77kg" -> (77.0, 77.0) [ignore age group W45]
    
    Returns:
        Tuple of (min_weight, max_weight)
    """
    if not weight_str:
        return None, None
    
    # Remove age group prefix to avoid extracting age numbers as weights
    # Remove patterns like "W45 ", "M60 ", "W30 - W35 " etc.
    cleaned_str = re.sub(r'^[WM]\d+(\s*-\s*[WM]\d+)?\s+', '', weight_str)
    
    # Extract all weight numbers from the cleaned string
    # Look for patterns like "77kg", "86+", "48kg & 53kg", "60kg - 71kg"
    all_weights = re.findall(r'(\d+)(\+)?(?:kg)?', cleaned_str)
    if not all_weights:
        return None, None
    
    # Convert to floats and track if any have plus
    weights = []
    has_plus = False
    for weight, plus in all_weights:
        w = float(weight)
        # Filter out unrealistic weight classes (age numbers that slipped through)
        # Valid weight classes are typically between 30 and 200 (kg)
        if 30 <= w <= 200:
            weights.append(w)
            if plus:
                has_plus = True
    
    if not weights:
        return None, None
    
    # Get min and max
    min_weight = min(weights)
    max_weight = max(weights)
    
    # If there's a plus sign, max is unlimited
    if has_plus:
        max_weight = 999.0
    
    return min_weight, max_weight


def parse_entry_total_range(total_str: str) -> Tuple[Optional[int], Optional[int]]:
    """
    Parse entry total range string
    
    Examples:
        "74-118" -> (74, 118)
        "90 - 122" -> (90, 122)
        "0-115" -> (0, 115)
    
    Returns:
        Tuple of (min_total, max_total)
    """
    if not total_str:
        return None, None
    
    range_match = re.search(r'(\d+)\s*-\s*(\d+)', total_str)
    if range_match:
        return int(range_match.group(1)), int(range_match.group(2))
    
    return None, None


def athlete_weight_matches(athlete_weight: str, session_weight_range: str, session_gender: Optional[str] = None) -> bool:
    """
    Check if athlete's weight class matches session weight range.
    
    Weight classes with '+' (e.g., 69+, 86+) are specific categories, not "anything above".
    Sessions can list multiple weight classes like "77kg & 69+kg" or ranges like "48kg - 53kg".
    """
    if not athlete_weight or not session_weight_range:
        return False
    
    def normalize_weight_token(weight_token: str) -> str:
        """
        Normalize weight tokens to a canonical form:
        - "110", "110kg" -> "110"
        - "+110", "110+", "+110kg", "110+kg" -> "110+"
        """
        token = str(weight_token or '').strip().lower().replace('kg', '').strip()
        if not token:
            return ''
        number_match = re.search(r'(\d+)', token)
        if not number_match:
            return ''
        number = number_match.group(1)
        has_plus = '+' in token
        return f"{number}+" if has_plus else number
    
    # Normalize athlete weight class (e.g., "+110" and "110+" both -> "110+")
    athlete_weight_clean = normalize_weight_token(athlete_weight)
    if not athlete_weight_clean:
        return False
    
    # Remove age group prefix from session to get just the weight part
    # Handles: "W45 77kg", "M65 88kg - 110+kg", "M70, M75, M80 65kg - 110kg"
    session_weights_only = re.sub(r'^[WM]\d+(\s*-\s*[WM]\d+)?\s+', '', session_weight_range)
    session_weights_only = re.sub(r'^([WM]\d+,\s*)+', '', session_weights_only)
    # Normalize en dash to standard hyphen for range detection
    session_weights_only = session_weights_only.replace('–', '-')
    
    # Extract all weight classes from the session (handles "77kg & 69+kg" or "48kg - 53kg")
    # Look for patterns like "69+", "77kg", "86+kg"
    weight_classes_in_session = re.findall(r'(\d+\+?)(?:kg)?', session_weights_only)
    weight_classes_in_session = [normalize_weight_token(w) for w in weight_classes_in_session]
    weight_classes_in_session = [w for w in weight_classes_in_session if w]
    
    if not weight_classes_in_session:
        return False
    
    # Check if athlete's exact weight class is in the session's list
    for session_wc in weight_classes_in_session:
        session_wc_clean = normalize_weight_token(session_wc)
        
        # Exact match (e.g., "86" matches "86", "86+" matches "86+")
        if athlete_weight_clean == session_wc_clean:
            return True
        
    # If no exact match, check if it's a range like "48kg - 53kg" or "48kg - 86+kg"
    # Ranges like "48kg - 86+kg" mean: 48-86 (numeric range) + 86+ (explicit plus class)
    if '&' not in session_weights_only and '-' in session_weights_only:
        # This is a range, not multiple specific classes
        try:
            athlete_num = float(re.search(r'(\d+)', athlete_weight_clean).group(1))
            athlete_has_plus = '+' in athlete_weight_clean
            
            # Extract all numbers from the range
            numbers = []
            for w in weight_classes_in_session:
                numbers.append(float(w.replace('+', '')))
            
            if len(numbers) >= 2:
                min_w = min(numbers)
                max_w = max(numbers)
                
                # Custom discrete classes for youth ranges per meet rules
                # Men 32-52 => 32, 36, 40, 44, 48, 52
                # Women 30-36 => 30, 33, 36
                if not athlete_has_plus:
                    if session_gender == 'M' and int(min_w) == 32 and int(max_w) == 52:
                        return int(athlete_num) in {32, 36, 40, 44, 48, 52}
                    if session_gender == 'F' and int(min_w) == 30 and int(max_w) == 36:
                        return int(athlete_num) in {30, 33, 36}
                
                # For non-plus athletes, check if weight is in the numeric range
                if not athlete_has_plus:
                    return min_w <= athlete_num <= max_w
                
                # For plus athletes, they only match if their base weight equals one of the range endpoints
                # AND that endpoint has a plus (e.g., "86+" matches "48kg - 86+kg" but not "48kg - 86kg")
                if athlete_has_plus:
                    # Check if any weight class in the range matches the athlete's plus class
                    for w in weight_classes_in_session:
                        if w == str(int(athlete_num)) + '+':
                            return True
                    return False
        except:
            pass
    
    return False


def find_matching_session(athlete: Dict, schedule: List[Dict]) -> Optional[Dict]:
    """
    Find the best matching session for an athlete
    
    Args:
        athlete: Dictionary with athlete data
        schedule: List of session dictionaries
        
    Returns:
        Matching session dictionary or None
    """
    athlete_meet = athlete.get('meet', '').upper()
    athlete_gender = athlete.get('gender', '')
    athlete_age = int(athlete.get('age', 0)) if athlete.get('age') else None
    athlete_weight = athlete.get('weight_class', '')
    athlete_total = int(athlete.get('entry_total', 0)) if athlete.get('entry_total') else None
    
    if not athlete_age:
        return None
    
    # Handle zero or missing totals - still try to match
    if not athlete_total or athlete_total == 0:
        athlete_total = 0
    
    # Determine event type from athlete meet name
    # "FINALS + UMWF" should be treated as UMWF
    is_umwf = 'UMWF' in athlete_meet
    is_finals = 'FINALS' in athlete_meet
    
    # Convert gender to M/F
    gender_code = 'M' if athlete_gender == 'Male' else 'F'
    
    # Filter sessions by meet type
    candidate_sessions = []
    weight_matched_sessions = []
    
    for session in schedule:
        session_meet = session.get('meet', '').upper()
        
        # Match meet type/name
        if is_umwf:
            if 'UMWF' not in session_meet:
                continue
        elif is_finals:
            if 'FINALS' not in session_meet or 'UMWF' in session_meet:
                continue
        else:
            # Standard non-finals/non-UMWF meets: match exact meet name
            if athlete_meet and session_meet and athlete_meet != session_meet:
                continue
        
        # Match gender
        session_gender = session.get('gender', '')
        if session_gender and session_gender != gender_code:
            continue
        
        # For UMWF, check age group
        if is_umwf:
            age_group_str = session.get('age_group_weight_category', '')
            session_gender_prefix, min_age, max_age = parse_age_group(age_group_str)
            
            # Check if age matches
            if min_age is not None and max_age is not None:
                if not (min_age <= athlete_age <= max_age):
                    continue
            
            # Check if gender prefix matches (W=F, M=M)
            if session_gender_prefix:
                # Normalize: W (Women) -> F (Female), M (Men) -> M (Male)
                session_gender_normalized = 'F' if session_gender_prefix == 'W' else 'M'
                if session_gender_normalized != gender_code:
                    continue
        
        # Check weight class
        weight_category = session.get('age_group_weight_category', '') or session.get('weight_category', '')
        if not athlete_weight_matches(athlete_weight, weight_category, session_gender):
            continue
        
        # Keep all sessions that pass meet/gender/age/weight filters
        weight_matched_sessions.append(session)
        
        # Check entry total range - must be within the stated range
        total_range_str = session.get('estimated_entry_totals_(min___max)', '')
        min_total, max_total = parse_entry_total_range(total_range_str)
        
        if min_total is not None and max_total is not None and athlete_total > 0:
            # Athlete total must be within the stated range
            if not (min_total <= athlete_total <= max_total):
                continue
        
        # This session is a candidate
        candidate_sessions.append(session)
    
    # If we have candidates, return the best match
    # Prioritize by how well the entry total fits
    if candidate_sessions:
        if athlete_total > 0:
            # Score each session by how close the total is to the middle of the range
            best_session = None
            best_score = float('inf')
            
            for session in candidate_sessions:
                total_range_str = session.get('estimated_entry_totals_(min___max)', '')
                min_total, max_total = parse_entry_total_range(total_range_str)
                
                if min_total and max_total:
                    mid_range = (min_total + max_total) / 2
                    score = abs(athlete_total - mid_range)
                    if score < best_score:
                        best_score = score
                        best_session = session
            
            if best_session:
                return best_session
        
        # Default to first match
        return candidate_sessions[0]
    
    # Fallback: if total is out of range for all weight-matched sessions,
    # assign the session whose min/max band is closest to the athlete total.
    if weight_matched_sessions and athlete_total > 0:
        best_session = None
        best_distance = float('inf')
        
        for session in weight_matched_sessions:
            total_range_str = session.get('estimated_entry_totals_(min___max)', '')
            min_total, max_total = parse_entry_total_range(total_range_str)
            
            # If no range exists, skip for closest-range scoring
            if min_total is None or max_total is None:
                continue
            
            if min_total <= athlete_total <= max_total:
                distance = 0
            else:
                distance = min(abs(athlete_total - min_total), abs(athlete_total - max_total))
            
            if distance < best_distance:
                best_distance = distance
                best_session = session
        
        if best_session:
            return best_session
        
        # If ranges are missing on all candidates, keep deterministic fallback
        return weight_matched_sessions[0]
    
    return None


def load_csv(filename: str) -> List[Dict]:
    """Load CSV file into list of dictionaries"""
    data = []
    with open(filename, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            data.append(row)
    return data


def assign_sessions(start_list_file: str, schedule_file: str, output_file: str):
    """
    Main function to assign athletes to sessions
    
    Args:
        start_list_file: Path to start list CSV
        schedule_file: Path to schedule CSV
        output_file: Path to output CSV
    """
    print(f"Loading start list from {start_list_file}...")
    athletes = load_csv(start_list_file)
    print(f"Loaded {len(athletes)} athletes")
    
    print(f"\nLoading schedule from {schedule_file}...")
    schedule = load_csv(schedule_file)
    print(f"Loaded {len(schedule)} sessions")
    
    # Assign sessions
    print("\nAssigning sessions...")
    assigned_count = 0
    unassigned_count = 0
    
    # Track session assignments for verification
    session_counts = {}
    
    # Auto-increment member_id starting from 1400
    member_id = 3100
    
    for athlete in athletes:
        matching_session = find_matching_session(athlete, schedule)
        
        # Assign member_id and increment
        athlete['member_id'] = str(member_id)
        member_id += 1
        
        if matching_session:
            athlete['session_number'] = matching_session.get('sess', '')
            athlete['session_platform'] = matching_session.get('plat', '')
            athlete['meet'] = MEET_NAME
            assigned_count += 1
            
            # Track counts
            session_key = (matching_session.get('sess', ''), matching_session.get('plat', ''))
            session_counts[session_key] = session_counts.get(session_key, 0) + 1
        else:
            athlete['session_number'] = ''
            athlete['session_platform'] = ''
            athlete['meet'] = MEET_NAME
            unassigned_count += 1
            print(f"  WARNING: Could not assign {athlete['name']} ({athlete['gender']}, {athlete['age']}, {athlete['weight_class']}, {athlete['entry_total']}, {athlete.get('meet', '')})")
    
    print(f"\nAssignment complete:")
    print(f"  Assigned: {assigned_count}")
    print(f"  Unassigned: {unassigned_count}")
    
    # Display session counts
    print(f"\nSession assignment counts:")
    for (sess, plat), count in sorted(session_counts.items()):
        print(f"  Session {sess}, Platform {plat}: {count} athletes")
    
    # Export to CSV
    print(f"\nExporting to {output_file}...")
    fieldnames = [
        'member_id',
        'name',
        'age',
        'club',
        'gender',
        'weight_class',
        'entry_total',
        'session_number',
        'session_platform',
        'meet',
        'adaptive'
    ]
    
    with open(output_file, 'w', newline='', encoding='utf-8') as csvfile:
        writer = csv.DictWriter(csvfile, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(athletes)
    
    print(f"✓ Successfully exported {len(athletes)} athletes to {output_file}")


def main():
    """Main entry point for CLI usage"""
    parser = argparse.ArgumentParser(
        description='Assign athletes to sessions based on schedule',
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument('--start-list', default='vwf_umwf_start_list.csv', help='Path to start list CSV')
    parser.add_argument('--schedule', default='full_output.csv', help='Path to schedule CSV')
    parser.add_argument('--output', default='assigned_athletes.csv', help='Output CSV filename')
    
    args = parser.parse_args()
    
    assign_sessions(args.start_list, args.schedule, args.output)


if __name__ == '__main__':
    main()
