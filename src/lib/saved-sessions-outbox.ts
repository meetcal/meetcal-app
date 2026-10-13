import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Crypto from 'expo-crypto';
import { normalizeStoredSession, type SavedSession } from '@/lib/saved-sessions-store';
import {
  deleteSavedSession,
  deleteSavedSessions,
  MeetCalApiError,
  MeetCalApiTimeoutError,
  putSavedSession,
  type SavedSessionWriteRevision,
} from '@/lib/api/meetcal-api';
import { devWarn } from '@/lib/logger';

/**
 * Pending-writes outbox for saved sessions.
 *
 * Every local mutation records here what still has to reach the server,
 * *before* the local list is written, so a crash between the two cannot
 * leave a local change with no record that it is unsynced. A pending PUT
 * carries the session body it will send, so the sync always sends the latest
 * edit and a reconcile can restore a dirty row even if the local list lost it.
 *
 * Ordering rules:
 * - Every entry has a rev from one per-user counter. `flushOutbox` sends
 *   entries in rev order, re-reading the outbox before each send, and it is
 *   single-flight per user: immediate writes and replays share one runner,
 *   so a stale replay can never overtake a newer write.
 * - A reset (bulk delete of a meet, or of every meet) covers only writes
 *   made *before* it. Marking a reset drops the per-session entries it
 *   supersedes; a session saved after the reset keeps its own, later entry.
 * - While a reset for a meet is still in the outbox (unsent, or sent but not
 *   yet cleared), later writes for that meet are held back, so the reset can
 *   never land after them and delete them.
 * - A flag is cleared only on a 2xx, and only if the entry still has the rev
 *   that was sent.
 * - Every write carries its rev and the outbox's install id (`device`), so the
 *   server can ignore one that lands after a newer write from this install
 *   (aborting a timed-out request cannot recall it). The server answers such
 *   a write with success, so it is cleared like any other.
 */

/**
 * Mirrors `MAX_SAVED_SESSION_ATHLETE_NAMES` in the backend
 * (`app/src/common/query.rs`). A PUT with more names is a 400.
 */
export const MAX_SAVED_SESSION_ATHLETE_NAMES = 64;

/** `resets` key meaning "delete every meet", as `DELETE /users/me/saved-sessions` without `meet`. */
export const RESET_ALL_MEETS = '*';

/** Upper bound on back-to-back passes one flush runs when writes keep arriving. */
const MAX_FLUSH_PASSES = 5;

export type PendingSessionOp = 'put' | 'delete';

export interface PendingSessionEntry {
  op: PendingSessionOp;
  /** Monotonic per outbox (`takeRev`); a clear only lands when the rev still matches. */
  rev: number;
  /** Meet the session belongs to, so resets can supersede and hold it. */
  meet: string;
  /** Body to send for a PUT. Always the latest local version. */
  session?: SavedSession;
}

export interface SavedSessionsOutbox {
  sessions: Record<string, PendingSessionEntry>;
  /** Meet name (or `RESET_ALL_MEETS`) → rev of the pending bulk delete. */
  resets: Record<string, number>;
  nextRev: number;
  /**
   * This install's id in the server's write ordering, which compares revs
   * only within one id. Stored with `nextRev`, not beside it: whenever the
   * counter starts over (storage cleared, or a value that reads as empty or
   * without a counter), so does the id, so a new rev is never read as older
   * than one an earlier outbox sent. Set by the first write of the outbox.
   */
  device?: string;
}

export interface FlushResult {
  /** The server answered 401: the Clerk session no longer authorises writes. */
  authExpired: boolean;
  /** At least one write reached the server this flush. */
  delivered: number;
  /** Entries still pending after the flush. */
  remaining: number;
  /** Session id → rev of each write the server refused with a non-retryable 4xx. */
  rejected: Map<string, number>;
}

function emptyOutbox(): SavedSessionsOutbox {
  return { sessions: {}, resets: {}, nextRev: 1 };
}

/**
 * Hands out the next rev: past every rev this outbox gave before, and at
 * least the clock in milliseconds. The clock is what keeps the server's
 * ordering sound when storage goes back in time with the install id intact:
 * an outbox restored from a device backup (or the same backup restored onto
 * two phones) has an older `nextRev` than the revs the server already holds
 * from that id, and counting on from it would have the server ignore the new
 * writes as stale. Never moves back, even when the clock does.
 */
