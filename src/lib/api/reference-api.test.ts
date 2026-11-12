import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { fetchApiAdaptiveRecords, fetchApiIntlRankings, fetchApiNationalRankings, fetchApiQualifyingTotals, fetchApiRecords, fetchApiStandards, fetchApiWsoList, fetchApiWsoRecords } from '@/lib/api/reference-api';
import { fetchApiMeetByName, fetchApiMeets, fetchApiSchedule } from '@/lib/api/meets-api';
import { fetchApiClubNames } from '@/lib/api/clubs-api';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { callQuery, isClockCall } from './json-transport-stub';
import { setApiTransportForTests, TransportRequestError, type ApiCall } from './transport';

type Responder = (call: ApiCall) => unknown;

function installTransport(respond: Responder, clock: Responder = () => Date.now()) {
  const transport = jest.fn(
    async (call: ApiCall): Promise<unknown> => (isClockCall(call) ? clock(call) : respond(call)),
  );
  setApiTransportForTests(transport);
  const allCalls = (): ApiCall[] => transport.mock.calls.map(([{ signal: _signal, ...call }]) => call);
  const dataCalls = (): ApiCall[] => allCalls().filter((call) => !isClockCall(call));
  const clockCalls = (): ApiCall[] => allCalls().filter((call) => isClockCall(call));
  const lastCall = (): ApiCall => {
    const calls = dataCalls();
    if (calls.length === 0) throw new Error('no data call was made');
    return calls[calls.length - 1];
  };
  return { transport, dataCalls, clockCalls, lastCall };
}

function apiFailure(status: number, data: Record<string, unknown> = { error: 'failed' }) {
  return new TransportRequestError(
    `query failed with ${status}`,
    status,
    JSON.stringify({ status, ...data }),
  );
}

type Reply = { etag?: string | null; body?: unknown; json?: unknown } | { fail: number };

function queueTransport(replies: Reply[]) {
  const fake = installTransport(() => {
    const reply = replies.shift();
    if (!reply) throw new Error('unexpected call');
    if ('fail' in reply) throw apiFailure(reply.fail);
    return reply;
  });
  return { ...fake, sentTag: (index: number) => fake.dataCalls()[index].args.ifNoneMatch };
}

