import AsyncStorage from '@react-native-async-storage/async-storage';
import type { NetInfoState } from '@react-native-community/netinfo';
import * as fc from 'fast-check';

import * as api from '@/lib/api/meetcal-api';
import { TransportRequestError, type ApiCall, type Transport } from '@/lib/api/transport';
import * as store from '@/lib/saved-sessions-store';
import type { SavedSession } from '@/lib/saved-sessions-store';
import {
  chaosGetToken,
  installChaosTransport,
  installStorageChaos,
  setNetInfoState,
  settlingTransportFaultArb,
  storageFaultArb,
  tokenFaultArb,
  transportFaultArb,
  type ChaosTransport,
  type StorageFault,
  type TokenFault,
  type TransportFault,
} from '@/test-support/chaos';

/**
 * Model-based chaos harness for the saved-sessions outbox
 * (`lib/saved-sessions-outbox.ts`). Test-only.
 *
 * The real system is the outbox module (re-required on a simulated app
 * restart) over the real API client, with the transport answered by an
 * in-memory server behind `installChaosTransport`. The model is what the
 * user meant: per session, the last save, unsave or reset wins.
 *
 * Writes the outbox drops by design are accounted for explicitly, never
 * guessed at: a write the server refuses (any 4xx but 401 and 429, and a
 * 404 on a single delete, which counts as done) leaves that session as the
 * server has it, and storage that lies (a lost write, a corrupted read, which
 * the module documents as reading empty) leaves the affected sessions
 * unconstrained. Every other session must match the model.
 */

export type OutboxModule = typeof import('@/lib/saved-sessions-outbox');

export const OWNER = 'user_outbox_owner';
export const OTHER_USER = 'user_outbox_other';
export const MEETS = ['Spring Open', 'Fall Classic'] as const;
export type Meet = (typeof MEETS)[number];
export const SESSION_IDS: readonly string[] = MEETS.flatMap((meet) => [1, 2, 3].map((n) => `${meet}-${n}-Red`));
const RESET_ALL_KEY = '*';

/** How long a request that outlives the client's timeout takes to land (the `late` answer). */
export const LATE_LANDING_MS = 15_000;
/** Healthy flushes the final convergence may take; one is enough when nothing fails. */
const MAX_CONVERGENCE_FLUSHES = 3;
const SETTLE_STEP_MS = 1_000;
const MAX_SETTLE_STEPS = 120;

