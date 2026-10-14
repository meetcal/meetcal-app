/**
 * Runs a command that starts Metro or drives the simulator (`expo start`,
 * `expo run:ios`, `expo run:android`, a Maestro session) while holding the
 * machine-wide simulator lock, so agents in several worktrees, and in the
 * Atlas repository, take turns on the one simulator and port 8081 instead of
 * loading their builds over each other:
 *
 *   bun scripts/metro-lock.ts <command> [args...]
 *
 * - Another worktree's session: wait, printing who holds it, then start.
 * - This worktree's own session: exit at once; stop that Metro first.
 * - Port 8081 taken by a process outside the lock: exit, naming it.
 * - The lease (30 minutes, `METRO_SIMULATOR_LEASE_MIN` to change it) ends:
 *   stop the command, so a forgotten Metro cannot hold the simulator forever.
 *
 * The lock's location and the other settings are in `scripts/metro/session.ts`.
 */
import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname } from 'node:path';

import { runLocked } from './check/run-locked';
import { leaseMinutes, metroLockPath, metroPort, portProblem } from './metro/session';

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('Usage: bun scripts/metro-lock.ts <command> [args...]');
  process.exit(2);
}
const lockPath = metroLockPath(process.env, homedir());
mkdirSync(dirname(lockPath), { recursive: true });
const port = metroPort(process.env);
void runLocked(command, {
  lockPath,
  label: 'Metro',
  refuseSameWorktree: true,
  leaseMs: leaseMinutes(process.env) * 60_000,
  leaseHint: 'Set METRO_SIMULATOR_LEASE_MIN to hold it longer.',
  beforeRun: () => portProblem(port),
});