function takeRev(outbox: SavedSessionsOutbox): number {
  const rev = Math.max(outbox.nextRev, Date.now());
  outbox.nextRev = rev + 1;
  return rev;
}

/** An install id this outbox writes, and the server's 64-character limit allows. */
const DEVICE_ID = /^[A-Za-z0-9_-]{8,64}$/;

function isDeviceId(value: unknown): value is string {
  return typeof value === 'string' && DEVICE_ID.test(value);
}

/**
 * A new random install id: a v4 UUID from the platform's secure random
 * source, or, where that is unavailable (Jest's native-module mock), 128 bits
 * from `Math.random`. It only has to differ between one user's installs.
 */
export function newDeviceId(): string {
  try {
    const id: unknown = Crypto.randomUUID();
    if (isDeviceId(id)) return id;
  } catch {
    // Fall through to the fallback below.
  }
  let id = '';
  for (let i = 0; i < 4; i += 1) {
    id += Math.floor(Math.random() * 0x1_0000_0000)
      .toString(16)
      .padStart(8, '0');
  }
  return id;
}

export function getSavedSessionsOutboxKey(userId: string): string {
  return `@saved_sessions_outbox_${userId}`;
}

export function getOutboxSeededKey(userId: string): string {
  return `@saved_sessions_outbox_seeded_${userId}`;
}

/**
 * Tail of the serialized read-modify-write chain, so two overlapping marks
 * cannot each read the same snapshot and have one overwrite the other.
 */
let writeChain: Promise<unknown> = Promise.resolve();

function enqueue<T>(task: () => Promise<T>): Promise<T> {
  const run = writeChain.then(task, task);
  writeChain = run.catch(() => undefined);
  return run;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

/**
 * A persisted PUT body goes through the same reader as the saved-sessions
 * list. It used to have its own, weaker check (four typeof tests, then
 * `as unknown as SavedSession`), so a body written by an older build with
 * `athleteNames: "Jane Doe"` or `weightClass: null` was replayed as-is: the
 * string reached `capAthleteNames` (which only checks `.length`) and the PUT,
 * and `mergeServerSessions` published the row into the Saved list unnormalized.
 */
function parseSessionBody(value: unknown): SavedSession | undefined {
  return normalizeStoredSession(value) ?? undefined;
}

function parseOutbox(raw: string | null): SavedSessionsOutbox {
  if (!raw) return emptyOutbox();
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return emptyOutbox();
    const sessions: Record<string, PendingSessionEntry> = {};
    if (isRecord(parsed.sessions)) {
      for (const [id, entry] of Object.entries(parsed.sessions)) {
        if (!isRecord(entry)) continue;
        const { op, rev, meet } = entry;
        if ((op !== 'put' && op !== 'delete') || typeof rev !== 'number' || !Number.isInteger(rev)) {
          continue;
        }
        const body = parseSessionBody(entry.session);
        const entryMeet = typeof meet === 'string' ? meet : body?.meet;
        // A PUT without a body, or any entry without a meet, cannot be
        // replayed or ordered against resets; drop it rather than guess.
        if (!entryMeet || (op === 'put' && !body)) continue;
        sessions[id] = { op, rev, meet: entryMeet, ...(body ? { session: body } : {}) };
      }
    }
    const resets: Record<string, number> = {};
    if (isRecord(parsed.resets)) {
      for (const [meet, rev] of Object.entries(parsed.resets)) {
        if (typeof rev === 'number' && Number.isInteger(rev)) resets[meet] = rev;
      }
    }
    const maxRev = Math.max(
      0,
      ...Object.values(sessions).map((entry) => entry.rev),
      ...Object.values(resets),
    );
    const hasCounter = typeof parsed.nextRev === 'number' && Number.isInteger(parsed.nextRev);
    const nextRev = hasCounter ? Math.max(parsed.nextRev as number, maxRev + 1) : maxRev + 1;
    // The id is kept only with the counter it numbered: one without it
    // starts over, so the next write takes a new id.
    const device = hasCounter && isDeviceId(parsed.device) ? parsed.device : undefined;
    return { sessions, resets, nextRev, ...(device ? { device } : {}) };
  } catch {
    return emptyOutbox();
  }
}

