import { upsertEntryAthletes } from '../convex/ingest';
import { memberWsos } from '../convex/scrapers/queries';
import { fakeDb, fakeMutationCtx, handlerOf } from './fakeDb';

/**
 * Synced entries and WSOs (#345): Sport80's entries list has none, so the
 * sync takes each member's WSO from their other registrations, and never
 * clears one a start list loaded by hand stored.
 */
const registration = (memberId: string, meet: string, wso: string | undefined) => ({
  memberId,
  name: `Member ${memberId}`,
  age: 30,
  club: 'Club',
  gender: 'Women',
  weightClass: '64',
  entryTotal: 150,
  meet,
  adaptive: false,
  ...(wso === undefined ? {} : { wso }),
});
const entry = (memberId: string, extra: Record<string, unknown> = {}) => ({
  memberId,
  name: `Member ${memberId}`,
  age: 30,
  club: 'Club',
  gender: 'Women',
  weightClass: '64',
  entryTotal: 150,
  meet: 'Carolina Open',
  ...extra,
});

describe('WSOs for synced entries (#345)', () => {
  it("finds each member's WSO in their most recent registration naming one", async () => {
    const { db } = fakeDb({
      athletes: [
        registration('1', 'Old Meet', 'Florida'),
        registration('1', 'Hand-loaded Meet', 'Carolina'),
        registration('1', 'Synced Meet', undefined),
        registration('2', 'Synced Meet', ' '),
      ],
    });
    const found = await handlerOf<{ memberIds: string[] }, Record<string, string>>(memberWsos)({ db }, { memberIds: ['1', '2', '3', 'noid:someone'] });
    expect(found).toEqual({ 1: 'Carolina' });
    await expect(handlerOf<{ memberIds: string[] }, unknown>(memberWsos)({ db }, { memberIds: Array.from({ length: 501 }, (_, i) => String(i)) })).rejects.toThrow('at most 500');
  });

  it('stores a known WSO with an entrant, and never clears a stored one', async () => {
    const store = fakeMutationCtx({ athletes: [registration('5', 'Carolina Open', 'Carolina')] });
    const upsert = handlerOf<{ meet: string; rows: ReturnType<typeof entry>[] }, Record<string, number>>(upsertEntryAthletes);
    await upsert(store.ctx, { meet: 'Carolina Open', rows: [entry('5', { entryTotal: 160 }), entry('6', { wso: 'Carolina' }), entry('7')] });
    const byId = Object.fromEntries(store.rows('athletes').map((a) => [a.memberId, a.wso ?? null]));
    expect(byId).toEqual({ 5: 'Carolina', 6: 'Carolina', 7: null });
  });
});
