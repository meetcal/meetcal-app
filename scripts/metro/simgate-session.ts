/**
 * What a Maestro session reads from simgate, the machine-wide simulator gate (see AGENTS.md,
 * Simulator lock): the Metro port of its slot and the simulator it claimed.
 */

/** Metro's port outside a simgate session. */
const DEFAULT_METRO_PORT = 8081;

/** The session's Metro port from simgate, or 8081. A value that is not a port is an error. */
export const sessionPort = (env: Record<string, string | undefined>): number => {
  const port = Number(env.SIMGATE_PORT ?? DEFAULT_METRO_PORT);
  if (!Number.isSafeInteger(port) || port <= 0 || port > 65_535) {
    throw new Error(`SIMGATE_PORT must be a TCP port, got "${env.SIMGATE_PORT}"`);
  }
  return port;
};

/** `maestro test` aimed at the session's simulator when simgate claimed one. */
export const maestroArgsFor = (appId: string, flows: string[], udid: string | undefined): string[] => [
  ...(udid ? ['--device', udid] : []),
  'test',
  '-e',
  `APP_ID=${appId}`,
  ...flows,
];
