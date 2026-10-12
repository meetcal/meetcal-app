import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  LOCK_NAME,
  acquireLock,
  isOwnerAlive,
  isProcessAlive,
  processStartTime,
  readLockOwner,
  reclaimStaleLock,
  recordChildPid,
  releaseLock,
  sweepLeftovers,
  tryAcquireLock,
  type LockOwner,
} from './lock';

let directory: string;
let lockPath: string;

const owner = (pid: number, token: string): LockOwner => ({
  pid,
  worktree: `/work/${token}`,
  startedAtMs: 0,
  token,
});

beforeEach(() => {
  directory = mkdtempSync(join(tmpdir(), 'check-lock-'));
  lockPath = join(directory, LOCK_NAME);
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** Only the lock itself may remain; staging and stale copies are always cleaned up. */
const leftovers = () => readdirSync(directory).filter((name) => name !== LOCK_NAME);

describe('tryAcquireLock', () => {
  it('creates the lock with its owner already recorded', () => {
    expect(tryAcquireLock(lockPath, owner(1, 'a'))).toEqual({ acquired: true });
    expect(readLockOwner(lockPath)).toEqual(owner(1, 'a'));
    expect(leftovers()).toEqual([]);
  });

  it('reports the current owner when the lock is held', () => {
    tryAcquireLock(lockPath, owner(1, 'a'));
    expect(tryAcquireLock(lockPath, owner(2, 'b'))).toEqual({ acquired: false, owner: owner(1, 'a') });
    expect(readLockOwner(lockPath)?.token).toBe('a');
    expect(leftovers()).toEqual([]);
  });
});

describe('readLockOwner', () => {
  it('treats a missing or malformed owner file as unknown', () => {
    expect(readLockOwner(lockPath)).toBeUndefined();
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), '{not json');
    expect(readLockOwner(lockPath)).toBeUndefined();
    writeFileSync(join(lockPath, 'owner.json'), JSON.stringify({ pid: -1, token: 'x' }));
    expect(readLockOwner(lockPath)).toBeUndefined();
  });
});

