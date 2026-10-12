/**
 * Runs a command while holding the release-gate lock (`scripts/check/lock.ts`),
 * so heavy runs in several worktrees queue instead of running at once:
 *
 *   bun scripts/check-lock.ts <command> [args...]
 *
 * `mise run check` and the full Jest tasks go through it. `MEETCAL_CHECK_LOCK_PATH`
 * overrides the lock location (the lock's own tests use it).
 */
import { spawn, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';

import {
  acquireLock,
  defaultLockPath,
  processStartTime,
  recordChildPid,
  releaseLock,
  sweepLeftovers,
  type LockOwner,
} from './check/lock';

const SIGNAL_EXIT_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

async function runLocked(command: string[]): Promise<void> {
  const lockPath = defaultLockPath();
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
  await acquireLock(lockPath, owner);
  process.on('exit', () => releaseLock(lockPath, owner));

  const [program, ...args] = command;
  const started = spawn(program, args, { stdio: 'inherit' });
  child = started;
  if (started.pid !== undefined) recordChildPid(lockPath, owner, started.pid);
  const [code, signal] = await new Promise<[number | null, NodeJS.Signals | null]>((resolve) => {
    started.on('error', (error) => {
      console.error(`check-lock: could not start ${program}: ${error.message}`);
      resolve([127, null]);
    });
    started.on('exit', (exitCode, exitSignal) => resolve([exitCode, exitSignal]));
  });
  process.exit((signal ? SIGNAL_EXIT_CODES[signal] : undefined) ?? code ?? 1);
}

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('Usage: bun scripts/check-lock.ts <command> [args...]');
  process.exit(2);
}
void runLocked(command);
