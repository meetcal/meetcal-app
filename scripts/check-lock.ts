/**
 * Runs a command while holding the release-gate lock (`scripts/check/lock.ts`),
 * so heavy runs in several worktrees queue instead of running at once:
 *
 *   bun scripts/check-lock.ts <command> [args...]
 *
 * `mise run check` and the full Jest tasks go through it. `MEETCAL_CHECK_LOCK_PATH`
 * overrides the lock location (the lock's own tests use it).
 */
import { defaultLockPath } from './check/lock';
import { runLocked } from './check/run-locked';

const command = process.argv.slice(2);
if (command.length === 0) {
  console.error('Usage: bun scripts/check-lock.ts <command> [args...]');
  process.exit(2);
}
void runLocked(command, { lockPath: defaultLockPath(), label: 'mise run check' });
