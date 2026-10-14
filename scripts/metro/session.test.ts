import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { readLockOwner, releaseLock, tryAcquireLock, type LockOwner } from '../check/lock';
import { LEASE_EXPIRED_EXIT_CODE } from '../check/run-locked';
import {
  DEFAULT_LEASE_MINUTES,
  METRO_LOCK_PREFIX,
  METRO_SCRIPTS,
  isListening,
  leaseMinutes,
  metroLockPath,
  metroPort,
  portProblem,
} from './session';

const repoRoot = resolve(__dirname, '..', '..');
const script = join(repoRoot, 'scripts', 'metro-lock.ts');

let directory: string;
let lockPath: string;

beforeEach(() => {
  // A process's cwd is the resolved path (macOS's /var is /private/var), and the lock compares it.
  directory = realpathSync(mkdtempSync(join(tmpdir(), 'metro-lock-')));
  lockPath = join(directory, 'simulator.lock');
});

afterEach(() => rmSync(directory, { recursive: true, force: true }));

/** A port nothing listens on: bound, read, then closed. */
const freePort = async (): Promise<number> => {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  const { port } = server.address() as { port: number };
  await new Promise<void>((done) => server.close(() => done()));
  return port;
};

const listen = async (): Promise<[Server, number]> => {
  const server = createServer();
  await new Promise<void>((done) => server.listen(0, '127.0.0.1', done));
  return [server, (server.address() as { port: number }).port];
};

/** A lock held by this test process, which stays alive for the whole test. */
const heldBy = (worktree: string): LockOwner => ({
  pid: process.pid,
  worktree,
  startedAtMs: Date.now(),
  token: `held-${worktree}`,
});

const runMetroLock = (command: string[], env: Record<string, string>) => {
  const child = spawn('bun', [script, ...command], {
    cwd: directory,
    env: { ...process.env, METRO_SIMULATOR_LOCK_PATH: lockPath, ...env },
  });
  let stderr = '';
  child.stderr.on('data', (chunk: Buffer) => {
    stderr += chunk.toString();
  });
  const done = new Promise<{ status: number | null; stderr: string }>((settle) =>
    child.on('exit', (status) => settle({ status, stderr })),
  );
  return { done, stderr: () => stderr };
};

describe('package.json', () => {
  it('runs every script that starts Metro through the simulator lock', () => {
    const parsed: unknown = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'));
    const scripts = (parsed as { scripts: Record<string, string> }).scripts;
    for (const name of METRO_SCRIPTS) expect(scripts[name]).toMatch(new RegExp(`^${METRO_LOCK_PREFIX}`));
    const unwrapped = Object.entries(scripts).filter(
      ([, command]) => /\bexpo (?:start|run:)|\bmaestro test\b/.test(command) && !command.startsWith(METRO_LOCK_PREFIX),
    );
    expect(unwrapped).toEqual([]);
  });
});

describe('metroLockPath', () => {
  it('keeps one lock per machine in the user cache directory, where Atlas finds it too', () => {
    expect(metroLockPath({}, '/home/me')).toBe('/home/me/.cache/metro/simulator.lock');
    expect(metroLockPath({ XDG_CACHE_HOME: '' }, '/home/me')).toBe('/home/me/.cache/metro/simulator.lock');
    expect(metroLockPath({ XDG_CACHE_HOME: '/xdg' }, '/home/me')).toBe('/xdg/metro/simulator.lock');
    expect(metroLockPath({ METRO_SIMULATOR_LOCK_PATH: '/tmp/t.lock', XDG_CACHE_HOME: '/xdg' }, '/home/me')).toBe(
      '/tmp/t.lock',
    );
  });
});

