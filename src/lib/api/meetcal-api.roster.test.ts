import { clearHttpValidatorCache } from './revalidated-reads';
import { fetchApiAthletesWithSession } from './meets-api';
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
    expect(calls[1].args.ifNoneMatch).toBe('"r1"');
    expect(second).toEqual(first);
    expect(second.map((athlete) => athlete.name)).toEqual(['A Lifter']);
  });

  it('keeps a narrowed read apart from the whole roster', async () => {
    const calls = server(() => ({ etag: '"r1"', json: JSON.stringify(roster) }));
    await fetchApiAthletesWithSession(MEET);
    await fetchApiAthletesWithSession(MEET, 1);
    expect(calls[1].args.ifNoneMatch).toBeUndefined();
    expect(calls[1].args.sessionNumber).toBe(1);
  });

  it('rejects a roster that is not a list', async () => {
    server(() => ({ json: JSON.stringify({ rows: [] }) }));
    await expect(fetchApiAthletesWithSession(MEET)).rejects.toThrow('/meets/athletes-sessions expected an array response');
  });
});
