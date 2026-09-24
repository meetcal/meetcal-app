import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import { SyncManager } from '@/lib/database/sync-manager';
import { clearExpiredDownloadedMeets } from '@/lib/database/offline-store';
import { prefetchMeetData, fetchMeetsFresh, getCachedMeets, warmMeetData } from '@/lib/database/meet-manager';
import { fetchApiMeetByName } from '@/lib/api/meetcal-api';
import { subscribeToNetworkChanges } from '@/lib/networkUtils';
import { RECONNECT_REFETCH_JITTER_MAX_MS, reconnectRefetchDelayMs } from '@/lib/data/mutable-resource';
import { reindexAppEntities } from '@/utils/appIntents';
import { devLog } from '@/lib/logger';

type SelectedMeetContextType = {
  selectedMeet: MeetName | null;
  meetDetails: Meet | null;
  availableMeets: Meet[];
  setSelectedMeet: (meet: MeetName) => Promise<void>;
  isLoading: boolean;
  forceSync: () => Promise<void>;
  refreshAvailableMeets: () => Promise<void>;
};

const SELECTED_MEET_KEY = '@selected_meet';
/**
 * How often the meet list is re-checked while the app is foregrounded. Matches
 * `SYNC_INTERVAL` in `lib/database/sync-manager.ts`, which is the per-meet
 * schedule refresh this provider starts alongside it.
 */
const MEET_LIST_REFRESH_INTERVAL_MS = 5 * 60 * 1000;
/**
 * A reconnect used to refetch `/meets` on the very edge, and every open
 * screen's provider did the same, so a flapping connection (train, stadium
 * wifi) hit the API in lockstep from every device that came back at once.
 * The refetch now waits a random slice of this window, and further edges
 * while one is pending or in flight are dropped.
 */
export { RECONNECT_REFETCH_JITTER_MAX_MS };
const SELECTED_MEET_DETAILS_KEY = '@selected_meet_details';

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

// Parse a persisted out-of-window Meet, ignoring stale JSON that belongs to a
// different meet than the one we're resolving.
//
// The `Meet` type declares `venue`, `venue.address` and `time` as non-null,
// and screens read them that way — `components/info/EventInfoScreen` renders
// `meetDetails.venue.address.street` with no guard. Everything the API builds
// has those, but this blob was written by whatever version of the app the user
// last ran, and a truncated or older-schema entry would be handed straight to
// the Info tab as a `Meet` and crash it. Validate the shape the type promises
// instead of `as Meet`-ing past the parse.
function parseStoredMeetDetails(raw: string | null, expectedName: string): Meet | null {
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    if (parsed.name !== expectedName) return null;
    if (!isRecord(parsed.venue) || !isRecord(parsed.venue.address)) return null;
    if (!isRecord(parsed.time) || !isRecord(parsed.dates)) return null;
    return parsed as unknown as Meet;
  } catch {
    return null;
  }
}

const SelectedMeetContext = createContext<SelectedMeetContextType | undefined>(undefined);

