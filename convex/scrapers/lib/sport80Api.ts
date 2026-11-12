import { daysBetween, isoDaysAfter } from '../../lib/dates';
import { errorMessage } from '../../lib/errors';
import { rowCount } from '../../lib/json';
import { pageRows, readSport80Env, readTablePage, USAW_DOMAIN, type Sport80Env } from '../parse/sport80';
import { retryable, withRetries, type RetryPolicy } from './http';
import { gaveUp, TRANSIENT_RETRY } from './transientFetch';

type Dict = Record<string, unknown>;

const MAX_PAGES = 50;
const REQUEST_TIMEOUT_MS = 60_000;
const EVENT_INDEX_PAGE_ROWS = 1000;
const TABLE_PAGE_ROWS = 2000;
export const RANKINGS_PAGE_ROWS = [2000, 1000, 500] as const;
export const RANKINGS_UNSPLIT_DAYS = 366;
export const MAX_RANKINGS_RANGES = 64;

export type DateRange = readonly [start: string, end: string];

export type RankingsReading = { deadline?: number; wholeTables?: boolean; retryDroppedConnections?: boolean };

const ONE_TRY: RetryPolicy = { attempts: 1, delayMs: () => 0 };

const droppedConnection = (error: unknown) => retryable(error) || (error instanceof Error && 'cause' in error && retryable(error.cause));

type TableRead = { rows: Dict[]; notWhole?: string; shifted?: boolean };

export function halvesOf([start, end]: DateRange, unsplitDays = RANKINGS_UNSPLIT_DAYS): [DateRange, DateRange] | null {
  const days = daysBetween(start, end);
  if (end < start || days <= unsplitDays) return null;
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

export function joinPages(pages: readonly Dict[][], total: unknown): TableRead {
  const rows = pages.flat();
  const reported = rowCount(total);
  if (typeof total === 'number' && reported === null) throw new Error(`read ${rows.length} rows of the ${total} the table reports`);
  if (reported === null) return { rows, notWhole: 'the table reports no row count' };
  if (!tableComplete(rows.length, reported)) throw new Error(`read ${rows.length} rows of the ${reported} the table reports`);
  const earlier = new Set<string>();
  for (const page of pages) {
    const keys = page.map((row) => JSON.stringify(row));
    if (keys.some((key) => earlier.has(key))) return { rows, notWhole: 'a row came back on two pages (their order shifted)', shifted: true };
    for (const key of keys) earlier.add(key);
  }
  return { rows };
}

const isServerError = (error: unknown): error is Sport80HttpError => error instanceof Sport80HttpError && error.isServerError;

const rangeFailure = ([start, end]: DateRange, reason: unknown) => new Error(`${start} to ${end}: ${errorMessage(reason)}`);

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

  private async request(method: 'GET' | 'POST', url: string, payload?: Dict, retry: RetryPolicy = ONE_TRY): Promise<Dict> {
    const path = new URL(url).pathname;
    return await withRetries(
      async () => {
        const response = await fetch(url, {
          method,
          headers: this.headers(),
          body: payload === undefined ? undefined : JSON.stringify(payload),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        if (!response.ok) throw new Sport80HttpError(method, path, response.status);
        return readTablePage(await response.json());
      },
      retry,
      (error, attempts) => (attempts > 1 && retryable(error) ? gaveUp(path, method)(error, attempts) : error),
    );
  }

  private async collate(first: Dict, payload?: Dict, retry: RetryPolicy = ONE_TRY): Promise<TableRead> {
    const pages: Dict[][] = [pageRows(first)];
    let current = first;
    for (let page = 1; typeof current.next_page_url === 'string' && current.next_page_url; page++) {
      if (page > MAX_PAGES) throw new Error(`table has over ${MAX_PAGES} pages`);
      current = await this.request('POST', current.next_page_url, payload, retry);
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

  private async rankingsRange(classId: number, [start, end]: DateRange, pageSizes: readonly number[], retry: RetryPolicy): Promise<TableRead> {
    const payload = { date_range_start: start, date_range_end: end, weight_class: classId };
    let serverError: Sport80HttpError | null = null;
    for (const rows of pageSizes) {
      try {
        return await this.collate(await this.request('POST', this.url('/api/categories/all/rankings/table/data', rows), payload, retry), payload, retry);
      } catch (error) {
        if (!isServerError(error)) throw error;
        serverError = error;
      }
    }
    throw serverError ?? new Error(`sport80: rankings of class ${classId} not read`);
  }

  async rankings(
    classId: number,
    start: string,
    end: string,
    { deadline = Infinity, wholeTables = false, retryDroppedConnections = false }: RankingsReading = {},
  ): Promise<Dict[]> {
    const dropped = (error: unknown) => retryDroppedConnections && droppedConnection(error);
    const retry: RetryPolicy = retryDroppedConnections
      ? { ...TRANSIENT_RETRY, retryIf: (error) => (TRANSIENT_RETRY.retryIf?.(error) ?? true) && Date.now() < deadline }
      : ONE_TRY;
    const pending: DateRange[] = [[start, end]];
    const parts: Dict[][] = [];
    for (let asked = 0; asked < MAX_RANKINGS_RANGES; asked++) {
      const range = pending.shift();
      if (range === undefined) return parts.flat();
      if (Date.now() >= deadline) throw rangeFailure(range, `not read in time, with ${pending.length} more range(s) after it`);
      const halves = halvesOf(range);
      let table: TableRead;
      try {
        table = await this.rankingsRange(classId, range, halves ? RANKINGS_PAGE_ROWS.slice(0, 1) : RANKINGS_PAGE_ROWS, retry);
      } catch (error) {
        if (!halves || !(isServerError(error) || dropped(error))) throw rangeFailure(range, error);
        pending.unshift(...halves);
        continue;
      }
      if (table.notWhole === undefined || !wholeTables) {
        parts.push(table.rows);
        continue;
      }
      const smaller = table.shifted ? halvesOf(range, 0) : null;
      if (!smaller) throw rangeFailure(range, table.notWhole);
      pending.unshift(...smaller);
    }
    const [unread] = pending;
    if (unread === undefined) return parts.flat();
    throw rangeFailure(unread, `still not read after ${MAX_RANKINGS_RANGES} ranges were asked, with ${pending.length - 1} more after it`);
  }

  async athleteResults(athleteId: string): Promise<Dict[]> {
    return (await this.collate(await this.request('POST', this.url(`/api/athletes/${athleteId}/table/data`, TABLE_PAGE_ROWS)))).rows;
  }
}
