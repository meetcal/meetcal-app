import AsyncStorage from '@react-native-async-storage/async-storage';
import * as fc from 'fast-check';

import type { SupabaseLiftResult } from '@/data/types/athletes';
import { jsonTransportStub } from '@/lib/api/json-transport-stub';
import { mapApiAthletes, mapApiLiftingResult, NAMES_QUERY_CHUNK_SIZE } from '@/lib/api/meetcal-api';
import type { ApiCall, Transport } from '@/lib/api/transport';
import { prefetchMeetData, warmMeetData } from '@/lib/database/meet-manager';
import {
  findAthleteNamesWithoutHistory,
  getAllCachedLiftingResultsForAthlete,
  markMeetExplicitlyDownloaded,
} from '@/lib/database/offline-store';
import { corruptedArb, hostileStringArb } from '@/test-support/arbitraries';
import {
  faultPlanArb,
  installChaosTransport,
  installStorageChaos,
  storageFaultArb,
  transportFaultArb,
  type ChaosTransport,
  type StorageFault,
  type TransportFault,
} from '@/test-support/chaos';

/**
 * The offline meet download (`meet-manager.ts`) under a generated plan of
 * network and storage failures, through the real API client and the real
 * offline store. It pulls every athlete's history in sequential
 * `/lifting-results/by-names` batches (one in flight, for memory), retries a
 * batch once straight away only for a 429/503 or Convex's "try again", and
 * once more after the rest of the pass only when it got no answer (a timeout
 * or a dropped connection). It records the download as complete (history
 * stamp, a resolved promise) only when every athlete's history is on disk.
 * The package ETag means "package ingested" and is saved before the history
 * pass; what that pass still owes is kept in a pending list (or found again
 * as missing blobs), so a later healthy run completes.
 */

jest.mock('@/lib/networkUtils', () => ({ isNetworkAvailable: jest.fn(async () => true) }));

// The meet-open requests (schedule, roster) are not under test; the deferred
// full download that `warmMeetData` schedules is.
jest.mock('@/lib/database/queries', () => ({
  fetchSchedule: jest.fn(async () => []),
  fetchAthletesWithSession: jest.fn(async () => []),
}));

jest.setTimeout(Math.max(20_000, (fc.readConfigureGlobal().numRuns ?? 100) * 250));

const MEET = 'Chaos Download Meet';
const ETAG = '"package-v1"';
const BY_NAMES = 'results:byNames';
/** How long a by-names request that reaches the server takes (fake time). */
const SERVER_LATENCY_MS = 50;
const ETAG_KEY = '@meet_package_etag_v1';
const HISTORY_SYNCED_AT_KEY = '@meet_history_synced_at_v1';
const HISTORY_PENDING_KEY = '@meet_history_pending_v1';

function athleteName(index: number): string {
  return `Lifter ${String(index).padStart(3, '0')}`;
}

/** The server's rows for one athlete: none for every third athlete, else one or two. */
function serverRows(name: string): Record<string, unknown>[] {
  const index = Number(name.slice(-3));
  return Array.from({ length: index % 3 }, (_, n) => ({
    id: index * 10 + n,
    event_id: `event-${index}-${n}`,
    meet: `Past Meet ${n}`,
    date: `2025-0${n + 1}-15`,
    name,
    age: 'Open',
    body_weight: 88.5,
    snatch1: 100,
    snatch2: -105,
    snatch3: 105,
    snatch_best: 105,
    cj1: 125,
    cj2: null,
    cj3: 130,
    cj_best: 130,
    total: 235,
  }));
}

function expectedHistory(name: string): SupabaseLiftResult[] {
  return serverRows(name).map((row) => mapApiLiftingResult(row as never));
}

function packageFor(names: readonly string[]) {
  return {
    meet: {
      id: 'chaos-meet',
      name: MEET,
      federation: 'USAW',
      status: 'upcoming',
      start_date: '2026-10-01',
      end_date: '2026-10-02',
      time_zone: 'America/New_York',
      venue_name: 'v',
      venue_street: 's',
      venue_city: 'c',
      venue_state: 'OH',
      venue_zip: '43215',
      venue_map_pdf_url: null,
      venue_map_apple_url: null,
    },
    schedule: [
      {
        date: '2026-10-01',
        sessions: [
          {
            session_id: 1,
            start_time: '09:00:00',
            weigh_in_time: '07:00:00',
            platforms: [{ platform: 'Red', weight_class: '89' }],
          },
        ],
      },
    ],
    athletes: names.map((name, index) => ({
      member_id: String(index + 1),
      name,
      age: 30,
      club: 'Club',
      wso: null,
      gender: 'Male',
      weight_class: '89',
      entry_total: 250,
      adaptive: false,
      session: {
        session_number: 1,
        session_platform: 'Red',
        date: '2026-10-01',
        start_time: '09:00:00',
        weigh_in_time: '07:00:00',
      },
    })),
    meet_results: [],
    year_bests: [],
  };
}