/** An unsigned JWT with `sub`; the outbox only reads the subject. */
export function jwtFor(sub: string): string {
  const part = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${part({ alg: 'RS256' })}.${part({ sub })}.sig`;
}
export const OWNER_TOKEN = jwtFor(OWNER);

function subjectOf(token: string | undefined): string | null {
  const payload = token?.split('.')[1];
  if (!payload) return null;
  try {
    const claims: unknown = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return claims && typeof claims === 'object' && typeof (claims as { sub?: unknown }).sub === 'string'
      ? (claims as { sub: string }).sub
      : null;
  } catch {
    return null;
  }
}

export function meetOf(id: string): Meet {
  const meet = MEETS.find((candidate) => id.startsWith(`${candidate}-`));
  if (!meet) throw new Error(`no meet for ${id}`);
  return meet;
}

/**
 * Version `version` of session `id`. `invalid` gives it session number 0,
 * which `normalizeStoredSession` (and so the outbox's reader) rejects.
 */
export function sessionBody(id: string, version: number, invalid = false): SavedSession {
  return {
    id,
    meet: meetOf(id) as SavedSession['meet'],
    sessionNumber: invalid ? 0 : Number(id.split('-')[1]),
    platform: 'Red',
    weightClass: '71kg',
    startTime: '10:00 AM',
    weighInTime: '8:00 AM',
    date: '2099-06-20',
    notes: `v${version}`,
    ...(version % 2 === 1 ? { athleteNames: [`Athlete ${version}`] } : {}),
  };
}

/** A session as it travels to the server: the PUT arguments, canonical JSON. */
export type Wire = string;

function canonical(args: Record<string, unknown>): Wire {
  return JSON.stringify(
    Object.keys(args)
      .filter((key) => key !== 'sessionId' && args[key] !== undefined)
      .sort()
      .map((key) => [key, args[key]]),
  );
}

export function wireOf(outbox: OutboxModule, session: SavedSession): Wire {
  return canonical(outbox.toSavedSessionBody(session));
}

type Row = Record<string, unknown>;

/** `users:*` saved-session mutations over an in-memory table per account. */
export class FakeServer {
  readonly accounts = new Map<string, Map<string, Row>>();

  rowsOf(user: string): Map<string, Row> {
    let rows = this.accounts.get(user);
    if (!rows) {
      rows = new Map();
      this.accounts.set(user, rows);
    }
    return rows;
  }

  apply(call: ApiCall): unknown {
    const user = subjectOf(call.token);
    if (!user) {
      throw new TransportRequestError(`${call.fn} unauthorized`, 401, JSON.stringify({ status: 401, error: 'unauthorized' }));
    }
    const rows = this.rowsOf(user);
    const { sessionId, ...rest } = call.args;
    switch (call.fn) {
      case 'users:putSavedSession': {
        const row: Row = {};
        for (const [key, value] of Object.entries(rest)) if (value !== undefined) row[key] = value;
        rows.set(String(sessionId), row);
        return { session_id: sessionId, updated_at: Date.now() };
      }
      case 'users:deleteSavedSession':
        return { deleted: rows.delete(String(sessionId)) };
      case 'users:deleteSavedSessions': {
        let deleted = 0;
        for (const [id, row] of rows) {
          if (call.args.meet === undefined || row.meet === call.args.meet) {
            rows.delete(id);
            deleted += 1;
          }
        }
        return { deleted_count: deleted };
      }
      default:
        throw new Error(`fake server: unexpected call to ${call.fn}`);
    }
  }

  wires(user: string): Map<string, Wire> {
    return new Map([...this.rowsOf(user)].map(([id, row]) => [id, canonical(row)]));
  }

  /** The account's list as the reconcile reads it (`sessionsFromApi`). */
  sessions(user: string): SavedSession[] {
    const text = (value: unknown) => (typeof value === 'string' ? value : '');
    return [...this.rowsOf(user)].map(([id, row]) => ({
      id,
      meet: row.meet as SavedSession['meet'],
      sessionNumber: row.session_number as number,
      platform: text(row.platform),
      weightClass: text(row.weight_class),
      startTime: text(row.start_time),
      weighInTime: '',
      date: text(row.date),
      ...(typeof row.notes === 'string' ? { notes: row.notes } : {}),
      ...(Array.isArray(row.athlete_names) ? { athleteNames: row.athlete_names as string[] } : {}),
    }));
  }
}

/**
 * What happens after the server has applied a write: the answer arrives, or
 * it is lost (dropped connection, a body that is not the answer, a proxy's
 * 502, no answer until the client's timeout), so the write landed but the
 * client cannot know. `late` is the one fault the property leaves out: the
 * request lands only after the client has timed out (see the FINDING test).
 */
export type AnswerFault =
  | { kind: 'answer' }
  | { kind: 'lost'; how: 'network' | 'garbage' | 'bad-gateway' | 'timeout' }
  | { kind: 'late' };

export const answerFaultArb: fc.Arbitrary<AnswerFault> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<AnswerFault>({ kind: 'answer' }) },
  {
    weight: 2,
    arbitrary: fc
      .constantFrom('network', 'garbage', 'bad-gateway', 'timeout')
      .map((how): AnswerFault => ({ kind: 'lost', how })),
  },
);

/** For the scheduled burst, which runs without advancing timers: no `timeout`. */
const settlingAnswerFaultArb: fc.Arbitrary<AnswerFault> = fc.oneof(
  { weight: 4, arbitrary: fc.constant<AnswerFault>({ kind: 'answer' }) },
  {
    weight: 2,
    arbitrary: fc.constantFrom('network', 'garbage', 'bad-gateway').map((how): AnswerFault => ({ kind: 'lost', how })),
  },
);

function abortError(): Error {
  const error = new Error('Aborted');
  error.name = 'AbortError';
  return error;
}

function untilAborted(signal: AbortSignal | undefined): Promise<never> {
  return new Promise((_, reject) => {
    if (signal?.aborted) reject(abortError());
    signal?.addEventListener('abort', () => reject(abortError()), { once: true });
  });
}

export interface Harness {
  server: FakeServer;
  /** The outbox module of the current app process. */
  outbox: OutboxModule;
  online: boolean;
}

function isClock(call: ApiCall): boolean {
  return call.fn === 'system:serverTime';
}

/**
 * The server as the transport sees it: offline fails every call before it
 * leaves the device; otherwise the write is applied, then `answers` decide
 * whether its answer gets back. `gate` holds a call until a scheduler lets it
 * reach the server.
 */
export function serverTransport(
  h: Harness,
  answers: readonly AnswerFault[],
  gate?: (call: ApiCall) => Promise<unknown>,
  answered: AnswerFault[] = [],
): Transport {
  let next = 0;
  return async (call) => {
    if (!h.online) throw new TypeError('Network request failed');
    if (isClock(call)) return Date.now();
    if (gate) await gate(call);
    const answer = next < answers.length ? answers[next++] : ({ kind: 'answer' } as const);
    answered.push(answer);
    if (answer.kind === 'late') {
      // Already on the wire: the client's abort cannot recall it.
      setTimeout(() => h.server.apply(call), LATE_LANDING_MS);
      return untilAborted(call.signal);
    }
    const result = h.server.apply(call);
    if (answer.kind === 'answer') return result;
    switch (answer.how) {
      case 'network':
        throw new TypeError('Network request failed');
      case 'garbage':
        return {};
      case 'bad-gateway':
        throw new TransportRequestError(`${call.fn} failed with 502`, 502, JSON.stringify({ status: 502 }));
      case 'timeout':
        return untilAborted(call.signal);
    }
  };
}

/** A fresh copy of the outbox module: a new app process over the same storage. */
export function loadOutbox(): OutboxModule {
  let loaded!: OutboxModule;
  jest.isolateModules(() => {
    // Storage and the API client survive the "restart": the device keeps its
    // disk and the transport stays the stub. Only the outbox's in-memory
    // state (write chain, single-flight runner, delivery log) starts over.
    jest.doMock('@react-native-async-storage/async-storage', () => AsyncStorage);
    jest.doMock('@/lib/api/meetcal-api', () => api);
    jest.doMock('@/lib/saved-sessions-store', () => store);
    // Only `require()` loads a module inside `jest.isolateModules()` (the
    // test-file exemption in eslint.config.js does not cover test-support/).
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    loaded = require('@/lib/saved-sessions-outbox');
  });
  return loaded;
}

/** Lets every pending promise callback run (real `setImmediate`; fake timers leave it alone). */
export function flushMicrotasks(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

/** Awaits `promise`, advancing fake timers so client timeouts fire. */
export async function settle<T>(promise: Promise<T>, label: string): Promise<T> {
  let outcome: { ok: true; value: T } | { ok: false; error: unknown } | null = null;
  promise.then(
    (value) => {
      outcome = { ok: true, value };
    },
    (error: unknown) => {
      outcome = { ok: false, error };
    },
  );
  for (let step = 0; step < MAX_SETTLE_STEPS; step += 1) {
    await flushMicrotasks();
    if (outcome) break;
    await jest.advanceTimersByTimeAsync(SETTLE_STEP_MS);
  }
  const settled = outcome as { ok: true; value: T } | { ok: false; error: unknown } | null;
  if (!settled) throw new Error(`${label} did not settle`);
  if (!settled.ok) throw settled.error;
  return settled.value;
}

// ---------------------------------------------------------------------------
// The model

/**
 * Why a session may differ from the user's last intent:
 * - `server`: the outbox dropped its write as refused by design, so the
 *   server's row at that moment (`wire`) is an accepted outcome too;
 * - `any`: storage lost or corrupted the queue entry that carried it.
 * A later save, unsave or reset of the session clears the excuse.
 */
export type Excuse = { kind: 'server'; wire: Wire | undefined } | { kind: 'any' };

export interface Model {
  /** Session id → the version the user last saved; absent when unsaved. */
  intended: Map<string, Wire>;
  excused: Map<string, Excuse>;
  /** Session id → the reset key (meet or `*`) when a reset was its last change. */
  lastReset: Map<string, string>;
  /** Highest `nextRev` seen; revisions only move forward. 0 after corruption. */
  revFloor: number;
}

export function emptyModel(): Model {
  return { intended: new Map(), excused: new Map(), lastReset: new Map(), revFloor: 0 };
}

export type Intent =
  | { kind: 'save'; id: string; version: number; invalid?: boolean }
  | { kind: 'unsave'; id: string }
  | { kind: 'reset'; meet: Meet | null };

function describeIntent(intent: Intent): string {
  if (intent.kind === 'save') return `save(${intent.id}, v${intent.version}${intent.invalid ? ', invalid' : ''})`;
  if (intent.kind === 'unsave') return `unsave(${intent.id})`;
  return `reset(${intent.meet ?? 'all'})`;
}

function idsCoveredBy(intent: Intent): string[] {
  if (intent.kind !== 'reset') return [intent.id];
  return SESSION_IDS.filter((id) => intent.meet === null || meetOf(id) === intent.meet);
}

export function applyIntent(m: Model, h: Harness, intent: Intent): void {
  for (const id of idsCoveredBy(intent)) {
    m.excused.delete(id);
    if (intent.kind === 'save') {
      m.intended.set(id, wireOf(h.outbox, sessionBody(id, intent.version, intent.invalid)));
      m.lastReset.delete(id);
    } else {
      m.intended.delete(id);
      if (intent.kind === 'reset') m.lastReset.set(id, intent.meet ?? RESET_ALL_KEY);
      else m.lastReset.delete(id);
    }
  }
}

export function markIntent(h: Harness, intent: Intent): Promise<number> {
  if (intent.kind === 'save') {
    return h.outbox.markSessionPut(OWNER, sessionBody(intent.id, intent.version, intent.invalid));
  }
  if (intent.kind === 'unsave') return h.outbox.markSessionDelete(OWNER, intent.id, meetOf(intent.id));
  return h.outbox.markResetPending(OWNER, intent.meet);
}

function excuse(m: Model, id: string, reason: Excuse): void {
  if (m.excused.get(id)?.kind === 'any') return;
  m.excused.set(id, reason);
}

/** A status the outbox treats as final for this call: it drops the entry. */
function isFinalStatus(status: number): boolean {
  return status >= 400 && status < 500 && status !== 401 && status !== 429;
}

/**
 * Accounts for every call since `cursor.seen` that the outbox will drop as
 * refused (or, for a 404 on a single delete, as done): the session keeps the
 * server's row. A refused reset excuses the sessions whose last change was
 * that reset; sessions saved after it keep their own pending writes.
 */
export function processRefusals(m: Model, h: Harness, calls: ChaosTransport['calls'], cursor: { seen: number }): void {
  const rows = h.server.wires(OWNER);
  for (; cursor.seen < calls.length; cursor.seen += 1) {
    const { call, fault } = calls[cursor.seen];
    if (fault.kind !== 'status' || !isFinalStatus(fault.status)) continue;
    if (call.fn === 'users:deleteSavedSessions') {
      const key = typeof call.args.meet === 'string' ? call.args.meet : RESET_ALL_KEY;
      for (const [id, resetKey] of m.lastReset) {
        if (resetKey === key) excuse(m, id, { kind: 'server', wire: rows.get(id) });
      }
    } else if (call.fn === 'users:putSavedSession' || call.fn === 'users:deleteSavedSession') {
      const id = String(call.args.sessionId);
      excuse(m, id, { kind: 'server', wire: rows.get(id) });
    }
  }
}

// ---------------------------------------------------------------------------
// Invariants

function wiresOf(h: Harness, sessions: SavedSession[], label: string): Map<string, Wire> {
  const wires = new Map<string, Wire>();
  for (const session of sessions) {
    if (wires.has(session.id)) throw new Error(`${label}: ${session.id} appears twice`);
    wires.set(session.id, wireOf(h.outbox, session));
  }
  return wires;
}

/** Every session matches the user's last intent, or an outcome its excuse allows. */
export function expectMatchesIntent(label: string, actual: Map<string, Wire>, m: Model): void {
  for (const id of actual.keys()) {
    if (!SESSION_IDS.includes(id)) throw new Error(`${label}: unknown session ${id}`);
  }
  for (const id of SESSION_IDS) {
    const want = m.intended.get(id);
    const got = actual.get(id);
    if (got === want) continue;
    const reason = m.excused.get(id);
    if (reason?.kind === 'any') continue;
    if (reason?.kind === 'server' && got === reason.wire) continue;
    throw new Error(
      `${label}: ${id} is ${got ?? 'absent'}, but the user's last intent is ${want ?? 'absent'}` +
        (reason ? ` (or the refused write's server row ${reason.wire ?? 'absent'})` : ''),
    );
  }
}

