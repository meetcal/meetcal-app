import { writeFileSync } from 'fs';
import { schedule } from '../data/meets/usaw-masters-nationals/schedule';

// Convert 12-hour time to 24-hour format
function convertTo24Hour(time12h: string): string {
    const [time, period] = time12h.split(' ');
    let [hours, minutes] = time.split(':').map(Number);
    
    if (period === 'PM' && hours !== 12) {
        hours += 12;
    } else if (period === 'AM' && hours === 12) {
        hours = 0;
    }
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:00`;
}

// Define headers to match database columns (excluding id which is SERIAL)
const headers = [
    'date',
    'session_id',
    'start_time',
    'weigh_in_time',
    'platform',
    'weight_class',
    'meet'
].join(',');

// Convert schedule data to rows
const rows = schedule.flatMap(day => 
    day.sessions.flatMap(session =>
        session.platforms.map(platform => {
            const values = [
                day.fullDate,
                session.id,
                convertTo24Hour(session.startTime),
                convertTo24Hour(session.weighInTime),
                escapeCsvValue(platform.platform),
                escapeCsvValue(platform.weightClass),
                'USAW'
            ];
            return values.join(',');
        })
    )
);

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
writeFileSync('session_schedule.csv', '\ufeff' + csvContent, 'utf-8');
console.log('CSV file has been saved as session_schedule.csv'); 