/**
 * Runs a command while holding a lock from `lock.ts`: the release gate
 * (`scripts/check-lock.ts`).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  LockHeldByWorktreeError,
  acquireLock,
  processStartTime,
  recordChildPid,
  releaseLock,
  sweepLeftovers,
  type LockOwner,
} from './lock';
import { processTree, signalProcesses } from './process-tree';

const SIGNAL_EXIT_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };
/** `timeout(1)`'s status for a command it stopped. */
export const LEASE_EXPIRED_EXIT_CODE = 124;
const LEASE_WARNING_MS = 2 * 60_000;
/** How long a command stopped at the end of its lease gets before it is killed. */
const LEASE_KILL_GRACE_MS = 10_000;

export type RunLockedOptions = {
  lockPath: string;
  /** What the command is, for messages: `mise run check`, `Metro`. */
  label: string;
  /** Exit at once instead of waiting when this worktree already holds the lock. */
  refuseSameWorktree?: boolean;
  /** Stop the command and free the lock after this long. */
  leaseMs?: number;
  /** How to hold the lock longer, appended to the lease messages. */
  leaseHint?: string;
  /** Runs once the lock is held; a returned message aborts the run with it. */
  beforeRun?: () => Promise<string | undefined>;
};

const minutes = (ms: number) => `${Math.round((ms / 60_000) * 10) / 10}m`;

/** Waits for the lock, runs `command` under it, and exits with the command's status. */
export async function runLocked(
  command: string[],
  { lockPath, label, refuseSameWorktree = false, leaseMs, leaseHint = '', beforeRun }: RunLockedOptions,
): Promise<never> {
  const owner: LockOwner = {
    pid: process.pid,
    pidStartedAt: processStartTime(process.pid),
    worktree: process.cwd(),
    startedAtMs: Date.now(),
    token: randomUUID(),
  };

  let child: ChildProcess | undefined;
  for (const signal of Object.keys(SIGNAL_EXIT_CODES) as NodeJS.Signals[]) {
    process.on(signal, () => {
      // The terminal already sends Ctrl-C to the child's process group; forward
      // the rest and let the exit handler below release the lock.
      if (child) child.kill(signal);
      else process.exit(SIGNAL_EXIT_CODES[signal]);
    });
  }

  sweepLeftovers(lockPath);
  try {
    await acquireLock(lockPath, owner, { label, refuseWorktree: refuseSameWorktree ? owner.worktree : undefined });
  } catch (error) {
    if (!(error instanceof LockHeldByWorktreeError)) throw error;
    console.error(`${label} is already running in this worktree (pid ${error.owner.pid}); stop it first.`);
    process.exit(1);
  }
  process.on('exit', () => releaseLock(lockPath, owner));

  const problem = await beforeRun?.();
  if (problem !== undefined) {
    console.error(problem);
    process.exit(1);
  }

  if (leaseMs !== undefined) owner.leaseEndsAtMs = Date.now() + leaseMs;
  const [program, ...args] = command;
  const started = spawn(program, args, { stdio: 'inherit' });
  child = started;
  if (started.pid !== undefined) recordChildPid(lockPath, owner, started.pid);

  let leaseExpired = false;
  if (leaseMs !== undefined && started.pid !== undefined) {
    const pid = started.pid;
    const hint = leaseHint ? ` ${leaseHint}` : '';
    if (leaseMs > LEASE_WARNING_MS) {
      setTimeout(
        () => console.error(`${label}: the lock's ${minutes(leaseMs)} lease ends in 2 minutes.${hint}`),
        leaseMs - LEASE_WARNING_MS,
      ).unref();
    }
    setTimeout(() => {
      leaseExpired = true;
      console.error(`${label}: the lock's ${minutes(leaseMs)} lease ended; stopping it for the next waiter.${hint}`);
      const tree = processTree(pid);
      signalProcesses(tree, 'SIGTERM');
      setTimeout(() => signalProcesses(tree, 'SIGKILL'), LEASE_KILL_GRACE_MS).unref();
    }, leaseMs).unref();
  }

  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    started.on('error', (error) => {
      console.error(`${label}: could not start ${program}: ${error.message}`);
      resolve([127, null]);
    });
    started.on('exit', (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  if (leaseExpired) process.exit(LEASE_EXPIRED_EXIT_CODE);
  process.exit((signal ? SIGNAL_EXIT_CODES[signal] : undefined) ?? code ?? 1);
}
