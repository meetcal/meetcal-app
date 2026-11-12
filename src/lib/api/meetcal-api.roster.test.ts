import { itemAt } from '@/test-support/checked-access';
import { clearHttpValidatorCache } from './revalidated-reads';
import { fetchApiAthletesWithSession, fetchApiRosterTagged } from './meets-api';
import { fetchApiYearBestsByNames } from './results-api';
import { setApiTransportForTests, type ApiCall } from './transport';
import type { MeetName } from '@/data/types/meet';

const MEET = 'Roster Meet' as MeetName;
const roster = [{ name: 'A Lifter', meet: MEET, session_number: 1, session_platform: 'Red', weight_class: '89' }];

function server(answer: (call: ApiCall) => unknown) {
  const calls: ApiCall[] = [];
  setApiTransportForTests(async (call) => {
    if (call.kind === 'clock') return Date.now();
    calls.push(call);
    return answer(call);
  });
  return calls;
}

beforeEach(() => clearHttpValidatorCache());
afterAll(() => setApiTransportForTests(null));

describe('the meet roster read', () => {
  it('never sends ifNoneMatch to a server that does not tag the roster', async () => {
    const calls = server(() => ({ json: JSON.stringify(roster) }));
    await fetchApiAthletesWithSession(MEET);
    await fetchApiAthletesWithSession(MEET);
    expect(calls.map((call) => 'ifNoneMatch' in call.args && call.args.ifNoneMatch !== undefined)).toEqual([false, false]);
  });

  it('revalidates with the tag once the server tags the roster, and reuses the roster on a bodiless answer', async () => {
    const calls = server((call) =>
      call.args.ifNoneMatch === '"r1"' ? { etag: '"r1"' } : { etag: '"r1"', json: JSON.stringify(roster) },
    );
    const first = await fetchApiAthletesWithSession(MEET);
    const second = await fetchApiAthletesWithSession(MEET);
    expect(itemAt(calls, 1).args.ifNoneMatch).toBe('"r1"');
    expect(second).toEqual(first);
    expect(second.map((athlete) => athlete.name)).toEqual(['A Lifter']);
  });

  it('keeps a narrowed read apart from the whole roster', async () => {
    const calls = server(() => ({ etag: '"r1"', json: JSON.stringify(roster) }));
    await fetchApiAthletesWithSession(MEET);
    await fetchApiAthletesWithSession(MEET, 1);
    expect(itemAt(calls, 1).args.ifNoneMatch).toBeUndefined();
    expect(itemAt(calls, 1).args.sessionNumber).toBe(1);
  });

  it('rejects a roster that is not a list', async () => {
    server(() => ({ json: JSON.stringify({ rows: [] }) }));
    await expect(fetchApiAthletesWithSession(MEET)).rejects.toThrow('/meets/athletes-sessions expected an array response');
  });
});

describe('the roster read against a tag held on disk', () => {
  it('sends the stored tag after a restart and hears that the stored roster is current', async () => {
    const calls = server((call) => (call.args.ifNoneMatch === '"r1"' ? { etag: '"r1"' } : { etag: '"r1"', json: JSON.stringify(roster) }));
    await expect(fetchApiRosterTagged(MEET, '"r1"')).resolves.toEqual({ status: 'unchanged', tag: '"r1"' });
    expect(itemAt(calls, 0).args).toMatchObject({ meet: MEET, ifNoneMatch: '"r1"' });
  });

  it('answers a changed roster in full with its new tag', async () => {
    server(() => ({ etag: '"r2"', json: JSON.stringify(roster) }));
    const answer = await fetchApiRosterTagged(MEET, '"r1"');
    expect(answer.status).toBe('fresh');
    if (answer.status !== 'fresh') return;
    expect(answer.tag).toBe('"r2"');
    expect(answer.value.map((athlete) => athlete.name)).toEqual(['A Lifter']);
  });

  it('asks again without a tag when a bodiless answer names another tag', async () => {
    const calls = server((call) => (call.args.ifNoneMatch ? { etag: '"other"' } : { etag: '"r2"', json: JSON.stringify(roster) }));
    await expect(fetchApiRosterTagged(MEET, '"r1"')).resolves.toMatchObject({ status: 'fresh', tag: '"r2"' });
    expect(calls).toHaveLength(2);
    expect(itemAt(calls, 1).args.ifNoneMatch).toBeUndefined();
  });
});

describe('results:bests with the latest meet for empty windows', () => {
  it('sends latestWhenEmpty only when asked, and reads a latest row like any other', async () => {
    const calls = server(() => [
      { name: 'A Lifter', best_snatch: 100, best_cj: 120, best_total: 220 },
      { name: 'B Lifter', best_snatch: 77.5, best_cj: 97.5, best_total: 175, latest: true },
    ]);
    const answer = await fetchApiYearBestsByNames(['A Lifter', 'B Lifter'], '2024-11-12', { latestWhenEmpty: true });
    expect(itemAt(calls, 0).args).toMatchObject({ latestWhenEmpty: true, cutoffDate: '2024-11-12' });
    expect(answer['B Lifter']).toEqual({ bestSnatch: 77.5, bestCJ: 97.5, bestTotal: 175 });

    await fetchApiYearBestsByNames(['A Lifter'], '2024-11-12');
    expect(itemAt(calls, 1).args.latestWhenEmpty).toBeUndefined();
  });
});
