import { daysBetween } from '../../convex/lib/dates';
import { halvesOf, RANKINGS_PAGE_ROWS, RANKINGS_UNSPLIT_DAYS, Sport80 } from '../../convex/scrapers/lib/sport80Api';

type Request = { start: string; end: string; rows: number };

function fakeSport80(answer: (request: Request) => Response) {
  const requests: Request[] = [];
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
    const url = new URL(String(input));
    if (url.pathname === '/public/rankings/') return new Response('window.env = {"SERVICES_API_PUBLIC_KEY":"k","RANKINGS_DOMAIN_URL":"https://api.test"};');
    const body = JSON.parse(String(init?.body)) as { date_range_start: string; date_range_end: string };
    const request = { start: body.date_range_start, end: body.date_range_end, rows: Number(url.searchParams.get('l')) };
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

  it('halves again until each part answers, reaching every day of an all-time range', async () => {
    fakeSport80(failsOverAYear);
    const rows = await (await Sport80.connect()).rankings(938, '1900-01-01', '2026-11-12');
    const bounds = rows.flatMap((row) => String(row.lifter).split('..'));
    expect(bounds.at(0)).toBe('1900-01-01');
    expect(bounds.at(-1)).toBe('2026-11-12');
    const gaps = bounds.slice(1, -1).flatMap((date, i, inner) => (i % 2 === 0 ? [daysBetween(date, inner[i + 1] ?? date)] : []));
    expect(gaps.length).toBe(rows.length - 1);
    expect(new Set(gaps)).toEqual(new Set([1]));
  });

  it('tries smaller pages on a range of a year or less, then fails naming the status', async () => {
    const requests = fakeSport80(() => new Response('', { status: 502 }));
    await expect((await Sport80.connect()).rankings(938, '2026-01-01', '2026-06-30')).rejects.toThrow('failed with 502');
    expect(requests.map((r) => r.rows)).toEqual([...RANKINGS_PAGE_ROWS]);
  });

  it('does not split on an error that is not the server failing', async () => {
    const requests = fakeSport80(() => new Response('', { status: 403 }));
    await expect((await Sport80.connect()).rankings(938, '2020-01-01', '2023-12-31')).rejects.toThrow('failed with 403');
    expect(requests).toHaveLength(1);
  });
});
