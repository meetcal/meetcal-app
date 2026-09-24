/**
 * What the Offline Data screen is running right now, kept for the app process
 * rather than for one mount of the screen.
 *
 * A download, a removal, Refresh All and Delete All all keep running after the
 * user swipes back from the screen. When the busy flags lived in the screen's
 * hook, reopening it mounted fresh flags that said "idle" while the old run was
 * still writing: Delete All then cleared storage and the orphaned refresh wrote
 * its remaining meets back (and re-marked them downloaded), and a second
 * Refresh All ran every forced meet download twice, back to back.
 *
 * Bounded: at most one bulk action, and one entry per row id, released in
 * `finally` by the action that claimed it.
 */

export type OfflineBulkAction = 'refresh' | 'delete';

export type OfflineActivity = {
  readonly bulk: OfflineBulkAction | null;
  /** Row ids (competition item ids and `meet:` ids) with an action running. */
  readonly items: ReadonlySet<string>;
  /** Bumped whenever an action ends; stored statuses may have changed. */
  readonly settled: number;
};

const IDLE: OfflineActivity = { bulk: null, items: new Set(), settled: 0 };

let activity: OfflineActivity = IDLE;
const listeners = new Set<() => void>();

function publish(next: OfflineActivity): void {
  activity = next;
  for (const listener of listeners) listener();
}

export function getOfflineActivity(): OfflineActivity {
  return activity;
}

export function subscribeOfflineActivity(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Claims a row. False while a bulk action runs or the row is already busy. */
export function claimOfflineItem(id: string): boolean {
  if (!id) throw new Error('Offline activity: empty item id');
  if (activity.bulk || activity.items.has(id)) return false;
  const items = new Set(activity.items);
  items.add(id);
  publish({ ...activity, items });
  return true;
}

export function releaseOfflineItem(id: string): void {
  if (!activity.items.has(id)) return;
  const items = new Set(activity.items);
  items.delete(id);
  publish({ ...activity, items, settled: activity.settled + 1 });
}

export type BulkClaim = 'claimed' | 'bulk-running' | 'items-running';

/**
 * Claims every row for a bulk action. A row action still running would race
 * it: its item is either re-downloaded after its removal or removed after its
 * refresh.
 */
export function claimOfflineBulk(action: OfflineBulkAction): BulkClaim {
  if (activity.bulk) return 'bulk-running';
  if (activity.items.size > 0) return 'items-running';
  publish({ ...activity, bulk: action });
  return 'claimed';
}

export function releaseOfflineBulk(action: OfflineBulkAction): void {
  if (activity.bulk !== action) return;
  publish({ ...activity, bulk: null, settled: activity.settled + 1 });
}

/** Test-only: module state outlives a test that failed mid-action. */
export function resetOfflineActivityForTests(): void {
  activity = IDLE;
  listeners.clear();
}
