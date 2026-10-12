import * as fc from 'fast-check';

/**
 * Shared fast-check generators for property tests. Test-only: nothing in the
 * app imports `test-support/`.
 *
 * Generators lean towards the inputs that have broken MeetCal before: DST
 * transition days, zones far from UTC, leap days, and strings that are not
 * what a mapper expects.
 */

/** Every zone the runtime knows. */
export const ALL_TIME_ZONES: readonly string[] = Intl.supportedValuesOf('timeZone');

/**
 * Zones USA Weightlifting meets run in, plus the awkward ones: no DST
 * (Phoenix, Honolulu), half-hour and 45-minute offsets, and both sides of the
 * date line.
 */
export const EDGE_TIME_ZONES = [
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Phoenix',
  'America/Los_Angeles',
  'America/Anchorage',
  'Pacific/Honolulu',
  'America/Puerto_Rico',
  'UTC',
  'Europe/London',
  'Asia/Kolkata',
  'Asia/Kathmandu',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Pacific/Auckland',
  'Pacific/Kiritimati',
  'Pacific/Pago_Pago',
] as const;

export const timeZoneArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 3, arbitrary: fc.constantFrom(...EDGE_TIME_ZONES) },
  { weight: 1, arbitrary: fc.constantFrom(...ALL_TIME_ZONES) },
);

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

/** `YYYY-MM-DD` for a UTC instant. */
export function isoDateOf(date: Date): string {
  return `${pad(date.getUTCFullYear(), 4)}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** US DST changes and leap days, where calendar arithmetic goes wrong first. */
const EDGE_DATES = [
  '2024-02-29',
  '2028-02-29',
  '2025-03-09',
  '2025-11-02',
  '2026-03-08',
  '2026-11-01',
  '2027-03-14',
  '2027-11-07',
  '2026-01-01',
  '2026-12-31',
] as const;

const DAY_MS = 86_400_000;
const MIN_DATE_MS = Date.UTC(1990, 0, 1);
const MAX_DATE_MS = Date.UTC(2040, 11, 31);

/** A calendar date, `YYYY-MM-DD`, between 1990 and 2040. */
export const isoCalendarDateArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 1, arbitrary: fc.constantFrom(...EDGE_DATES) },
  {
    weight: 3,
    arbitrary: fc
      .integer({ min: 0, max: Math.floor((MAX_DATE_MS - MIN_DATE_MS) / DAY_MS) })
      .map((days) => isoDateOf(new Date(MIN_DATE_MS + days * DAY_MS))),
  },
);

/** A wall-clock time as meets publish it: `HH:MM` (24h) or `H:MM AM`. */
export const clockTimeArb: fc.Arbitrary<string> = fc.oneof(
  fc
    .record({ hour: fc.integer({ min: 0, max: 23 }), minute: fc.integer({ min: 0, max: 59 }) })
    .map(({ hour, minute }) => `${pad(hour)}:${pad(minute)}`),
  fc
    .record({
      hour: fc.integer({ min: 1, max: 12 }),
      minute: fc.integer({ min: 0, max: 59 }),
      meridiem: fc.constantFrom('AM', 'PM', 'am', 'pm'),
    })
    .map(({ hour, minute, meridiem }) => `${hour}:${pad(minute)} ${meridiem}`),
);

/**
 * Strings a parser should survive: empty and whitespace, lone surrogates,
 * prototype keys, numeric lookalikes, URL schemes and path traversal.
 */
export const HOSTILE_STRINGS = [
  '',
  ' ',
  '\t\n',
  '\u0000',
  '\uD800',
  '‮',
  '__proto__',
  'constructor',
  'toString',
  'NaN',
  'Infinity',
  '-1',
  '1e309',
  'null',
  'undefined',
  'true',
  '[]',
  '{}',
  '<script>alert(1)</script>',
  '../../etc/passwd',
  'javascript:alert(1)',
  '//evil.example',
  'https://evil.example/',
  '25:61',
  '13:00 PM',
  '2026-02-30',
  '2026-13-01',
] as const;

export const hostileStringArb: fc.Arbitrary<string> = fc.oneof(
  { weight: 2, arbitrary: fc.constantFrom(...HOSTILE_STRINGS) },
  { weight: 2, arbitrary: fc.string() },
  { weight: 1, arbitrary: fc.string({ unit: 'binary' }) },
);

/** A value of the wrong kind for whatever field it lands in. */
export const hostileValueArb: fc.Arbitrary<unknown> = fc.oneof(
  fc.constantFrom(null, undefined, true, false, 0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, [], {}),
  hostileStringArb,
  fc.jsonValue({ maxDepth: 2 }),
);

type Path = (string | number)[];

function pathsOf(value: unknown, path: Path = [], out: Path[] = []): Path[] {
  out.push(path);
  if (Array.isArray(value)) {
    value.forEach((item, index) => pathsOf(item, [...path, index], out));
  } else if (value && typeof value === 'object') {
    for (const [key, item] of Object.entries(value)) pathsOf(item, [...path, key], out);
  }
  return out;
}

type Mutation = { kind: 'replace'; value: unknown } | { kind: 'delete' } | { kind: 'wrap' };

function mutateAt(value: unknown, path: Path, mutation: Mutation): unknown {
  if (path.length === 0) {
    if (mutation.kind === 'replace') return mutation.value;
    if (mutation.kind === 'wrap') return [value];
    return undefined;
  }
  const [head, ...rest] = path;
  if (Array.isArray(value)) {
    const copy = [...value];
    if (rest.length === 0 && mutation.kind === 'delete') copy.splice(head as number, 1);
    else copy[head as number] = mutateAt(copy[head as number], rest, mutation);
    return copy;
  }
  const copy = { ...(value as Record<string, unknown>) };
  if (rest.length === 0 && mutation.kind === 'delete') delete copy[head as string];
  else copy[head as string] = mutateAt(copy[head as string], rest, mutation);
  return copy;
}

/**
 * `valid` with one node broken: a field replaced by a value of the wrong
 * kind, a field or array item removed, or a value wrapped in an array. Feed
 * it to a mapper or validator to check that a malformed payload is rejected
 * (or tolerated by design), never half-mapped.
 */
export function corruptedArb(valid: unknown): fc.Arbitrary<unknown> {
  const paths = pathsOf(valid);
  const mutationArb: fc.Arbitrary<Mutation> = fc.oneof(
    { weight: 3, arbitrary: hostileValueArb.map((value): Mutation => ({ kind: 'replace', value })) },
    { weight: 1, arbitrary: fc.constant<Mutation>({ kind: 'delete' }) },
    { weight: 1, arbitrary: fc.constant<Mutation>({ kind: 'wrap' }) },
  );
  return fc
    .tuple(fc.nat({ max: paths.length - 1 }), mutationArb)
    .map(([index, mutation]) => mutateAt(valid, paths[index], mutation));
}
