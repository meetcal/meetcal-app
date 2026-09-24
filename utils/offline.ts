import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { useSubscription } from "@/contexts/SubscriptionContext";
import { fetchAdaptiveRecords } from "@/lib/database/fetch-adaptive-records";
import { fetchQualifyingTotals } from "@/lib/database/fetch-qualifying-totals";
import { fetchFederations, fetchRecords } from "@/lib/database/fetch-records";
import { fetchStandards } from "@/lib/database/fetch-standards";
import {
  fetchWSOList,
  fetchWSORecords,
} from "@/lib/database/fetch-wso-records";
import { fetchIntlRankings } from "@/lib/database/fetchIntlRankings";
import { prefetchMeetData } from "@/lib/database/meet-manager";
import { isNetworkAvailable } from "@/lib/networkUtils";
import {
  clearOfflineCache,
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
} from "@/lib/database/offline-cache";
import {
  clearAllAthleteHistory,
  clearMeetData,
  getExplicitlyDownloadedMeetIds,
  getLastSyncTime,
  markMeetExplicitlyDownloaded,
  readStorageKeysForMeetClear,
} from "@/lib/database/offline-store";
import {
  getCalendarDateInTimeZone,
  toMeetCalendarDate,
} from "@/utils/dateTime";
import { formatDistanceToNow } from "date-fns";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Alert } from "react-native";

type DownloadStatus = {
  isDownloaded: boolean;
  lastSynced: number | null;
};

type DownloadItem = {
  id: string;
  title: string;
  onDownload: () => Promise<void>;
  onDelete: () => Promise<void>;
  status: DownloadStatus | undefined;
  isDownloading: boolean;
};

/**
 * How far ahead a meet may start and still be offered for offline download.
 */
const DOWNLOADABLE_MEET_WINDOW_DAYS = 21;

/**
 * The timezone the download window is anchored in. Meet dates are calendar
 * dates with no zone of their own, and Pacific is the latest US zone, so a
 * meet stays offered until it has finished everywhere in the country.
 */
const DOWNLOAD_WINDOW_TIME_ZONE = "America/Los_Angeles";

/** `YYYY-MM-DD`, `days` after `from`. */
function shiftCalendarDate(from: string, days: number): string {
  const [year, month, day] = from.split("-").map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  return shifted.toISOString().split("T")[0];
}

/**
 * The meets the offline screen offers: starting within the next
 * `DOWNLOADABLE_MEET_WINDOW_DAYS`, or already under way.
 *
 * Compared as `YYYY-MM-DD` strings. `new Date(`${startDate}T00:00:00`)` parses
 * a meet calendar date in the *device* timezone, which is not the meet's, and
 * is the pattern the recurring-lessons list calls out.
 */
export function selectDownloadableMeets<
  T extends { dates?: { start?: string; end?: string } | null },
>(meets: T[], today: string): T[] {
  const windowEnd = shiftCalendarDate(today, DOWNLOADABLE_MEET_WINDOW_DAYS);

  return meets.filter((meet) => {
    const start = toMeetCalendarDate(meet?.dates?.start);
    if (!start) return false;
    const end = toMeetCalendarDate(meet?.dates?.end);
    if (!end) return false;

    const isUpcoming = start >= today && start <= windowEnd;
    // Without the end-date check a multi-day meet that began before today
    // would be filtered out even though it is happening right now.
    const isOngoing = start < today && end >= today;
    return isUpcoming || isOngoing;
  });
}

const getMeetDownloadId = (meetName: string) => `meet:${meetName}`;

const getMeetNameFromDownloadId = (
  id: string,
  meetNames: string[],
): string | null => {
  if (!id.startsWith("meet:")) return null;
  const meetName = id.slice("meet:".length);
  return meetNames.includes(meetName) ? meetName : null;
};

