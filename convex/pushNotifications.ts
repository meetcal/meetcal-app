/**
 * Push notification support.
 * Ports the Supabase edge function `send-marketing-push.ts`.
 *
 * - getAllEnabledTokens: internal query used by the HTTP action
 * - sendMarketingPush: internal action that fetches tokens and batches to Expo
 */

import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

const BATCH_SIZE = 100;
const EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send";

export const sendMarketingPush = internalAction({
  args: {
    title: v.string(),
    body: v.string(),
    data: v.optional(v.any()),
  },
  handler: async (ctx, { title, body, data }) => {
    // Fetch all enabled tokens via the internal query on notificationPreferences
    const tokens: string[] = await ctx.runQuery(
      internal.notificationPreferences.getAllEnabledTokens,
      {}
    );

    if (tokens.length === 0) {
      return {
        success: true,
        summary: { totalTokens: 0, totalSent: 0, totalErrors: 0, batchesProcessed: 0 },
        results: [],
        message: "No eligible users with push notifications enabled.",
      };
    }

    const expoAccessToken = process.env.EXPO_ACCESS_TOKEN;

    // Split into batches of 100
    const chunks: string[][] = [];
    for (let i = 0; i < tokens.length; i += BATCH_SIZE) {
      chunks.push(tokens.slice(i, i + BATCH_SIZE));
    }

    let totalSent = 0;
    let totalErrors = 0;
    const results: Array<{
      batch: number;
      success: boolean;
      tokensSent: number;
      expoResponse?: unknown;
      error?: string;
    }> = [];

    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      const messages = chunk.map((token) => ({
        to: token,
        sound: "default",
        title,
        body,
        data,
      }));

      try {
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
          Accept: "application/json",
        };
        if (expoAccessToken) {
          headers["Authorization"] = `Bearer ${expoAccessToken}`;
        }

        const res = await fetch(EXPO_PUSH_URL, {
          method: "POST",
          headers,
          body: JSON.stringify(messages),
        });

        const expoResponse = await res.json();

        if (res.ok) {
          totalSent += chunk.length;
          results.push({
            batch: i + 1,
            success: true,
            tokensSent: chunk.length,
            expoResponse,
          });
        } else {
          totalErrors += chunk.length;
          results.push({
            batch: i + 1,
            success: false,
            tokensSent: 0,
            expoResponse,
            error: `HTTP ${res.status}`,
          });
        }
      } catch (err) {
        totalErrors += chunk.length;
        results.push({
          batch: i + 1,
          success: false,
          tokensSent: 0,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      // Small delay between batches to avoid Expo rate limits
      if (i < chunks.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }

    const allSucceeded = totalErrors === 0;
    return {
      success: allSucceeded,
      summary: {
        totalTokens: tokens.length,
        totalSent,
        totalErrors,
        batchesProcessed: chunks.length,
      },
      results,
      message: allSucceeded
        ? `Successfully sent ${totalSent} notifications.`
        : `Sent ${totalSent}, failed ${totalErrors} out of ${tokens.length} notifications.`,
    };
  },
});