export function countPendingWrites(outbox: SavedSessionsOutbox): number {
  return Object.keys(outbox.sessions).length + Object.keys(outbox.resets).length;
}

/**
 * The stored outbox. Throws when storage cannot be read: an unreadable
 * outbox is not an empty one, and treating it as empty would let the next
 * mark write "empty + one entry" over every queued write, and let a
 * reconcile drop the rows those writes protect. (A stored value that parses
 * badly is corruption, not unavailability, and reads as empty.)
 */
export async function readOutbox(userId: string): Promise<SavedSessionsOutbox> {
  return parseOutbox(await AsyncStorage.getItem(getSavedSessionsOutboxKey(userId)));
}

async function writeOutbox(userId: string, outbox: SavedSessionsOutbox): Promise<void> {
  // Written even when empty so `nextRev` never restarts: a rev must never be
  // reused while a send that carries an older copy of it may still clear it.
  await AsyncStorage.setItem(getSavedSessionsOutboxKey(userId), JSON.stringify(outbox));
}

function updateOutbox<T>(
  userId: string,
  mutate: (outbox: SavedSessionsOutbox) => T,
): Promise<T> {
  return enqueue(async () => {
    const outbox = await readOutbox(userId);
    const result = mutate(outbox);
    outbox.device ??= newDeviceId();
    await writeOutbox(userId, outbox);
    return result;
  });
}

/**
 * Record that `session` must be upserted on the server. Returns the entry's rev.
 *
 * Rejects a body the outbox's reader would drop (`parseSessionBody`): the
 * entry would vanish on the next read, and with it the write it replaced
 * (a pending unsave would never reach the server). Stores the body as that
 * reader returns it.
 */
export function markSessionPut(userId: string, session: SavedSession): Promise<number> {
  const body = parseSessionBody(session);
  if (!body) {
    return Promise.reject(new Error(`Saved sessions outbox: unreadable session body for ${String(session.id)}; not queued`));
  }
  return updateOutbox(userId, (outbox) => {
    const rev = takeRev(outbox);
    outbox.sessions[body.id] = { op: 'put', rev, meet: body.meet, session: body };
    return rev;
  });
}

/** Record that session `sessionId` (in `meet`) must be deleted on the server. */
export function markSessionDelete(userId: string, sessionId: string, meet: string): Promise<number> {
  return updateOutbox(userId, (outbox) => {
    const rev = takeRev(outbox);
    outbox.sessions[sessionId] = { op: 'delete', rev, meet };
    return rev;
  });
}

/**
 * Record a pending bulk delete of `meet` (or every meet). Per-session entries
 * it covers are superseded: a queued PUT or DELETE for a session in that
 * meet has nothing left to do once the whole meet is deleted.
 */
export function markResetPending(userId: string, meet: string | null): Promise<number> {
  return updateOutbox(userId, (outbox) => {
    const rev = takeRev(outbox);
    if (meet === null) {
      outbox.sessions = {};
      outbox.resets = { [RESET_ALL_MEETS]: rev };
      return rev;
    }
    for (const [id, entry] of Object.entries(outbox.sessions)) {
      if (entry.meet === meet) delete outbox.sessions[id];
    }
    outbox.resets[meet] = rev;
    return rev;
  });
}

/**
 * Drop the entry for `sessionId`, but only if it is still the one marked
 * with `rev`. A PUT that succeeds after the user has since removed the
 * session must not erase the newer pending DELETE.
 */
export function clearSessionPending(userId: string, sessionId: string, rev: number): Promise<void> {
  return updateOutbox(userId, (outbox) => {
    if (outbox.sessions[sessionId]?.rev === rev) {
      delete outbox.sessions[sessionId];
    }
  });
}

export function clearResetPending(userId: string, meet: string | null, rev: number): Promise<void> {
  return updateOutbox(userId, (outbox) => {
    const key = meet ?? RESET_ALL_MEETS;
    if (outbox.resets[key] === rev) {
      delete outbox.resets[key];
    }
  });
}

