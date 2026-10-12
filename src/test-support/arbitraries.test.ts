import * as fc from 'fast-check';

import {
  clockTimeArb,
  corruptedArb,
  isoCalendarDateArb,
  timeZoneArb,
} from '@/test-support/arbitraries';

describe('shared arbitraries', () => {
  it('generates real calendar dates', () => {
    fc.assert(
      fc.property(isoCalendarDateArb, (date) => {
        expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(date);
      }),
    );
  });

  it('generates zones the runtime accepts', () => {
    fc.assert(
      fc.property(timeZoneArb, (zone) => {
        expect(() => new Intl.DateTimeFormat('en-US', { timeZone: zone })).not.toThrow();
      }),
    );
  });

  it('generates in-range clock times', () => {
    fc.assert(
      fc.property(clockTimeArb, (time) => {
        expect(time).toMatch(/^(?:[01]\d|2[0-3]):[0-5]\d$|^(?:[1-9]|1[0-2]):[0-5]\d (?:AM|PM)$/i);
      }),
    );
  });

  it('corrupts a copy, never the original', () => {
    const valid = { meet: 'Nationals', sessions: [{ id: 1, platform: 'Red' }] };
    const snapshot = structuredClone(valid);
    fc.assert(
      fc.property(corruptedArb(valid), () => {
        expect(valid).toEqual(snapshot);
      }),
    );
  });

  it('can reach every node of the payload', () => {
    const valid = { sessions: [{ id: 1 }] };
    const seen = fc.sample(corruptedArb(valid), { numRuns: 500, seed: 1 });
    expect(seen).toContainEqual({ sessions: [{}] });
    expect(seen).toContainEqual({ sessions: [] });
    expect(seen).toContainEqual({});
    expect(seen).toContainEqual([valid]);
  });
});
