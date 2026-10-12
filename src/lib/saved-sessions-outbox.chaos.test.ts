/**
 * Model-based chaos tests for the saved-sessions outbox.
 *
 * fast-check generates a session of user actions (save, unsave, reset a meet
 * or everything), flushes under transport faults, lost answers and a flaky or
 * foreign Clerk token, network drops, storage faults, app restarts (some in
 * the middle of a send) and overlapping taps, flushes and reconciles
 * interleaved by its scheduler. After every step the outbox must read back
 * well formed and, merged with the server's list, show exactly what the user
 * meant; at the end, healthy flushes must empty it and leave the server
 * holding exactly that. The harness and its rules for writes dropped by
 * design are in `test-support/saved-sessions-outbox-model.ts`.
 */
import * as fc from 'fast-check';

import { MeetCalApiError, MeetCalApiTimeoutError } from '@/lib/api/meetcal-api';
import { TransportRequestError } from '@/lib/api/transport';
import { classifySyncError } from '@/lib/saved-sessions-outbox';
import { hostileValueArb } from '@/test-support/arbitraries';
import { HTTP_FAULT_STATUSES, installChaosTransport, installStorageChaos } from '@/test-support/chaos';
import {
  converge,
  LATE_LANDING_MS,
  OWNER,
  OWNER_TOKEN,
  outboxCommandArbs,
  serverTransport,
  sessionBody,
  settle,
  startRun,
  wireOf,
  type Harness,
} from '@/test-support/saved-sessions-outbox-model';

/** Long enough for faults to meet queued writes; short enough to shrink well. */
const MAX_COMMANDS = 30;
const NUM_RUNS = Number(process.env.FC_NUM_RUNS) || 100;
/** Generous: a run is ~20-60ms; the nightly run raises FC_NUM_RUNS. */
const MODEL_TIMEOUT_MS = Math.max(60_000, NUM_RUNS * 500);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'info').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('saved-sessions outbox under chaos (model-based)', () => {
  it(
    'never loses or resurrects a write, and converges on the user\'s last intent',
    async () => {
      await fc.assert(
        fc.asyncProperty(fc.commands(outboxCommandArbs, { maxCommands: MAX_COMMANDS, size: 'max' }), async (commands) => {
          const { m, h, dispose } = await startRun();
          try {
            await fc.asyncModelRun(() => ({ model: m, real: h }), commands);
            await converge(m, h);
          } finally {
            dispose();
          }
        }),
      );
    },
    MODEL_TIMEOUT_MS,
  );
});

/**
 * Real defects the model found, kept as the shrunk sequences it reported.
 * The fixed ones run as regressions; the property above covers them too. The
 * one still open is skipped, and the property excludes exactly its scenario
 * (see the FINDING comment in the harness).
 */