/**
 * One-time adoption of rows written before the outbox existed.
 *
 * Old builds kept local-only rows when the server list was empty and never
 * uploaded them. The first reconcile on this build marks those rows as
 * pending PUTs (only when the server has nothing, matching what old builds
 * showed the user), so from then on "not pending" really means "the server
 * has it" and an empty server list can be trusted like any other.
 *
 * @returns how many rows were queued (0 on every call after the first).
 */
export async function adoptPreOutboxSessions(
  userId: string,
  serverIsEmpty: boolean,
  localSessions: SavedSession[],
): Promise<number> {
  const seededKey = getOutboxSeededKey(userId);
  if ((await AsyncStorage.getItem(seededKey)) === '1') return 0;
  let adopted = 0;
  if (serverIsEmpty && localSessions.length > 0) {
    await updateOutbox(userId, (outbox) => {
      for (const session of localSessions) {
        // Same check as `markSessionPut`: a body the reader would drop is not queued.
        const body = parseSessionBody(session);
        if (!body || outbox.sessions[body.id]) continue;
        const rev = takeRev(outbox);
        outbox.sessions[body.id] = { op: 'put', rev, meet: body.meet, session: body };
        adopted += 1;
      }
    });
  }
  await AsyncStorage.setItem(seededKey, '1');
  return adopted;
}

/** First `MAX_SAVED_SESSION_ATHLETE_NAMES` names; `undefined` stays `undefined`. */
export function capAthleteNames(names: string[] | undefined): string[] | undefined {
  if (!names) return undefined;
  if (names.length <= MAX_SAVED_SESSION_ATHLETE_NAMES) return names;
  devWarn(
    `Saved sessions: athlete_names capped at ${MAX_SAVED_SESSION_ATHLETE_NAMES} (had ${names.length})`,
  );
  return names.slice(0, MAX_SAVED_SESSION_ATHLETE_NAMES);
}

/** The PUT body for a session; one mapper so every caller sends the same shape. */
export function toSavedSessionBody(session: SavedSession): Parameters<typeof putSavedSession>[2] {
  return {
    meet: session.meet,
    session_number: session.sessionNumber,
    platform: session.platform,
    weight_class: session.weightClass,
    start_time: session.startTime,
    date: session.date,
    notes: session.notes,
    athlete_names: capAthleteNames(session.athleteNames),
  };
}

/**
 * Writes the server accepted, newest last, kept briefly in memory.
 *
 * A reconcile fetches the server's list and then merges it with the outbox.
 * A write delivered *while* that fetch was in flight is already cleared from
 * the outbox, yet the fetched list may predate it. The merge replays the
 * deliveries made since the fetch started on top of the server's list, so
 * such a save is not dropped (or a delete undone) by a stale read.
 */
export type Delivery =
  | { seq: number; kind: 'put'; id: string; session: SavedSession }
  | { seq: number; kind: 'delete'; id: string }
  | { seq: number; kind: 'reset'; meet: string | null };

type DeliveryInput =
  | { kind: 'put'; id: string; session: SavedSession }
  | { kind: 'delete'; id: string }
  | { kind: 'reset'; meet: string | null };

/** Cap on remembered deliveries per user; a reconcile only needs the last few. */
const MAX_DELIVERY_LOG = 200;
let deliverySeq = 0;
const deliveryLogs = new Map<string, Delivery[]>();

function recordDelivery(userId: string, delivery: DeliveryInput): void {
  const log = deliveryLogs.get(userId) ?? [];
  deliverySeq += 1;
  log.push({ ...delivery, seq: deliverySeq } as Delivery);
  if (log.length > MAX_DELIVERY_LOG) log.splice(0, log.length - MAX_DELIVERY_LOG);
  deliveryLogs.set(userId, log);
}

/** A marker to pass to `deliveriesSince` once the matching fetch returns. */
export function currentDeliverySeq(): number {
  return deliverySeq;
}

export function deliveriesSince(userId: string, seq: number): Delivery[] {
  return (deliveryLogs.get(userId) ?? []).filter((delivery) => delivery.seq > seq);
}

