#!/usr/bin/env python3
"""
Convert full_output.csv format to the simplified csv.csv format.

Input format (full_output.csv):
id,date,meet,sess,plat,age_group_weight_category,weigh,time,estimated_entry_totals_(min___max),gender,number_of_lifters

Output format (csv.csv):
id,date,session_id,start_time,weigh_in_time,platform,weight_class,meet
"""

import csv
import argparse
from datetime import datetime, timedelta


def parse_time(time_str):
    """Parse time string (HH:MM:SS) to time object"""
    return datetime.strptime(time_str, '%H:%M:%S').time()


def format_time(time_obj):
    """Format time object to HH:MM:SS string"""
    return time_obj.strftime('%H:%M:%S')


def calculate_weigh_in_time(start_time_str):
    """
    Calculate weigh-in time (2 hours before start time)
    
    Args:
        start_time_str: Start time as string (HH:MM:SS)
    
    Returns:
        Weigh-in time as string (HH:MM:SS)
    """
    start_time = datetime.strptime(start_time_str, '%H:%M:%S')
    weigh_in_time = start_time - timedelta(hours=2)
    return weigh_in_time.strftime('%H:%M:%S')


def convert_schedule(input_file, output_file, meet_name=None):
    """
    Convert full_output.csv to csv.csv format
    
    Args:
        input_file: Path to full_output.csv
        output_file: Path to output csv file
        meet_name: Optional custom meet name (uses original if not provided)
    """
    
    # Read input CSV
    with open(input_file, 'r', encoding='utf-8') as f:
        reader = csv.DictReader(f)
        rows = list(reader)
    
    # Convert each row
    converted_rows = []
    for row in rows:
        # Use custom meet name if provided, otherwise use original
        final_meet_name = meet_name if meet_name else row['meet']
        
        converted_row = {
            'id': row['id'],
            'date': row['date'],
            'session_id': row['sess'],  # sess -> session_id
            'start_time': row['time'],  # time -> start_time
            'weigh_in_time': calculate_weigh_in_time(row['time']),  # Calculate 2 hours before
            'platform': row['plat'],  # plat -> platform
            'weight_class': row['age_group_weight_category'],  # age_group_weight_category -> weight_class
            'meet': final_meet_name
        }
        
        converted_rows.append(converted_row)
    
    # Write output CSV
    fieldnames = ['id', 'date', 'session_id', 'start_time', 'weigh_in_time', 'platform', 'weight_class', 'meet']
    
    with open(output_file, 'w', newline='', encoding='utf-8') as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(converted_rows)
    
    print(f"✓ Converted {len(converted_rows)} rows")
    print(f"✓ Output saved to {output_file}")
    
    # Show sample output
    print("\nSample output (first 3 rows):")
    print(f"{'id':<4} {'date':<12} {'session_id':<10} {'start_time':<12} {'weigh_in_time':<14} {'platform':<10} {'weight_class':<30} {'meet':<40}")
    print("=" * 150)
    for row in converted_rows[:3]:
        print(f"{row['id']:<4} {row['date']:<12} {row['session_id']:<10} {row['start_time']:<12} {row['weigh_in_time']:<14} {row['platform']:<10} {row['weight_class']:<30} {row['meet'][:40]:<40}")


def main():
    parser = argparse.ArgumentParser(
        description='Convert full_output.csv format to simplified csv.csv format'
    )
    parser.add_argument(
        '--input',
        default='full_output.csv',
        help='Input CSV file (default: full_output.csv)'
    )
    parser.add_argument(
        '--output',
        default='converted_schedule.csv',
        help='Output CSV file (default: converted_schedule.csv)'
    )
    parser.add_argument(
        '--meet',
        help='Custom meet name to use for all sessions (optional)'
    )
    
    args = parser.parse_args()
    
    print(f"Converting {args.input} to {args.output}...")
    if args.meet:
        print(f"Using custom meet name: {args.meet}")
    print()
    
    convert_schedule(args.input, args.output, args.meet)


if __name__ == '__main__':
    main()