type ServerState = {
  chaos: ChaosTransport | null;
  inFlight: number;
  maxInFlight: number;
  /** A by-names request started while another was still being answered. */
  overlapped: boolean;
};

/**
 * The backend as the wire shows it: the package as a conditional answer with
 * an ETag (and `304`, no body, for a matching `ifNoneMatch`), by-names rows as
 * JSON text after `SERVER_LATENCY_MS`. It watches the chaos transport's call
 * log to catch a second by-names request starting while one is in flight.
 */
function backend(names: readonly string[], state: ServerState): Transport {
  const rows = jsonTransportStub((path, query) => {
    if (path !== '/lifting-results/by-names') throw new Error(`unrouted ${path}`);
    return query.names.split(',').flatMap(serverRows);
  });
  const pkg = JSON.stringify(packageFor(names));
  const byNamesStarted = () => state.chaos?.calls.filter(({ call }) => call.fn === BY_NAMES).length ?? 0;

  return async (call: ApiCall) => {
    if (call.fn === 'meets:packageForMeet') {
      return call.args.ifNoneMatch === ETAG ? { etag: ETAG } : { etag: ETAG, json: pkg };
    }
    if (call.fn !== BY_NAMES) return rows(call);
    const startedBefore = byNamesStarted();
    state.inFlight += 1;
    state.maxInFlight = Math.max(state.maxInFlight, state.inFlight);
    try {
      // Abortable, as fetch is: a request the client timed out (and so
      // aborted) is no longer in flight for it. Ignoring the abort counted a
      // batch whose answer was due on the very millisecond of the timeout as
      // still running when the next batch started.
      await latency(call.signal);
      return await rows(call);
    } finally {
      state.inFlight -= 1;
      if (byNamesStarted() !== startedBefore) state.overlapped = true;
    }
  };
}

/** `SERVER_LATENCY_MS`, or a rejection as soon as `signal` aborts. */
function latency(signal: AbortSignal | undefined): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('aborted'));
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      reject(new Error('aborted'));
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, SERVER_LATENCY_MS);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function isRetryable(fault: TransportFault): boolean {
  return fault.kind === 'transient' || (fault.kind === 'status' && (fault.status === 429 || fault.status === 503));
}

/** Faults that never get an answer from the server: the batch must be tried again after the pass. */
function getsNoAnswer(fault: TransportFault): boolean {
  return fault.kind === 'network' || fault.kind === 'hang';
}

/**
 * Faults after which a deferred retry is allowed: no answer, or an answer
 * the client could not use (a long delay may time out; truncated or garbage
 * bodies may fail to parse). An HTTP status, Convex's "try again" and a
 * clean answer are answers, never retried at the end.
 */
function mayDefer(fault: TransportFault): boolean {
  return getsNoAnswer(fault) || fault.kind === 'delay' || fault.kind === 'truncate' || fault.kind === 'garbage';
}

/**
 * Each batch's requests, split into phases. A phase is a request, plus one
 * immediate retry exactly when it failed with a retryable fault (the very
 * next by-names request). A batch has a second, deferred phase only when its
 * first phase ended without a usable answer, and always when it ended with
 * none; deferred phases run after every batch's first phase.
 */