type OutboxState = Awaited<ReturnType<OutboxModule['readOutbox']>>;

/** The stored outbox reads back, and its shape follows the module's ordering rules. */
export function expectWellFormed(outbox: OutboxState, m: Model): void {
  const fail = (why: string) => {
    throw new Error(`malformed outbox (${why}): ${JSON.stringify(outbox)}`);
  };
  const { nextRev } = outbox;
  if (!Number.isInteger(nextRev) || nextRev < 1) fail('nextRev');
  if (nextRev < m.revFloor) fail(`nextRev went back from ${m.revFloor}`);
  m.revFloor = nextRev;
  const revs = new Set<number>();
  const checkRev = (rev: number) => {
    if (!Number.isInteger(rev) || rev < 1 || rev >= nextRev) fail(`rev ${rev} outside [1, ${nextRev})`);
    if (revs.has(rev)) fail(`rev ${rev} used twice`);
    revs.add(rev);
  };
  for (const [key, rev] of Object.entries(outbox.resets)) {
    if (key !== RESET_ALL_KEY && !(MEETS as readonly string[]).includes(key)) fail(`reset key ${key}`);
    checkRev(rev);
  }
  for (const [id, entry] of Object.entries(outbox.sessions)) {
    if (!SESSION_IDS.includes(id)) fail(`entry for unknown ${id}`);
    checkRev(entry.rev);
    if (entry.meet !== meetOf(id)) fail(`${id} filed under ${entry.meet}`);
    if (entry.op === 'put' && (entry.session?.id !== id || entry.session.meet !== entry.meet)) fail(`${id} body`);
    if (entry.op !== 'put' && entry.op !== 'delete') fail(`${id} op`);
    // Marking a reset drops the entries it supersedes.
    for (const key of [RESET_ALL_KEY, entry.meet]) {
      const resetRev = outbox.resets[key];
      if (resetRev !== undefined && entry.rev < resetRev) fail(`${id} older than pending reset ${key}`);
    }
  }
}

