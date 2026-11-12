import React, { createContext, useContext, useState, useEffect, useCallback, useMemo, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName, Meet } from '@/data/types/meet';
import { SyncManager } from '@/lib/database/sync-manager';
import { clearExpiredDownloadedMeets } from '@/lib/database/downloaded-meet-expiry';
import { isMeetExplicitlyDownloaded } from '@/lib/database/meet-downloads-registry';
import { primeScheduleCache } from '@/lib/database/schedule-resource';
import { prefetchCriticalMeetData, prefetchMeetData, warmMeetData } from '@/lib/database/meet-manager';
import { fetchMeetsFresh } from '@/lib/database/meets-fetch';
import { getCachedMeets } from '@/lib/database/meets-list-cache';
import { awaitServerClock, getTrustedNow } from '@/lib/api/server-clock';
import { fetchApiMeetByName } from '@/lib/api/meets-api';
import { startupTiming } from '@/lib/startup-timing';
import {
  decideAfterActiveMeetLookup,
  decideAfterFreshList,
  decideAfterStoredMeetLookup,
  decideFromCachedList,
  refreshedMeetDetails,
  type LaunchDecision,
} from '@/lib/launch-meet';
import { subscribeToNetworkChanges } from '@/lib/networkUtils';
import {
  RECONNECT_REFETCH_JITTER_MAX_MS,
  reconnectRefetchDelayMs,
} from '@/lib/data/mutable-resource';
import { reindexAppEntities } from '@/utils/appIntents';
import { devLog } from '@/lib/logger';
import { parseStoredMeetNamed } from '@/lib/stored-meet';

type SelectedMeetContextType = {
  selectedMeet: MeetName | null;
  meetDetails: Meet | null;
  availableMeets: Meet[];
  setSelectedMeet: (meet: MeetName) => Promise<void>;
  isLoading: boolean;
  /**
   * The cached meets list is shown, but the stored meet was not in it and
   * is still being looked up by name: no meet is chosen yet, and one may
   * arrive. Not the same as "no meet".
   */
  isResolvingStoredMeet: boolean;
  forceSync: () => Promise<void>;
  refreshAvailableMeets: () => Promise<void>;
};

const SELECTED_MEET_KEY = '@selected_meet';
/**
 * How often the meet list is re-checked while the app is foregrounded. Matches
 * `SYNC_INTERVAL_MS` in `lib/database/sync-manager.ts`, which is the per-meet
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

/**
 * The clock a launch choice reads: the server's once this process has a
 * sample, else the device's. The cached list is painted before any request
 * answers, and waiting for one would show the ended meet first.
 */
function launchNow(): Date {
  return getTrustedNow() ?? new Date();
}

/**
 * A by-name meet lookup whose answer is judged on `launchNow` (is the stored
 * meet over, and so forgotten?). Requests no longer wait for the clock
 * sample they start, so this waits for both: the lookup, and a sample
 * (`awaitServerClock`, bounded). One await, as the lookup alone was, so the
 * caller's commit points do not move. A failed lookup rejects at once.
 */
async function lookUpMeetForLaunch(name: string): Promise<Meet | null> {
  const [meet] = await Promise.all([fetchApiMeetByName(name), awaitServerClock()]);
  return meet;
}

const SelectedMeetContext = createContext<SelectedMeetContextType | undefined>(undefined);

