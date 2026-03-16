import { internal } from "./_generated/api";
import { internalAction } from "./_generated/server";

type AutoUnsaveJobResult = {
  skipped: boolean;
  reason?: string;
  processedUsers: number;
  removedSessions: number;
  earliestSavedDate?: string | null;
};

function getTodayUtcDateString(): string {
  return new Date().toISOString().split("T")[0];
}

export const run = internalAction({
  args: {},
  handler: async (ctx): Promise<AutoUnsaveJobResult> => {
    const enabledUsers: { userId: string }[] = await ctx.runQuery(
      internal.userPreferences.listUsersWithAutoUnsaveEnabled,
      {},
    );

    if (enabledUsers.length === 0) {
      return {
        skipped: true,
        reason: "no_enabled_users",
        processedUsers: 0,
        removedSessions: 0,
      };
    }

    const eligibleUserIds: string[] = enabledUsers.map((row) => row.userId);

    const earliestSavedDate: string | null = await ctx.runQuery(
      internal.savedSessions.getEarliestSavedSessionDateForUsers,
      { userIds: eligibleUserIds },
    );
    const today = getTodayUtcDateString();

    if (!earliestSavedDate) {
      return {
        skipped: true,
        reason: "no_dated_saved_sessions",
        processedUsers: 0,
        removedSessions: 0,
      };
    }

    if (earliestSavedDate > today) {
      return {
        skipped: true,
        reason: "all_saved_sessions_are_future_dated",
        processedUsers: 0,
        removedSessions: 0,
        earliestSavedDate,
      };
    }

    let removedSessions = 0;
    for (const userId of eligibleUserIds) {
      removedSessions += await ctx.runMutation(
        internal.savedSessions.removeExpiredSavedSessionsForUser,
        { userId, now: Date.now() },
      );
    }

    return {
      skipped: false,
      processedUsers: eligibleUserIds.length,
      removedSessions,
      earliestSavedDate,
    };
  },
});
