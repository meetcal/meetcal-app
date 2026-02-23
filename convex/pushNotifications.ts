/**
 * Push notification support via OneSignal REST API.
 * Targets users by external_id (Clerk userId).
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const ONESIGNAL_APP_ID = "184c93ff-546a-4db8-945c-203091782fc9";
const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";
const BATCH_SIZE = 2000;

export const sendMarketingPush = internalAction({
  args: {
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, { title, body, data }) => {
    const userIds: string[] = await ctx.runQuery(
      internal.notificationPreferences.getAllEnabledUserIds,
      {}
    );

    if (userIds.length === 0) {
      return {
        success: true,
        summary: { totalUserIds: 0, totalSent: 0, totalErrors: 0, batchesProcessed: 0 },
        results: [],
        message: "No eligible users with push notifications enabled.",
      };
    }

    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    if (!apiKey) {
      return {
        success: false,
        summary: { totalUserIds: userIds.length, totalSent: 0, totalErrors: userIds.length, batchesProcessed: 0 },
        results: [],
        message: "ONESIGNAL_REST_API_KEY not configured.",
      };
    }

    const chunks: string[][] = [];
    for (let i = 0; i < userIds.length; i += BATCH_SIZE) {
      chunks.push(userIds.slice(i, i + BATCH_SIZE));
    }

    let totalSent = 0;
    let totalErrors = 0;
    const results: Array<{
      batch: number;
      success: boolean;
      userIdsSent: number;
      onesignalResponse?: unknown;
      error?: string;
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const payload = {
        app_id: ONESIGNAL_APP_ID,
        target_channel: "push",
        include_aliases: {
          external_id: chunk,
        },
        contents: { en: body },
        headings: { en: title },
        ...(data && { data }),
      };

      try {
        const res = await fetch(ONESIGNAL_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Key ${apiKey}`,
          },
          body: JSON.stringify(payload),
        });

        const onesignalResponse = await res.json();

        if (res.ok && onesignalResponse.id) {
          totalSent += chunk.length;
          results.push({
            batch: i + 1,
            success: true,
            userIdsSent: chunk.length,
            onesignalResponse,
          });
        } else {
          totalErrors += chunk.length;
          results.push({
            batch: i + 1,
            success: false,
            userIdsSent: 0,
            onesignalResponse,
            error: onesignalResponse.errors?.[0] || `HTTP ${res.status}`,
          });
        }
      } catch (err) {
        totalErrors += chunk.length;
        results.push({
          batch: i + 1,
          success: false,
          userIdsSent: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const allSucceeded = totalErrors === 0;
    return {
      success: allSucceeded,
      summary: {
        totalUserIds: userIds.length,
        totalSent,
        totalErrors,
        batchesProcessed: chunks.length,
      },
      results,
      message: allSucceeded
        ? `Successfully sent ${totalSent} notifications.`
        : `Sent ${totalSent}, failed ${totalErrors} out of ${userIds.length} notifications.`,
    };
  },
});