/**
 * After every command: the outbox reads and is well formed; what a reconcile
 * would show (server list merged with the outbox) is the user's intent, so no
 * pending write vanished; and no other account was written to.
 */
export async function checkInvariants(m: Model, h: Harness): Promise<void> {
  const outbox = await h.outbox.readOutbox(OWNER);
  expectWellFormed(outbox, m);
  const merged = h.outbox.mergeServerSessions(h.server.sessions(OWNER), outbox);
  expectMatchesIntent('reconcile', wiresOf(h, merged, 'reconcile'), m);
  for (const [user, rows] of h.server.accounts) {
    if (user !== OWNER && rows.size > 0) throw new Error(`wrote to ${user}'s account: ${[...rows.keys()].join(', ')}`);
  }
}

// ---------------------------------------------------------------------------
// Commands

type Command = fc.AsyncCommand<Model, Harness>;

const ONLINE = { isConnected: true, isInternetReachable: true, type: 'wifi', details: null } as unknown as NetInfoState;
const OFFLINE = { isConnected: false, isInternetReachable: false, type: 'none', details: null } as unknown as NetInfoState;

export function setOnline(h: Harness, online: boolean): void {
  h.online = online;
  // The outbox never reads NetInfo (the hook's reconnect trigger does); the
  // transport failing every call is what being offline means to it.
  setNetInfoState(online ? ONLINE : OFFLINE);
}

