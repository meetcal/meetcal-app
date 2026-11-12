import { daysBetween } from '../../convex/lib/dates';
import { halvesOf, MAX_RANKINGS_RANGES, RANKINGS_PAGE_ROWS, RANKINGS_UNSPLIT_DAYS, Sport80 } from '../../convex/scrapers/lib/sport80Api';
import { TRANSIENT_RETRY } from '../../convex/scrapers/lib/transientFetch';

type Request = { start: string; end: string; rows: number; page: string | null };

function fakeSport80(answer: (request: Request) => Response) {
  const requests: Request[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/public/rankings/') return new Response('window.env = {"SERVICES_API_PUBLIC_KEY":"k","RANKINGS_DOMAIN_URL":"https://api.test"};');
    const body = JSON.parse(String(init?.body)) as { date_range_start: string; date_range_end: string };
    const request = { start: body.date_range_start, end: body.date_range_end, rows: Number(url.searchParams.get('l')), page: url.searchParams.get('page') };
    requests.push(request);
    return answer(request);
  });
  return requests;
}

const rowsFor = ({ start, end }: Request) => Response.json({ data: [{ lifter: `${start}..${end}` }], total: 1 });
const failsOverAYear = (request: Request) =>
  daysBetween(request.start, request.end) > RANKINGS_UNSPLIT_DAYS ? new Response('', { status: 502 }) : rowsFor(request);

afterEach(() => jest.restoreAllMocks());

describe('halving a rankings date range', () => {
  it('splits a range longer than a year into two that cover it without overlap', () => {
    expect(halvesOf(['2020-01-01', '2023-12-31'])).toEqual([
      ['2020-01-01', '2021-12-31'],
      ['2022-01-01', '2023-12-31'],
    ]);
  });

  it('leaves a range of a year or less whole', () => {
    expect(halvesOf(['2025-01-01', '2026-01-02'])).toBeNull();
    expect(halvesOf(['2026-03-01', '2026-04-15'])).toBeNull();
  });

  it('halves down to single days when asked to, and leaves one day whole', () => {
    expect(halvesOf(['2026-11-11', '2026-11-12'], 0)).toEqual([
      ['2026-11-11', '2026-11-11'],
      ['2026-11-12', '2026-11-12'],
    ]);
    expect(halvesOf(['2026-11-12', '2026-11-12'], 0)).toBeNull();
  });

  it('leaves a range that ends before it starts whole, so a failing one is never widened', () => {
    expect(halvesOf(['2028-06-01', '2026-11-12'])).toBeNull();
  });
});

describe('reading a class whose full range Sport80 cannot answer', () => {
  it('reads it in halves and joins their rows in date order', async () => {
    const requests = fakeSport80((request) => (request.start === '2020-01-01' && request.end === '2023-12-31' ? new Response('', { status: 502 }) : rowsFor(request)));
    const rows = await (await Sport80.connect()).rankings(938, '2020-01-01', '2023-12-31');
    expect(rows).toEqual([{ lifter: '2020-01-01..2021-12-31' }, { lifter: '2022-01-01..2023-12-31' }]);
    expect(requests.filter((r) => r.start === '2020-01-01' && r.end === '2023-12-31').map((r) => r.rows)).toEqual([RANKINGS_PAGE_ROWS[0]]);
  });

  it('halves again until each part answers, reaching every day of a long range', async () => {
    fakeSport80(failsOverAYear);
    const rows = await (await Sport80.connect()).rankings(938, '2011-01-01', '2026-11-12');
    const bounds = rows.flatMap((row) => String(row.lifter).split('..'));
    expect(bounds.at(0)).toBe('2011-01-01');
    expect(bounds.at(-1)).toBe('2026-11-12');
    const gaps = bounds.slice(1, -1).flatMap((date, i, inner) => (i % 2 === 0 ? [daysBetween(date, inner[i + 1] ?? date)] : []));
    expect(gaps.length).toBe(rows.length - 1);
    expect(new Set(gaps)).toEqual(new Set([1]));
  });

  it('tries smaller pages on a range of a year or less, then fails naming the status', async () => {
    const requests = fakeSport80(() => new Response('', { status: 502 }));
    await expect((await Sport80.connect()).rankings(938, '2026-01-01', '2026-06-30')).rejects.toThrow('2026-01-01 to 2026-06-30: POST /api/categories/all/rankings/table/data failed with 502');
    expect(requests.map((r) => r.rows)).toEqual([...RANKINGS_PAGE_ROWS]);
  });

  it('does not split on an error that is not the server failing', async () => {
    const requests = fakeSport80(() => new Response('', { status: 403 }));
    await expect((await Sport80.connect()).rankings(938, '2020-01-01', '2023-12-31')).rejects.toThrow('failed with 403');
    expect(requests).toHaveLength(1);
  });
});

describe('the bounds on one class read', () => {
  it(`asks at most ${MAX_RANKINGS_RANGES} ranges, then fails naming the first it did not read`, async () => {
    const requests = fakeSport80(failsOverAYear);
    await expect((await Sport80.connect()).rankings(938, '1900-01-01', '2026-11-12')).rejects.toThrow(`still not read after ${MAX_RANKINGS_RANGES} ranges were asked`);
    expect(requests).toHaveLength(MAX_RANKINGS_RANGES);
  });

  it('stops halving once its time is spent, naming the range it did not read', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const requests = fakeSport80((request) => {
      now += 1;
      return failsOverAYear(request);
    });
    const api = await Sport80.connect();
    now = 0;
    await expect(api.rankings(938, '1900-01-01', '2026-11-12', { deadline: 2 })).rejects.toThrow('1900-01-01 to 1931-09-20: not read in time, with 2 more range(s) after it');
    expect(requests).toHaveLength(2);
  });
});