function assertRetryPolicy(chaos: ChaosTransport): void {
  const requests = chaos.calls
    .filter(({ call }) => call.fn === BY_NAMES)
    .map(({ call, fault }, index) => ({ batch: (call.args.names as string[]).join('|'), fault, index }));
  const byBatch = new Map<string, typeof requests>();
  for (const request of requests) {
    byBatch.set(request.batch, [...(byBatch.get(request.batch) ?? []), request]);
  }
  let lastFirstPhaseIndex = -1;
  const deferredStarts: number[] = [];
  for (const attempts of byBatch.values()) {
    const phases: (typeof requests)[] = [];
    let i = 0;
    while (i < attempts.length) {
      const phase = [attempts[i]];
      if (isRetryable(attempts[i].fault)) {
        expect(attempts[i + 1]?.index).toBe(attempts[i].index + 1);
        phase.push(attempts[i + 1]);
      }
      phases.push(phase);
      i += phase.length;
    }
    expect(phases.length).toBeLessThanOrEqual(2);
    const firstEnd = phases[0][phases[0].length - 1];
    lastFirstPhaseIndex = Math.max(lastFirstPhaseIndex, firstEnd.index);
    if (phases.length === 2) {
      expect(mayDefer(firstEnd.fault)).toBe(true);
      deferredStarts.push(phases[1][0].index);
    } else {
      expect(getsNoAnswer(firstEnd.fault)).toBe(false);
    }
  }
  for (const start of deferredStarts) expect(start).toBeGreaterThan(lastFirstPhaseIndex);
}

/** The names the pending list says a meet's history pass still owes. */
function pendingNames(): unknown {
  return (storedJson(HISTORY_PENDING_KEY)[MEET] as { names?: unknown } | undefined)?.names;
}

