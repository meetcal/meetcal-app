"""
Analyze member performance at specific meets.

This script queries the database for all members from a specific club who competed at:
- 2025 UMWF World Championships
- 2025 Virus Weightlifting Finals, Powered by Rogue Fitness

Then calculates statistics on how these individuals performed on average.

Setup and Run:
    cd P&G && python3 -m venv venv && source venv/bin/activate && pip install -r requirements.txt
    python meet_results.py

Configuration:
    Set CLUB_NAME variable below to the desired club name
"""

import os
from supabase import create_client, Client
from typing import List, Dict
from dotenv import load_dotenv
from collections import defaultdict

# Load environment variables from .env file
load_dotenv()

# ============================================================================
# CONFIGURATION: Set the club name here
# ============================================================================
CLUB_NAME = "POWER AND GRACE PERFORMANCE."  # Change this to your desired club name
# ============================================================================

def get_athlete_names_by_club(supabase_url: str, supabase_key: str, club_name: str) -> List[str]:
    """
    Get all athlete names from the athletes table for a specific club.
    
    Args:
        supabase_url: Supabase project URL
        supabase_key: Supabase API key
        club_name: Name of the club to filter by
    
    Returns:
        List of athlete names (unique)
    """
    # Initialize Supabase client
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Query the athletes table for this club
    query = supabase.table('athletes') \
        .select('name') \
        .eq('club', club_name)
    
    response = query.execute()
    
    # Extract unique names
    athlete_names = list(set(result['name'] for result in response.data if result.get('name')))
    
    return athlete_names

def get_meet_results(supabase_url: str, supabase_key: str, athlete_names: List[str]) -> List[Dict]:
    """
    Get results for specific athletes at the specified meets.
    
    Args:
        supabase_url: Supabase project URL
        supabase_key: Supabase API key
        athlete_names: List of athlete names to filter by
    
    Returns:
        List of dictionaries containing meet results
    """
    if not athlete_names:
        return []
    
    # Initialize Supabase client
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Target meets
    target_meets = [
        '2025 UMWF World Championships',
        '2025 Virus Weightlifting Finals, Powered by Rogue Fitness'
    ]
    
    # Query the database - specify all columns we need
    results = []
    for meet_name in target_meets:
        query = supabase.table('lifting_results') \
            .select('name, meet, age, body_weight, snatch_best, cj_best, total, date, ' +
                   'snatch1, snatch2, snatch3, cj1, cj2, cj3') \
            .eq('meet', meet_name) \
            .in_('name', athlete_names)
        
        response = query.execute()
        results.extend(response.data)
    
    return results

def get_all_athlete_results(supabase_url: str, supabase_key: str, athlete_names: List[str]) -> Dict[str, List[Dict]]:
    """
    Get all historical results for specific athletes.
    
    Args:
        supabase_url: Supabase project URL
        supabase_key: Supabase API key
        athlete_names: List of athlete names
    
    Returns:
        Dictionary mapping athlete names to their list of all results
    """
    if not athlete_names:
        return {}
    
    # Initialize Supabase client
    supabase: Client = create_client(supabase_url, supabase_key)
    
    # Query all results for these athletes (lifting_results doesn't have club field)
    query = supabase.table('lifting_results') \
        .select('name, meet, snatch_best, cj_best, total, date') \
        .in_('name', athlete_names) \
        .order('date')
    
    response = query.execute()
    
    # Group results by athlete name
    athlete_results = defaultdict(list)
    for result in response.data:
        athlete_results[result['name']].append(result)
    
    return dict(athlete_results)

def get_all_meet_results(supabase_url: str, supabase_key: str, target_meets: List[str]) -> List[Dict]:
    """
    Get ALL results (not just members) from the target meets for medal comparison.
    
    Args:
        supabase_url: Supabase project URL
        supabase_key: Supabase API key
        target_meets: List of meet names
    
    Returns:
        List of all results from those meets
    """
    supabase: Client = create_client(supabase_url, supabase_key)
    
    all_meet_results = []
    for meet_name in target_meets:
        query = supabase.table('lifting_results') \
            .select('name, meet, age, snatch_best, cj_best, total') \
            .eq('meet', meet_name)
        
        response = query.execute()
        all_meet_results.extend(response.data)
    
    return all_meet_results

