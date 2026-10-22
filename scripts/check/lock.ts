/**
 * The release-gate lock: `mise run check` in several worktrees of this
 * repository queues instead of running at once. Concurrent gates (several
 * Jest pools, `tsrs` runs and Cargo builds at a time) have exhausted memory on
 * development machines. Ported from the Atlas repository's `check-lock.ts`.
 *
 * The lock is a directory in the git common directory, which every worktree of
 * a repository shares even when a sandbox points TMPDIR somewhere private. It
 * is created by renaming a fully written temporary directory into place, so a
 * lock that exists always names its owner. A lock whose owner process has
 * exited is stale and the next waiter reclaims it.
 *
 * The simulator lock (`scripts/metro-lock.ts`) uses the same mechanics at a
 * machine-wide path that the Atlas repository shares, so keep the owner file's
 * format in step with Atlas's `scripts/check-lock.ts`.
 */
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';

export type LockOwner = {
  pid: number;
  worktree: string;
  startedAtMs: number;
  token: string;
  /** When `pid` started, so a reused process ID is not mistaken for the owner. */
  pidStartedAt?: string;
  /** The gate's own process, so killing only the wrapper does not free the lock early. */
  childPid?: number;
  childStartedAt?: string;
  /** When the holder will stop its command and free the lock (the simulator lock's lease). */
  leaseEndsAtMs?: number;
};

type AcquireAttempt = { acquired: true } | { acquired: false; owner: LockOwner | undefined };

export const LOCK_NAME = 'meetcal-check.lock';
const OWNER_FILE = 'owner.json';
const POLL_INTERVAL_MS = 2_000;
const REPORT_INTERVAL_MS = 30_000;
/** A reclaim takes milliseconds; a guard older than this was left by a reclaimer that died. */
const ABANDONED_GUARD_MS = 10_000;
/** Polls that must find the same unreadable lock before it is treated as corrupt. */
const CORRUPT_LOCK_POLLS = 3;
/** Staging, stale, and released copies older than this were left by a killed process. */
const LEFTOVER_MAX_AGE_MS = 60 * 60_000;

// Duck-typed, not `instanceof Error`: under Jest, Node's fs errors come from
// another realm and fail that check.
const isErrorCode = (error: unknown, codes: string[]) =>
  typeof error === 'object' && error !== null && 'code' in error && codes.includes(String(error.code));

const isLockOwner = (value: unknown): value is LockOwner => {
  if (typeof value !== 'object' || value === null) return false;
  const owner = value as Record<string, unknown>;
  return (
    Number.isSafeInteger(owner.pid) &&
    (owner.pid as number) > 0 &&
    typeof owner.worktree === 'string' &&
    Number.isFinite(owner.startedAtMs) &&
    typeof owner.token === 'string' &&
    owner.token.length > 0 &&
    (owner.childPid === undefined || (Number.isSafeInteger(owner.childPid) && (owner.childPid as number) > 0)) &&
    (owner.pidStartedAt === undefined || typeof owner.pidStartedAt === 'string') &&
    (owner.childStartedAt === undefined || typeof owner.childStartedAt === 'string') &&
    (owner.leaseEndsAtMs === undefined || Number.isFinite(owner.leaseEndsAtMs))
  );
};

/** The owner recorded in a lock directory, or `undefined` when it is missing or unreadable. */
export const readLockOwner = (lockPath: string): LockOwner | undefined => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(join(lockPath, OWNER_FILE), 'utf8'));
    return isLockOwner(parsed) ? parsed : undefined;
  } catch (error) {
    if (isErrorCode(error, ['ENOENT', 'ENOTDIR']) || (error as { name?: unknown })?.name === 'SyntaxError') return undefined;
    throw error;
  }
};

/** The process's start time as `ps` reports it, or undefined when it has exited. */
export const processStartTime = (pid: number): string | undefined => {
  const result = spawnSync('ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8' });
  const startedAt = (result.stdout ?? '').trim();
  return result.status === 0 && startedAt !== '' ? startedAt : undefined;
};

/**
 * Signal 0 checks existence; EPERM means the process exists but belongs to another user.
 * With a recorded start time, a different process that reused the ID does not count.
 */
