/**
 * Dev-only diagnostics.
 *
 * AGENTS.md TigerStyle "show your work": trace logging belongs in `__DEV__`,
 * not in a shipped build's console. Release-build `console.log` costs a bridge
 * hop per call on hot paths (offline store writes, saved-session reloads,
 * RevenueCat pushes) and, worse, leaks payloads — RevenueCat `CustomerInfo`
 * carries the app user id, entitlement ids, and purchase dates.
 *
 * Genuine failure reporting stays on bare `console.error`/`console.warn` so it
 * still surfaces in production crash/log capture. Use these helpers only for
 * "what is happening" narration.
 *
 * `__DEV__` is read at call time rather than captured at module load so a test
 * (or a dev menu) can flip it.
 */

function isDev(): boolean {
  return typeof __DEV__ !== 'undefined' && __DEV__;
}

export function devLog(...args: unknown[]): void {
  if (isDev()) {
    console.log(...args);
  }
}

export function devWarn(...args: unknown[]): void {
  if (isDev()) {
    console.warn(...args);
  }
}

export function devInfo(...args: unknown[]): void {
  if (isDev()) {
    console.info(...args);
  }
}
