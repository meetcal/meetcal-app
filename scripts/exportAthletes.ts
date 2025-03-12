import { writeFileSync } from 'fs';
import { liftingResults } from '../data/meets/usaw-masters-nationals/athletes';

// Define headers in snake_case to match database columns
const headers = [
    'member_id',
    'name',
    'age',
    'club',
    'gender',
    'weight_class',
    'entry_total',
    'session_number',
    'session_platform',
    'meet'
].join(',');

// Convert each athlete to CSV row
const rows = liftingResults.map(athlete => {
    const values = [
        athlete.memberId,
        escapeCsvValue(athlete.name),
        athlete.age,
        escapeCsvValue(athlete.club),
        athlete.gender,
        athlete.weightClass,
        athlete.entryTotal,
        athlete.session?.number || '',
        athlete.session?.platform || '',
        'USAW'
    ];
    return values.join(',');
});

// Helper function to escape CSV values
function escapeCsvValue(value: string): string {
    if (value.includes(',') || value.includes('"') || value.includes('\n')) {
        return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
}

// Combine headers and rows
const csvContent = [headers, ...rows].join('\n');

// Write to file
writeFileSync('athletes.csv', '\ufeff' + csvContent, 'utf-8');
console.log('CSV file has been saved as athletes.csv'); 