import { MeetName } from '@/data/types/meet';
import { parseNamedBests, type ApiYearBests } from '@/lib/api/api-athlete-mappers';
import { assertArray, assertHasFields, assertObject } from '@/lib/api/api-validators';
import { readConditional } from '@/lib/api/revalidated-reads';
import { request } from '@/lib/api/meetcal-api';

export type ApiMeetPackage = {
  meet: Record<string, unknown>;
  schedule: unknown[];
  athletes: unknown[];
  meet_results: unknown[];
  year_bests_by_name?: Record<string, ApiYearBests>;
};

export const MEET_PACKAGE_TIMEOUT_MS = 14000;

const MEET_PACKAGE_FIELDS = ['meet', 'schedule', 'athletes', 'meet_results'];

export const MEET_PACKAGE_INCLUDE = ['year_bests'] as const;

export type MeetPackageFetch =
  | { status: 'fresh'; etag: string | null; package: ApiMeetPackage }
  | { status: 'not_modified' };

function assertPackageSchedule(schedule: unknown): void {
  assertArray(schedule, '/meets/package.schedule').forEach((day, dayIndex) => {
    const dayLabel = `/meets/package.schedule[${dayIndex}]`;
    assertObject(day, dayLabel);
    assertArray(day.sessions, `${dayLabel}.sessions`).forEach((session, sessionIndex) => {
      const sessionLabel = `${dayLabel}.sessions[${sessionIndex}]`;
      assertObject(session, sessionLabel);
      assertArray(session.platforms, `${sessionLabel}.platforms`).forEach((platform, platformIndex) =>
        assertObject(platform, `${sessionLabel}.platforms[${platformIndex}]`),
      );
    });
  });
}

export async function fetchApiMeetPackageConditional(
  meet: MeetName,
  historyCutoffDate?: string,
  ifNoneMatch?: string | null,
): Promise<MeetPackageFetch> {
  const answer = readConditional(
    await request(
      {
        path: '/meets/package',
        fn: 'meets:packageForMeet',
        kind: 'query',
        args: {
          meet,
          historyCutoffDate,
          include: [...MEET_PACKAGE_INCLUDE],
          ifNoneMatch: ifNoneMatch ?? undefined,
        },
        conditional: true,
      },
      MEET_PACKAGE_TIMEOUT_MS,
    ),
    '/meets/package',
  );
  if (!answer.hasBody) {
    if (ifNoneMatch && (answer.etag == null || answer.etag === ifNoneMatch)) {
      return { status: 'not_modified' };
    }
    throw new Error('/meets/package answered without a body');
  }
  const pkg = assertHasFields(answer.body, '/meets/package', MEET_PACKAGE_FIELDS);
  assertObject(pkg.meet, '/meets/package.meet');
  const schedule = assertArray(pkg.schedule, '/meets/package.schedule');
  assertPackageSchedule(schedule);
  const built: ApiMeetPackage = {
    meet: pkg.meet,
    schedule,
    athletes: assertArray(pkg.athletes, '/meets/package.athletes'),
    meet_results: assertArray(pkg.meet_results, '/meets/package.meet_results'),
  };
  if ('year_bests' in pkg) {
    const byName: Record<string, ApiYearBests> = {};
    const rows = assertArray(pkg.year_bests, '/meets/package.year_bests');
    for (const { name, bests } of parseNamedBests(rows, '/meets/package.year_bests')) {
      byName[name] = bests;
    }
    built.year_bests_by_name = byName;
  }
  return { status: 'fresh', etag: answer.etag, package: built };
}
