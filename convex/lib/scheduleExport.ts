import { athletesByRow } from './schedulePublishing';
import type { BuiltSchedule } from './scheduleBuilder';
import { clockLabel } from './scheduleBuilderOptions';
import { workbook, type Cell } from './xlsx';
import { hasNoMemberId } from './memberIds';

export type ExportFormat = 'csv' | 'xlsx';

export const START_LIST_HEADER = ['Session', 'Platform', 'Date', 'Weigh-In', 'Start Time', 'Group', 'Name', 'Gender', 'Age', 'Weight Class', 'Entry Total', 'Club', 'Member ID'];
export const SESSIONS_HEADER = ['Session', 'Platform', 'Date', 'Weigh-In', 'Start Time', 'Group', 'Athletes'];

export function startListRows(schedule: BuiltSchedule): Cell[][] {
  return schedule.sessions.flatMap((session) =>
    session.groups.flatMap((group) =>
      athletesByRow(session, group).flatMap(({ row, athletes }) =>
        athletes.map((athlete): Cell[] => [
          session.number,
          group.platform,
          row.date,
          clockLabel(row.weighInTime),
          clockLabel(row.startTime),
          row.weightClass,
          athlete.name,
          athlete.gender,
          athlete.age,
          athlete.weightClass,
          athlete.entryTotal,
          athlete.club,
          hasNoMemberId(athlete.memberId) ? '' : athlete.memberId,
        ]),
      ),
    ),
  );
}

export function sessionRows(schedule: BuiltSchedule): Cell[][] {
  return schedule.sessions.flatMap((session) =>
    session.groups.flatMap((group) =>
      athletesByRow(session, group).map(({ row, athletes }): Cell[] => [session.number, group.platform, row.date, clockLabel(row.weighInTime), clockLabel(row.startTime), row.weightClass, athletes.length]),
    ),
  );
}

const FORMULA_START = /^[=+\-@\t\r]/;

export function csvCell(value: Cell): string {
  const text = typeof value === 'string' && FORMULA_START.test(value) ? `'${value}` : String(value);
  const escaped = text.replace(/"/g, '""');
  return /[",\n\r]/.test(escaped) || text !== String(value) ? `"${escaped}"` : escaped;
}

export function scheduleCsv(schedule: BuiltSchedule): string {
  return `\uFEFF${[START_LIST_HEADER, ...startListRows(schedule)].map((row) => row.map(csvCell).join(',')).join('\r\n')}`;
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

export const EXPORT_CONTENT_TYPES: Record<ExportFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};