function applyDeliveries(serverSessions: SavedSession[], deliveries: Delivery[]): SavedSession[] {
  let rows = serverSessions;
  for (const delivery of deliveries) {
    if (delivery.kind === 'reset') {
      rows = delivery.meet === null ? [] : rows.filter((row) => row.meet !== delivery.meet);
    } else if (delivery.kind === 'delete') {
      rows = rows.filter((row) => row.id !== delivery.id);
    } else {
      const index = rows.findIndex((row) => row.id === delivery.id);
      rows =
        index >= 0
          ? rows.map((row, i) => (i === index ? delivery.session : row))
          : [...rows, delivery.session];
    }
  }
  return rows;
}

/** Revs of the pending resets that apply to `meet`. */
function resetRevsFor(meet: string, outbox: SavedSessionsOutbox): number[] {
  const revs: number[] = [];
  const all = outbox.resets[RESET_ALL_MEETS];
  if (all !== undefined) revs.push(all);
  const own = outbox.resets[meet];
  if (own !== undefined) revs.push(own);
  return revs;
}

/**
 * Whether a pending reset deletes a row in `meet` whose own pending write
 * (if any) has `rev`. A reset covers only what was written before it.
 */
function isCoveredByReset(meet: string, rev: number | undefined, outbox: SavedSessionsOutbox): boolean {
  return resetRevsFor(meet, outbox).some((resetRev) => rev === undefined || rev < resetRev);
}

/**
 * Reconcile the server's list with the writes this device still owes it.
 *
 * Server rows are the base. A row pending DELETE, or covered by an earlier
 * pending reset, is dropped. A pending PUT replaces its server twin or is
 * appended, using the body stored in the outbox. Everything else is the
 * server's word, including an empty list: a session removed on another
 * device disappears here too.
 */
export function mergeServerSessions(
  serverSessions: SavedSession[],
  outbox: SavedSessionsOutbox,
  deliveredDuringFetch: Delivery[] = [],
): SavedSession[] {
  const base = applyDeliveries(serverSessions, deliveredDuringFetch);
  const merged: SavedSession[] = [];
  const seen = new Set<string>();
  for (const session of base) {
    const entry = outbox.sessions[session.id];
    if (entry?.op === 'delete') continue;
    if (isCoveredByReset(session.meet, entry?.rev, outbox)) continue;
    seen.add(session.id);
    merged.push(entry?.op === 'put' && entry.session ? entry.session : session);
  }
  const pendingPuts = Object.entries(outbox.sessions)
    .filter(([id, entry]) => entry.op === 'put' && entry.session && !seen.has(id))
    .sort(([, a], [, b]) => a.rev - b.rev);
  for (const [, entry] of pendingPuts) {
    if (isCoveredByReset(entry.meet, entry.rev, outbox)) continue;
    merged.push(entry.session as SavedSession);
  }
  return merged;
}

export type SyncErrorKind = 'auth' | 'rejected' | 'retry';

/**
 * How a failed write should be treated.
 *
 * - `auth`: 401. The Clerk session no longer authorises writes.
 * - `rejected`: any other 4xx except 429. The server refused the payload, so
 *   sending it again can never succeed; the entry is dropped.
 * - `retry`: timeout, network, 5xx, 429, and a server fault Convex reports
 *   without a status.
 */
export function classifySyncError(error: unknown): SyncErrorKind {
  if (!(error instanceof MeetCalApiError)) return 'retry';
  if (error.status === 401) return 'auth';
  if (error.status === 429) return 'retry';
  return error.status >= 400 && error.status < 500 ? 'rejected' : 'retry';
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** base64url → UTF-8 text, or null when the input is not valid base64url. */
function decodeBase64Url(input: string): string | null {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of base64) {
    const index = BASE64_ALPHABET.indexOf(char);
    if (index < 0) return null;
    value = (value << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >> bits) & 0xff);
    }
  }
  try {
    return decodeURIComponent(bytes.map((b) => `%${b.toString(16).padStart(2, '0')}`).join(''));
  } catch {
    return null;
  }
}

/**
 * Whether a Clerk session JWT was issued for `userId` (its `sub` claim).
 *
 * The outbox is per user, but Clerk's `getToken()` returns a token for
 * whoever is signed in *now*. A flush that outlives a sign-out or account
 * switch must not send one user's queued writes under another user's token,
 * which would upsert them onto (or reset) the wrong account. The signature is
 * the server's to verify; this only refuses a token that is plainly someone
 * else's, and treats anything unreadable as not matching.
 */