/** The user saves, unsaves or resets; the mark must be durable once it resolves. */
export class MarkCommand implements Command {
  constructor(readonly intent: Intent) {}
  check = () => true;
  async run(m: Model, h: Harness): Promise<void> {
    applyIntent(m, h, this.intent);
    const rev = await markIntent(h, this.intent);
    const outbox = await h.outbox.readOutbox(OWNER);
    const { intent } = this;
    const stored =
      intent.kind === 'reset'
        ? outbox.resets[intent.meet ?? RESET_ALL_KEY]
        : outbox.sessions[intent.id]?.op === (intent.kind === 'save' ? 'put' : 'delete')
          ? outbox.sessions[intent.id].rev
          : undefined;
    if (stored !== rev) {
      throw new Error(`${describeIntent(intent)} resolved with rev ${rev}, but the outbox holds ${JSON.stringify(outbox)}`);
    }
    await checkInvariants(m, h);
  }
  toString = () => describeIntent(this.intent);
}

export type TokenHolder = 'owner' | 'other' | 'unreadable';

/** One flush under transport faults, lost answers and a flaky (or foreign) Clerk token. */
export class FlushCommand implements Command {
  constructor(
    readonly faults: TransportFault[],
    readonly answers: AnswerFault[],
    readonly tokenFaults: TokenFault[],
    readonly holder: TokenHolder,
  ) {}
  check = () => true;
  async run(m: Model, h: Harness): Promise<void> {
    const chaos = installChaosTransport(serverTransport(h, h.online ? this.answers : []), h.online ? this.faults : []);
    try {
      const token = this.holder === 'owner' ? OWNER_TOKEN : this.holder === 'other' ? jwtFor(OTHER_USER) : 'not-a-jwt';
      const result = await settle(h.outbox.flushOutbox(OWNER, chaosGetToken(token, this.tokenFaults)), 'flush');
      processRefusals(m, h, chaos.calls, { seen: 0 });
      const writes = chaos.calls.filter(({ call }) => !isClock(call));
      const foreign = writes.filter(({ call }) => call.token !== OWNER_TOKEN);
      if (foreign.length > 0) throw new Error(`sent ${foreign[0].call.fn} with a token that is not the owner's`);
      const sawAuthFailure = writes.some(({ fault }) => fault.kind === 'status' && fault.status === 401);
      if (result.authExpired !== sawAuthFailure) {
        throw new Error(`authExpired ${result.authExpired}, but a 401 was ${sawAuthFailure ? '' : 'not '}answered`);
      }
      const pending = h.outbox.countPendingWrites(await h.outbox.readOutbox(OWNER));
      if (result.remaining !== pending) throw new Error(`flush reported ${result.remaining} remaining, outbox holds ${pending}`);
    } finally {
      chaos.restore();
    }
    await checkInvariants(m, h);
  }
  toString = () =>
    `flush(${JSON.stringify({ faults: this.faults, answers: this.answers, tokens: this.tokenFaults, holder: this.holder })})`;
}

export class NetworkCommand implements Command {
  constructor(readonly online: boolean) {}
  check = () => true;
  async run(m: Model, h: Harness): Promise<void> {
    setOnline(h, this.online);
    await checkInvariants(m, h);
  }
  toString = () => (this.online ? 'online' : 'offline');
}