describe('releaseLock', () => {
  it('removes only a lock this owner holds', () => {
    tryAcquireLock(lockPath, owner(1, 'a'));
    releaseLock(lockPath, owner(2, 'b'));
    expect(existsSync(lockPath)).toBe(true);
    releaseLock(lockPath, owner(1, 'a'));
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('reclaimStaleLock', () => {
  it('removes the stale lock it judged', () => {
    tryAcquireLock(lockPath, owner(1, 'stale'));
    reclaimStaleLock(lockPath, owner(1, 'stale'));
    expect(existsSync(lockPath)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('leaves a lock that was re-acquired after the stale check', () => {
    tryAcquireLock(lockPath, owner(2, 'fresh'));
    reclaimStaleLock(lockPath, owner(1, 'stale'));
    expect(readLockOwner(lockPath)?.token).toBe('fresh');
    expect(leftovers()).toEqual([]);
  });

  it('leaves the lock to a reclaim already in progress', () => {
    tryAcquireLock(lockPath, owner(1, 'stale'));
    mkdirSync(`${lockPath}.reclaim`);
    reclaimStaleLock(lockPath, owner(1, 'stale'));
    expect(readLockOwner(lockPath)?.token).toBe('stale');
  });

  it('clears a reclaim guard left by a reclaimer that died', () => {
    tryAcquireLock(lockPath, owner(1, 'stale'));
    mkdirSync(`${lockPath}.reclaim`);
    reclaimStaleLock(lockPath, owner(1, 'stale'), Date.now() + 60_000);
    expect(existsSync(`${lockPath}.reclaim`)).toBe(false);
    reclaimStaleLock(lockPath, owner(1, 'stale'));
    expect(existsSync(lockPath)).toBe(false);
    expect(leftovers()).toEqual([]);
  });

  it('removes a lock whose owner file is unreadable', () => {
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), '{not json');
    reclaimStaleLock(lockPath, undefined);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('does nothing when another waiter already reclaimed the lock', () => {
    reclaimStaleLock(lockPath, owner(1, 'stale'));
    expect(existsSync(lockPath)).toBe(false);
  });
});

describe('recordChildPid', () => {
  it('keeps the lock live while the gate outlives its wrapper', () => {
    tryAcquireLock(lockPath, owner(1, 'a'));
    recordChildPid(lockPath, owner(1, 'a'), 2, 'started');
    const recorded = readLockOwner(lockPath)!;
    expect(recorded.childPid).toBe(2);
    expect(isOwnerAlive(recorded, (pid) => pid === 2)).toBe(true);
    expect(isOwnerAlive(recorded, () => false)).toBe(false);
    expect(leftovers()).toEqual([]);
  });
});

describe('sweepLeftovers', () => {
  it('deletes only old copies left beside the lock', () => {
    const old = join(directory, `${LOCK_NAME}.stale-1-x`);
    const fresh = join(directory, `${LOCK_NAME}.staging-y`);
    const unrelated = join(directory, 'other.stale-z');
    for (const path of [old, fresh, unrelated]) mkdirSync(path);
    const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60_000);
    utimesSync(old, twoHoursAgo, twoHoursAgo);
    utimesSync(unrelated, twoHoursAgo, twoHoursAgo);
    sweepLeftovers(lockPath);
    expect(readdirSync(directory).sort()).toEqual([`${LOCK_NAME}.staging-y`, 'other.stale-z']);
  });
});

describe('acquireLock', () => {
  it('waits out a briefly unreadable lock, then reclaims one that stays unreadable', async () => {
    mkdirSync(lockPath);
    writeFileSync(join(lockPath, 'owner.json'), '{not json');
    let sleeps = 0;
    await acquireLock(lockPath, owner(2, 'next'), {
      isAlive: () => true,
      report: () => {},
      sleep: async () => {
        sleeps += 1;
      },
    });
    expect(sleeps).toBe(2);
    expect(readLockOwner(lockPath)?.token).toBe('next');
  });

  it('reclaims a lock whose owner has exited', async () => {
    tryAcquireLock(lockPath, owner(1, 'dead'));
    await acquireLock(lockPath, owner(2, 'next'), {
      isAlive: () => false,
      sleep: () => Promise.reject(new Error('should not wait')),
    });
    expect(readLockOwner(lockPath)?.token).toBe('next');
  });

  it('waits for a live owner and reports who holds the lock', async () => {
    tryAcquireLock(lockPath, owner(1, 'busy'));
    const reports: string[] = [];
    let sleeps = 0;
    await acquireLock(lockPath, owner(2, 'next'), {
      isAlive: () => true,
      report: (message) => reports.push(message),
      reportIntervalMs: 0,
      sleep: async () => {
        sleeps += 1;
        if (sleeps === 3) releaseLock(lockPath, owner(1, 'busy'));
      },
    });
    expect(sleeps).toBe(3);
    expect(reports).toHaveLength(3);
    expect(reports[0]).toMatch(/^Waiting for mise run check in \/work\/busy \(pid 1, running /);
    expect(readLockOwner(lockPath)?.token).toBe('next');
  });

  it('serializes concurrent waiters', async () => {
    const pause = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
    const holders: string[] = [];
    const waiters = ['a', 'b', 'c'].map(async (token, index) => {
      await acquireLock(lockPath, owner(index + 10, token), {
        isAlive: () => true,
        report: () => {},
        sleep: () => pause(1),
      });
      holders.push(token);
      expect(holders.filter((holder) => holder !== 'done')).toHaveLength(1);
      await pause(5);
      holders.splice(holders.indexOf(token), 1, 'done');
      releaseLock(lockPath, owner(index + 10, token));
    });
    await Promise.all(waiters);
    expect(holders).toEqual(['done', 'done', 'done']);
  });
});

describe('isProcessAlive', () => {
  it('recognizes this process and rejects an exited one', () => {
    expect(isProcessAlive(process.pid)).toBe(true);
    const exited = spawnSync('true');
    expect(isProcessAlive(exited.pid!)).toBe(false);
  });

  it('rejects a process that reused the owner ID', () => {
    const startedAt = processStartTime(process.pid);
    expect(typeof startedAt).toBe('string');
    expect(isProcessAlive(process.pid, startedAt)).toBe(true);
    expect(isProcessAlive(process.pid, 'Thu Jan  1 00:00:00 1970')).toBe(false);
  });
});

describe('check-lock command', () => {
  it('runs the command, passes its exit code through, and releases the lock', () => {
    const script = join(__dirname, '..', 'check-lock.ts');
    const result = spawnSync('bun', [script, 'sh', '-c', 'test -d "$MEETCAL_CHECK_LOCK_PATH" && exit 7'], {
      env: { ...process.env, MEETCAL_CHECK_LOCK_PATH: lockPath },
    });
    expect(result.status).toBe(7);
    expect(existsSync(lockPath)).toBe(false);
  });
});