beforeEach(() => {
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  setApiTransportForTests(null);
  resetServerClockForTests();
  clearHttpValidatorCache();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('conditional reads for reference data', () => {
  const recordRow = (overrides: Record<string, unknown> = {}) => ({
    age_category: 'Senior',
    gender: 'Men',
    weight_class: '89kg',
    record_type: 'USAW',
    snatch_record: 170,
    cj_record: 210,
    total_record: 380,
    ...overrides,
  });

  it('answers a bodiless reply with the stored rows, checked again', async () => {
    const { sentTag } = queueTransport([
      { etag: '"r1"', body: [recordRow()] },
      { etag: '"r1"' },
    ]);

    const first = await fetchApiRecords();
    const second = await fetchApiRecords();

    expect(sentTag(0)).toBeUndefined();
    expect(sentTag(1)).toBe('"r1"');
    expect(second).toEqual(first);
    expect(second).toEqual([recordRow()]);
  });

  it('hands out frozen rows, so a caller cannot rewrite what the next unchanged answer returns', async () => {
    queueTransport([
      { etag: '"r1"', body: [recordRow()] },
      { etag: '"r1"' },
    ]);

    const rows = await fetchApiRecords();
    expect(Object.isFrozen(rows)).toBe(true);
    expect(Object.isFrozen(rows[0])).toBe(true);
    try {
      (rows[0] as { total_record: number | null }).total_record = 1;
    } catch {
    }
    expect(rows[0].total_record).toBe(380);
    await expect(fetchApiRecords()).resolves.toEqual([recordRow()]);
  });

  it('returns a fresh copy of a cached string list on every call', async () => {
    queueTransport([
      { etag: '"w1"', body: ['Ohio', 'Carolina'] },
      { etag: '"w1"' },
    ]);

    const first = await fetchApiWsoList();
    first.sort();
    first.push('Mutated');
    await expect(fetchApiWsoList()).resolves.toEqual(['Ohio', 'Carolina']);
  });

  it('replaces the remembered rows when the etag changes', async () => {
    const { sentTag } = queueTransport([
      { etag: '"s1"', body: [{ age_category: 'Senior', gender: 'Men', weight_class: '89kg', standard_a: 300, standard_b: 280 }] },
      { etag: '"s2"', body: [{ age_category: 'Senior', gender: 'Men', weight_class: '89kg', standard_a: 310, standard_b: 290 }] },
      { etag: '"s2"' },
    ]);

    await fetchApiStandards();
    await expect(fetchApiStandards()).resolves.toMatchObject([{ standard_a: 310 }]);
    expect(sentTag(1)).toBe('"s1"');
    await expect(fetchApiStandards()).resolves.toMatchObject([{ standard_a: 310 }]);
    expect(sentTag(2)).toBe('"s2"');
  });

  it('passes straight through when the query answers without an etag', async () => {
    const row = {
      meet: 'Worlds',
      ranking: 1,
      name: 'Athlete A',
      weight_class: '89kg',
      total: 380,
      percent_a: 101.5,
      gender: 'Men',
      age_category: 'Senior',
    };
    const { sentTag } = queueTransport([
      { etag: null, body: [row] },
      { etag: null, body: [{ ...row, total: 385 }] },
    ]);

    await expect(fetchApiIntlRankings()).resolves.toEqual([row]);
    await expect(fetchApiIntlRankings()).resolves.toEqual([{ ...row, total: 385 }]);
    expect(sentTag(0)).toBeUndefined();
    expect(sentTag(1)).toBeUndefined();
  });

  it('throws on a body that fails validation and caches nothing', async () => {
    const { sentTag } = queueTransport([
      { etag: '"bad"', body: { error: 'wrapped' } },
      { etag: '"q1"', body: [] },
      { etag: '"c-bad"', body: ['Club A', 7] },
      { etag: '"c1"', body: ['Club A'] },
    ]);

    await expect(fetchApiQualifyingTotals()).rejects.toThrow(
      '/data/qualifying-totals expected an array response',
    );
    await expect(fetchApiQualifyingTotals()).resolves.toEqual([]);
    expect(sentTag(1)).toBeUndefined();

    await expect(fetchApiClubNames()).rejects.toThrow('/clubs expected a string array response');
    await expect(fetchApiClubNames()).resolves.toEqual(['Club A']);
    expect(sentTag(3)).toBeUndefined();
  });

  it('reads a wrong-typed column as null and skips a non-object row', async () => {
    queueTransport([
      {
        etag: '"q1"',
        body: [
          { event_name: 'Nationals', age_category: 'Senior', gender: 'Men', weight_class: '89kg', qualifying_total: '300', extra: 1 },
          null,
          'row',
          [1, 2],
        ],
      },
    ]);

    await expect(fetchApiQualifyingTotals()).resolves.toEqual([
      {
        event_name: 'Nationals',
        age_category: 'Senior',
        gender: 'Men',
        weight_class: '89kg',
        qualifying_total: null,
      },
    ]);
  });

  it('remembers each query variant under its own arguments', async () => {
    const { dataCalls } = installTransport((call) => {
      const key = [call.args.ageCategory ?? '', call.args.gender ?? '', call.args.wso ?? ''].join('|');
      const tag = `"${key}"`;
      if (call.args.ifNoneMatch === tag) return { etag: tag };
      return { etag: tag, body: [{ name: key, total: 1, weight_class: '71kg', snatch: 1, cj: 1 }] };
    });

    for (let pass = 0; pass < 2; pass += 1) {
      await expect(fetchApiNationalRankings('USAW', 'Senior 89')).resolves.toMatchObject([{ name: 'Senior 89||' }]);
      await expect(fetchApiNationalRankings('USAW', 'Junior 89')).resolves.toMatchObject([{ name: 'Junior 89||' }]);
      await expect(fetchApiAdaptiveRecords('Men', 'BWL')).resolves.toMatchObject([{ weight_class: '71kg' }]);
      await expect(fetchApiAdaptiveRecords('Women', 'BWL')).resolves.toMatchObject([{ weight_class: '71kg' }]);
      await expect(fetchApiWsoRecords('Ohio', 'Senior', 'Men')).resolves.toHaveLength(1);
    }

    const validators = dataCalls().map((call) => call.args.ifNoneMatch);
    expect(validators.slice(0, 5)).toEqual([undefined, undefined, undefined, undefined, undefined]);
    expect(validators.slice(5)).toEqual([
      '"Senior 89||"',
      '"Junior 89||"',
      '"|Men|"',
      '"|Women|"',
      '"Senior|Men|Ohio"',
    ]);
  });

  it('treats an omitted optional argument like an absent one', async () => {
    const { sentTag } = queueTransport([
      { etag: '"o1"', body: [] },
      { etag: '"o1"' },
    ]);

    await fetchApiWsoRecords('Ohio');
    await fetchApiWsoRecords('Ohio', undefined, undefined);
    expect(sentTag(1)).toBe('"o1"');
  });

  it('keeps the meets tag through a session of reference-data browsing', async () => {
    jest.useFakeTimers({ now: new Date('2026-06-20T12:30:00.000Z') });
    const tagFor = (call: ApiCall) =>
      `"${call.fn}?${new URLSearchParams(callQuery(call)).toString()}"`;
    const { dataCalls, transport } = installTransport((call) => {
      const tag = tagFor(call);
      if (call.args.ifNoneMatch === tag) return { etag: tag };
      let body: unknown = [];
      if (call.fn === 'meets:list') body = [];
      else if (call.fn === 'meets:details') body = { name: 'M', start_date: '2026-06-20', end_date: '2026-06-21', time_zone: 'America/New_York' };
      else if (call.fn === 'reference:wsoList' || call.fn === 'reference:clubs') body = ['A'];
      return { etag: tag, body };
    });

    await fetchApiMeets();
    await fetchApiRecords();
    await fetchApiStandards();
    await fetchApiQualifyingTotals();
    await fetchApiIntlRankings();
    await fetchApiWsoList();
    await fetchApiClubNames();
    await fetchApiAdaptiveRecords('Men', 'BWL');
    await fetchApiAdaptiveRecords('Women', 'BWL');
    for (let i = 0; i < 8; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
      await fetchApiSchedule(`Meet ${i}`);
    }
    for (let i = 0; i < 30; i += 1) {
      await fetchApiNationalRankings('USAW', `Category ${i}`);
    }

    transport.mockClear();
    await fetchApiMeets();
    const [meetsCall] = dataCalls();
    expect(meetsCall.fn).toBe('meets:list');
    expect(meetsCall.args.ifNoneMatch).toBe(tagFor(meetsCall));
  });
});
