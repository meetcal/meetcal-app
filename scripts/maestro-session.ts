/**
 * One Maestro run as its own device session: starts Metro with the E2E switch
 * (`docs/maestro.md`), waits until it serves, opens the development client,
 * runs the flows, then stops Metro. `bun run maestro:test` runs it as a simgate
 * session (see AGENTS.md, Simulator lock), so the run owns its simulator
 * (`SIMGATE_UDID`) and Metro port (`SIMGATE_PORT`) from start to finish:
 *
 *   bun scripts/maestro-session.ts <maestro test args...>
 */
import { spawn, type ChildProcess } from 'node:child_process';

import { processTree, signalProcesses } from './check/process-tree';
import { maestroArgsFor, sessionPort } from './metro/simgate-session';

const METRO_READY_TIMEOUT_MS = 180_000;
const METRO_POLL_MS = 1_000;
const STATUS_TIMEOUT_MS = 1_000;
const DEFAULT_APP_ID = 'com.memohnsen.meetcal';
const SIGNAL_EXIT_CODES: Record<string, number> = { SIGINT: 130, SIGTERM: 143, SIGHUP: 129 };

const metroIsReady = async (port: number): Promise<boolean> => {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/status`, { signal: AbortSignal.timeout(STATUS_TIMEOUT_MS) });
    return (await response.text()).includes('packager-status:running');
  } catch {
    return false;
  }
};

const exited = (child: ChildProcess) =>
  new Promise<number>((resolve) => {
    child.on('error', () => resolve(127));
    child.on('exit', (code, signal) => resolve((signal ? SIGNAL_EXIT_CODES[signal] : undefined) ?? code ?? 1));
  });

async function main(maestroArgs: string[]): Promise<never> {
  const appId = process.env.APP_ID || DEFAULT_APP_ID;
  const port = sessionPort(process.env);
  // CI turns off Expo's interactive prompts; nothing reads this Metro's stdin.
  const metro = spawn('expo', ['start', '--port', String(port)], {
    stdio: ['ignore', 'inherit', 'inherit'],
    env: { ...process.env, EXPO_PUBLIC_MAESTRO_E2E: '1', CI: '1' },
  });
  let metroRunning = metro.pid !== undefined;
  const metroExit = exited(metro).finally(() => {
    metroRunning = false;
  });
  process.on('exit', () => {
    if (metroRunning && metro.pid !== undefined) signalProcesses(processTree(metro.pid), 'SIGTERM');
  });
  for (const signal of Object.keys(SIGNAL_EXIT_CODES) as NodeJS.Signals[]) {
    process.on(signal, () => process.exit(SIGNAL_EXIT_CODES[signal]));
  }

  const deadline = Date.now() + METRO_READY_TIMEOUT_MS;
  while (!(await metroIsReady(port))) {
    if (!metroRunning) {
      console.error(`maestro-session: Metro exited with status ${await metroExit} before it was ready`);
      process.exit(1);
    }
    if (Date.now() > deadline) {
      console.error(`maestro-session: Metro was not ready on port ${port} after ${METRO_READY_TIMEOUT_MS / 1000}s`);
      process.exit(1);
    }
    await new Promise((resolve) => setTimeout(resolve, METRO_POLL_MS));
  }

  const env = { ...process.env, APP_ID: appId };
  const bootstrap = await exited(spawn('bun', ['run', 'maestro:bootstrap'], { stdio: 'inherit', env }));
  if (bootstrap !== 0) process.exit(bootstrap);
  const maestro = maestroArgsFor(appId, maestroArgs, process.env.SIMGATE_UDID);
  process.exit(await exited(spawn('maestro', maestro, { stdio: 'inherit', env })));
}

const maestroArgs = process.argv.slice(2);
if (maestroArgs.length === 0) {
  console.error('Usage: bun scripts/maestro-session.ts <flow or folder> [maestro test args...]');
  process.exit(2);
}
void main(maestroArgs);
