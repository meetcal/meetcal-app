/**
 * Daily cron job: marks meets as 'completed' when their end date has passed.
 * Ports the Supabase edge function `update-meet-status.ts`.
 *
 * Scheduled in convex/crons.ts.
 */

import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    // 1. Run the DB mutation — returns list of updated meets
    const updatedMeets: Array<{ id: string; name: string; endDate: string }> =
      await ctx.runMutation(internal.meets.markCompletedMeets, {});

    const updatedCount = updatedMeets.length;

    // 2. Send Slack notification (mirrors the Supabase edge function behaviour)
    const slackWebhookUrl = process.env.SLACK_WEBHOOK_URL;
    if (slackWebhookUrl) {
      const currentTime = new Date().toLocaleString("en-US", {
        timeZone: "America/New_York",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: true,
      });

      const meetList = updatedMeets
        .map((m) => `• ${m.name} (ended ${m.endDate})`)
        .join("\n");

      const text =
        updatedCount === 0
          ? `*Meet Status Update*\n\nNo meets to update at ${currentTime}`
          : `*Meet Status Update*\n\n${updatedCount} Meet${updatedCount !== 1 ? "s" : ""} Status Updated to Completed at ${currentTime}\n\n${meetList}`;

      try {
        await fetch(slackWebhookUrl, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text }),
        });
      } catch (err) {
        console.error("Failed to send Slack notification:", err);
      }
    }

    return { updatedCount, updatedMeets };
  },
});