def calculate_medals(member_results: List[Dict], all_meet_results: List[Dict]) -> Dict:
    """
    Calculate medals by comparing our members against ALL athletes in their age category at each meet.
    
    Args:
        member_results: Results from our members only
        all_meet_results: Results from ALL athletes at the meets
    
    Returns:
        Dictionary with medal statistics
    """
    # Group ALL meet results by meet and age category
    meet_age_groups = defaultdict(lambda: defaultdict(list))
    
    for result in all_meet_results:
        meet = result.get('meet', '')
        age_cat = result.get('age', '')
        
        # Skip if no total (bombed out)
        if not result.get('total') or result['total'] == 0:
            continue
            
        meet_age_groups[meet][age_cat].append(result)
    
    # Create a set of our member names for easy lookup
    member_names = set(r['name'] for r in member_results)
    
    total_medals = 0
    snatch_medals = 0
    cj_medals = 0
    
    medal_details = []
    
    # For each meet and age category, rank all athletes and see where our members placed
    for meet, age_categories in meet_age_groups.items():
        for age_cat, athletes in age_categories.items():
            if len(athletes) < 1:
                continue
            
            # Sort by total (descending)
            sorted_by_total = sorted(athletes, key=lambda x: x.get('total', 0), reverse=True)
            
            # Sort by snatch (descending)
            sorted_by_snatch = sorted(
                [a for a in athletes if a.get('snatch_best', 0) > 0], 
                key=lambda x: x.get('snatch_best', 0), 
                reverse=True
            )
            
            # Sort by C&J (descending)
            sorted_by_cj = sorted(
                [a for a in athletes if a.get('cj_best', 0) > 0],
                key=lambda x: x.get('cj_best', 0),
                reverse=True
            )
            
            # Check if any of our members are in top 3 for total
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
            
            # Check if any of our members are in top 3 for snatch
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
            
            # Check if any of our members are in top 3 for C&J
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
    
    # Break down medals by meet
    medals_by_meet = defaultdict(lambda: {'total': 0, 'snatch': 0, 'cj': 0})
    
    # Count gold, silver, bronze
    gold_count = 0
    silver_count = 0
    bronze_count = 0
    
    for medal in medal_details:
        meet = medal['meet']
        category = medal['category']
        place = medal['place']
        
        # Count by place
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