export const useOfflineData = () => {
  const { isSubscribed, isLoading: isSubscriptionLoading } = useSubscription();
  const { availableMeets, isLoading: isMeetLoading } = useSelectedMeet();
  const availableMeetNames = useMemo(
    () => availableMeets.map((meet) => meet.name),
    [availableMeets],
  );
  const [downloadingItems, setDownloadingItems] = useState<Set<string>>(
    new Set()
  );
  const [downloadStatuses, setDownloadStatuses] = useState<
    Record<string, DownloadStatus>
  >({});
  const [refreshCounter, setRefreshCounter] = useState(0);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isDeletingAll, setIsDeletingAll] = useState(false);

  const filteredMeets = useMemo(
    () =>
      selectDownloadableMeets(
        availableMeets,
        getCalendarDateInTimeZone(DOWNLOAD_WINDOW_TIME_ZONE),
      ),
    [availableMeets],
  );

  const formatLastSynced = useCallback(
    (lastSynced: number | null | undefined) => {
      if (!lastSynced) return "Not downloaded yet";
      return `Last synced ${formatDistanceToNow(new Date(lastSynced), { addSuffix: true })}`;
    },
    []
  );

  const competitionItems: Omit<DownloadItem, "status" | "isDownloading">[] =
    useMemo(
      () => [
        {
          id: "standards",
          title: "A/B Standards",
          onDownload: async () => {
            await fetchStandards();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.standards);
          },
        },
        {
          id: "adaptiveRecords",
          title: "Adaptive Records",
          onDownload: async () => {
            await fetchAdaptiveRecords();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords);
          },
        },
        {
          id: "records",
          title: "National & World Records",
          onDownload: async () => {
            const federations = await fetchFederations();
            for (const federation of federations) {
              await fetchRecords(federation);
            }
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.records);
          },
        },
        {
          id: "intlRankings",
          title: "International Rankings",
          onDownload: async () => {
            await fetchIntlRankings();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.intlRankings);
          },
        },
        {
          id: "qualifyingTotals",
          title: "Qualifying Totals",
          onDownload: async () => {
            await fetchQualifyingTotals();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals);
          },
        },
        {
          id: "wsoRecords",
          title: "WSO Records",
          onDownload: async () => {
            const wsos = await fetchWSOList();
            for (const wso of wsos) {
              await fetchWSORecords(wso);
            }
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords);
          },
        },
      ],
      []
    );
    
    const updateDownloading = useCallback((id: string, downloading: boolean) => {
        setDownloadingItems((prev) => {
          const next = new Set(prev);
          if (downloading) {
            next.add(id);
          } else {
            next.delete(id);
          }
          return next;
        });
      }, []);
    
      const loadStatuses = useCallback(async () => {
        const nextStatuses: Record<string, DownloadStatus> = {};
    
        const [
          standardsCache,
          totalsCache,
          rankingsCache,
          recordsCache,
          wsoCache,
          adaptiveCache,
        ] = await Promise.all([
          getOfflineCache(OFFLINE_CACHE_KEYS.standards),
          getOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals),
          getOfflineCache(OFFLINE_CACHE_KEYS.intlRankings),
          getOfflineCache(OFFLINE_CACHE_KEYS.records),
          getOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords),
          getOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords),
        ]);

        nextStatuses.standards = {
          isDownloaded: Boolean(standardsCache?.data),
          lastSynced: standardsCache?.lastSynced ?? null,
        };
        nextStatuses.qualifyingTotals = {
          isDownloaded: Boolean(totalsCache?.data),
          lastSynced: totalsCache?.lastSynced ?? null,
        };
        nextStatuses.intlRankings = {
          isDownloaded: Boolean(rankingsCache?.data),
          lastSynced: rankingsCache?.lastSynced ?? null,
        };
        nextStatuses.records = {
          isDownloaded: Boolean(recordsCache?.data),
          lastSynced: recordsCache?.lastSynced ?? null,
        };
        nextStatuses.wsoRecords = {
          isDownloaded: Boolean(wsoCache?.data),
          lastSynced: wsoCache?.lastSynced ?? null,
        };
        nextStatuses.adaptiveRecords = {
          isDownloaded: Boolean(adaptiveCache?.data),
          lastSynced: adaptiveCache?.lastSynced ?? null,
        };
    
        // One read of the downloads blob instead of a `Promise.all` fan-out
        // that re-read and re-parsed the same AsyncStorage value once per meet.
        const downloadedMeetIds = await getExplicitlyDownloadedMeetIds();
        for (const meet of availableMeets) {
          const explicitlyDownloaded = downloadedMeetIds.has(meet.name);
          const lastSynced = explicitlyDownloaded
            ? await getLastSyncTime(meet.name)
            : null;
          nextStatuses[getMeetDownloadId(meet.name)] = {
            isDownloaded: explicitlyDownloaded,
            lastSynced: lastSynced ?? null,
          };
        }
    
        return nextStatuses;
      }, [availableMeets]);
    
      useEffect(() => {
        let cancelled = false;
        loadStatuses()
          .then((nextStatuses) => {
            if (cancelled) return;
            setDownloadStatuses(nextStatuses);
          })
          .catch((error) => {
            console.error("Failed to load offline download statuses:", error);
          });
        return () => {
          cancelled = true;
        };
      }, [loadStatuses, refreshCounter]);
    
      const handleDownload = async (id: string, action: () => Promise<void>) => {
        updateDownloading(id, true);
        try {
          await action();
          const meetName = getMeetNameFromDownloadId(
            id,
            availableMeetNames,
          );
          if (meetName) {
            const meetDetails = availableMeets.find((meet) => meet.name === meetName);
            await markMeetExplicitlyDownloaded(meetName, true, {
              endDate: meetDetails?.dates?.end,
            });
          }
          setRefreshCounter((count) => count + 1);
        } catch (error) {
          console.error("Download failed:", error);
          Alert.alert(
            "Download Failed",
            "Please check your connection and try again.",
          );
        } finally {
          updateDownloading(id, false);
        }
      };
    
      const handleDelete = async (
        title: string,
        id: string,
        action: () => Promise<void>,
      ) => {
        Alert.alert("Remove Download", `Remove ${title} from this device?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              updateDownloading(id, true);
              try {
                await action();
                setRefreshCounter((count) => count + 1);
              } catch (error) {
                console.error("Delete failed:", error);
                Alert.alert("Remove Failed", "Please try again.");
              } finally {
                updateDownloading(id, false);
              }
            },
          },
        ]);
      };
    
      const refreshAllDownloadedData = async () => {
        if (isRefreshingAll || isDeletingAll) return;
        setIsRefreshingAll(true);
    
        try {
          // Refresh deletes before it re-downloads. Offline the re-download
          // cannot happen, so starting would only wipe what the user saved.
          if (!(await isNetworkAvailable())) {
            Alert.alert(
              "You're Offline",
              "Connect to the internet to refresh. Your downloaded data has been kept.",
            );
            return;
          }

          const downloadedMeetNames = availableMeets
            .filter(
              (meet) =>
                downloadStatuses[getMeetDownloadId(meet.name)]?.isDownloaded,
            )
            .map((meet) => meet.name);
    
          const downloadedCompetitionItems = competitionItems.filter(
            (item) => downloadStatuses[item.id]?.isDownloaded,
          );
    
          await deleteAllOfflineData(false, true, true);
    
          for (const item of downloadedCompetitionItems) {
            await item.onDownload();
          }
    
          for (const meetName of downloadedMeetNames) {
            await prefetchMeetData(meetName);
            const meetDetails = availableMeets.find((meet) => meet.name === meetName);
            await markMeetExplicitlyDownloaded(meetName, true, {
              endDate: meetDetails?.dates?.end,
            });
          }
    
          setRefreshCounter((count) => count + 1);
          Alert.alert(
            "Refresh Complete",
            "All downloaded data has been refreshed.",
          );
        } catch (error) {
          console.error("Refresh all failed:", error);
          Alert.alert(
            "Refresh Failed",
            "Please check your connection and try again.",
          );
        } finally {
          setIsRefreshingAll(false);
        }
      };
    
      const deleteAllOfflineData = async (showSuccessAlert: boolean, skipSettingIsDeletingAll = false, keepAthleteHistory = false) => {
        if (!skipSettingIsDeletingAll && isDeletingAll) return;
        if (!skipSettingIsDeletingAll) setIsDeletingAll(true);
        try {
          await Promise.all([
            clearOfflineCache(OFFLINE_CACHE_KEYS.standards),
            clearOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals),
            clearOfflineCache(OFFLINE_CACHE_KEYS.intlRankings),
            clearOfflineCache(OFFLINE_CACHE_KEYS.records),
            clearOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords),
            clearOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords),
          ]);
    
          // One key listing shared by every meet. Each `clearMeetData` has to
          // scan all storage keys for that meet's session-athlete entries, and
          // at this point the athlete-history keys — 1500 to 4500 of them for a
          // downloaded meet — have not been removed yet, so the listing is at
          // its largest exactly while it was being repeated once per meet.
          const storageKeys = await readStorageKeysForMeetClear(
            availableMeets.length,
          );
          for (const meet of availableMeets) {
            await clearMeetData(meet.name, { storageKeys });
          }
          if (!keepAthleteHistory) {
            await clearAllAthleteHistory();
          }
    
          setRefreshCounter((count) => count + 1);
          if (showSuccessAlert) {
            Alert.alert(
              "Deleted",
              "All offline data has been removed from your device.",
            );
          }
        } catch (error) {
          console.error("Delete all failed:", error);
          Alert.alert("Delete Failed", "Please try again.");
        } finally {
          if (!skipSettingIsDeletingAll) setIsDeletingAll(false);
        }
      };
    
      const confirmRefreshAll = () => {
        if (isRefreshingAll || isDeletingAll) return;
        Alert.alert(
          "Refresh All Downloads",
          "This will re-download everything you already saved for offline use.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Refresh All", onPress: refreshAllDownloadedData },
          ],
        );
      };
    
  const confirmDeleteAll = () => {
    if (isRefreshingAll || isDeletingAll) return;
    Alert.alert(
      "Delete All Offline Data",
      "This will remove all offline data from your device.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Delete All",
          style: "destructive",
          onPress: () => deleteAllOfflineData(true),
        },
      ]
    );
  };

  return {
    isSubscribed,
    isSubscriptionLoading,
    isMeetLoading,
    filteredMeets,
    downloadingItems,
    downloadStatuses,
    isRefreshingAll,
    isDeletingAll,
    competitionItems,
    formatLastSynced,
    handleDownload,
    handleDelete,
    confirmRefreshAll,
    confirmDeleteAll,
  };
};