/** A mark or a flush while storage rejects, fills up, loses writes or corrupts reads. */
export class StorageFaultCommand implements Command {
  constructor(
    readonly plan: StorageFault[],
    readonly inner: Intent | { kind: 'flush' },
  ) {}
  check = () => true;
  async run(m: Model, h: Harness): Promise<void> {
    const beforeOutbox = await h.outbox.readOutbox(OWNER);
    const before = JSON.stringify(beforeOutbox);
    const transport = installChaosTransport(serverTransport(h, []), []);
    const storage = installStorageChaos(this.plan);
    let failed = false;
    try {
      if (this.inner.kind === 'flush') {
        await settle(h.outbox.flushOutbox(OWNER, async () => OWNER_TOKEN), 'flush under storage faults');
      } else {
        await markIntent(h, this.inner).catch(() => {
          failed = true;
        });
      }
    } finally {
      storage.restore();
      transport.restore();
    }
    const consumed = new Set(storage.calls.map(({ fault }) => fault.kind));
    if (this.inner.kind !== 'flush') {
      if (failed) {
        const after = JSON.stringify(await h.outbox.readOutbox(OWNER));
        if (after !== before) throw new Error(`a mark that failed changed the outbox: ${before} → ${after}`);
      } else {
        applyIntent(m, h, this.inner);
        // The platform said the write landed; it did not. Nothing can see that.
        if (consumed.has('lose-write')) for (const id of idsCoveredBy(this.inner)) excuse(m, id, { kind: 'any' });
      }
    } else if (consumed.has('lose-write')) {
      // FINDING (lost reset clear, see `saved-sessions-outbox.chaos.test.ts`):
      // a delivered reset whose clear is lost stays pending, yet the same pass
      // sends later saves in its meet, which the re-sent reset then deletes.
      // Excluded here, and only here, until the fix is approved.
      for (const key of Object.keys(beforeOutbox.resets)) {
        const meet = key === RESET_ALL_KEY ? null : (key as Meet);
        for (const id of idsCoveredBy({ kind: 'reset', meet })) excuse(m, id, { kind: 'any' });
      }
    }
    if (consumed.has('corrupt-read')) {
      // Documented: a stored value that parses badly reads as empty, and the
      // next write replaces it, queue and revision counter included.
      for (const id of SESSION_IDS) excuse(m, id, { kind: 'any' });
      m.revFloor = 0;
    }
    await checkInvariants(m, h);
  }
  toString = () =>
    `storage(${JSON.stringify(this.plan)}, ${this.inner.kind === 'flush' ? 'flush' : describeIntent(this.inner)})`;
}

/**
 * The app is killed and relaunched. With `crash`, it dies while a flush has a
 * write on the wire (which `applied` says reached the server).
 */
export class RestartCommand implements Command {
  constructor(readonly crash: { applied: boolean } | null) {}
  check = () => true;
  async run(m: Model, h: Harness): Promise<void> {
    if (this.crash && h.online) {
      const { applied } = this.crash;
      let onWire = false;
      let finished = false;
      const chaos = installChaosTransport(async (call) => {
        if (isClock(call)) return Date.now();
        if (applied) h.server.apply(call);
        onWire = true;
        return new Promise(() => {});
      }, []);
      try {
        void h.outbox.flushOutbox(OWNER, async () => OWNER_TOKEN).finally(() => {
          finished = true;
        });
        for (let tick = 0; tick < 20 && !onWire && !finished; tick += 1) await flushMicrotasks();
        if (!onWire && !finished) throw new Error('crash flush neither sent nor finished');
      } finally {
        chaos.restore();
      }
    }
    // The old process's timers die with it; its stuck flush never resumes.
    jest.clearAllTimers();
    h.outbox = loadOutbox();
    await checkInvariants(m, h);
  }
  toString = () => (this.crash ? `restart(crash mid-flush, ${this.crash.applied ? 'applied' : 'not applied'})` : 'restart');
}

export type BurstOp = Intent | { kind: 'flush' } | { kind: 'reconcile' };

function describeOp(op: BurstOp): string {
  return op.kind === 'flush' || op.kind === 'reconcile' ? op.kind : describeIntent(op);
}

type StorageMock = Record<'getItem' | 'setItem', jest.Mock>;

/**
 * Makes every AsyncStorage read and write a point the scheduler can
 * interleave at, as the native bridge makes each one a separate await.
 */
function gateStorage(s: fc.Scheduler): { restore: () => void } {
  const mock = AsyncStorage as unknown as StorageMock;
  const originals = (['getItem', 'setItem'] as const).map((method) => {
    const original = mock[method].getMockImplementation() as (...args: unknown[]) => Promise<unknown>;
    mock[method].mockImplementation(async (...args: unknown[]) => {
      await s.schedule(Promise.resolve(), `storage ${method}`);
      return original(...args);
    });
    return [method, original] as const;
  });
  return {
    restore: () => {
      for (const [method, original] of originals) mock[method].mockImplementation(original);
    },
  };
}

/**
 * Taps, flushes and reconciles overlapping, interleaved by fast-check's
 * scheduler: each user action starts, each request reaches the server, and
 * each storage read or write completes when the scheduler says. Marks and the reconcile's merge share one queue,
 * as `useSavedSessions`' mutation queue makes them; flushes run beside it.
 * A reconcile fetches at one point and merges later, replaying the writes
 * delivered meanwhile, and must still show the user's intent.
 */
