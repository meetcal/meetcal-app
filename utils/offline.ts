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
import {
  clearOfflineCache,
  getOfflineCache,
  OFFLINE_CACHE_KEYS,
} from "@/lib/database/offline-cache";
import {
  clearMeetData,
  getLastSyncTime,
  isMeetExplicitlyDownloaded,
  markMeetExplicitlyDownloaded,
} from "@/lib/database/offline-store";
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

  const filteredMeets = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const endDate = new Date(startOfToday);
    endDate.setDate(endDate.getDate() + 21);

    return availableMeets.filter((meet) => {
      const startDateValue = meet?.dates?.start;
      if (!startDateValue) return false;
      const parsed = new Date(`${startDateValue}T00:00:00`);
      if (Number.isNaN(parsed.getTime())) return false;
      return parsed >= startOfToday && parsed <= endDate;
    });
  }, [availableMeets]);

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
    
        await Promise.all(
          availableMeets.map(async (meet) => {
            const explicitlyDownloaded = await isMeetExplicitlyDownloaded(
              meet.name,
            );
            const lastSynced = explicitlyDownloaded
              ? await getLastSyncTime(meet.name)
              : null;
            nextStatuses[getMeetDownloadId(meet.name)] = {
              isDownloaded: explicitlyDownloaded,
              lastSynced: lastSynced ?? null,
            };
          }),
        );
    
        setDownloadStatuses(nextStatuses);
      }, [availableMeets]);
    
      useEffect(() => {
        loadStatuses();
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
          const downloadedMeetNames = availableMeets
            .filter(
              (meet) =>
                downloadStatuses[getMeetDownloadId(meet.name)]?.isDownloaded,
            )
            .map((meet) => meet.name);
    
          const downloadedCompetitionItems = competitionItems.filter(
            (item) => downloadStatuses[item.id]?.isDownloaded,
          );
    
          await deleteAllOfflineData(false, true);
    
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
    
      const deleteAllOfflineData = async (showSuccessAlert: boolean, skipSettingIsDeletingAll = false) => {
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
    
          for (const meet of availableMeets) {
            await clearMeetData(meet.name);
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
