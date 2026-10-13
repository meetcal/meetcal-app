/**
 * Accounts deleted on this device in this run of the app (#250). Once the
 * device's data for one is cleared (`clearLocalUserData`), a saved-sessions
 * or outbox write already past its signed-in check must not store it again,
 * so the writers skip a write for an account marked here. Signing in as the
 * same user again (they only signed out of the account sheet) clears it.
 */
const deleted = new Set<string>();
const listeners = new Set<(userId: string) => void>();

export function markAccountDeleted(userId: string): void {
  deleted.add(userId);
  for (const listener of listeners) listener(userId);
}

/**
 * Calls `listener` with each account marked deleted from now on, so a screen
 * still showing its data (the cached user stays active offline) can blank
 * it. Returns the unsubscribe.
 */
export function onAccountDeleted(listener: (userId: string) => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function isAccountDeleted(userId: string): boolean {
  return deleted.has(userId);
}

export function clearAccountDeleted(userId: string): void {
  deleted.delete(userId);
}