export const isProcessAlive = (pid: number, startedAt?: string): boolean => {
  try {
    process.kill(pid, 0);
  } catch (error) {
    if (!isErrorCode(error, ['EPERM'])) return false;
  }
  if (startedAt === undefined) return true;
  const current = processStartTime(pid);
  return current === undefined || current === startedAt;
};

/** True while the wrapper or the gate it started is still running. */
export const isOwnerAlive = (
  owner: LockOwner,
  isAlive: (pid: number, startedAt?: string) => boolean = isProcessAlive,
) =>
  isAlive(owner.pid, owner.pidStartedAt) ||
  (owner.childPid !== undefined && isAlive(owner.childPid, owner.childStartedAt));

/**
 * Atomically creates the lock with its owner already written. `rename` onto an
 * existing non-empty directory fails, so only one caller can win.
 */
export const tryAcquireLock = (lockPath: string, owner: LockOwner): AcquireAttempt => {
  const staging = mkdtempSync(`${lockPath}.staging-`);
  writeFileSync(join(staging, OWNER_FILE), JSON.stringify(owner));
  try {
    renameSync(staging, lockPath);
    return { acquired: true };
  } catch (error) {
    rmSync(staging, { recursive: true, force: true });
    if (!isErrorCode(error, ['EEXIST', 'ENOTEMPTY'])) throw error;
    return { acquired: false, owner: readLockOwner(lockPath) };
  }
};

const removeAbandonedGuard = (guardPath: string, nowMs: number) => {
  try {
    if (nowMs - statSync(guardPath).mtimeMs > ABANDONED_GUARD_MS) rmSync(guardPath, { recursive: true, force: true });
  } catch (error) {
    if (!isErrorCode(error, ['ENOENT'])) throw error;
  }
};

/**
 * Removes a lock whose owner has exited. Reclaimers serialize on a guard directory, and
 * under it re-read the lock: only the exact dead owner that was judged may be removed. A
 * lock can only disappear through its owner's release or a reclaim, so the lock read
 * under the guard is still the lock that gets moved.
 */
export const reclaimStaleLock = (lockPath: string, stale: LockOwner | undefined, nowMs = Date.now()): void => {
  const guardPath = `${lockPath}.reclaim`;
  try {
    mkdirSync(guardPath);
  } catch (error) {
    if (!isErrorCode(error, ['EEXIST'])) throw error;
    // Another waiter is reclaiming; retry after it, or after its guard is abandoned.
    removeAbandonedGuard(guardPath, nowMs);
    return;
  }
  try {
    if (!existsSync(lockPath)) return;
    if (readLockOwner(lockPath)?.token !== stale?.token) return;
    const aside = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
    renameSync(lockPath, aside);
    rmSync(aside, { recursive: true, force: true });
  } finally {
    rmSync(guardPath, { recursive: true, force: true });
  }
};

/**
 * Releases the lock only if this owner still holds it. The lock is renamed away before it
 * is deleted, so a waiter never sees an empty lock directory it could acquire into.
 */
export const releaseLock = (lockPath: string, owner: LockOwner): void => {
  if (readLockOwner(lockPath)?.token !== owner.token) return;
  const released = `${lockPath}.released-${randomUUID()}`;
  try {
    renameSync(lockPath, released);
  } catch (error) {
    if (isErrorCode(error, ['ENOENT'])) return;
    throw error;
  }
  rmSync(released, { recursive: true, force: true });
};

/** Records the gate's process in the held lock, replacing the owner file atomically. */
export const recordChildPid = (
  lockPath: string,
  owner: LockOwner,
  childPid: number,
  childStartedAt = processStartTime(childPid),
): LockOwner => {
  const updated = { ...owner, childPid, childStartedAt };
  const staging = join(lockPath, `${OWNER_FILE}.${randomUUID()}`);
  writeFileSync(staging, JSON.stringify(updated));
  renameSync(staging, join(lockPath, OWNER_FILE));
  return updated;
};

