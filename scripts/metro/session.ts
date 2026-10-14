/**
 * The simulator lock's settings: where it lives, how long a session may hold
 * it, and the Metro port it guards. See `scripts/metro-lock.ts`.
 *
 * The simulator and port 8081 belong to the machine, not to one repository,
 * so the lock lives in the user's cache directory and the Atlas repository
 * uses the same path, lease variable and owner format: agents in either repo
 * queue for one another.
 */
import { spawnSync } from 'node:child_process';
import { connect } from 'node:net';
import { join } from 'node:path';

export const METRO_PORT = 8081;
export const DEFAULT_LEASE_MINUTES = 30;
/** A day: past this a lease is a typo, and Node's timers overflow long before the next limit. */
const MAX_LEASE_MINUTES = 24 * 60;
const PORT_PROBE_TIMEOUT_MS = 1_000;

/** How each package.json script that starts Metro or drives the simulator must begin. */
export const METRO_LOCK_PREFIX = 'bun scripts/metro-lock.ts ';
export const METRO_SCRIPTS = ['start', 'dev', 'ios', 'android', 'web', 'maestro:test', 'maestro:test:flow'] as const;

type Env = Record<string, string | undefined>;

/**
 * `$XDG_CACHE_HOME/metro/simulator.lock`, or `~/.cache/metro/simulator.lock`
 * when that is unset or empty. `METRO_SIMULATOR_LOCK_PATH` overrides it for tests.
 */
export const metroLockPath = (env: Env, home: string): string => {
  if (env.METRO_SIMULATOR_LOCK_PATH) return env.METRO_SIMULATOR_LOCK_PATH;
  return join(env.XDG_CACHE_HOME || join(home, '.cache'), 'metro', 'simulator.lock');
};

/** `METRO_SIMULATOR_LEASE_MIN`, or 30 minutes. A value that is not a sane duration is an error, not a silent default. */
export const leaseMinutes = (env: Env): number => {
  const raw = env.METRO_SIMULATOR_LEASE_MIN;
  if (raw === undefined || raw.trim() === '') return DEFAULT_LEASE_MINUTES;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0 || value > MAX_LEASE_MINUTES) {
    throw new Error(`METRO_SIMULATOR_LEASE_MIN must be minutes between 0 and ${MAX_LEASE_MINUTES}, got "${raw}"`);
  }
  return value;
};

/** The port the lock guards; `METRO_SIMULATOR_PORT` overrides it for tests. */
export const metroPort = (env: Env): number => {
  const port = Number(env.METRO_SIMULATOR_PORT ?? METRO_PORT);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`METRO_SIMULATOR_PORT must be a TCP port, got "${env.METRO_SIMULATOR_PORT}"`);
  }
  return port;
};

/** True when something accepts connections on `host:port`. */
export const isListening = (port: number, host: string): Promise<boolean> =>
  new Promise((resolve) => {
    const socket = connect({ port, host });
    const finish = (listening: boolean) => {
      socket.destroy();
      resolve(listening);
    };
    socket.setTimeout(PORT_PROBE_TIMEOUT_MS, () => finish(false));
    socket.once('connect', () => finish(true));
    socket.once('error', () => finish(false));
  });

const output = (command: string, args: string[]): string => {
  const result = spawnSync(command, args, { encoding: 'utf8' });
  return result.status === 0 ? (result.stdout ?? '').trim() : '';
};

/** The processes listening on the port: `lsof` on macOS, `ss` where `lsof` is missing. */
const listenerPids = (port: number): number[] => {
  const fromLsof = output('lsof', ['-t', '-nP', `-iTCP:${port}`, '-sTCP:LISTEN']).split('\n');
  const fromSs = [...output('ss', ['-ltnpH', `sport = :${port}`]).matchAll(/pid=(\d+)/g)].map((match) => match[1]);
  return [...new Set([...fromLsof, ...fromSs].map(Number).filter((pid) => Number.isSafeInteger(pid) && pid > 0))];
};

const workingDirectory = (pid: number): string =>
  output('readlink', [`/proc/${pid}/cwd`]) ||
  (output('lsof', ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']).match(/^n(.+)$/m)?.[1] ?? 'unknown');

/** Who listens on the port, with the command and directory, for the error message. */
const describeListeners = (port: number): string => {
  const pids = listenerPids(port);
  if (pids.length === 0) return '  (could not name the process)';
  return pids
    .map((pid) => `  pid ${pid} in ${workingDirectory(pid)}: ${output('ps', ['-o', 'args=', '-p', String(pid)])}`)
    .join('\n');
};

/**
 * Checked once the lock is held: anything still on Metro's port was started
 * outside the lock (a bare `expo start`, or one run by hand). It is reported,
 * never killed.
 */
export const portProblem = async (port: number): Promise<string | undefined> => {
  const [ipv4, ipv6] = await Promise.all([isListening(port, '127.0.0.1'), isListening(port, '::1')]);
  if (!ipv4 && !ipv6) return undefined;
  return [
    `Port ${port} is in use by a process started outside the simulator lock:`,
    describeListeners(port),
    'Stop it (or ask whoever started it), then run this again.',
  ].join('\n');
};
