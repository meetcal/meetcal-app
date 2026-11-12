import { daysBetween, isoDaysAfter } from '../../lib/dates';
import { rowCount } from '../../lib/json';
import { pageRows, readSport80Env, readTablePage, USAW_DOMAIN, type Sport80Env } from '../parse/sport80';

type Dict = Record<string, unknown>;

const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 60_000;
const EVENT_INDEX_PAGE_ROWS = 1000;
const TABLE_PAGE_ROWS = 2000;
export const RANKINGS_PAGE_ROWS = [2000, 1000, 500] as const;
export const RANKINGS_UNSPLIT_DAYS = 366;

export type DateRange = readonly [start: string, end: string];

export function halvesOf([start, end]: DateRange): [DateRange, DateRange] | null {
  const days = daysBetween(start, end);
  if (days <= RANKINGS_UNSPLIT_DAYS) return null;
  const firstEnd = isoDaysAfter(start, Math.floor(days / 2));
  return [
    [start, firstEnd],
    [isoDaysAfter(firstEnd, 1), end],
  ];
}

export class Sport80HttpError extends Error {
  constructor(
    readonly method: string,
    readonly path: string,
    readonly status: number,
  ) {
    super(`${method} ${path} failed with ${status}`);
  }

  get isServerError(): boolean {
    return this.status >= 500;
  }
}

export function tableComplete(rows: number, total: unknown): boolean {
  return rowCount(total) === rows;
}

export function joinPages(pages: readonly Dict[][], total: unknown): { rows: Dict[]; notWhole?: string } {
  const rows = pages.flat();
  const reported = rowCount(total);
  if (typeof total === 'number' && reported === null) throw new Error(`read ${rows.length} rows of the ${total} the table reports`);
  if (reported === null) return { rows, notWhole: 'the table reports no row count' };
  if (!tableComplete(rows.length, reported)) throw new Error(`read ${rows.length} rows of the ${reported} the table reports`);
  const earlier = new Set<string>();
  for (const page of pages) {
    const keys = page.map((row) => JSON.stringify(row));
    if (keys.some((key) => earlier.has(key))) return { rows, notWhole: 'a row came back on two pages (their order shifted)' };
    for (const key of keys) earlier.add(key);
  }
  return { rows };
}

export class Sport80 {
  private constructor(private readonly env: Sport80Env) {}

  static async connect(): Promise<Sport80> {
    const response = await fetch(`${USAW_DOMAIN}/public/rankings/`, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    if (!response.ok) throw new Error(`sport80: rankings page failed with ${response.status}`);
    const page = await response.text();
    const match = /window\.env = ({.*?});/s.exec(page);
    if (!match) throw new Error('sport80: window.env not found on the rankings page');
    return new Sport80(readSport80Env(match[1] ?? ''));
  }

  private headers() {
    return {
      'X-API-TOKEN': this.env.SERVICES_API_PUBLIC_KEY,
      authority: this.env.RANKINGS_DOMAIN_URL,
      accept: 'application/json',
      'Content-Type': 'application/json',
    };
  }

  private async request(method: 'GET' | 'POST', url: string, payload?: Dict): Promise<Dict> {
    const response = await fetch(url, {
      method,
      headers: this.headers(),
      body: payload === undefined ? undefined : JSON.stringify(payload),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if (!response.ok) throw new Sport80HttpError(method, new URL(url).pathname, response.status);
    return readTablePage(await response.json());
  }

  private async collate(first: Dict, payload?: Dict): Promise<{ rows: Dict[]; notWhole?: string }> {
    const pages: Dict[][] = [pageRows(first)];
    let current = first;
    for (let page = 1; typeof current.next_page_url === 'string' && current.next_page_url; page++) {
      if (page > MAX_PAGES) throw new Error(`table has over ${MAX_PAGES} pages`);
      current = await this.request('POST', current.next_page_url, payload);
      pages.push(pageRows(current));
    }
    return joinPages(pages, first.total);
  }

  private url(path: string, rows?: number): string {
    const query = rows === undefined ? '' : `?p=0&l=${rows}&s=`;
    return new URL(`${path}${query}`, this.env.RANKINGS_DOMAIN_URL).toString();
  }

  async eventIndex(year: number): Promise<Dict[]> {
    const payload = { date_range_start: `${year}-01-01`, date_range_end: `${year}-12-31` };
    return (await this.collate(await this.request('POST', this.url('/api/events/table/data', EVENT_INDEX_PAGE_ROWS), payload), payload)).rows;
  }

  async eventResults(eventId: string): Promise<{ rows: Dict[]; notWhole?: string }> {
    return await this.collate(await this.request('POST', this.url(`/api/events/${eventId}/table/data`, TABLE_PAGE_ROWS)));
  }

  async rankingsTable(): Promise<Dict> {
    return await this.request('GET', this.url('/api/categories/rankings/table'));
  }

  async rankings(classId: number, start: string, end: string): Promise<Dict[]> {
    const payload = { date_range_start: start, date_range_end: end, weight_class: classId };
    const halves = halvesOf([start, end]);
    let serverError: Sport80HttpError | null = null;
    for (const rows of halves ? RANKINGS_PAGE_ROWS.slice(0, 1) : RANKINGS_PAGE_ROWS) {
      try {
        return (await this.collate(await this.request('POST', this.url('/api/categories/all/rankings/table/data', rows), payload), payload)).rows;
      } catch (error) {
        if (!(error instanceof Sport80HttpError) || !error.isServerError) throw error;
        serverError = error;
      }
    }
    if (halves) return [...(await this.rankings(classId, ...halves[0])), ...(await this.rankings(classId, ...halves[1]))];
    throw serverError ?? new Error(`sport80: rankings of class ${classId} not read`);
  }

  async athleteResults(athleteId: string): Promise<Dict[]> {
    return (await this.collate(await this.request('POST', this.url(`/api/athletes/${athleteId}/table/data`, TABLE_PAGE_ROWS)))).rows;
  }
}