export function SelectedMeetProvider({ children }: { children: React.ReactNode }) {
  const [selectedMeet, setSelectedMeetState] = useState<MeetName | null>(null);
  const [meetDetails, setMeetDetails] = useState<Meet | null>(null);
  const [availableMeets, setAvailableMeets] = useState<Meet[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isResolvingStoredMeet, setIsResolvingStoredMeet] = useState(false);
  const [syncManager, setSyncManager] = useState<SyncManager | null>(null);
  const lastNetworkStateRef = useRef<boolean | null>(null);
  // The reconnect-triggered refetch that is scheduled or running, if any.
  const reconnectRefetchRef = useRef<{
    timer: ReturnType<typeof setTimeout> | null;
    inFlight: boolean;
  }>({ timer: null, inFlight: false });
  const loadRunRef = useRef(0);
  const isMountedRef = useRef(true);
  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);
  const meetDetailsRef = useRef<Meet | null>(null);
  useEffect(() => {
    meetDetailsRef.current = meetDetails;
  }, [meetDetails]);

  // `rosterAfterFirstScreen`: the meet the app opens on. Its roster (~0.5 MB
  // to fetch, parse and store) waits until the first screen has drawn, so it
  // does not compete with it; the schedule warms at once. Once the first
  // screen is up the wait is over, so a later automatic switch (the meet
  // ended) is not held back. A meet the user picks is never deferred.
  const beginMeetWarmup = useCallback(
    (meet: MeetName, label: string, rosterAfterFirstScreen = false) => {
      const options = rosterAfterFirstScreen
        ? { rosterAfter: startupTiming.whenFirstScreen() }
        : undefined;
      warmMeetData(meet, options).catch((error) => {
        console.error(`Error ${label}:`, error);
      });
    },
    [],
  );

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
    beginMeetWarmup(meet, 'initializing meet data', true);
  }, [activateMeet, beginMeetWarmup]);

  const applyLaunchDecision = useCallback(
    async (decision: LaunchDecision, isStale: () => boolean): Promise<boolean> => {
      if (decision.clearStored) {
        await AsyncStorage.multiRemove([SELECTED_MEET_KEY, SELECTED_MEET_DETAILS_KEY]);
        if (isStale()) return false;
      }
      if (decision.select) {
        await initializeMeetData(decision.select.name, decision.select);
        if (isStale()) return false;
      }
      if (decision.persistDetails) {
        await AsyncStorage.setItem(SELECTED_MEET_DETAILS_KEY, JSON.stringify(decision.persistDetails));
        if (isStale()) return false;
      }
      return true;
    },
    [initializeMeetData],
  );

  const loadMeets = useCallback(async () => {
    const runId = ++loadRunRef.current;
    const isStale = () => !isMountedRef.current || loadRunRef.current !== runId;
    let swept = false;
    const sweepExpiredOnce = () => {
      if (swept) return;
      swept = true;
      void awaitServerClock()
        .then(() => clearExpiredDownloadedMeets())
        .catch((error) => {
          console.error('Error clearing expired downloaded meets:', error);
        });
    };
    const isLaunchRun = runId === 1 && !selectedMeet;

    try {
      const [cachedMeets, stored, storedDetailsRaw] = await Promise.all([
        getCachedMeets(),
        AsyncStorage.getItem(SELECTED_MEET_KEY).then((name) => {
          if (isLaunchRun && name) primeScheduleCache(name);
          return name;
        }),
        AsyncStorage.getItem(SELECTED_MEET_DETAILS_KEY),
      ]);
      if (isStale()) return;

      const fromCache = decideFromCachedList({ cachedMeets, stored, selectedMeet, now: launchNow() });
      let activeMeet = fromCache.activeMeet;
      let choseFromCache = fromCache.select !== null;
      let keepsStoredMeet = false;
      if (isLaunchRun) {
        startupTiming.setFlags({
          meetsCacheHit: fromCache.paintCachedList,
          neededMeetLookup: fromCache.lookUpStoredMeet,
        });
      }
      if (fromCache.paintCachedList) {
        setAvailableMeets(cachedMeets);
        if (!(await applyLaunchDecision(fromCache, isStale))) return;
        if (fromCache.resolving) setIsResolvingStoredMeet(true);
        setIsLoading(false);
        if (isLaunchRun && !fromCache.lookUpStoredMeet) startupTiming.mark('meetsPaintedFromCache');
      }

      if (fromCache.lookUpStoredMeet && stored) {
        let found: Meet | null = null;
        let lookupFailed = false;
        try {
          found = await lookUpMeetForLaunch(stored);
        } catch {
          lookupFailed = true;
          found = parseStoredMeetNamed(storedDetailsRaw, stored);
        }
        if (isStale()) return;
        const afterLookup = decideAfterStoredMeetLookup({
          stored,
          found,
          lookupFailed,
          cachedMeets,
          now: launchNow(),
        });
        if (!(await applyLaunchDecision(afterLookup, isStale))) return;
        keepsStoredMeet = afterLookup.keepsStoredMeet;
        if (afterLookup.select) activeMeet = afterLookup.select.name;
        choseFromCache = !keepsStoredMeet && afterLookup.select !== null;
        setIsResolvingStoredMeet(false);
      }

      let freshMeets: Meet[];
      try {
        freshMeets = await fetchMeetsFresh();
      } finally {
        sweepExpiredOnce();
      }
      if (isStale()) return;
      setAvailableMeets((current) => {
        const currentSerialized = JSON.stringify(current);
        const nextSerialized = JSON.stringify(freshMeets);
        return currentSerialized === nextSerialized ? current : freshMeets;
      });

      const afterFreshList = decideAfterFreshList({
        freshMeets,
        activeMeet,
        selectedMeet,
        shownMeetName: meetDetailsRef.current?.name ?? null,
        keepsStoredMeet,
        choseFromCache,
        stored,
        storedDetailsRaw,
        now: launchNow(),
      });
      if (afterFreshList.kind === 'noMeets') {
        devLog('No meets available');
        setIsLoading(false);
        return;
      }
      if (afterFreshList.kind === 'keepSelection') return;
      if (afterFreshList.kind === 'lookUpActiveMeet') {
        let found: Meet | null;
        try {
          found = await lookUpMeetForLaunch(afterFreshList.meet);
        } catch {
          return;
        }
        if (isStale()) return;
        const afterLookup = decideAfterActiveMeetLookup({
          found,
          selectedMeet,
          freshMeets,
          now: launchNow(),
        });
        if (afterLookup.clearStored) {
          devLog('Selected meet no longer available, switching to first available meet');
        }
        await applyLaunchDecision(afterLookup, isStale);
        return;
      }
      if (afterFreshList.refreshShownDetails) {
        setMeetDetails((current) => refreshedMeetDetails(current, freshMeets) ?? current);
      }
      await applyLaunchDecision(afterFreshList, isStale);
    } catch (error) {
      sweepExpiredOnce();
      console.error('Error loading available meets:', error);
    } finally {
      if (!isStale()) {
        setIsLoading(false);
        setIsResolvingStoredMeet(false);
      }
    }
  }, [applyLaunchDecision, selectedMeet]);

    // Initial load
  useEffect(() => {
    void loadMeets();

    const refreshInterval = setInterval(
      () => void loadMeets(),
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
        void loadMeets().finally(() => {
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
      // A full package and roster-wide history pass only for a meet the user
      // downloaded; any other meet re-syncs what opening it fetches. The full
      // ingest on a browsed meet is the memory-heavy path `warmMeetData`
      // keeps off, and it left the meet counted as browse cache anyway.
      if (await isMeetExplicitlyDownloaded(selectedMeet)) {
        await prefetchMeetData(selectedMeet);
      } else {
        await prefetchCriticalMeetData(selectedMeet);
      }
    } catch (error) {
      console.error('Error forcing sync:', error);
      // Rethrown: "Clear Cache" reported success after a failed re-download.
      throw error;
    }
  }, [syncManager, selectedMeet]);

  // Refresh available meets function. Always goes to the network: the
  // profile screen's "clear cached meet data" has just emptied the cache this
  // would otherwise read. Rejects on failure so that caller can tell a
  // refreshed list from an empty one; the meet picker catches it.
  const refreshAvailableMeets = useCallback(async () => {
    try {
      // The list first, so the sweep reads current end dates.
      let fresh: Meet[];
      try {
        fresh = await fetchMeetsFresh();
      } finally {
        // The sweep skips without a server clock sample, which the request
        // above no longer waits for.
        await awaitServerClock()
          .then(() => clearExpiredDownloadedMeets())
          .catch((error) => {
            console.error('Error clearing expired downloaded meets:', error);
          });
      }
      setAvailableMeets((current) =>
        JSON.stringify(current) === JSON.stringify(fresh) ? current : fresh,
      );
    } catch (error) {
      console.error('Error refreshing available meets:', error);
      throw error;
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
      isResolvingStoredMeet,
      forceSync,
      refreshAvailableMeets,
    }),
    [
      selectedMeet,
      meetDetails,
      availableMeets,
      setSelectedMeet,
      isLoading,
      isResolvingStoredMeet,
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