def calculate_prs(meet_results: List[Dict], all_results: Dict[str, List[Dict]]) -> Dict:
    """
    Calculate how many PRs were hit at these meets.
    
    Args:
        meet_results: Results from the target meets
        all_results: All historical results for each athlete
    
    Returns:
        Dictionary with PR statistics
    """
    target_meets = {
        '2025 UMWF World Championships',
        '2025 Virus Weightlifting Finals, Powered by Rogue Fitness'
    }
    
    snatch_prs = 0
    cj_prs = 0
    total_prs = 0
    
    athletes_with_snatch_pr = []
    athletes_with_cj_pr = []
    athletes_with_total_pr = []
    
    for result in meet_results:
        name = result['name']
        meet = result['meet']
        
        # Skip if athlete bombed out
        if not result.get('total') or result['total'] == 0:
            continue
        
        current_snatch = result.get('snatch_best', 0)
        current_cj = result.get('cj_best', 0)
        current_total = result.get('total', 0)
        
        # Get all other results for this athlete (excluding current target meets)
        if name in all_results:
            other_results = [r for r in all_results[name] 
                           if r.get('meet') not in target_meets]
            
            # Find max values from other meets
            max_snatch = 0
            max_cj = 0
            max_total = 0
            
            for other in other_results:
                if other.get('snatch_best'):
                    max_snatch = max(max_snatch, other['snatch_best'])
                if other.get('cj_best'):
                    max_cj = max(max_cj, other['cj_best'])
                if other.get('total'):
                    max_total = max(max_total, other['total'])
            
            # Check for PRs
            if current_snatch > 0 and current_snatch > max_snatch:
                snatch_prs += 1
                athletes_with_snatch_pr.append((name, current_snatch, max_snatch, meet))
            
            if current_cj > 0 and current_cj > max_cj:
                cj_prs += 1
                athletes_with_cj_pr.append((name, current_cj, max_cj, meet))
            
            if current_total > 0 and current_total > max_total:
                total_prs += 1
                athletes_with_total_pr.append((name, current_total, max_total, meet))
    
    return {
        'snatch_prs': snatch_prs,
        'cj_prs': cj_prs,
        'total_prs': total_prs,
        'athletes_with_snatch_pr': athletes_with_snatch_pr,
        'athletes_with_cj_pr': athletes_with_cj_pr,
        'athletes_with_total_pr': athletes_with_total_pr
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
    
    # Basic statistics
    totals = [r['total'] for r in results if r.get('total')]
    snatches = [r['snatch_best'] for r in results if r.get('snatch_best')]
    clean_jerks = [r['cj_best'] for r in results if r.get('cj_best')]
    body_weights = [r['body_weight'] for r in results if r.get('body_weight')]
    
    # Count unique athletes
    unique_athletes = set(r['name'] for r in results)
    
    # Calculate make rates
    snatch_made = 0
    snatch_missed = 0
    cj_made = 0
    cj_missed = 0
    
    # Calculate opener make rates
    snatch1_made = 0
    snatch1_missed = 0
    cj1_made = 0
    cj1_missed = 0
    
    for r in results:
        # Snatch attempts
        for i in [1, 2, 3]:
            attempt_key = f'snatch{i}'
            if attempt_key in r and r[attempt_key]:
                if r[attempt_key] > 0:
                    snatch_made += 1
                    if i == 1:
                        snatch1_made += 1
                else:
                    snatch_missed += 1
                    if i == 1:
                        snatch1_missed += 1
        
        # Clean & Jerk attempts
        for i in [1, 2, 3]:
            attempt_key = f'cj{i}'
            if attempt_key in r and r[attempt_key]:
                if r[attempt_key] > 0:
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
    
    # Calculate opener make rates
    total_snatch1_attempts = snatch1_made + snatch1_missed
    total_cj1_attempts = cj1_made + cj1_missed
    
    snatch1_make_rate = (snatch1_made / total_snatch1_attempts * 100) if total_snatch1_attempts > 0 else 0
    cj1_make_rate = (cj1_made / total_cj1_attempts * 100) if total_cj1_attempts > 0 else 0
    
    
    # Medal counting is now done in calculate_medals function
    medal_counts = {'gold': 0, 'silver': 0, 'bronze': 0}
    
    # Calculate posted total rate (unique athletes who successfully totaled at least once)
    athletes_with_total = set()
    athletes_attempted = set()
    
    for r in results:
        name = r['name']
        athletes_attempted.add(name)
        if r.get('total') and r.get('total') > 0:
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
    
    # Sort by meet, then by total (descending)
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

def print_statistics(stats: Dict, pr_stats: Dict = None, medal_stats: Dict = None, club_name: str = None):
    """
    Print formatted statistics.
    
    Args:
        stats: Dictionary containing statistics
        pr_stats: Dictionary containing PR statistics
        medal_stats: Dictionary containing medal statistics
        club_name: Name of the club
    """
    print("\n" + "="*80)
    print("PERFORMANCE STATISTICS")
    if club_name:
        print(f"Club: {club_name}")
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
    
    if pr_stats:
        print(f"\nPersonal Records:")
        print(f"  Snatch PRs:            {pr_stats['snatch_prs']}")
        print(f"  Clean & Jerk PRs:      {pr_stats['cj_prs']}")
        print(f"  Total PRs:             {pr_stats['total_prs']}")
    
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

def export_medal_details(medal_stats: Dict, filename: str = 'medal_details.txt', club_name: str = None):
    """
    Export detailed medal information to a text file.
    
    Args:
        medal_stats: Dictionary containing medal statistics
        filename: Output filename
        club_name: Name of the club
    """
    if not medal_stats or not medal_stats.get('medal_details'):
        return
    
    # Sort medal details by meet, then by athlete name
    sorted_medals = sorted(
        medal_stats['medal_details'],
        key=lambda x: (x['meet'], x['name'], x['category'])
    )
    
    with open(filename, 'w', encoding='utf-8') as f:
        f.write("="*100 + "\n")
        f.write("DETAILED MEDAL REPORT\n")
        if club_name:
            f.write(f"Club: {club_name}\n")
        f.write("="*100 + "\n\n")
        
        # Group by meet
        current_meet = None
        for medal in sorted_medals:
            meet = medal['meet']
            
            # Print meet header when it changes
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

def export_summary_to_txt(stats: Dict, pr_stats: Dict = None, medal_stats: Dict = None, filename: str = 'meet_statistics_summary.txt', club_name: str = None):
    """
    Export statistics summary to a text file.
    
    Args:
        stats: Dictionary containing statistics
        pr_stats: Dictionary containing PR statistics
        medal_stats: Dictionary containing medal statistics
        filename: Output filename
        club_name: Name of the club
    """
    with open(filename, 'w', encoding='utf-8') as f:
        f.write("="*80 + "\n")
        f.write("MEET PERFORMANCE STATISTICS\n")
        if club_name:
            f.write(f"Club: {club_name}\n")
        f.write("Meets: 2025 UMWF World Championships & 2025 Virus Weightlifting Finals\n")
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
        
        if pr_stats:
            f.write("Personal Records:\n")
            f.write(f"  Snatch PRs:            {pr_stats['snatch_prs']}\n")
            f.write(f"  Clean & Jerk PRs:      {pr_stats['cj_prs']}\n")
            f.write(f"  Total PRs:             {pr_stats['total_prs']}\n\n")
        
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
    # Get Supabase credentials from environment variables
    supabase_url = os.getenv('SUPABASE_URL')
    supabase_key = os.getenv('SUPABASE_KEY')
    
    if not supabase_url or not supabase_key:
        print("Error: Please set SUPABASE_URL and SUPABASE_KEY environment variables")
        print("Create a .env file with:")
        print("SUPABASE_URL=your_url_here")
        print("SUPABASE_KEY=your_key_here")
        return
    
    # Use club name from configuration
    club_name = CLUB_NAME
    
    if not club_name:
        print("Error: Please set CLUB_NAME variable at the top of the script")
        return
    
    try:
        print(f"Querying database for club: {club_name}")
        
        # First, get athlete names from the athletes table
        print("\nFetching athlete names from athletes table...")
        athlete_names = get_athlete_names_by_club(supabase_url, supabase_key, club_name)
        print(f"Found {len(athlete_names)} athletes in club: {club_name}")
        
        if not athlete_names:
            print(f"\nNo athletes found for club: {club_name}")
            print("Note: Club name must match exactly (case-sensitive)")
            return
        
        # Get results from database using athlete names
        print("\nQuerying database for meet results...")
        results = get_meet_results(supabase_url, supabase_key, athlete_names)
        print(f"Found {len(results)} results")
        
        if not results:
            print("\nNo results found for the specified meets:")
            print("  - 2025 UMWF World Championships")
            print("  - 2025 Virus Weightlifting Finals, Powered by Rogue Fitness")
            print(f"\nClub name used: {club_name}")
            print(f"Athletes found in club: {len(athlete_names)}")
            return
        
        # Get all athlete names who competed (from results)
        competing_athlete_names = list(set(r['name'] for r in results))
        
        # Get all historical results for PR comparison
        print(f"\nFetching historical results for {len(competing_athlete_names)} athletes...")
        all_results = get_all_athlete_results(supabase_url, supabase_key, competing_athlete_names)
        
        # Calculate PRs
        print("Calculating personal records...")
        pr_stats = calculate_prs(results, all_results)
        
        # Get ALL meet results (not just members) for medal comparison
        target_meets = [
            '2025 UMWF World Championships',
            '2025 Virus Weightlifting Finals, Powered by Rogue Fitness'
        ]
        print("\nFetching all meet results for medal comparison...")
        all_meet_results = get_all_meet_results(supabase_url, supabase_key, target_meets)
        print(f"Found {len(all_meet_results)} total results across both meets")
        
        # Calculate medals
        print("Calculating medals...")
        medal_stats = calculate_medals(results, all_meet_results)
        
        # Calculate statistics
        stats = calculate_statistics(results)
        
        # Print statistics
        print_statistics(stats, pr_stats, medal_stats, club_name)
        
        # Export summary to text file
        export_summary_to_txt(stats, pr_stats, medal_stats, filename='meet_statistics_summary.txt', club_name=club_name)
        
        # Export detailed medal report
        export_medal_details(medal_stats, club_name=club_name)
        
        print("\n" + "="*80)
        print(f"Analysis complete! Found {len(results)} results from {stats['total_athletes']} athletes.")
        print("="*80)
        
    except Exception as e:
        print(f"Error: {str(e)}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    main()