function storedJson(key: string): Record<string, unknown> {
  const raw = (AsyncStorage as unknown as { __INTERNAL_MOCK_STORAGE__: Record<string, string> })
    .__INTERNAL_MOCK_STORAGE__[key];
  try {
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

/** Whether every athlete's full, correct history is on disk (read with healthy storage). */
async function historyComplete(names: readonly string[]): Promise<boolean> {
  for (const name of names) {
    const cached = await getAllCachedLiftingResultsForAthlete(name);
    if (JSON.stringify(cached) !== JSON.stringify(expectedHistory(name))) return false;
  }
  return true;
}

/** `meet-manager`'s wait before the deferred full download of a warmed meet. */
const FULL_PREFETCH_DELAY_MS = 5_000;

/** Runs one download to the end on fake time; resolves with its outcome. */
async function runDownload(entry: 'prefetch' | 'warm'): Promise<'resolved' | 'rejected'> {
  let start: Promise<unknown>;
  if (entry === 'prefetch') {
    start = prefetchMeetData(MEET);
  } else {
    // The meet open itself needs no timers (its requests are mocked); it
    // fails only on a storage fault, and then schedules nothing.
    try {
      await warmMeetData(MEET);
    } catch {
      return 'rejected';
    }
    // Fire the deferred download and join it in the same tick, so a download
    // that fails at once is joined rather than followed by a second one.
    jest.advanceTimersByTime(FULL_PREFETCH_DELAY_MS - 1);
    jest.advanceTimersByTime(1);
    start = prefetchMeetData(MEET);
  }
  let outcome: 'resolved' | 'rejected' | null = null;
  void start.then(
    () => {
      outcome = 'resolved';
    },
    () => {
      outcome = 'rejected';
    },
  );
  for (let i = 0; i < 400 && outcome === null; i++) await jest.advanceTimersByTimeAsync(250);
  if (outcome === null) throw new Error('download did not settle');
  return outcome;
}

beforeEach(async () => {
  jest.useFakeTimers();
  await AsyncStorage.clear();
  for (const method of ['log', 'info', 'warn', 'error'] as const) {
    jest.spyOn(console, method).mockImplementation(() => {});
  }
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

/**
 * One faulted download, then a healthy one: the property's body (see the
 * test below), also replayed for counterexamples worth keeping.
 */
async function checkDownloadUnderChaos(
  athleteCount: number,
  entry: 'prefetch' | 'warm',
  transportPlan: TransportFault[],
  storagePlan: StorageFault[],
): Promise<void> {
    await AsyncStorage.clear();
    const names = Array.from({ length: athleteCount }, (_, i) => athleteName(i));
    expect(mapApiAthletes(packageFor(names).athletes as never, 'test')).toHaveLength(athleteCount);
    if (entry === 'warm') await markMeetExplicitlyDownloaded(MEET, true);

    // The faulted run.
    const state: ServerState = { chaos: null, inFlight: 0, maxInFlight: 0, overlapped: false };
    state.chaos = installChaosTransport(backend(names, state), transportPlan);
    const storageChaos = installStorageChaos(storagePlan);
    let outcome: 'resolved' | 'rejected';
    try {
      outcome = await runDownload(entry);
    } finally {
      storageChaos.restore();
      state.chaos.restore();
    }

    expect(state.maxInFlight).toBeLessThanOrEqual(1);
    expect(state.overlapped).toBe(false);
    assertRetryPolicy(state.chaos);

    // Nothing claims a complete download that is not. Complete means
    // every athlete has a history blob; the rows are the server's unless
    // a fault answered with a well-formed array (`[]` is "no history"),
    // which the client has no way to tell from the truth. The package
    // ETag is not a claim: it means "package ingested" and is saved
    // before the history pass, which the healthy run below resumes.
    const plausibleWrongAnswer = transportPlan.some(
      (fault) => fault.kind === 'garbage' && Array.isArray(fault.value),
    );
    const claimed = outcome === 'resolved' || storedJson(HISTORY_SYNCED_AT_KEY)[MEET] !== undefined;
    if (claimed) {
      expect(await findAthleteNamesWithoutHistory(names)).toEqual([]);
      if (!plausibleWrongAnswer) expect(await historyComplete(names)).toBe(true);
    }

    // A later healthy run completes, whatever the first one left.
    const healthy: ServerState = { chaos: null, inFlight: 0, maxInFlight: 0, overlapped: false };
    healthy.chaos = installChaosTransport(backend(names, healthy), []);
    try {
      expect(await runDownload('prefetch')).toBe('resolved');
    } finally {
      healthy.chaos.restore();
    }
    expect(healthy.maxInFlight).toBeLessThanOrEqual(1);
    expect(await findAthleteNamesWithoutHistory(names)).toEqual([]);
    // A wrong-but-well-formed answer that completed the first run is
    // kept until the history TTL or a forced refresh, by design.
    if (!plausibleWrongAnswer) expect(await historyComplete(names)).toBe(true);
    expect(storedJson(ETAG_KEY)[MEET]).toBe(ETAG);
}

describe('offline meet download under transport and storage chaos', () => {
  it('keeps history batches sequential, retries only as allowed, marks only complete downloads, and recovers', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: NAMES_QUERY_CHUNK_SIZE * 2 + 5 }),
        fc.constantFrom('prefetch' as const, 'warm' as const),
        faultPlanArb(transportFaultArb, 8),
        faultPlanArb(storageFaultArb, 10),
        checkDownloadUnderChaos,
      ),
    );
  });

  // Seed 1787336259: the first batch's delayed answer was due on the same
  // millisecond as the client's 10 s timeout. The client aborted it and sent
  // the next batch, and the stub server, ignoring the abort, counted both.
  it('does not count a batch the client timed out as still in flight', async () => {
    await checkDownloadUnderChaos(41, 'prefetch', [{ kind: 'pass' }, { kind: 'delay', ms: 9950 }], []);
  });

  it('a 304 revalidation over any stored history-stamp bytes still fills in missing history', async () => {
    const stampBytesArb = fc.oneof(
      hostileStringArb,
      fc.jsonValue({ maxDepth: 2 }).map((value) => JSON.stringify(value)),
      corruptedArb({ [MEET]: 1_700_000_000_000, Other: 5 }).map((value) => JSON.stringify(value) ?? ''),
    );
    await fc.assert(
      fc.asyncProperty(
        fc.integer({ min: 1, max: 12 }),
        stampBytesArb,
        fc.array(fc.nat(), { maxLength: 4 }),
        async (athleteCount, stampBytes, dropped) => {
          await AsyncStorage.clear();
          const names = Array.from({ length: athleteCount }, (_, i) => athleteName(i));
          const state: ServerState = { chaos: null, inFlight: 0, maxInFlight: 0, overlapped: false };
          state.chaos = installChaosTransport(backend(names, state), []);
          try {
            expect(await runDownload('prefetch')).toBe('resolved');
            // "Delete all offline data" style loss of some history, and a
            // stamp blob nobody can read.
            for (const index of dropped) {
              await AsyncStorage.removeItem(`meetcal_athlete_history_${athleteName(index % athleteCount).toLowerCase()}`);
            }
            await AsyncStorage.setItem(HISTORY_SYNCED_AT_KEY, stampBytes);
            expect(await runDownload('prefetch')).toBe('resolved');
          } finally {
            state.chaos.restore();
          }
          // The second run revalidated (304) rather than refetching the package.
          const packageCalls = state.chaos.calls.filter(({ call }) => call.fn === 'meets:packageForMeet');
          expect(packageCalls[1]?.call.args.ifNoneMatch).toBe(ETAG);
          expect(await historyComplete(names)).toBe(true);
        },
      ),
    );
  });

  // Shrunk counterexample (seed -1738086823, FC_NUM_RUNS=1000): the
  // by-names batch answered `[]`. That is a well-formed "no history" answer,
  // so the download completes with empty blobs; the property was narrowed.
  it('a by-names batch answered with no rows completes with empty history blobs', async () => {
    const names = [athleteName(0), athleteName(1)];
    const state: ServerState = { chaos: null, inFlight: 0, maxInFlight: 0, overlapped: false };
    state.chaos = installChaosTransport(backend(names, state), [
      { kind: 'pass' },
      { kind: 'garbage', value: [] },
    ]);
    try {
      expect(await runDownload('prefetch')).toBe('resolved');
    } finally {
      state.chaos.restore();
    }
    expect(await findAthleteNamesWithoutHistory(names)).toEqual([]);
    expect(await getAllCachedLiftingResultsForAthlete(athleteName(1))).toEqual([]);
    expect(storedJson(ETAG_KEY)[MEET]).toBe(ETAG);
  });

  // Shrunk counterexample from the property (a harness bug, since fixed: the
  // deferred download of a warmed meet failed before the test joined it).
  // A batch that got no answer is asked for once more after the pass.
  it('a warmed meet whose deferred download hits a network failure retries the batch once after the pass', async () => {
    const names = [athleteName(0)];
    await markMeetExplicitlyDownloaded(MEET, true);
    const state: ServerState = { chaos: null, inFlight: 0, maxInFlight: 0, overlapped: false };
    state.chaos = installChaosTransport(backend(names, state), [{ kind: 'pass' }, { kind: 'network' }]);
    try {
      expect(await runDownload('warm')).toBe('resolved');
    } finally {
      state.chaos.restore();
    }
    expect(state.chaos.calls.filter(({ call }) => call.fn === BY_NAMES)).toHaveLength(2);
    assertRetryPolicy(state.chaos);
    expect(await historyComplete(names)).toBe(true);
    expect(storedJson(ETAG_KEY)[MEET]).toBe(ETAG);
    expect(storedJson(HISTORY_SYNCED_AT_KEY)[MEET]).toBeDefined();
    expect(pendingNames()).toBeUndefined();
  });

  it('a warmed meet whose batch gets no answer twice asks twice and marks nothing complete', async () => {
    const names = [athleteName(0)];
    await markMeetExplicitlyDownloaded(MEET, true);
    const state: ServerState = { chaos: null, inFlight: 0, maxInFlight: 0, overlapped: false };
    state.chaos = installChaosTransport(backend(names, state), [
      { kind: 'pass' },
      { kind: 'network' },
      { kind: 'network' },
    ]);
    try {
      expect(await runDownload('warm')).toBe('rejected');
    } finally {
      state.chaos.restore();
    }
    expect(state.chaos.calls.filter(({ call }) => call.fn === BY_NAMES)).toHaveLength(2);
    assertRetryPolicy(state.chaos);
    // The package was ingested; the history it owes is recorded, not claimed.
    expect(storedJson(ETAG_KEY)[MEET]).toBe(ETAG);
    expect(storedJson(HISTORY_SYNCED_AT_KEY)[MEET]).toBeUndefined();
    expect(pendingNames()).toEqual(names);
  });

  it('retries a batch once after a 429, then gives up on a second', async () => {
    const names = Array.from({ length: NAMES_QUERY_CHUNK_SIZE + 1 }, (_, i) => athleteName(i));
    const state: ServerState = { chaos: null, inFlight: 0, maxInFlight: 0, overlapped: false };
    // Package passes; batch 1 gets 429 twice; batch 2 passes.
    state.chaos = installChaosTransport(backend(names, state), [
      { kind: 'pass' },
      { kind: 'status', status: 429 },
      { kind: 'status', status: 429 },
    ]);
    try {
      expect(await runDownload('prefetch')).toBe('rejected');
    } finally {
      state.chaos.restore();
    }
    const byNames = state.chaos.calls.filter(({ call }) => call.fn === BY_NAMES);
    expect(byNames.map(({ fault }) => fault.kind)).toEqual(['status', 'status', 'pass']);
    assertRetryPolicy(state.chaos);
    // The package was ingested (ETag kept, so a retry revalidates with a 304);
    // the refused batch is what the pending list says the next run owes.
    expect(storedJson(ETAG_KEY)[MEET]).toBe(ETAG);
    expect(storedJson(HISTORY_SYNCED_AT_KEY)[MEET]).toBeUndefined();
    expect(pendingNames()).toEqual(names.slice(0, NAMES_QUERY_CHUNK_SIZE));
  });
});