describe('a range whose rows shift between pages', () => {
  const shiftedOverAWeek = (request: Request) => {
    if (request.page === '2') return Response.json({ data: [{ lifter: 'tied' }] });
    if (daysBetween(request.start, request.end) <= 7) return rowsFor(request);
    return Response.json({ data: [{ lifter: 'first' }, { lifter: 'tied' }], total: 3, next_page_url: 'https://api.test/api/categories/all/rankings/table/data?p=0&l=2000&s=&page=2' });
  };

  it('is read as it comes on a night, as before', async () => {
    fakeSport80(shiftedOverAWeek);
    const rows = await (await Sport80.connect()).rankings(938, '2026-09-01', '2026-11-12');
    expect(rows).toEqual([{ lifter: 'first' }, { lifter: 'tied' }, { lifter: 'tied' }]);
  });

  it('is read again in halves by the backfill, as a lifter tied at the page break may be missing from it', async () => {
    fakeSport80(shiftedOverAWeek);
    const rows = await (await Sport80.connect()).rankings(938, '2026-09-01', '2026-11-12', { wholeTables: true });
    expect(rows.length).toBeGreaterThan(1);
    expect(rows.every((row) => String(row.lifter).includes('..'))).toBe(true);
  });

  it('fails the backfill’s read at once, without splitting, when the table reports no row count', async () => {
    const requests = fakeSport80(() => Response.json({ data: [{ lifter: 'only' }] }));
    await expect((await Sport80.connect()).rankings(938, '2026-09-01', '2026-11-12', { wholeTables: true })).rejects.toThrow(
      '2026-09-01 to 2026-11-12: the table reports no row count',
    );
    expect(requests).toHaveLength(1);
  });

  it('fails the backfill’s read when a single day still shifts', async () => {
    fakeSport80((request) =>
      request.page === '2'
        ? Response.json({ data: [{ lifter: 'tied' }] })
        : Response.json({ data: [{ lifter: 'first' }, { lifter: 'tied' }], total: 3, next_page_url: 'https://api.test/x?page=2' }),
    );
    await expect((await Sport80.connect()).rankings(938, '2026-11-12', '2026-11-12', { wholeTables: true })).rejects.toThrow(
      '2026-11-12 to 2026-11-12: a row came back on two pages (their order shifted)',
    );
  });
});

describe('a connection Sport80 drops part way through an answer', () => {
  const droppedMidBody = () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('{"data":['));
          controller.error(new TypeError('terminated', { cause: Object.assign(new Error('other side closed'), { code: 'UND_ERR_SOCKET' }) }));
        },
      }),
    );
  const askedFor = (requests: Request[], start: string, end: string) => requests.filter((r) => r.start === start && r.end === end).length;

  beforeEach(() => {
    jest.spyOn(globalThis, 'setTimeout').mockImplementation(((resume: () => void) => {
      resume();
      return 0;
    }) as never);
  });

  it('asks the backfill’s page again and reads the class', async () => {
    let dropped = false;
    const requests = fakeSport80((request) => {
      if (dropped) return rowsFor(request);
      dropped = true;
      return droppedMidBody();
    });
    const rows = await (await Sport80.connect()).rankings(767, '1963-06-09', '2026-11-12', { retryDroppedConnections: true });
    expect(rows).toEqual([{ lifter: '1963-06-09..2026-11-12' }]);
    expect(requests).toHaveLength(2);
  });

  it('reads in halves a long range whose connection keeps dropping, as it would one Sport80 answers with a 5xx', async () => {
    const requests = fakeSport80((request) => (request.start === '1963-06-09' && request.end === '2026-11-12' ? droppedMidBody() : rowsFor(request)));
    const rows = await (await Sport80.connect()).rankings(767, '1963-06-09', '2026-11-12', { retryDroppedConnections: true });
    expect(rows).toEqual([{ lifter: '1963-06-09..1995-02-24' }, { lifter: '1995-02-25..2026-11-12' }]);
    expect(askedFor(requests, '1963-06-09', '2026-11-12')).toBe(TRANSIENT_RETRY.attempts);
  });

  it('fails the class naming the range, the tries and the socket error when even a year keeps dropping', async () => {
    const requests = fakeSport80(() => droppedMidBody());
    await expect((await Sport80.connect()).rankings(767, '2026-01-01', '2026-11-12', { retryDroppedConnections: true })).rejects.toThrow(
      `2026-01-01 to 2026-11-12: POST /api/categories/all/rankings/table/data failed after ${TRANSIENT_RETRY.attempts} attempt(s): terminated (UND_ERR_SOCKET: other side closed)`,
    );
    expect(requests).toHaveLength(TRANSIENT_RETRY.attempts);
  });

  it('asks no page again once the backfill’s time is spent', async () => {
    let now = 0;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const requests = fakeSport80(() => {
      now = 10;
      return droppedMidBody();
    });
    const api = await Sport80.connect();
    now = 0;
    await expect(api.rankings(767, '2026-01-01', '2026-11-12', { deadline: 10, retryDroppedConnections: true })).rejects.toThrow('terminated');
    expect(requests).toHaveLength(1);
  });

  it('fails a nightly read at once, as before', async () => {
    const requests = fakeSport80(() => droppedMidBody());
    await expect((await Sport80.connect()).rankings(767, '1963-06-09', '2026-11-12')).rejects.toThrow('1963-06-09 to 2026-11-12: terminated');
    expect(requests).toHaveLength(1);
  });
});
