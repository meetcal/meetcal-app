import { useSelectedMeet } from "@/contexts/SelectedMeetContext";
import { downloadAdaptiveRecordsForOffline } from "@/lib/database/fetch-adaptive-records";
import { downloadQualifyingTotalsForOffline } from "@/lib/database/fetch-qualifying-totals";
import { downloadRecordsForOffline } from "@/lib/database/fetch-records";
import { downloadStandardsForOffline } from "@/lib/database/fetch-standards";
import { downloadWSORecordsForOffline } from "@/lib/database/fetch-wso-records";
import { downloadIntlRankingsForOffline } from "@/lib/database/fetchIntlRankings";
import {
  describeOfflineRefresh,
  refreshOfflineDownloads,
} from "@/lib/database/offline-refresh";
import {
  clearBrowseCaches,
  clearOfflineCache,
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
} from "@/lib/database/offline-cache";
import {
  clearAllAthleteHistory,
  clearAllMeetData,
  getExplicitlyDownloadedMeetIds,
  getLastSyncTime,
  markMeetExplicitlyDownloaded,
} from "@/lib/database/offline-store";
import {
  getAnywhereOnEarthDate,
  toMeetCalendarDate,
} from "@/utils/dateTime";
import {
  claimOfflineBulk,
  claimOfflineItem,
  getOfflineActivity,
  releaseOfflineBulk,
  releaseOfflineItem,
  subscribeOfflineActivity,
  type OfflineBulkAction,
} from "@/lib/database/offline-activity";
import { formatDistanceToNow } from "date-fns";
import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
} from "react";
import { Alert } from "react-native";

export type DownloadStatus = {
  isDownloaded: boolean;
  lastSynced: number | null;
};

/**
 * Whether the stored statuses have been read. Until they are, a row cannot
 * say whether its item is downloaded: every row used to read "Not downloaded
 * yet" meanwhile (or for good, when the read failed), so a tap re-downloaded
 * a downloaded item instead of offering Remove, and Refresh All found nothing.
 */
export type DownloadStatusesLoad = "loading" | "loaded" | "failed";

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

/** A row's subtitle: its last sync, or why its status is not known yet. */
export function describeDownloadStatus(
  load: DownloadStatusesLoad,
  status: DownloadStatus | undefined,
): string {
  if (load === "failed") return "Couldn't read offline data";
  // No entry yet: a row the meets list added after the last read.
  if (load === "loading" || !status) return "Checking…";
  if (!status.lastSynced) return "Not downloaded yet";
  return `Last synced ${formatDistanceToNow(new Date(status.lastSynced), { addSuffix: true })}`;
}

/**
 * Whether a row can act (download or remove). Not until its status has been
 * read: a meet the meets list adds after a read has no entry until the next
 * one lands, and its tap would download a meet that may be downloaded.
 */
