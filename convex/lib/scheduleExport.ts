import { platformLabel } from './schedulePublishing';
import type { BuiltSchedule } from './scheduleBuilder';
import { clockLabel } from './scheduleBuilderOptions';
import { workbook, type Cell } from './xlsx';

export type ExportFormat = 'csv' | 'xlsx';

export const START_LIST_HEADER = ['Session', 'Platform', 'Date', 'Weigh-In', 'Start Time', 'Group', 'Name', 'Gender', 'Age', 'Weight Class', 'Entry Total', 'Club', 'Member ID'];
export const SESSIONS_HEADER = ['Session', 'Platform', 'Date', 'Weigh-In', 'Start Time', 'Group', 'Athletes'];

export function startListRows(schedule: BuiltSchedule): Cell[][] {
  return schedule.sessions.flatMap((session) =>
    session.groups.flatMap((group) =>
      group.athletes.map((athlete): Cell[] => [
        session.number,
        group.platform,
        session.date,
        clockLabel(session.weighInTime),
        clockLabel(session.startTime),
        platformLabel(group),
        athlete.name,
        athlete.gender,
        athlete.age,
        athlete.weightClass,
        athlete.entryTotal,
        athlete.club,
        athlete.memberId,
      ]),
    ),
  );
}

export function sessionRows(schedule: BuiltSchedule): Cell[][] {
  return schedule.sessions.flatMap((session) =>
    session.groups.map((group): Cell[] => [session.number, group.platform, session.date, clockLabel(session.weighInTime), clockLabel(session.startTime), platformLabel(group), group.athletes.length]),
  );
}

export function csvCell(value: Cell): string {
  const text = String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) ? `"${escaped}"` : escaped;
}

export function scheduleCsv(schedule: BuiltSchedule): string {
  return [START_LIST_HEADER, ...startListRows(schedule)].map((row) => row.map(csvCell).join(',')).join('\r\n');
}

export function scheduleWorkbook(schedule: BuiltSchedule): Uint8Array {
  return workbook([
    { name: 'Sessions', rows: [SESSIONS_HEADER, ...sessionRows(schedule)] },
    { name: 'Start List', rows: [START_LIST_HEADER, ...startListRows(schedule)] },
  ]);
}

export function exportFileName(meet: string, format: ExportFormat): string {
  const safe = meet
    .normalize('NFKD')
    .replace(/[^\w\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .toLowerCase();
  return `${safe || 'meet'}-schedule.${format}`;
}

export function base64Of(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
