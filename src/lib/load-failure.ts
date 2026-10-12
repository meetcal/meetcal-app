export type LoadFailure = 'offline' | 'error';

/**
 * Why a screen that loads by hand (the Start List) has nothing to show, or
 * null when its empty state is real: rows are shown, or the request answered
 * with nothing.
 */
export function emptyLoadFailure(input: {
  shownCount: number;
  hasNetwork: boolean;
  requestFailed: boolean;
}): LoadFailure | null {
  if (input.shownCount > 0) return null;
  if (!input.hasNetwork) return 'offline';
  return input.requestFailed ? 'error' : null;
}

/**
 * What a screen says when its data could not be loaded and nothing is cached.
 *
 * Several screens dropped the load error and rendered their normal empty
 * state ("No schedule yet … Check back soon!", "Athletes will appear here
 * once the start list is published", "No meet results found for …"), which
 * tells the user the data does not exist when the request failed. Offline
 * and a failed request are told apart, and both offer a retry.
 *
 * @param subject what failed to load, as it reads after "the" ("schedule",
 * "start list", "session athletes", "results").
 */
export function loadFailureCopy(
  subject: string,
  isOffline: boolean,
): { title: string; message: string } {
  if (isOffline) {
    return {
      title: "You're offline",
      message: `The ${subject} isn't saved on this device yet. Connect to the internet and try again.`,
    };
  }
  return {
    title: `Couldn't load the ${subject}`,
    message: 'Something went wrong while loading. Check your connection and try again.',
  };
}