/** Deletes staging, stale, and released copies that a killed process left beside the lock. */
export const sweepLeftovers = (lockPath: string, nowMs = Date.now()): void => {
  const prefix = `${basename(lockPath)}.`;
  const directory = dirname(lockPath);
  for (const name of readdirSync(directory)) {
    const isLeftover = name.startsWith(prefix) && /^(staging|stale|released)-/.test(name.slice(prefix.length));
    if (!isLeftover) continue;
    const path = join(directory, name);
    try {
      if (nowMs - statSync(path).mtimeMs > LEFTOVER_MAX_AGE_MS) rmSync(path, { recursive: true, force: true });
    } catch (error) {
      if (!isErrorCode(error, ['ENOENT'])) throw error;
    }
  }
};

export const describeOwner = (owner: LockOwner | undefined, nowMs: number) => {
  if (!owner) return 'another checkout';
  const minutes = Math.floor((nowMs - owner.startedAtMs) / 60_000);
  const lease =
    owner.leaseEndsAtMs === undefined
      ? ''
      : `, lease ends in ${Math.max(0, Math.ceil((owner.leaseEndsAtMs - nowMs) / 60_000))}m`;
  return `${owner.worktree} (pid ${owner.pid}, running ${minutes}m${lease})`;
};

/** A live holder runs in the caller's own worktree, which would otherwise wait on itself. */
export class LockHeldByWorktreeError extends Error {
  constructor(readonly owner: LockOwner) {
    super(`already held by this worktree (pid ${owner.pid})`);
    this.name = 'LockHeldByWorktreeError';
  }
}

type WaitOptions = {
  /** What the holder is running, for the waiting message. */
  label?: string;
  /** Throw `LockHeldByWorktreeError` instead of waiting when a live holder runs in this worktree. */
  refuseWorktree?: string;
  pollIntervalMs?: number;
  reportIntervalMs?: number;
  report?: (message: string) => void;
  sleep?: (ms: number) => Promise<void>;
  isAlive?: (pid: number, startedAt?: string) => boolean;
};

const sleepFor = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Waits until this owner holds the lock, reclaiming locks left by exited processes. */
export const acquireLock = async (
  lockPath: string,
  owner: LockOwner,
  {
    label = 'mise run check',
    refuseWorktree,
    pollIntervalMs = POLL_INTERVAL_MS,
    reportIntervalMs = REPORT_INTERVAL_MS,
    report = (message) => console.error(message),
    sleep = sleepFor,
    isAlive = isProcessAlive,
  }: WaitOptions = {},
): Promise<void> => {
  let lastReportMs = Number.NEGATIVE_INFINITY;
  let unreadablePolls = 0;
  for (;;) {
    const attempt = tryAcquireLock(lockPath, owner);
    if (attempt.acquired) return;
    // An unreadable owner is usually a lock that vanished between the attempt and the read;
    // only one that stays unreadable is corrupt.
    unreadablePolls = attempt.owner === undefined ? unreadablePolls + 1 : 0;
    const corrupt = unreadablePolls >= CORRUPT_LOCK_POLLS;
    if (corrupt || (attempt.owner !== undefined && !isOwnerAlive(attempt.owner, isAlive))) {
      reclaimStaleLock(lockPath, attempt.owner);
      unreadablePolls = 0;
      continue;
    }
    if (refuseWorktree !== undefined && attempt.owner?.worktree === refuseWorktree) {
      throw new LockHeldByWorktreeError(attempt.owner);
    }
    const nowMs = Date.now();
    if (nowMs - lastReportMs >= reportIntervalMs) {
      report(`Waiting for ${label} in ${describeOwner(attempt.owner, nowMs)}`);
      lastReportMs = nowMs;
    }
    await sleep(pollIntervalMs);
  }
};

/** Where the lock lives: `MEETCAL_CHECK_LOCK_PATH`, or the git directory every worktree shares. */
export const defaultLockPath = (): string => {
  if (process.env.MEETCAL_CHECK_LOCK_PATH) return process.env.MEETCAL_CHECK_LOCK_PATH;
  const result = spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-common-dir'], { encoding: 'utf8' });
  const path = (result.stdout ?? '').trim();
  if (result.status !== 0 || path === '') {
    throw new Error('check-lock: run inside a git checkout of this repository');
  }
  return join(path, LOCK_NAME);
};
