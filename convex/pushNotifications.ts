/**
 * Push notification support via OneSignal REST API.
 * Targets users by external_id (Clerk userId).
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const ONESIGNAL_APP_ID = process.env.EXPO_PUBLIC_ONESIGNAL_APP_ID;
const ONESIGNAL_API_URL = "https://api.onesignal.com/notifications";
const BATCH_SIZE = 2000;
const FETCH_TIMEOUT_MS = 15000;

if (!ONESIGNAL_APP_ID) {
  throw new Error("EXPO_PUBLIC_ONESIGNAL_APP_ID environment variable is required for push notifications.");
}

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
      const externalId = `marketing-${i}-${chunk[0]}`;
      const payload = {
        app_id: ONESIGNAL_APP_ID,
        external_id: externalId,
        target_channel: "push",
        include_aliases: {
          external_id: chunk,
        },
        contents: { en: body },
        headings: { en: title },
        ...(data !== undefined ? { data } : {}),
      };

      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

        const res = await fetch(ONESIGNAL_API_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Key ${apiKey}`,
          },
          body: JSON.stringify(payload),
          signal: controller.signal,
        });

        clearTimeout(timeoutId);

        const rawBody = await res.text();
        let onesignalResponse: Record<string, unknown>;
        try {
          onesignalResponse = JSON.parse(rawBody) as Record<string, unknown>;
        } catch {
          onesignalResponse = { _raw: rawBody };
        }

        const normalizeError = (entry: unknown): string => {
          if (typeof entry === "string") return entry;
          if (entry && typeof entry === "object") {
            const obj = entry as Record<string, unknown>;
            const msg = (obj.title ?? obj.message ?? obj.detail) as string | undefined;
            if (typeof msg === "string") return msg;
          }
          return JSON.stringify(entry);
        };

        const errorEntries = Array.isArray(onesignalResponse.errors)
          ? onesignalResponse.errors
          : [];
        const errorStr =
          errorEntries.length > 0
            ? errorEntries.map(normalizeError).join("; ")
            : `HTTP ${res.status}${rawBody ? `: ${rawBody.slice(0, 200)}` : ""}`;

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
            error: errorStr,
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