describe('outbox defects the model found', () => {
  const ID = 'Spring Open-1-Red';
  const flush = (h: Harness) => settle(h.outbox.flushOutbox(OWNER, async () => OWNER_TOKEN), 'flush');

  async function withDevice(run: (h: Harness) => Promise<void>): Promise<void> {
    const { h, dispose } = await startRun();
    try {
      await run(h);
    } finally {
      dispose();
    }
  }

  // Regression (lost reset clear). Shrunk sequence:
  //   reset(Spring Open), save(Spring Open-1-Red, v1),
  //   storage([pass, pass, lose-write], flush)
  // The reset is delivered but the write clearing it is lost, so the outbox
  // still holds it and the next flush re-sends it. The save used to go out in
  // the same pass (the meet was held only for a reset that *failed* in it),
  // so the re-sent reset deleted it. A session now waits while any reset of
  // its meet is still stored.
  it('keeps a save made after a delivered reset whose clear was lost', () =>
    withDevice(async (h) => {
      const chaos = installChaosTransport(serverTransport(h, []), []);
      try {
        await h.outbox.markResetPending(OWNER, 'Spring Open');
        await h.outbox.markSessionPut(OWNER, sessionBody(ID, 1));
        // Storage calls: the pass's read, then the reset clear's read and (lost) write.
        const storage = installStorageChaos([{ kind: 'pass' }, { kind: 'pass' }, { kind: 'lose-write' }]);
        try {
          await flush(h);
        } finally {
          storage.restore();
        }
        await flush(h);
        expect(h.server.wires(OWNER).get(ID)).toBe(wireOf(h.outbox, sessionBody(ID, 1)));
      } finally {
        chaos.restore();
      }
    }),
  );

  // Regression (unreadable PUT body). Shrunk sequence:
  //   save(Spring Open-1-Red, v7, invalid)   (session number 0)
  // `parseOutbox` drops a PUT whose body `normalizeStoredSession` rejects.
  // `markSessionPut` used to store such a body anyway and resolve, so the
  // entry vanished on the next read along with the pending unsave it had
  // replaced, and the session came back. The mark now refuses the body.
  it('refuses a save with a body the outbox cannot read back, keeping the unsave it would replace', () =>
    withDevice(async (h) => {
      const chaos = installChaosTransport(serverTransport(h, []), []);
      try {
        await h.outbox.markSessionPut(OWNER, sessionBody(ID, 1));
        await flush(h);
        await h.outbox.markSessionDelete(OWNER, ID, 'Spring Open');
        await expect(h.outbox.markSessionPut(OWNER, sessionBody(ID, 7, true))).rejects.toThrow('unreadable session body');
        await flush(h);
        expect(h.server.wires(OWNER).has(ID)).toBe(false);
      } finally {
        chaos.restore();
      }
    }),
  );

  // FINDING (late landing), deferred: needs a server-side revision check, see
  // the linked issue in PR #190. Shrunk sequence:
  //   save(Spring Open-1-Red, v1), flush(answers: [late]),
  //   unsave(Spring Open-1-Red), flush
  // The PUT is on the wire when the client's 10s timeout aborts it; the abort
  // cannot recall bytes already sent, and the server applies it at 15s. By
  // then the unsave was sent and acknowledged, so the outbox is empty and the
  // stale save silently resurrects the session (the transport's comment
  // assumes an aborted write never lands).
  // Expected: the session stays unsaved. Actual: the server has v1 again.
  it.skip('FINDING: a save that lands after the client timed out undoes a later unsave', () =>
    withDevice(async (h) => {
      await h.outbox.markSessionPut(OWNER, sessionBody(ID, 1));
      const late = installChaosTransport(serverTransport(h, [{ kind: 'late' }]), []);
      try {
        await flush(h);
      } finally {
        late.restore();
      }
      await h.outbox.markSessionDelete(OWNER, ID, 'Spring Open');
      const healthy = installChaosTransport(serverTransport(h, []), []);
      try {
        await flush(h);
        expect(h.outbox.countPendingWrites(await h.outbox.readOutbox(OWNER))).toBe(0);
        await jest.advanceTimersByTimeAsync(LATE_LANDING_MS);
        expect(h.server.wires(OWNER).has(ID)).toBe(false);
      } finally {
        healthy.restore();
      }
    }),
  );
});

describe('classifySyncError', () => {
  type Case = { error: unknown; expected: 'auth' | 'rejected' | 'retry' };

  /** The rules in the function's doc comment, stated independently. */
  function documented(status: number): 'auth' | 'rejected' | 'retry' {
    if (status === 401) return 'auth';
    if (status === 429) return 'retry';
    if (Number.isInteger(status) && status >= 400 && status <= 499) return 'rejected';
    return 'retry';
  }

  const statusArb = fc.oneof(
    fc.constantFrom(...HTTP_FAULT_STATUSES),
    fc.integer({ min: 100, max: 599 }),
    fc.integer({ min: -1_000, max: 10_000 }),
  );

  const caseArb: fc.Arbitrary<Case> = fc.oneof(
    statusArb.map((status): Case => ({ error: new MeetCalApiError('refused', status, ''), expected: documented(status) })),
    // Timeouts, dropped connections and Convex's "try again later" never drop a write.
    fc.constant<Case>({ error: new MeetCalApiTimeoutError('POST', '/users/me/saved-sessions/x', 10_000), expected: 'retry' }),
    fc.constant<Case>({ error: new TypeError('Network request failed'), expected: 'retry' }),
    fc.constant<Case>({ error: new Error('Your request could not be processed. Please try again later.'), expected: 'retry' }),
    // A transport rejection the API client did not convert, or an object
    // shaped like an API error, is not the server refusing the payload.
    statusArb.map((status): Case => ({ error: new TransportRequestError('raw', status, ''), expected: 'retry' })),
    statusArb.map((status): Case => ({ error: { name: 'MeetCalApiError', status }, expected: 'retry' })),
    hostileValueArb.map((error): Case => ({ error, expected: 'retry' })),
  );

  it('sorts every failure into auth, rejected or retry by the documented rules', () => {
    fc.assert(
      fc.property(caseArb, ({ error, expected }) => {
        expect(classifySyncError(error)).toBe(expected);
      }),
    );
  });
});
