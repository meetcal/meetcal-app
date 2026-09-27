// Meet entries from Sport80 (replaces `usaw/entry_scraper/csv_scraper.js`).
// The Node scraper drove a headless browser through the public entries page;
// the table on that page is filled from a public JSON endpoint, which this
// reads directly: `/api/public/events/datatable/{event}/entries/{stage}`,
// 100 rows a page, the meet's name in the table's title.

export const SPORT80 = 'https://usaweightlifting.sport80.com';

/** The entries data endpoint behind a public entries page URL. */
export function entriesEndpoint(pageUrl: string): string {
  const match = /\/public\/events\/(\d+)\/entries\/(\d+)/.exec(pageUrl);
  if (!match) throw new Error(`not a Sport80 entries page: ${pageUrl}`);
  return `${SPORT80}/api/public/events/datatable/${match[1]}/entries/${match[2]}`;
}

/** The table title without its " - Members" suffix, as the page's heading read. */
export function meetFromTitle(title: string): string {
  const trimmed = title.trim();
  return trimmed.endsWith(' - Members') ? trimmed.slice(0, -' - Members'.length) : trimmed;
}

/**
 * The shared stand-in for a missing membership number (`placeholder_member_id`
 * in the Python writer): athletes without one are keyed on meet and name.
 */
export function placeholderMemberId(name: string): string {
  const normalized = name.split(/\s+/).filter(Boolean).join(' ').toLowerCase();
  return `noid:${normalized.replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')}`;
}

export type EntryRow = {
  id?: number;
  member_id?: string | null;
  first_name?: string | null;
  last_name?: string | null;
  weightlifting_age?: number | string | null;
  club?: string | null;
  gender?: string | null;
  weight_class?: string | null;
  entry_total?: number | string | null;
};

export type Entry = {
  memberId: string;
  name: string;
  age: number;
  club: string;
  gender: string;
  weightClass: string;
  entryTotal: number;
  meet: string;
};

/** JavaScript's `parseInt`, with the writer's default of 0 where it gives NaN. */
function whole(value: number | string | null | undefined): number {
  const parsed = parseInt(String(value ?? '').trim(), 10);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/**
 * One entry as the Node scraper built it: the last name cut at its first
 * space ("Mullen (She/her)" -> "Mullen"; pronouns follow the name), a
 * missing membership number replaced by its placeholder.
 */
export function entryFromRow(row: EntryRow, meet: string): Entry {
  const first = (row.first_name ?? '').trim();
  const last = (row.last_name ?? '').trim().split(' ')[0];
  const name = `${first} ${last}`;
  const memberId = (row.member_id ?? '').trim();
  return {
    memberId: memberId || placeholderMemberId(name),
    name,
    age: whole(row.weightlifting_age),
    club: (row.club ?? '').trim(),
    gender: (row.gender ?? '').trim(),
    weightClass: (row.weight_class ?? '').trim(),
    entryTotal: whole(row.entry_total),
    meet,
  };
}
