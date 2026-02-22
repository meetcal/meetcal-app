"""
Analyze member performance at all meets in a given year.

This script queries the database for all members from pg_athletes.csv who competed
at meets in a specific year, then calculates performance statistics.

Setup and Run:
    cd P&G && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
    python meet_results_by_members.py

Configuration:
    Set YEAR variable below to the desired year
"""

import os
import csv
from supabase import create_client, Client
from typing import List, Dict
from dotenv import load_dotenv
from collections import defaultdict
from typing import cast

load_dotenv()

YEAR = 2025

def get_athlete_names_from_csv(csv_path: str) -> List[str]:
    """
    Get all athlete names from pg_athletes.csv.

    Args:
        csv_path: Path to the CSV file

    Returns:
        List of athlete names
    """
    athlete_names = []
    with open(csv_path, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get('name', '').strip()
            if name:
                athlete_names.append(name)
    
    return athlete_names

def get_meet_results_for_year(supabase_url: str, supabase_key: str, athlete_names: List[str], year: int) -> List[Dict]:
    """
    Get results for specific athletes at all meets in a given year.

    Args:
        supabase_url: Supabase project URL
        supabase_key: Supabase API key
        athlete_names: List of athlete names to filter by
        year: Year to filter meets by

    Returns:
        List of dictionaries containing meet results
    """
    if not athlete_names:
        return []

    supabase: Client = create_client(supabase_url, supabase_key)

    all_results = []
    from_range = 0
    to_range = 999
    batch_size = 1000

    csv_names_stripped = {name.replace(' ', '') for name in athlete_names}

    while True:
        query = supabase.table('lifting_results') \
            .select('name, meet, age, body_weight, snatch_best, cj_best, total, date, ' +
                   'snatch1, snatch2, snatch3, cj1, cj2, cj3') \
            .gte('date', f'{year}-01-01') \
            .lte('date', f'{year}-12-31') \
            .range(from_range, to_range)

        response = query.execute()

        if not response.data:
            break

        for result in response.data:
            db_name = result.get('name', '')
            if not db_name:
                continue
            
            db_name_stripped = db_name.replace(' ', '')
            
            if db_name_stripped in csv_names_stripped:
                all_results.append(result)

        if len(response.data) < batch_size:
            break

        from_range += batch_size
        to_range += batch_size

    return all_results

def get_all_meet_results(supabase_url: str, supabase_key: str, year: int) -> List[Dict]:
    """
    Get ALL results from all meets in a given year for medal comparison.

    Args:
        supabase_url: Supabase project URL
        supabase_key: Supabase API key
        year: Year to filter meets by

    Returns:
        List of all results from those meets
    """
    supabase: Client = create_client(supabase_url, supabase_key)

    all_results = []
    from_range = 0
    to_range = 999
    batch_size = 1000

    while True:
        query = supabase.table('lifting_results') \
            .select('name, meet, age, snatch_best, cj_best, total') \
            .gte('date', f'{year}-01-01') \
            .lte('date', f'{year}-12-31') \
            .range(from_range, to_range)

        response = query.execute()

        if not response.data:
            break

        all_results.extend(response.data)

        if len(response.data) < batch_size:
            break

        from_range += batch_size
        to_range += batch_size
    
    return all_results

def calculate_medals(member_results: List[Dict], all_meet_results: List[Dict]) -> Dict:
    """
    Calculate medals by comparing our members against ALL athletes in their age category at each meet.

    Args:
        member_results: Results from our members only
        all_meet_results: Results from ALL athletes at the meets

    Returns:
        Dictionary with medal statistics
    """
    meet_age_groups = defaultdict(lambda: defaultdict(list))
    
    for result in all_meet_results:
        meet = result.get('meet', '')
        age_cat = result.get('age', '')
        
        if not result.get('total') or result['total'] == 0:
            continue
            
        meet_age_groups[meet][age_cat].append(result)
    
    member_names = set(r['name'] for r in member_results)
    
    total_medals = 0
    snatch_medals = 0
    cj_medals = 0
    
    medal_details = []
    
    for meet, age_categories in meet_age_groups.items():
        for age_cat, athletes in age_categories.items():
            if len(athletes) < 1:
                continue
            
            sorted_by_total = sorted(athletes, key=lambda x: x.get('total', 0), reverse=True)
            
            sorted_by_snatch = sorted(
                [a for a in athletes if a.get('snatch_best', 0) > 0], 
                key=lambda x: x.get('snatch_best', 0), 
                reverse=True
            )
            
            sorted_by_cj = sorted(
                [a for a in athletes if a.get('cj_best', 0) > 0],
                key=lambda x: x.get('cj_best', 0),
                reverse=True
            )
            
            for idx, athlete in enumerate(sorted_by_total[:3]):
                if athlete['name'] in member_names:
                    place = idx + 1
                    total_medals += 1
                    medal_details.append({
                        'name': athlete['name'],
                        'meet': meet,
                        'age_cat': age_cat,
                        'category': 'Total',
                        'place': place,
                        'value': athlete['total']
                    })
            
            for idx, athlete in enumerate(sorted_by_snatch[:3]):
                if athlete['name'] in member_names:
                    place = idx + 1
                    snatch_medals += 1
                    medal_details.append({
                        'name': athlete['name'],
                        'meet': meet,
                        'age_cat': age_cat,
                        'category': 'Snatch',
                        'place': place,
                        'value': athlete['snatch_best']
                    })
            
            for idx, athlete in enumerate(sorted_by_cj[:3]):
                if athlete['name'] in member_names:
                    place = idx + 1
                    cj_medals += 1
                    medal_details.append({
                        'name': athlete['name'],
                        'meet': meet,
                        'age_cat': age_cat,
                        'category': 'C&J',
                        'place': place,
                        'value': athlete['cj_best']
                    })
    
    medals_by_meet = defaultdict(lambda: {'total': 0, 'snatch': 0, 'cj': 0})
    
    gold_count = 0
    silver_count = 0
    bronze_count = 0
    
    for medal in medal_details:
        meet = medal['meet']
        category = medal['category']
        place = medal['place']
        
        if place == 1:
            gold_count += 1
        elif place == 2:
            silver_count += 1
        elif place == 3:
            bronze_count += 1
        
        if category == 'Total':
            medals_by_meet[meet]['total'] += 1
        elif category == 'Snatch':
            medals_by_meet[meet]['snatch'] += 1
        elif category == 'C&J':
            medals_by_meet[meet]['cj'] += 1
    
    return {
        'total_medals': total_medals,
        'snatch_medals': snatch_medals,
        'cj_medals': cj_medals,
        'all_medals': total_medals + snatch_medals + cj_medals,
        'gold': gold_count,
        'silver': silver_count,
        'bronze': bronze_count,
        'medal_details': medal_details,
        'by_meet': dict(medals_by_meet)
    }

def calculate_statistics(results: List[Dict]) -> Dict:
    """
    Calculate detailed statistics on meet performance including make rates.

    Args:
        results: List of meet results

    Returns:
        Dictionary containing statistics
    """
    if not results:
        return {
            'total_athletes': 0,
            'total_results': 0,
            'avg_total': 0,
            'avg_snatch': 0,
            'avg_clean_jerk': 0,
            'avg_body_weight': 0,
            'snatch_make_rate': 0,
            'cj_make_rate': 0,
            'total_make_rate': 0,
            'snatch_attempts': {'made': 0, 'missed': 0},
            'cj_attempts': {'made': 0, 'missed': 0},
            'snatch1_make_rate': 0,
            'cj1_make_rate': 0,
            'snatch1_attempts': {'made': 0, 'missed': 0},
            'cj1_attempts': {'made': 0, 'missed': 0},
            'posted_total': 0,
            'posted_total_rate': 0,
            'medal_counts': {'gold': 0, 'silver': 0, 'bronze': 0}
        }
    
    totals = [r['total'] for r in results if r.get('total')]
    snatches = [r['snatch_best'] for r in results if r.get('snatch_best')]
    clean_jerks = [r['cj_best'] for r in results if r.get('cj_best')]
    body_weights = [r['body_weight'] for r in results if r.get('body_weight')]
    
    unique_athletes = set(r['name'] for r in results)
    
    snatch_made = 0
    snatch_missed = 0
    cj_made = 0
    cj_missed = 0
    
    snatch1_made = 0
    snatch1_missed = 0
    cj1_made = 0
    cj1_missed = 0
    
    for r in results:
        for i in [1, 2, 3]:
            attempt_key = f'snatch{i}'
            attempt_val = r.get(attempt_key, None)
            if attempt_val is not None:
                if attempt_val > 0:
                    snatch_made += 1
                    if i == 1:
                        snatch1_made += 1
                else:
                    snatch_missed += 1
                    if i == 1:
                        snatch1_missed += 1
        
        for i in [1, 2, 3]:
            attempt_key = f'cj{i}'
            attempt_val = r.get(attempt_key, None)
            if attempt_val is not None:
                if attempt_val > 0:
                    cj_made += 1
                    if i == 1:
                        cj1_made += 1
                else:
                    cj_missed += 1
                    if i == 1:
                        cj1_missed += 1
    
    total_snatch_attempts = snatch_made + snatch_missed
    total_cj_attempts = cj_made + cj_missed
    total_attempts = total_snatch_attempts + total_cj_attempts
    total_made = snatch_made + cj_made
    
    snatch_make_rate = (snatch_made / total_snatch_attempts * 100) if total_snatch_attempts > 0 else 0
    cj_make_rate = (cj_made / total_cj_attempts * 100) if total_cj_attempts > 0 else 0
    total_make_rate = (total_made / total_attempts * 100) if total_attempts > 0 else 0
    
    total_snatch1_attempts = snatch1_made + snatch1_missed
    total_cj1_attempts = cj1_made + cj1_missed
    
    snatch1_make_rate = (snatch1_made / total_snatch1_attempts * 100) if total_snatch1_attempts > 0 else 0
    cj1_make_rate = (cj1_made / total_cj1_attempts * 100) if total_cj1_attempts > 0 else 0
    
    medal_counts = {'gold': 0, 'silver': 0, 'bronze': 0}
    
    athletes_with_total = set()
    athletes_attempted = set()
    
    for r in results:
        name = r['name']
        athletes_attempted.add(name)
        total_val = r.get('total')
        if total_val and total_val > 0:
            athletes_with_total.add(name)
    
    posted_total = len(athletes_with_total)
    total_athletes_attempted = len(athletes_attempted)
    posted_total_rate = (posted_total / total_athletes_attempted * 100) if total_athletes_attempted > 0 else 0
    
    stats = {
        'total_athletes': len(unique_athletes),
        'total_results': len(results),
        'avg_total': round(sum(totals) / len(totals), 2) if totals else 0,
        'avg_snatch': round(sum(snatches) / len(snatches), 2) if snatches else 0,
        'avg_clean_jerk': round(sum(clean_jerks) / len(clean_jerks), 2) if clean_jerks else 0,
        'avg_body_weight': round(sum(body_weights) / len(body_weights), 2) if body_weights else 0,
        'snatch_make_rate': round(snatch_make_rate, 2),
        'cj_make_rate': round(cj_make_rate, 2),
        'total_make_rate': round(total_make_rate, 2),
        'snatch_attempts': {'made': snatch_made, 'missed': snatch_missed, 'total': total_snatch_attempts},
        'cj_attempts': {'made': cj_made, 'missed': cj_missed, 'total': total_cj_attempts},
        'snatch1_make_rate': round(snatch1_make_rate, 2),
        'cj1_make_rate': round(cj1_make_rate, 2),
        'snatch1_attempts': {'made': snatch1_made, 'missed': snatch1_missed, 'total': total_snatch1_attempts},
        'cj1_attempts': {'made': cj1_made, 'missed': cj1_missed, 'total': total_cj1_attempts},
        'posted_total': posted_total,
        'posted_total_rate': round(posted_total_rate, 2),
        'medal_counts': medal_counts
    }
    
    return stats

def print_results_table(results: List[Dict]):
    """
    Print a formatted table of all results.

    Args:
        results: List of meet results
    """
    if not results:
        print("No results found.")
        return
    
    print("\n" + "="*140)
    print("INDIVIDUAL RESULTS")
    print("="*140)
    print(f"{'Name':<25}{'Meet':<45}{'Age/Category':<25}{'BW':<8}{'Snatch':<10}{'C&J':<10}{'Total':<10}{'Place':<8}")
    print("="*140)
    
    sorted_results = sorted(results, key=lambda x: (x.get('meet', ''), -(x.get('total', 0) or 0)))
    
    for r in sorted_results:
        name = r.get('name', 'Unknown')[:24]
        meet = r.get('meet', 'Unknown')[:44]
        age = r.get('age', 'Unknown')[:24]
        bw = f"{r.get('body_weight', 0):.1f}" if r.get('body_weight') else 'N/A'
        snatch = str(r.get('snatch_best', 'N/A'))
        cj = str(r.get('cj_best', 'N/A'))
        total = str(r.get('total', 'N/A'))
        place = r.get('place', 'N/A')
        
        print(f"{name:<25}{meet:<45}{age:<25}{bw:<8}{snatch:<10}{cj:<10}{total:<10}{place:<8}")
    
    print("="*140)

def print_statistics(stats: Dict, medal_stats: Dict | None = None, year: int | None = None):
    """
    Print formatted statistics.

    Args:
        stats: Dictionary containing statistics
        medal_stats: Dictionary containing medal statistics
        year: Year analyzed
    """
    print("\n" + "="*80)
    print("PERFORMANCE STATISTICS")
    if year:
        print(f"Year: {year}")
    print("="*80)
    
    print(f"\nOverall Summary:")
    print(f"  Total Athletes:        {stats['total_athletes']}")
    
    print(f"\nAttempt Make Rates:")
    print(f"  Snatch Make Rate:      {stats['snatch_make_rate']:.2f}% ({stats['snatch_attempts']['made']}/{stats['snatch_attempts']['total']} attempts)")
    print(f"  C&J Make Rate:         {stats['cj_make_rate']:.2f}% ({stats['cj_attempts']['made']}/{stats['cj_attempts']['total']} attempts)")
    print(f"  Overall Make Rate:     {stats['total_make_rate']:.2f}% ({stats['snatch_attempts']['made'] + stats['cj_attempts']['made']}/{stats['snatch_attempts']['total'] + stats['cj_attempts']['total']} attempts)")
    
    print(f"\nOpener Make Rates:")
    print(f"  Snatch Opener:         {stats['snatch1_make_rate']:.2f}% ({stats['snatch1_attempts']['made']}/{stats['snatch1_attempts']['total']} openers)")
    print(f"  C&J Opener:            {stats['cj1_make_rate']:.2f}% ({stats['cj1_attempts']['made']}/{stats['cj1_attempts']['total']} openers)")
    
    print(f"\nPosted Total Rate:     {stats['posted_total_rate']:.2f}% ({stats['posted_total']}/{stats['total_athletes']} athletes)")
    
    if medal_stats:
        print(f"\nMedals Won:")
        print(f"  Gold:                  {medal_stats['gold']}")
        print(f"  Silver:                {medal_stats['silver']}")
        print(f"  Bronze:                {medal_stats['bronze']}")
        print(f"  Total:                 {medal_stats['all_medals']}")
        
        if medal_stats.get('by_meet'):
            print(f"\nMedals by Meet:")
            for meet, counts in medal_stats['by_meet'].items():
                meet_name = meet if len(meet) <= 50 else meet[:47] + "..."
                meet_total = counts['total'] + counts['snatch'] + counts['cj']
                print(f"  {meet_name}:")
                print(f"    Total: {counts['total']}, Snatch: {counts['snatch']}, C&J: {counts['cj']} (Total: {meet_total})")
    
    print("="*80)

def export_medal_details(medal_stats: Dict, filename: str = 'medal_details.txt', year: int | None = None):
    """
    Export detailed medal information to a text file.

    Args:
        medal_stats: Dictionary containing medal statistics
        filename: Output filename
        year: Year analyzed
    """
    if not medal_stats or not medal_stats.get('medal_details'):
        return
    
    sorted_medals = sorted(
        medal_stats['medal_details'],
        key=lambda x: (x['meet'], x['name'], x['category'])
    )
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write("="*100 + "\n")
        f.write("DETAILED MEDAL REPORT\n")
        if year:
            f.write(f"Year: {year}\n")
        f.write("="*100 + "\n\n")
        
        current_meet = None
        for medal in sorted_medals:
            meet = medal['meet']
            
            if meet != current_meet:
                if current_meet is not None:
                    f.write("\n")
                f.write("-"*100 + "\n")
                f.write(f"{meet}\n")
                f.write("-"*100 + "\n\n")
                current_meet = meet
            
            place_name = {1: "1st", 2: "2nd", 3: "3rd"}.get(medal['place'], str(medal['place']))
            
            f.write(f"{medal['name']:<30} | {medal['age_cat']:<30} | {medal['category']:<10} | {place_name:<5} | {medal['value']} kg\n")
        
        f.write("\n" + "="*100 + "\n")
    
    print(f"Exported detailed medal report to {filename}")

def export_summary_to_txt(stats: Dict, medal_stats: Dict | None = None, filename: str = 'meet_statistics_summary.txt', year: int | None = None):
    """
    Export statistics summary to a text file.

    Args:
        stats: Dictionary containing statistics
        medal_stats: Dictionary containing medal statistics
        filename: Output filename
        year: Year analyzed
    """
    with open(filename, 'w', encoding='utf-8') as f:
        f.write("="*80 + "\n")
        f.write("MEET PERFORMANCE STATISTICS\n")
        if year:
            f.write(f"Year: {year}\n")
        f.write("="*80 + "\n\n")
        
        f.write("Overall Summary:\n")
        f.write(f"  Total Athletes:        {stats['total_athletes']}\n\n")
        
        f.write("Attempt Make Rates:\n")
        f.write(f"  Snatch Make Rate:      {stats['snatch_make_rate']:.2f}% ({stats['snatch_attempts']['made']}/{stats['snatch_attempts']['total']} attempts)\n")
        f.write(f"  C&J Make Rate:         {stats['cj_make_rate']:.2f}% ({stats['cj_attempts']['made']}/{stats['cj_attempts']['total']} attempts)\n")
        f.write(f"  Overall Make Rate:     {stats['total_make_rate']:.2f}% ({stats['snatch_attempts']['made'] + stats['cj_attempts']['made']}/{stats['snatch_attempts']['total'] + stats['cj_attempts']['total']} attempts)\n\n")
        
        f.write("Opener Make Rates:\n")
        f.write(f"  Snatch Opener:         {stats['snatch1_make_rate']:.2f}% ({stats['snatch1_attempts']['made']}/{stats['snatch1_attempts']['total']} openers)\n")
        f.write(f"  C&J Opener:            {stats['cj1_make_rate']:.2f}% ({stats['cj1_attempts']['made']}/{stats['cj1_attempts']['total']} openers)\n\n")
        
        f.write(f"Posted Total Rate:     {stats['posted_total_rate']:.2f}% ({stats['posted_total']}/{stats['total_athletes']} athletes)\n\n")
        
        if medal_stats:
            f.write("Medals Won:\n")
            f.write(f"  Gold:                  {medal_stats['gold']}\n")
            f.write(f"  Silver:                {medal_stats['silver']}\n")
            f.write(f"  Bronze:                {medal_stats['bronze']}\n")
            f.write(f"  Total:                 {medal_stats['all_medals']}\n\n")
            
            if medal_stats.get('by_meet'):
                f.write("Medals by Meet:\n")
                for meet, counts in medal_stats['by_meet'].items():
                    meet_total = counts['total'] + counts['snatch'] + counts['cj']
                    f.write(f"  {meet}:\n")
                    f.write(f"    Total: {counts['total']}, Snatch: {counts['snatch']}, C&J: {counts['cj']} (Total: {meet_total})\n")
        
        f.write("\n" + "="*80 + "\n")
    
    print(f"\nExported statistics summary to {filename}")

def main():
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Error: Please set SUPABASE_URL and SUPABASE_KEY environment variables")
        print("Create a .env file with:")
        print("SUPABASE_URL=your_url_here")
        print("SUPABASE_KEY=your_key_here")
        return
    
    csv_path = 'pg_athletes.csv'
    year = YEAR
    
    if not os.path.exists(csv_path):
        print(f"Error: CSV file not found: {csv_path}")
        return
    
    try:
        print(f"Analyzing results for year: {year}")
        
        print("\nFetching athlete names from CSV...")
        athlete_names = get_athlete_names_from_csv(csv_path)
        print(f"Found {len(athlete_names)} athletes in CSV")
        
        if not athlete_names:
            print(f"\nNo athletes found in CSV file")
            return
        
        print(f"\nFirst few athletes from CSV: {athlete_names[:3]}")
        
        print(f"\nChecking what dates exist in database...")
        supabase: Client = create_client(supabase_url, supabase_key)
        sample_query = supabase.table('lifting_results') \
            .select('date') \
            .order('date', desc=True) \
            .range(0, 9)
        
        sample_response = sample_query.execute()
        if sample_response.data:
            print(f"Sample dates in database:")
            for item in sample_response.data:
                print(f"  {item.get('date')}")
        
        print("\nQuerying database for meet results...")
        results = get_meet_results_for_year(supabase_url, supabase_key, athlete_names, year)
        print(f"Found {len(results)} results for {year}")
        
        if not results:
            print(f"\nNo results found for year: {year}")
            print(f"Athletes found in CSV: {len(athlete_names)}")
            
            print(f"\nLet's check if any data exists without year filter...")
            test_query = supabase.table('lifting_results') \
                .select('name, meet, date') \
                .range(0, 4)
            test_response = test_query.execute()
            if test_response.data:
                print(f"Sample records:")
                for item in test_response.data:
                    print(f"  Name: {item.get('name')}, Meet: {item.get('meet')}, Date: {item.get('date')}")
            
            return
        
        print("\nFetching all meet results for medal comparison...")
        all_meet_results = get_all_meet_results(supabase_url, supabase_key, year)
        print(f"Found {len(all_meet_results)} total results across all meets in {year}")
        
        print("Calculating medals...")
        medal_stats = calculate_medals(results, all_meet_results)
        
        stats = calculate_statistics(results)
        
        print_statistics(stats, medal_stats, year)
        
        export_summary_to_txt(stats, medal_stats, filename=f'meet_statistics_summary_{year}.txt', year=year)
        
        export_medal_details(medal_stats, filename=f'medal_details_{year}.txt', year=year)
        
        print("\n" + "="*80)
        print(f"Analysis complete! Found {len(results)} results from {stats['total_athletes']} athletes in {year}.")
        print("="*80)
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