export function tokenBelongsTo(token: string, userId: string): boolean {
  const payload = token.split('.')[1];
  if (!payload) return false;
  const json = decodeBase64Url(payload);
  if (!json) return false;
  try {
    const claims: unknown = JSON.parse(json);
    return isRecord(claims) && claims.sub === userId;
  } catch {
    return false;
  }
}

/**
 * The claims of a Clerk token that decide whether the API accepts it, for a
 * dev log after a 401: the issuer (which Clerk instance), `azp` (the web
 * origin, absent on native sessions), `aud`, and seconds until expiry. Never
 * the token or its subject. Null when the payload is unreadable.
 */
export function describeTokenClaims(
  token: string,
  nowMs: number = Date.now(),
): { iss: unknown; azp: unknown; aud: unknown; expiresInSeconds: number | null } | null {
  const payload = token.split('.')[1];
  if (!payload) return null;
  const json = decodeBase64Url(payload);
  if (!json) return null;
  try {
    const claims: unknown = JSON.parse(json);
    if (!isRecord(claims)) return null;
    return {
      iss: claims.iss,
      azp: claims.azp,
      aud: claims.aud,
      expiresInSeconds:
        typeof claims.exp === 'number' ? Math.round(claims.exp - nowMs / 1000) : null,
    };
  } catch {
    return null;
  }
}

/** A failure that says the network or server is unreachable right now. */
function isConnectivityFailure(error: unknown): boolean {
  return error instanceof MeetCalApiTimeoutError || !(error instanceof MeetCalApiError);
}

/** `DELETE` one session, treating 404 as done: already gone is the outcome wanted. */
export async function deletePendingSession(
  token: string,
  sessionId: string,
  revision?: SavedSessionWriteRevision,
): Promise<void> {
  try {
    await deleteSavedSession(token, sessionId, revision);
  } catch (error) {
    if (!(error instanceof MeetCalApiError && error.status === 404)) throw error;
  }
}

type Candidate =
  | { kind: 'reset'; key: string; rev: number }
  | { kind: 'session'; key: string; rev: number; entry: PendingSessionEntry };

function candidatesInRevOrder(outbox: SavedSessionsOutbox): Candidate[] {
  const candidates: Candidate[] = [
    ...Object.entries(outbox.resets).map(
      ([key, rev]): Candidate => ({ kind: 'reset', key, rev }),
    ),
    ...Object.entries(outbox.sessions).map(
      ([key, entry]): Candidate => ({ kind: 'session', key, rev: entry.rev, entry }),
    ),
  ];
  return candidates.sort((a, b) => a.rev - b.rev);
}

