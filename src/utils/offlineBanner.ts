const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/**
 * The app-wide offline banner's text: offline, and how old the selected
 * meet's own data on this device is.
 *
 * The banner used to take both its visibility and its "Last synced" time from
 * the RevenueCat entitlement cache, so an online user whose subscription
 * check was a week old read "Using Cached Data • Last synced 9d ago" as "the
 * schedule is 9 days old". `lastSyncedAt` is the meet's offline-store sync
 * time (`getLastSyncTime`); null or 0 when nothing is stored for it.
 */
export function offlineBannerText(lastSyncedAt: number | null, now: number): string {
  if (!lastSyncedAt || lastSyncedAt <= 0) return "Offline Mode";
  const age = Math.max(0, now - lastSyncedAt);
  const days = Math.floor(age / DAY_MS);
  const hours = Math.floor((age % DAY_MS) / HOUR_MS);
  const since = days > 0 ? `${days}d ago` : hours > 0 ? `${hours}h ago` : "recently";
  return `Offline Mode • Meet data synced ${since}`;
}
