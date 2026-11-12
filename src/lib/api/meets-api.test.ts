import { clearHttpValidatorCache } from '@/lib/api/revalidated-reads';
import { fetchApiMeetByName, fetchApiMeets, fetchApiSchedule } from '@/lib/api/meets-api';
import { resetServerClockForTests } from '@/lib/api/server-clock';
import { MeetCalApiError } from '@/lib/api/meetcal-api';
import { HTTP_VALIDATOR_CACHE_LIMIT } from './http-cache';
import { isClockCall } from './json-transport-stub';
import { setApiTransportForTests, TransportRequestError, type ApiCall } from './transport';
import { itemAt } from '@/test-support/checked-access';

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
    return itemAt(calls, -1);
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
  return { ...fake, sentTag: (index: number) => itemAt(fake.dataCalls(), index).args.ifNoneMatch };
}

function meetRow(name: string, venue = 'Hall') {
  return {
    name,
    start_date: '2026-06-20',
    end_date: '2026-06-21',
    time_zone: 'America/New_York',
    status: 'upcoming',
    venue_name: venue,
    venue_city: 'City',
    venue_state: 'ST',
    venue_street: '1 Main',
    venue_zip: '00000',
  };
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

describe('conditional reads for meet queries', () => {
  beforeEach(() => {
    jest.useFakeTimers({ now: new Date('2026-06-20T12:30:00.000Z') });
  });

  it('stores the etag from a full answer and answers a bodiless one with the remembered meets', async () => {
    const { sentTag, dataCalls } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"v1"' },
    ]);

    const first = await fetchApiMeets();
    expect(sentTag(0)).toBeUndefined();

    const second = await fetchApiMeets();
    expect(sentTag(1)).toBe('"v1"');
    expect(dataCalls().every((call) => call.fn === 'meets:list' && call.conditional === true)).toBe(true);
    expect(second).toEqual(first);
    expect(itemAt(second, 0).name).toBe('Meet A');
    expect(second[0]).not.toBe(first[0]);
  });

  it('trusts a bodiless answer that names no tag for the tag that was sent', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      {},
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentTag(1)).toBe('"v1"');
  });

  it('replaces the remembered body when the etag changes', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"v2"', body: [meetRow('Meet B')] },
      { etag: '"v2"' },
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(sentTag(1)).toBe('"v1"');
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(sentTag(2)).toBe('"v2"');
  });

  it('revalidates meet details and schedule per query', async () => {
    const schedule = [
      {
        date: '2026-06-20',
        platform: 'red',
        session_id: 1,
        start_time: '09:00:00',
        weigh_in_time: '07:00:00',
        weight_class: '60kg',
      },
    ];
    const { dataCalls } = installTransport((call) => {
      const isSchedule = call.fn === 'meets:schedule';
      const tag = isSchedule ? '"s1"' : '"d1"';
      if (call.args.ifNoneMatch === tag) return { etag: tag };
      return { etag: tag, body: isSchedule ? schedule : meetRow('Meet A') };
    });

    const first = await fetchApiSchedule('Meet A');
    const second = await fetchApiSchedule('Meet A');
    expect(second).toEqual(first);
    expect(itemAt(second, 0).sessions[0]?.platforms[0]?.platform).toBe('Red');
    const details = await fetchApiMeetByName('Meet A');
    await expect(fetchApiMeetByName('Meet A')).resolves.toEqual(details);

    const validators = dataCalls().map((call) => [call.fn, call.args.ifNoneMatch]);
    expect(validators).toHaveLength(4);
    expect(validators).toEqual(
      expect.arrayContaining([
        ['meets:schedule', undefined],
        ['meets:details', undefined],
        ['meets:schedule', '"s1"'],
        ['meets:details', '"d1"'],
      ]),
    );
  });

  it('does not remember a body that failed shape validation', async () => {
    const { sentTag } = queueTransport([
      { etag: '"bad"', body: { not: 'an array' } },
      { etag: '"v1"', body: [meetRow('Meet A')] },
    ]);

    await expect(fetchApiMeets()).rejects.toThrow('expected an array response');
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentTag(1)).toBeUndefined();
  });

  it('does not remember a schedule with a row that has no usable date or session number', async () => {
    const row = { date: '2026-06-20', platform: 'red', session_id: 1, start_time: '09:00:00', weigh_in_time: '07:00:00', weight_class: '60kg' };
    const { sentTag } = queueTransport([
      { etag: '"bad"', body: [row, { ...row, session_id: '2' }] },
      { etag: '"v1"', body: [row] },
    ]);

    await expect(fetchApiSchedule('Meet A')).rejects.toThrow('/meets/schedule[1] has an invalid date or session_id');
    await expect(fetchApiSchedule('Meet A')).resolves.toMatchObject([{ fullDate: '2026-06-20' }]);
    expect(sentTag(1)).toBeUndefined();
  });

  it('keeps throwing on rejected calls and keeps the tag for next time', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { fail: 500 },
      { etag: '"v1"' },
    ]);

    await fetchApiMeets();
    const failure = await fetchApiMeets().catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(500);
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(sentTag(2)).toBe('"v1"');
  });

  it('still returns 404 as null for meet details, and throws anything else', async () => {
    queueTransport([{ fail: 404 }]);
    await expect(fetchApiMeetByName('Gone Meet')).resolves.toBeNull();

    queueTransport([{ fail: 500 }]);
    const failure = await fetchApiMeetByName('Broken Meet').catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(MeetCalApiError);
    expect((failure as MeetCalApiError).status).toBe(500);
  });

  it('bounds the number of remembered queries', async () => {
    const replies: Reply[] = [];
    for (let i = 0; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      replies.push({ etag: `"d${i}"`, body: meetRow(`Meet ${i}`) });
    }
    replies.push({ etag: '"d0"', body: meetRow('Meet 0') });
    const { sentTag } = queueTransport(replies);

    for (let i = 0; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
    }
    await expect(fetchApiMeetByName('Meet 0')).resolves.toMatchObject({ name: 'Meet 0' });
    expect(sentTag(HTTP_VALIDATOR_CACHE_LIMIT + 1)).toBeUndefined();
  });

  it('answers a bodiless reply from the entry read before the call, even if it was evicted in flight', async () => {
    let releaseFirst: (() => void) | undefined;
    installTransport(async (call) => {
      const name = String(call.args.meet);
      if (call.args.ifNoneMatch) {
        await new Promise<void>((resolve) => {
          releaseFirst = resolve;
        });
        return { etag: call.args.ifNoneMatch };
      }
      return { etag: `"${name}"`, body: meetRow(name) };
    });

    await fetchApiMeetByName('Meet 0');
    const pending = fetchApiMeetByName('Meet 0');
    for (let i = 1; i <= HTTP_VALIDATOR_CACHE_LIMIT; i += 1) {
      await fetchApiMeetByName(`Meet ${i}`);
    }
    expect(releaseFirst).toBeDefined();
    releaseFirst?.();
    await expect(pending).resolves.toMatchObject({ name: 'Meet 0' });
  });

  it('sends one request for identical reads in flight together, and answers each caller with it', async () => {
    let release: (() => void) | undefined;
    const { dataCalls } = installTransport(async (call) => {
      if (call.args.ifNoneMatch) return { etag: '"v1"' };
      await new Promise<void>((resolve) => {
        release = resolve;
      });
      return { etag: '"v1"', body: [meetRow('Meet A')] };
    });

    const first = fetchApiMeets();
    const second = fetchApiMeets();
    await Promise.resolve();
    release?.();
    await expect(first).resolves.toMatchObject([{ name: 'Meet A' }]);
    await expect(second).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(dataCalls()).toHaveLength(1);

    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
    expect(dataCalls()).toHaveLength(2);
    expect(itemAt(dataCalls(), 1).args.ifNoneMatch).toBe('"v1"');
  });

  it('fails every caller of a merged read that failed, and asks again on the next read', async () => {
    const { dataCalls } = queueTransport([{ fail: 503 }, { etag: '"v1"', body: [meetRow('Meet A')] }]);

    const results = await Promise.allSettled([fetchApiMeets(), fetchApiMeets()]);
    expect(results.map((result) => result.status)).toEqual(['rejected', 'rejected']);
    expect(dataCalls()).toHaveLength(1);
    await expect(fetchApiMeets()).resolves.toHaveLength(1);
    expect(dataCalls()).toHaveLength(2);
  });

  it('retries without a tag when a bodiless answer names a different tag than was sent', async () => {
    const { sentTag, dataCalls } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"other"' },
      { etag: '"v2"', body: [meetRow('Meet B')] },
    ]);

    await fetchApiMeets();
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet B' }]);
    expect(dataCalls()).toHaveLength(3);
    expect(sentTag(1)).toBe('"v1"');
    expect(sentTag(2)).toBeUndefined();
  });

  it('treats a bodiless answer to a call that carried no tag as an error after one retry', async () => {
    const { sentTag, dataCalls } = queueTransport([{ etag: '"v1"' }, { etag: '"v1"' }]);

    await expect(fetchApiMeets()).rejects.toThrow('/meets answered without a body');
    expect(dataCalls()).toHaveLength(2);
    expect(sentTag(0)).toBeUndefined();
    expect(sentTag(1)).toBeUndefined();

    queueTransport([{ etag: '"v1"' }, { etag: '"v1"', body: [meetRow('Meet A')] }]);
    await expect(fetchApiMeets()).resolves.toMatchObject([{ name: 'Meet A' }]);
  });

  it('forgets the tag when a full answer carries no usable etag', async () => {
    const { sentTag } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: null, body: [meetRow('Meet B')] },
      { etag: '  ', body: [meetRow('Meet B')] },
      { etag: null, body: [meetRow('Meet B')] },
    ]);
    await fetchApiMeets();
    await fetchApiMeets();
    await fetchApiMeets();
    await fetchApiMeets();
    expect(sentTag(1)).toBe('"v1"');
    expect(sentTag(2)).toBeUndefined();
    expect(sentTag(3)).toBeUndefined();
  });

  it('asks about the current hour but keeps the meets list tag across hours', async () => {
    const { sentTag, dataCalls } = queueTransport([
      { etag: '"v1"', body: [meetRow('Meet A')] },
      { etag: '"v1"' },
      { etag: '"v1"' },
    ]);

    await fetchApiMeets();
    jest.setSystemTime(new Date('2026-06-20T12:59:59.000Z'));
    await fetchApiMeets();
    jest.setSystemTime(new Date('2026-06-20T13:00:00.000Z'));
    await fetchApiMeets();

    expect(dataCalls().map((call) => call.args.now)).toEqual([
      Date.parse('2026-06-20T12:00:00.000Z'),
      Date.parse('2026-06-20T12:00:00.000Z'),
      Date.parse('2026-06-20T13:00:00.000Z'),
    ]);
    expect(sentTag(1)).toBe('"v1"');
    expect(sentTag(2)).toBe('"v1"');
  });
});