export class BurstCommand implements Command {
  constructor(
    readonly scheduler: fc.Scheduler,
    readonly ops: BurstOp[],
    readonly faults: TransportFault[],
    readonly answers: AnswerFault[],
  ) {}
  check = () => true;
  async run(m: Model, h: Harness): Promise<void> {
    const s = this.scheduler;
    const cursor = { seen: 0 };
    const target = (call: ApiCall) => String(call.args.sessionId ?? call.args.meet ?? 'all');
    const answered: AnswerFault[] = [];
    const chaos = installChaosTransport(
      serverTransport(
        h,
        h.online ? this.answers : [],
        (call) => s.schedule(Promise.resolve(), `server ${call.fn} ${target(call)}`),
        answered,
      ),
      h.online ? this.faults : [],
    );
    // Event clock for the single-flight promise: a flush called after a
    // mark resolved sends that mark's entry, even when it joins a running one.
    let clock = 0;
    let lastMarkResolved = 0;
    let lastFlushCalled = 0;
    let tail: Promise<unknown> = Promise.resolve();
    const onQueue = <T>(task: () => Promise<T>): Promise<T> => {
      const run = tail.then(task);
      tail = run.catch(() => undefined);
      return run;
    };
    const runOp = async (op: BurstOp): Promise<void> => {
      if (op.kind === 'flush') {
        lastFlushCalled = ++clock;
        await h.outbox.flushOutbox(OWNER, async () => OWNER_TOKEN);
        return;
      }
      if (op.kind === 'reconcile') {
        const marker = h.outbox.currentDeliverySeq();
        await s.schedule(Promise.resolve(), 'server users:savedSessions');
        if (!h.online) return;
        const fetched = h.server.sessions(OWNER);
        await onQueue(async () => {
          const outbox = await h.outbox.readOutbox(OWNER);
          processRefusals(m, h, chaos.calls, cursor);
          const merged = h.outbox.mergeServerSessions(fetched, outbox, h.outbox.deliveriesSince(OWNER, marker));
          expectMatchesIntent('reconcile racing a flush', wiresOf(h, merged, 'reconcile racing a flush'), m);
        });
        return;
      }
      await onQueue(async () => {
        processRefusals(m, h, chaos.calls, cursor);
        applyIntent(m, h, op);
        await markIntent(h, op);
        lastMarkResolved = ++clock;
      });
    };
    const storage = gateStorage(s);
    try {
      const tasks = this.ops.map((op) => s.schedule(Promise.resolve(), `user ${describeOp(op)}`).then(() => runOp(op)));
      await s.waitFor(Promise.all(tasks));
      processRefusals(m, h, chaos.calls, cursor);
    } finally {
      storage.restore();
      chaos.restore();
    }
    const healthy =
      h.online &&
      chaos.calls.every(({ fault }) => fault.kind === 'pass') &&
      answered.every((answer) => answer.kind === 'answer') &&
      // Each joining call asks for one more pass; a flush runs at most five.
      this.ops.filter((op) => op.kind === 'flush').length <= 4;
    if (healthy && lastFlushCalled > lastMarkResolved) {
      const outbox = await h.outbox.readOutbox(OWNER);
      if (h.outbox.countPendingWrites(outbox) > 0) {
        throw new Error(`a flush called after the last mark left it unsent: ${JSON.stringify(outbox)}`);
      }
    }
    await checkInvariants(m, h);
  }
  [fc.cloneMethod](): BurstCommand {
    const scheduler = fc.hasCloneMethod(this.scheduler) ? this.scheduler[fc.cloneMethod]() : this.scheduler;
    return new BurstCommand(scheduler, this.ops, this.faults, this.answers);
  }
  toString = () =>
    `burst(${this.ops.map(describeOp).join(', ')}; ${JSON.stringify({ faults: this.faults, answers: this.answers })}; ${String(this.scheduler)})`;
}

// ---------------------------------------------------------------------------
// Arbitraries

const sessionIdArb = fc.constantFrom(...SESSION_IDS);

// Saves always carry a readable body. FINDING (unreadable PUT body, see
// `saved-sessions-outbox.chaos.test.ts`): an `invalid` save is acknowledged
// and then dropped on the next read; excluded until the fix is approved.

export const intentArb: fc.Arbitrary<Intent> = fc.oneof(
  {
    weight: 4,
    arbitrary: fc
      .record({ id: sessionIdArb, version: fc.integer({ min: 1, max: 9 }) })
      .map(({ id, version }): Intent => ({ kind: 'save', id, version })),
  },
  { weight: 3, arbitrary: sessionIdArb.map((id): Intent => ({ kind: 'unsave', id })) },
  { weight: 2, arbitrary: fc.constantFrom<Meet | null>(...MEETS, null).map((meet): Intent => ({ kind: 'reset', meet })) },
);

/**
 * The refusals the outbox branches on (401 keeps the queue and flags the
 * session; 404 on a delete is done; 429 retries; other 4xx drop; 5xx retry
 * and hold a failed reset's meet), more often than the generic plan has them.
 */
