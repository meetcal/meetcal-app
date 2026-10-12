import * as fc from 'fast-check';

import {
  CHAOS_STATUSES,
  DEFAULT_CHAOS_KINDS,
  pickChaosFault,
  validateChaosConfig,
  type ChaosConfig,
  type ChaosFaultKind,
} from '@/lib/api/dev-chaos';
import { SERVER_CLOCK_CALL } from '@/lib/api/meetcal-api';
import type { ApiCall } from '@/lib/api/transport';

const ALL_KINDS: ChaosFaultKind[] = ['network', 'hang', 'delay', 'status', 'transient', 'garbage', 'truncate'];

const configArb: fc.Arbitrary<ChaosConfig> = fc
  .record({
    rate: fc.double({ min: 0, max: 1, noNaN: true }),
    min: fc.nat(30_000),
    span: fc.nat(30_000),
    kinds: fc.option(fc.uniqueArray(fc.constantFrom(...ALL_KINDS), { minLength: 1 }), { nil: undefined }),
  })
  .map(({ rate, min, span, kinds }) => ({ rate, latencyMs: { min, max: min + span }, kinds }));

const callArb: fc.Arbitrary<ApiCall> = fc.record({
  path: fc.constantFrom('/meets', '/meets/package', '/users/me/saved-sessions', '/results'),
  fn: fc.constantFrom('meets:list', 'meets:package', 'users:saveSession', 'results:byNames'),
  kind: fc.constantFrom('query' as const, 'mutation' as const),
  args: fc.constant({}),
});

/** Draws for a random source; `randomFrom` replays them in a cycle. */
const drawsArb = fc.array(fc.double({ min: 0, max: 1, maxExcluded: true, noNaN: true }), { minLength: 1, maxLength: 6 });

function randomFrom(draws: readonly number[]): () => number {
  let next = 0;
  return () => draws[next++ % draws.length];
}

describe('pickChaosFault', () => {
  it('accepts every config the arbitrary builds', () => {
    fc.assert(fc.property(configArb, (config) => expect(validateChaosConfig(config)).toBe(config)));
  });

  it('never faults at rate 0', () => {
    fc.assert(
      fc.property(configArb, callArb, drawsArb, (config, call, draws) => {
        expect(pickChaosFault({ ...config, rate: 0 }, call, randomFrom(draws))).toEqual({ kind: 'pass' });
      }),
    );
  });

  it('always faults at rate 1', () => {
    fc.assert(
      fc.property(configArb, callArb, drawsArb, (config, call, draws) => {
        expect(pickChaosFault({ ...config, rate: 1 }, call, randomFrom(draws)).kind).not.toBe('pass');
      }),
    );
  });

  it('draws only the allowed kinds, the default ones when none are listed', () => {
    fc.assert(
      fc.property(configArb, callArb, drawsArb, (config, call, draws) => {
        const fault = pickChaosFault(config, call, randomFrom(draws));
        if (fault.kind === 'pass') return;
        expect(config.kinds ?? DEFAULT_CHAOS_KINDS).toContain(fault.kind);
      }),
    );
  });

  it('leaves hang and garbage out unless listed', () => {
    fc.assert(
      fc.property(configArb, callArb, drawsArb, (config, call, draws) => {
        const fault = pickChaosFault({ ...config, kinds: undefined }, call, randomFrom(draws));
        expect(['hang', 'garbage']).not.toContain(fault.kind);
      }),
    );
  });

  it('keeps delays within the latency range and statuses within the chaos set', () => {
    fc.assert(
      fc.property(configArb, callArb, drawsArb, (config, call, draws) => {
        const fault = pickChaosFault({ ...config, rate: 1, kinds: ['delay', 'status'] }, call, randomFrom(draws));
        if (fault.kind === 'delay') {
          expect(Number.isInteger(fault.ms)).toBe(true);
          expect(fault.ms).toBeGreaterThanOrEqual(config.latencyMs.min);
          expect(fault.ms).toBeLessThanOrEqual(config.latencyMs.max);
        } else if (fault.kind === 'status') {
          expect(CHAOS_STATUSES).toContain(fault.status);
        } else {
          throw new Error(`unexpected fault ${fault.kind}`);
        }
      }),
    );
  });

  it('never faults the server-clock sample', () => {
    fc.assert(
      fc.property(configArb, drawsArb, (config, draws) => {
        expect(pickChaosFault({ ...config, rate: 1 }, SERVER_CLOCK_CALL, randomFrom(draws))).toEqual({ kind: 'pass' });
      }),
    );
  });
});