async function runPass(
  userId: string,
  getToken: () => Promise<string | null>,
  result: FlushResult,
): Promise<'done' | 'stopped'> {
  const attempted = new Set<string>();
  // Set when a reset of every meet could not be sent: nothing else goes this pass.
  let holdAll = false;
  let assignedDevice = false;

  for (;;) {
    const outbox = await readOutbox(userId);
    const next = candidatesInRevOrder(outbox).find((candidate) => {
      if (attempted.has(`${candidate.kind}:${candidate.key}:${candidate.rev}`)) return false;
      if (holdAll) return false;
      // A session waits while an older reset of its meet is still stored, so
      // the reset cannot land after it and delete it. Checked against the
      // stored outbox, not this pass's failures: a reset that was delivered but
      // whose clear was lost is sent again next flush, after any save sent now.
      // A newer reset does not hold it: the session goes first, as revs order.
      if (candidate.kind === 'session') {
        return !resetRevsFor(candidate.entry.meet, outbox).some((rev) => rev < candidate.rev);
      }
      return true;
    });
    if (!next) return 'done';
    if (!outbox.device) {
      // Written by a build before write ordering: store an install id first,
      // so every write of this outbox goes out under the same one. Storage
      // that will not keep it holds the queue until it does.
      if (assignedDevice) return 'stopped';
      assignedDevice = true;
      await updateOutbox(userId, () => undefined);
      continue;
    }
    attempted.add(`${next.kind}:${next.key}:${next.rev}`);
    // A rev the server cannot take (only a damaged store holds one) goes
    // unordered, as before ordering, rather than failing the write forever.
    const revision: SavedSessionWriteRevision | undefined =
      Number.isSafeInteger(next.rev) && next.rev >= 1 ? { device: outbox.device, rev: next.rev } : undefined;

    let token: string | null = null;
    try {
      token = await getToken();
    } catch (error) {
      console.error('Saved sessions outbox: Clerk getToken() failed; writes stay queued', error);
    }
    if (!token) return 'stopped';
    // Checked before every send, not once per flush: the signed-in user can
    // change between two sends of the same flush.
    if (!tokenBelongsTo(token, userId)) {
      devWarn('Saved sessions outbox: token is not for the outbox owner; writes stay queued');
      return 'stopped';
    }

    const meet = next.kind === 'reset' ? (next.key === RESET_ALL_MEETS ? null : next.key) : null;
    const clear = () =>
      next.kind === 'reset'
        ? clearResetPending(userId, meet, next.rev)
        : clearSessionPending(userId, next.key, next.rev);

    try {
      if (next.kind === 'reset') {
        await deleteSavedSessions(token, meet ?? undefined, revision);
        recordDelivery(userId, { kind: 'reset', meet });
      } else if (next.entry.op === 'delete') {
        await deletePendingSession(token, next.key, revision);
        recordDelivery(userId, { kind: 'delete', id: next.key });
      } else {
        const body = next.entry.session as SavedSession;
        await putSavedSession(token, next.key, toSavedSessionBody(body), revision);
        recordDelivery(userId, { kind: 'put', id: next.key, session: body });
      }
      await clear();
      result.delivered += 1;
    } catch (error) {
      const kind = classifySyncError(error);
      if (kind === 'auth') {
        // Otherwise silent: the load stops before its own GET, so the
        // "sign-in expired" banner would show with nothing in the console.
        devWarn(
          `Saved sessions outbox: API rejected the sign-in token (401) on ${next.kind} ${next.key}; writes stay queued`,
          describeTokenClaims(token),
        );
        result.authExpired = true;
        return 'stopped';
      }
      if (kind === 'rejected') {
        console.error(`Saved sessions outbox: server rejected ${next.kind} ${next.key}; dropping`, error);
        if (next.kind === 'session') result.rejected.set(next.key, next.rev);
        await clear();
        continue;
      }
      devWarn(`Saved sessions outbox: ${next.kind} ${next.key} still pending`, error);
      if (isConnectivityFailure(error)) return 'stopped';
      if (next.kind === 'reset' && meet === null) holdAll = true;
    }
  }
}

interface FlushState {
  promise: Promise<FlushResult>;
  rerun: boolean;
}

const inFlight = new Map<string, FlushState>();

/**
 * Send every pending write for `userId`, in rev order.
 *
 * Single-flight per user: a call while a flush is running asks it for one
 * more pass (so the caller's new entry is sent) and shares its result.
 * Stops early on a 401, a missing token, or a connectivity failure; those
 * entries stay queued for the next flush.
 */
export function flushOutbox(
  userId: string,
  getToken: () => Promise<string | null>,
): Promise<FlushResult> {
  const running = inFlight.get(userId);
  if (running) {
    running.rerun = true;
    return running.promise;
  }

  const state = { rerun: false } as FlushState;
  state.promise = (async () => {
    const result: FlushResult = {
      authExpired: false,
      delivered: 0,
      remaining: 0,
      rejected: new Map(),
    };
    try {
      let passes = 0;
      let outcome: 'done' | 'stopped';
      do {
        state.rerun = false;
        passes += 1;
        outcome = await runPass(userId, getToken, result);
        result.remaining = countPendingWrites(await readOutbox(userId));
        // No await between this check and releasing the slot in `finally`,
        // so a caller that sets `rerun` after it starts a new flush instead
        // of joining one that will not send its entry.
      } while (outcome === 'done' && state.rerun && passes < MAX_FLUSH_PASSES);
      return result;
    } catch (error) {
      // Storage unavailable: nothing was cleared that was not sent, and the
      // queue is intact on disk. Report it as still pending.
      console.error('Saved sessions outbox: storage unavailable; writes stay queued', error);
      result.remaining = Math.max(result.remaining, 1);
      return result;
    } finally {
      inFlight.delete(userId);
    }
  })();
  inFlight.set(userId, state);
  return state.promise;
}
