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

  it("takes the WSO of the latest meet, not the row stored last", async () => {
    const meetRow = (name: string, startDate: string) => ({ name, startDate, endDate: startDate });
    const memberWso = handlerOf<{ memberIds: string[] }, Record<string, string>>(memberWsos);
    const { db } = fakeDb({
      meets: [meetRow('Nationals 2026', '2026-06-01'), meetRow('Open 2024', '2024-03-01'), meetRow('Same Day A', '2025-05-05'), meetRow('Same Day B', '2025-05-05')],
      athletes: [
        // Member 42 lifted for California in 2026, then their 2024 list was reloaded.
        registration('42', 'Nationals 2026', 'California'),
        registration('42', 'Open 2024', 'Florida'),
        // A meet with no stored date ranks below a dated one.
        registration('43', 'Open 2024', 'Florida'),
        registration('43', 'Undated Meet', 'Texas'),
        // Equal dates: the row stored last.
        registration('44', 'Same Day A', 'Ohio'),
        registration('44', 'Same Day B', 'Iowa'),
      ],
    });
    expect(await memberWso({ db }, { memberIds: ['42', '43', '44'] })).toEqual({ 42: 'California', 43: 'Florida', 44: 'Iowa' });
  });

  it('finds a WSO behind many newer registrations naming none', async () => {
    const { db } = fakeDb({
      athletes: [registration('17', 'Hand-loaded 2020', 'Carolina'), ...Array.from({ length: 60 }, (_, i) => registration('17', `Synced ${i}`, undefined))],
    });
    expect(await handlerOf<{ memberIds: string[] }, Record<string, string>>(memberWsos)({ db }, { memberIds: ['17'] })).toEqual({ 17: 'Carolina' });
  });

  it('gives a placed entrant a WSO it lacks, and changes nothing else on it', async () => {
    const placed = (memberId: string, wso: string | undefined) => ({ ...registration(memberId, 'Carolina Open', wso), sessionNumber: 3, sessionPlatform: 'Red' });
    const store = fakeMutationCtx({ athletes: [placed('8', undefined), placed('9', 'Florida')] });
    const upsert = handlerOf<{ meet: string; rows: ReturnType<typeof entry>[] }, Record<string, number>>(upsertEntryAthletes);
    const counts = await upsert(store.ctx, { meet: 'Carolina Open', rows: [entry('8', { wso: 'Carolina', entryTotal: 999 }), entry('9', { wso: 'Carolina' })] });
    const byId = Object.fromEntries(store.rows('athletes').map((a) => [a.memberId, [a.wso, a.entryTotal]]));
    expect(byId).toEqual({ 8: ['Carolina', 150], 9: ['Florida', 150] });
    expect(counts).toMatchObject({ updated: 1, sessionSkipped: 1 });
  });

  it('stores a known WSO with an entrant, and never clears a stored one', async () => {
    const store = fakeMutationCtx({ athletes: [registration('5', 'Carolina Open', 'Carolina')] });
    const upsert = handlerOf<{ meet: string; rows: ReturnType<typeof entry>[] }, Record<string, number>>(upsertEntryAthletes);
    await upsert(store.ctx, { meet: 'Carolina Open', rows: [entry('5', { entryTotal: 160 }), entry('6', { wso: 'Carolina' }), entry('7')] });
    const byId = Object.fromEntries(store.rows('athletes').map((a) => [a.memberId, a.wso ?? null]));
    expect(byId).toEqual({ 5: 'Carolina', 6: 'Carolina', 7: null });
  });
});