export function isRowStatusKnown(
  load: DownloadStatusesLoad,
  status: DownloadStatus | undefined,
): boolean {
  return load === "loaded" && status !== undefined;
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
  const { availableMeets, isLoading: isMeetLoading } = useSelectedMeet();
  const availableMeetNames = useMemo(
    () => availableMeets.map((meet) => meet.name),
    [availableMeets],
  );
  const [downloadStatuses, setDownloadStatuses] = useState<
    Record<string, DownloadStatus>
  >({});
  const [statusesLoad, setStatusesLoad] =
    useState<DownloadStatusesLoad>("loading");
  // Busy flags live in `offline-activity`, not in this hook: they are read
  // synchronously (an alert's button holds the closure of the render that
  // opened it, so render-time state still said "not busy"), and they outlive
  // this mount (an action keeps running after the user swipes back, and a
  // reopened screen must still see it).
  const activity = useSyncExternalStore(
    subscribeOfflineActivity,
    getOfflineActivity,
  );
  const downloadingItems = activity.items;
  const isRefreshingAll = activity.bulk === "refresh";
  const isDeletingAll = activity.bulk === "delete";

  const filteredMeets = useMemo(
    () =>
      selectDownloadableMeets(
        availableMeets,
        // Anchored in the last zone a day ends in (UTC-12), so a meet stays
        // offered until it has finished everywhere on Earth, whatever its zone.
        getAnywhereOnEarthDate(),
      ),
    [availableMeets],
  );

  const formatLastSynced = useCallback(
    (status: DownloadStatus | undefined) => describeDownloadStatus(statusesLoad, status),
    [statusesLoad],
  );
  const isRowReady = useCallback(
    (status: DownloadStatus | undefined) => isRowStatusKnown(statusesLoad, status),
    [statusesLoad],
  );

  const competitionItems: Omit<DownloadItem, "status" | "isDownloading">[] =
    useMemo(
      () => [
        {
          id: "standards",
          title: "A/B Standards",
          onDownload: async () => {
            await downloadStandardsForOffline();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.standards);
          },
        },
        {
          id: "adaptiveRecords",
          title: "Adaptive Records",
          onDownload: async () => {
            await downloadAdaptiveRecordsForOffline();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords);
          },
        },
        {
          id: "records",
          title: "National & World Records",
          onDownload: async () => {
            await downloadRecordsForOffline();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.records);
          },
        },
        {
          id: "intlRankings",
          title: "International Rankings",
          onDownload: async () => {
            await downloadIntlRankingsForOffline();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.intlRankings);
          },
        },
        {
          id: "qualifyingTotals",
          title: "Qualifying Totals",
          onDownload: async () => {
            await downloadQualifyingTotalsForOffline();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals);
          },
        },
        {
          id: "wsoRecords",
          title: "WSO Records",
          onDownload: async () => {
            await downloadWSORecordsForOffline();
          },
          onDelete: async () => {
            await clearOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords);
          },
        },
      ],
      []
    );
    
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
            setStatusesLoad("loaded");
          })
          .catch((error) => {
            console.error("Failed to load offline download statuses:", error);
            if (cancelled) return;
            setStatusesLoad("failed");
          });
        return () => {
          cancelled = true;
        };
        // Re-read whenever an action ends (`activity.settled`), including one
        // an earlier mount of this screen started: it may have changed storage.
      }, [loadStatuses, activity.settled]);
    
      const handleDownload = async (id: string, action: () => Promise<void>) => {
        if (!claimOfflineItem(id)) return;
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
        } catch (error) {
          console.error("Download failed:", error);
          Alert.alert(
            "Download Failed",
            "Please check your connection and try again.",
          );
        } finally {
          releaseOfflineItem(id);
        }
      };
    
      const handleDelete = async (
        title: string,
        id: string,
        action: () => Promise<void>,
      ) => {
        const busy = getOfflineActivity();
        if (busy.bulk || busy.items.has(id)) return;
        Alert.alert("Remove Download", `Remove ${title} from this device?`, [
          { text: "Cancel", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: async () => {
              // Re-checked: a bulk action may have started while this
              // confirmation was open.
              if (!claimOfflineItem(id)) return;
              try {
                await action();
              } catch (error) {
                console.error("Delete failed:", error);
                Alert.alert("Remove Failed", "Please try again.");
              } finally {
                releaseOfflineItem(id);
              }
            },
          },
        ]);
      };
    
      /** Claims every row for a bulk action, or says why it can't. */
      const claimBulkAction = (action: OfflineBulkAction): boolean => {
        const claim = claimOfflineBulk(action);
        if (claim === "items-running") {
          Alert.alert(
            "Download in Progress",
            "Wait for the current download or removal to finish, then try again.",
          );
        }
        return claim === "claimed";
      };

      const refreshAllDownloadedData = async () => {
        if (!claimBulkAction("refresh")) return;

        try {
          // Read now, not from the render that opened the confirmation: the
          // statuses may have landed (or changed) since.
          const statuses = await loadStatuses();
          // Download-then-swap (see `refreshOfflineDownloads`): nothing is
          // deleted, so a failed item keeps its previous copy.
          const result = await refreshOfflineDownloads(
            competitionItems
              .filter((item) => statuses[item.id]?.isDownloaded)
              .map((item) => ({
                id: item.id,
                title: item.title,
                download: item.onDownload,
              })),
            availableMeets
              .filter(
                (meet) =>
                  statuses[getMeetDownloadId(meet.name)]?.isDownloaded,
              )
              .map((meet) => ({ name: meet.name, endDate: meet.dates?.end })),
          );
          const { title, message } = describeOfflineRefresh(result);
          Alert.alert(title, message);
        } catch (error) {
          console.error("Refresh all failed:", error);
          Alert.alert(
            "Refresh Failed",
            "Please check your connection and try again. Your downloaded data has been kept.",
          );
        } finally {
          releaseOfflineBulk("refresh");
        }
      };
    
      const deleteAllOfflineData = async () => {
        if (!claimBulkAction("delete")) return;
        try {
          await Promise.all([
            clearOfflineCache(OFFLINE_CACHE_KEYS.standards),
            clearOfflineCache(OFFLINE_CACHE_KEYS.qualifyingTotals),
            clearOfflineCache(OFFLINE_CACHE_KEYS.intlRankings),
            clearOfflineCache(OFFLINE_CACHE_KEYS.records),
            clearOfflineCache(OFFLINE_CACHE_KEYS.wsoRecords),
            clearOfflineCache(OFFLINE_CACHE_KEYS.adaptiveRecords),
            // Rankings, club and filtered-record views cached while browsing.
            clearBrowseCaches(),
          ]);
    
          // Every meet with data on the device or marked downloaded, not only
          // the ones in today's window, through the same clear-all as Clear
          // Cache (one shared key listing, no per-meet history prune: all
          // history goes right after).
          const { failed } = await clearAllMeetData();
          await clearAllAthleteHistory();
          if (failed > 0) {
            throw new Error(`Could not clear ${failed} offline meet(s)`);
          }

          Alert.alert(
            "Deleted",
            "All offline data has been removed from your device.",
          );
        } catch (error) {
          console.error("Delete all failed:", error);
          Alert.alert("Delete Failed", "Please try again.");
        } finally {
          releaseOfflineBulk("delete");
        }
      };
    
      const confirmRefreshAll = () => {
        if (isRefreshingAll || isDeletingAll || statusesLoad !== "loaded") return;
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
          onPress: () => deleteAllOfflineData(),
        },
      ]
    );
  };

  return {
    isMeetLoading,
    filteredMeets,
    downloadingItems,
    downloadStatuses,
    statusesLoad,
    isRefreshingAll,
    isDeletingAll,
    competitionItems,
    formatLastSynced,
    isRowReady,
    handleDownload,
    handleDelete,
    confirmRefreshAll,
    confirmDeleteAll,
  };
};