describe('leaseMinutes', () => {
  it('defaults to 30 minutes and rejects values that are not a sane duration', () => {
    expect(leaseMinutes({})).toBe(DEFAULT_LEASE_MINUTES);
    expect(leaseMinutes({ METRO_SIMULATOR_LEASE_MIN: ' ' })).toBe(DEFAULT_LEASE_MINUTES);
    expect(leaseMinutes({ METRO_SIMULATOR_LEASE_MIN: '90' })).toBe(90);
    for (const bad of ['0', '-5', 'soon', '1441', 'Infinity']) {
      expect(() => leaseMinutes({ METRO_SIMULATOR_LEASE_MIN: bad })).toThrow('METRO_SIMULATOR_LEASE_MIN');
    }
  });
});

describe('metroPort', () => {
  it('is 8081 unless a test moves it', () => {
    expect(metroPort({})).toBe(8081);
    expect(metroPort({ METRO_SIMULATOR_PORT: '9000' })).toBe(9000);
    expect(() => metroPort({ METRO_SIMULATOR_PORT: '70000' })).toThrow('METRO_SIMULATOR_PORT');
  });
});

describe('portProblem', () => {
  it('names a listener started outside the lock and passes a free port', async () => {
    const [server, port] = await listen();
    try {
      expect(await isListening(port, '127.0.0.1')).toBe(true);
      expect(await portProblem(port)).toContain(`Port ${port} is in use by a process started outside the simulator lock`);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
    expect(await portProblem(await freePort())).toBeUndefined();
  });
});

describe('metro-lock command', () => {
  it('holds the lock with its lease while the command runs, then releases it', async () => {
    const port = await freePort();
    const run = runMetroLock(['sh', '-c', 'sleep 0.3; grep -q leaseEndsAtMs "$METRO_SIMULATOR_LOCK_PATH/owner.json" && exit 7'], {
      METRO_SIMULATOR_PORT: String(port),
    });
    expect((await run.done).status).toBe(7);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('refuses to queue behind a session from its own worktree, and leaves that lock alone', async () => {
    const holder = heldBy(directory);
    tryAcquireLock(lockPath, holder);
    const { status, stderr } = await runMetroLock(['true'], { METRO_SIMULATOR_PORT: String(await freePort()) }).done;
    expect(status).toBe(1);
    expect(stderr).toContain(`Metro is already running in this worktree (pid ${process.pid}); stop it first.`);
    expect(readLockOwner(lockPath)?.token).toBe(holder.token);
  });

  it("waits for another worktree's session to end before starting", async () => {
    const holder = heldBy('/work/other');
    tryAcquireLock(lockPath, holder);
    const run = runMetroLock(['true'], { METRO_SIMULATOR_PORT: String(await freePort()) });
    await new Promise((settle) => setTimeout(settle, 1_000));
    expect(run.stderr()).toContain('Waiting for Metro in /work/other');
    releaseLock(lockPath, holder);
    expect((await run.done).status).toBe(0);
    expect(existsSync(lockPath)).toBe(false);
  });

  it('does not start when something outside the lock holds the port', async () => {
    const [server, port] = await listen();
    try {
      const { status, stderr } = await runMetroLock(['true'], { METRO_SIMULATOR_PORT: String(port) }).done;
      expect(status).toBe(1);
      expect(stderr).toContain(`Port ${port} is in use`);
      expect(existsSync(lockPath)).toBe(false);
    } finally {
      await new Promise<void>((done) => server.close(() => done()));
    }
  });

  it('stops the command and its children when the lease ends', async () => {
    const started = Date.now();
    const { status, stderr } = await runMetroLock(['sh', '-c', 'sleep 30 & wait'], {
      METRO_SIMULATOR_PORT: String(await freePort()),
      METRO_SIMULATOR_LEASE_MIN: '0.01',
    }).done;
    expect(status).toBe(LEASE_EXPIRED_EXIT_CODE);
    expect(stderr).toContain('lease ended');
    expect(Date.now() - started).toBeLessThan(10_000);
    expect(existsSync(lockPath)).toBe(false);
  });
});