const branchStatusFaultArb: fc.Arbitrary<TransportFault> = fc
  .constantFrom(400, 401, 403, 404, 409, 429, 500, 503)
  .map((status): TransportFault => ({ kind: 'status', status }));

const flushFaultArb = fc.oneof({ weight: 3, arbitrary: transportFaultArb }, { weight: 1, arbitrary: branchStatusFaultArb });
const burstFaultArb = fc.oneof(
  { weight: 3, arbitrary: settlingTransportFaultArb },
  { weight: 1, arbitrary: branchStatusFaultArb },
);

const burstOpArb: fc.Arbitrary<BurstOp> = fc.oneof(
  { weight: 3, arbitrary: intentArb },
  { weight: 3, arbitrary: fc.constant<BurstOp>({ kind: 'flush' }) },
  { weight: 1, arbitrary: fc.constant<BurstOp>({ kind: 'reconcile' }) },
);

const markCommandArb = intentArb.map((intent): Command => new MarkCommand(intent));

const flushCommandArb = fc
  .record({
    faults: fc.array(flushFaultArb, { maxLength: 5 }),
    answers: fc.array(answerFaultArb, { maxLength: 3 }),
    tokens: fc.array(tokenFaultArb, { maxLength: 2 }),
    holder: fc.constantFrom<TokenHolder>('owner', 'owner', 'owner', 'owner', 'other', 'unreadable'),
  })
  .map(({ faults, answers, tokens, holder }): Command => new FlushCommand(faults, answers, tokens, holder));

const burstCommandArb = fc
  .record({
    scheduler: fc.scheduler(),
    ops: fc.array(burstOpArb, { minLength: 2, maxLength: 8 }),
    // Often clean, so the single-flight check (which needs no faults) runs.
    faults: fc.oneof(fc.constant<TransportFault[]>([]), fc.array(burstFaultArb, { maxLength: 4 })),
    answers: fc.oneof(fc.constant<AnswerFault[]>([]), fc.array(settlingAnswerFaultArb, { maxLength: 3 })),
  })
  .map(({ scheduler, ops, faults, answers }): Command => new BurstCommand(scheduler, ops, faults, answers));

/** `fc.commands` picks among these uniformly; repeats weight the common actions. */
export const outboxCommandArbs: fc.Arbitrary<Command>[] = [
  markCommandArb,
  markCommandArb,
  markCommandArb,
  flushCommandArb,
  flushCommandArb,
  burstCommandArb,
  burstCommandArb,
  fc.boolean().map((online) => new NetworkCommand(online)),
  fc
    .record({
      plan: fc.array(storageFaultArb, { minLength: 1, maxLength: 4 }),
      inner: fc.oneof(intentArb, fc.constant({ kind: 'flush' as const })),
    })
    .map(({ plan, inner }) => new StorageFaultCommand(plan, inner)),
  fc
    .option(fc.record({ applied: fc.boolean() }), { nil: null, freq: 2 })
    .map((crash) => new RestartCommand(crash)),
];

// ---------------------------------------------------------------------------
// One run

/** A fresh device: empty storage, a new outbox process, online, fake timers. */
export async function startRun(): Promise<{ m: Model; h: Harness; dispose: () => void }> {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask'] });
  await AsyncStorage.clear();
  api.resetServerClockForTests();
  const h: Harness = { server: new FakeServer(), outbox: loadOutbox(), online: true };
  setOnline(h, true);
  return {
    m: emptyModel(),
    h,
    dispose: () => {
      jest.clearAllTimers();
      jest.useRealTimers();
      setOnline(h, true);
      api.resetServerClockForTests();
    },
  };
}

/**
 * With a healthy network, a valid token and honest storage, the outbox
 * empties within a few flushes, and the server then holds exactly what the
 * user meant: no lost saves, no unsave undone by a stale save, no stray rows.
 */
export async function converge(m: Model, h: Harness): Promise<void> {
  setOnline(h, true);
  const chaos = installChaosTransport(serverTransport(h, []), []);
  try {
    for (let pass = 0; pass < MAX_CONVERGENCE_FLUSHES; pass += 1) {
      const result = await settle(h.outbox.flushOutbox(OWNER, async () => OWNER_TOKEN), 'convergence flush');
      if (result.remaining === 0) break;
    }
    // Anything still on the wire lands now.
    await jest.advanceTimersByTimeAsync(LATE_LANDING_MS * 2);
  } finally {
    chaos.restore();
  }
  const outbox = await h.outbox.readOutbox(OWNER);
  if (h.outbox.countPendingWrites(outbox) !== 0) {
    throw new Error(`outbox not empty after ${MAX_CONVERGENCE_FLUSHES} healthy flushes: ${JSON.stringify(outbox)}`);
  }
  expectMatchesIntent('server after convergence', h.server.wires(OWNER), m);
}