export function SelectedMeetProvider({ children }: { children: React.ReactNode }) {
  const [selectedMeet, setSelectedMeetState] = useState<MeetName | null>(null);
  const [meetDetails, setMeetDetails] = useState<Meet | null>(null);
  const [availableMeets, setAvailableMeets] = useState<Meet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);
  const lastNetworkStateRef = useRef<boolean | null>(null);
  // The reconnect-triggered refetch that is scheduled or running, if any.
  const reconnectRefetchRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    inFlight: boolean;
  }>({ timer: null, inFlight: false });
  // `loadMeets` is a ~150-line async sequence with a dozen commit points, and
  // three things start it: the mount/identity effect, a 5-minute interval, and
  // the network-reconnect handler. Nothing serialised them, so two runs could
  // interleave their `setSelectedMeetState` / `setAvailableMeets` /
  // `initializeMeetData` / AsyncStorage writes and the loser's *older*
  // decisions landed last. Every run takes a token; only the newest token is
  // allowed to commit, and any run whose token has been superseded bails at
  // its next checkpoint. `setSelectedMeet` bumps the token too, so an explicit
  // user selection can never be stomped by a background refresh that was
  // already in flight.
  const loadRunRef = useRef(0);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  // Mirror of meetDetails so loadMeets can read the latest value without
  // taking it as a dependency. Note this does NOT keep `loadMeets` stable:
  // it still closes over `selectedMeet` (directly and via `chooseMeet`), so
  // selecting a meet rebuilds the 5-minute refresh interval below and runs one
  // extra `loadMeets()`. That extra run is the refresh, so nothing goes stale.
  const meetDetailsRef = useRef<Meet | null>(null);
  useEffect(() => {
    meetDetailsRef.current = meetDetails;
  }, [meetDetails]);

  const beginMeetWarmup = useCallback((meet: MeetName, label: string) => {
    warmMeetData(meet).catch((error) => {
      console.error(`Error ${label}:`, error);
    });
  }, []);

  // A SyncManager owns a 5-minute timer, so exactly one has to exist per
  // selected meet and it has to be stopped when that meet changes or the
  // provider unmounts. That is an effect's job. It used to be constructed
  // inside a `setSyncManager` updater, which is a side effect in a function
  // React is free to re-run: under StrictMode the updater runs twice with the
  // same pre-update `current`, so the first instance was never handed back to
  // anyone and its interval kept re-fetching and re-writing a meet's schedule
  // for the rest of the session.
  useEffect(() => {
    if (!selectedMeet) {
      setSyncManager(null);
      return;
    }
    const manager = new SyncManager(selectedMeet);
    manager.start();
    setSyncManager(manager);
    return () => {
      manager.stopSync();
    };
  }, [selectedMeet]);

  const activateMeet = useCallback((meet: MeetName, meetData: Meet) => {
    setSelectedMeetState(meet);
    setMeetDetails(meetData);
    void reindexAppEntities();
  }, []);

  // Enhanced setSelectedMeet function with optimistic updates
  const setSelectedMeet = useCallback(async (meet: MeetName) => {
    // Capture the current selection so a transient lookup failure can restore
    // it instead of discarding a previously valid meet.
    const previousMeet = selectedMeet;
    const previousMeetDetails = meetDetails;

    // An explicit selection outranks any refresh already in flight: bump the
    // run token so a `loadMeets` that is mid-await cannot commit its older
    // choice on top of this one. Only when the selection actually changes and
    // only once it is about to be committed — the change is what re-creates
    // `loadMeets` and starts the run that replaces the one aborted here. A
    // bump on a failed lookup or a re-selection of the same meet aborted the
    // in-flight refresh with nothing to take over, losing its commit (and,
    // before first paint, leaving `isLoading` stuck).
    const supersedeInFlightLoad = (next: MeetName | null) => {
      if (next !== previousMeet) loadRunRef.current += 1;
    };

    // Find meet details from available meets; fall back to fetching by name so
    // programmatic selection (deep links, dev tools) works for meets outside
    // the upcoming-meets window.
    let meetData = availableMeets.find(m => m.name === meet);
    let resolvedOutOfWindow = false;
    if (!meetData) {
      let fetched: Meet | null;
      try {
        fetched = await fetchApiMeetByName(meet);
      } catch (error) {
        // Lookup failed (network error, not a definitive "not found"). Keep
        // the previous valid selection and surface the error so the UI can
        // toast — do not clear storage or null the state.
        console.error('Error looking up selected meet:', error);
        throw error;
      }
      if (fetched) {
        meetData = fetched;
        resolvedOutOfWindow = true;
      }
    }

    if (!meetData) {
      // Definitively invalid: the lookup returned no meet. Clear selection.
      console.error('Selected meet not found in available meets');
      supersedeInFlightLoad(null);
      setSelectedMeetState(null);
      setMeetDetails(null);
      await AsyncStorage.multiRemove([SELECTED_MEET_KEY, SELECTED_MEET_DETAILS_KEY]);
      throw new Error('Selected meet not found in available meets');
    }

    try {
      supersedeInFlightLoad(meet);
      activateMeet(meet, meetData);

      // Save to storage. Persist the resolved Meet object for out-of-window
      // selections so an offline cold start can rehydrate it.
      await AsyncStorage.setItem(SELECTED_MEET_KEY, meet);
      if (resolvedOutOfWindow) {
        await AsyncStorage.setItem(SELECTED_MEET_DETAILS_KEY, JSON.stringify(meetData));
      } else {
        await AsyncStorage.removeItem(SELECTED_MEET_DETAILS_KEY);
      }

      beginMeetWarmup(meet, 'preloading meet data');
    } catch (error) {
      // Persisting failed after activation; restore the prior selection rather
      // than leaving inconsistent state.
      console.error('Error saving selected meet:', error);
      if (previousMeet && previousMeetDetails) {
        activateMeet(previousMeet, previousMeetDetails);
      } else {
        setSelectedMeetState(null);
        setMeetDetails(null);
      }
      throw error;
    }
  }, [selectedMeet, meetDetails, availableMeets, activateMeet, beginMeetWarmup]);

  // Initialize meet data
  const initializeMeetData = useCallback(async (meet: MeetName, meetData: Meet) => {
    activateMeet(meet, meetData);
    beginMeetWarmup(meet, 'initializing meet data');
  }, [activateMeet, beginMeetWarmup]);

  // Load available meets
  const chooseMeet = useCallback(
    (meets: Meet[], stored: string | null) => {
      if (selectedMeet) {
        return meets.find((meet) => meet.name === selectedMeet) ?? null;
      }
      if (stored) {
        const storedMeet = meets.find((meet) => meet.name === stored);
        if (storedMeet) return storedMeet;
      }
      return meets[0] ?? null;
    },
    [selectedMeet],
  );

  const loadMeets = useCallback(async () => {
      const runId = ++loadRunRef.current;
      // True once a newer run has started (or the provider unmounted). Checked
      // after every await, before anything is committed.
      const isStale = () => !isMountedRef.current || loadRunRef.current !== runId;

      try {
        void clearExpiredDownloadedMeets().catch((error) => {
          console.error('Error clearing expired downloaded meets:', error);
        });

        const [cachedMeets, stored, storedDetailsRaw] = await Promise.all([
          getCachedMeets(),
          AsyncStorage.getItem(SELECTED_MEET_KEY),
          AsyncStorage.getItem(SELECTED_MEET_DETAILS_KEY),
        ]);
        if (isStale()) return;

        let activeMeet = selectedMeet;
        let initializedFromCache = false;
        let outOfWindowResolved = false;

        // A stored meet missing from the upcoming window may still be valid
        // (selected via dev tools or a deep link). It must be resolved by name
        // before chooseMeet can fall back to the first available meet.
        const pendingOutOfWindow =
          !activeMeet && !!stored && !cachedMeets.find(m => m.name === stored);

        // Paint the cached upcoming meets immediately for a fast first paint.
        // When an out-of-window meet is pending resolution, hold off on the
        // fallback choice so we don't stomp the user's stored selection —
        // resolution happens below and swaps the real meet in.
        if (cachedMeets.length > 0) {
          setAvailableMeets(cachedMeets);
          if (!pendingOutOfWindow) {
            const cachedChoice = chooseMeet(cachedMeets, stored);
            if (cachedChoice) {
              activeMeet = cachedChoice.name;
            }
            if (cachedChoice && !selectedMeet) {
              await initializeMeetData(cachedChoice.name, cachedChoice);
              if (isStale()) return;
              initializedFromCache = true;
            }
          }
          setIsLoading(false);
        }

        // Resolve the stored out-of-window meet by name AFTER the cache paint,
        // so the by-name lookup's timeout never blocks first paint.
        if (pendingOutOfWindow && stored) {
          let resolved: Meet | null = null;
          let lookupFailed = false;
          try {
            resolved = await fetchApiMeetByName(stored);
          } catch {
            // Offline or lookup failure: rehydrate from the persisted details
            // so the user's out-of-window selection isn't silently dropped.
            lookupFailed = true;
            resolved = parseStoredMeetDetails(storedDetailsRaw, stored);
          }
          if (isStale()) return;

          if (resolved) {
            await initializeMeetData(resolved.name, resolved);
            if (isStale()) return;
            activeMeet = resolved.name;
            outOfWindowResolved = true;
            // Keep the persisted copy fresh for the next offline cold start.
            await AsyncStorage.setItem(
              SELECTED_MEET_DETAILS_KEY,
              JSON.stringify(resolved),
            );
            if (isStale()) return;
          } else {
            // Neither the window cache nor persisted details have the meet.
            if (!lookupFailed) {
              // Online lookup confirmed the stored meet no longer exists —
              // clean up the stale keys before falling back.
              await AsyncStorage.multiRemove([
                SELECTED_MEET_KEY,
                SELECTED_MEET_DETAILS_KEY,
              ]);
              if (isStale()) return;
            }
            const fallback = chooseMeet(cachedMeets, lookupFailed ? stored : null);
            if (fallback) {
              activeMeet = fallback.name;
              if (!selectedMeet) {
                await initializeMeetData(fallback.name, fallback);
                if (isStale()) return;
                initializedFromCache = true;
              }
            }
          }
        }

        const freshMeets = await fetchMeetsFresh();
        if (isStale()) return;
        setAvailableMeets((current) => {
          const currentSerialized = JSON.stringify(current);
          const nextSerialized = JSON.stringify(freshMeets);
          return currentSerialized === nextSerialized ? current : freshMeets;
        });

        if (freshMeets.length === 0) {
          devLog('No meets available');
          setIsLoading(false);
          return;
        }

        if (activeMeet && !freshMeets.find(m => m.name === activeMeet)) {
          if (outOfWindowResolved) {
            // Already validated by name above — keep it.
            return;
          }
          // When the out-of-window meet is already the active selection with
          // its details loaded, it was resolved on a prior run. Skip the
          // by-name refetch + re-initialization so we don't churn a new
          // SyncManager and re-warm every 5 minutes / on every reconnect.
          if (activeMeet === selectedMeet && meetDetailsRef.current?.name === activeMeet) {
            return;
          }
          // Not in the upcoming window, but it may still be a valid meet
          // (selected via dev tools or a deep link) — only revert when the
          // meet can't be resolved by name at all.
          let outOfWindowMeet: Meet | null = null;
          try {
            outOfWindowMeet = await fetchApiMeetByName(activeMeet);
          } catch {
            // Network hiccup: keep the current selection rather than
            // discarding the user's meet on a failed lookup.
            return;
          }
          if (isStale()) return;
          if (outOfWindowMeet) {
            await initializeMeetData(outOfWindowMeet.name, outOfWindowMeet);
            if (isStale()) return;
            // Persist so an offline cold start can rehydrate this selection.
            await AsyncStorage.setItem(
              SELECTED_MEET_DETAILS_KEY,
              JSON.stringify(outOfWindowMeet),
            );
            return;
          }
          devLog('Selected meet no longer available, switching to first available meet');
          await AsyncStorage.multiRemove([SELECTED_MEET_KEY, SELECTED_MEET_DETAILS_KEY]);
          if (isStale()) return;
          await initializeMeetData(freshMeets[0].name, freshMeets[0]);
          return;
        }

        if (!initializedFromCache && !activeMeet) {
          const freshChoice = chooseMeet(freshMeets, stored);
          if (freshChoice) {
            await initializeMeetData(freshChoice.name, freshChoice);
          }
        }
      } catch (error) {
        console.error('Error loading available meets:', error);
      } finally {
        // A superseded run must not clear the spinner out from under the run
        // that replaced it — that one owns `isLoading` now.
        if (!isStale()) {
          setIsLoading(false);
        }
      }
  }, [chooseMeet, initializeMeetData, selectedMeet]);

    // Initial load
  useEffect(() => {
    loadMeets();

    const refreshInterval = setInterval(
      loadMeets,
      MEET_LIST_REFRESH_INTERVAL_MS,
    );

    // Cleanup interval on unmount
    return () => clearInterval(refreshInterval);
  }, [loadMeets]);

  useEffect(() => {
    // Same object for the listener and the cleanup: the ref's contents never
    // change identity, and the cleanup must clear the timer this
    // subscription scheduled.
    const pending = reconnectRefetchRef.current;
    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      const wasConnected = lastNetworkStateRef.current;
      lastNetworkStateRef.current = isConnected;
      if (!isConnected || wasConnected !== false) return;

      if (pending.timer !== null || pending.inFlight) return;

      pending.timer = setTimeout(() => {
        pending.timer = null;
        pending.inFlight = true;
        loadMeets().finally(() => {
          pending.inFlight = false;
        });
      }, reconnectRefetchDelayMs());
    });
    return () => {
      unsubscribe();
      if (pending.timer !== null) {
        clearTimeout(pending.timer);
        pending.timer = null;
      }
    };
  }, [loadMeets]);

  // Force sync function
  const forceSync = useCallback(async () => {
    if (!syncManager || !selectedMeet) return;

    try {
      await prefetchMeetData(selectedMeet);
    } catch (error) {
      console.error('Error forcing sync:', error);
    }
  }, [syncManager, selectedMeet]);

  // Refresh available meets function. Always goes to the network: the one
  // caller is the profile screen's "clear cached meet data", which has just
  // emptied the cache this would otherwise read.
  const refreshAvailableMeets = useCallback(async () => {
    try {
      await clearExpiredDownloadedMeets();
      const fresh = await fetchMeetsFresh();
      setAvailableMeets((current) =>
        JSON.stringify(current) === JSON.stringify(fresh) ? current : fresh,
      );
    } catch (error) {
      console.error('Error refreshing available meets:', error);
    }
  }, []);

  // Every screen reads this context. A value literal here handed each of them
  // a new object on every provider render — and the provider re-renders for
  // its own async loads — so `React.memo` children and effect deps keyed on
  // the context never settled.
  const value = useMemo<SelectedMeetContextType>(
    () => ({
      selectedMeet,
      meetDetails,
      availableMeets,
      setSelectedMeet,
      isLoading,
      forceSync,
      refreshAvailableMeets,
    }),
    [
      selectedMeet,
      meetDetails,
      availableMeets,
      setSelectedMeet,
      isLoading,
      forceSync,
      refreshAvailableMeets,
    ],
  );

  return (
    <SelectedMeetContext.Provider value={value}>
      {children}
    </SelectedMeetContext.Provider>
  );
}

export function useSelectedMeet() {
  const context = useContext(SelectedMeetContext);
  if (context === undefined) {
    throw new Error('useSelectedMeet must be used within a SelectedMeetProvider');
  }
  return context;
} 
