/**
 * HTTP router for Convex.
 * Exposes the marketing push notification endpoint.
 *
 * Ports the Supabase edge function `send-marketing-push.ts`.
 *
 * POST /send-marketing-push
 *   Headers: Authorization: Bearer <PUSH_NOTIFICATION_AUTH_KEY>
 *   Body:    { title: string, body: string, data?: object }
 */

import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";

const http = httpRouter();

http.route({
  path: "/send-marketing-push",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // CORS preflight
    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "POST, OPTIONS",
          "Access-Control-Allow-Headers": "Authorization, Content-Type",
        },
      });
    }

    // Auth check
    const authHeader = request.headers.get("authorization");
    const expectedKey = process.env.PUSH_NOTIFICATION_AUTH_KEY;
    if (!expectedKey || !authHeader || authHeader !== `Bearer ${expectedKey}`) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Parse body
    let payload: { title?: string; body?: string; data?: unknown };
    try {
      payload = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!payload.title || !payload.body) {
      return new Response(
        JSON.stringify({ error: "Bad Request: 'title' and 'body' are required" }),
        { status: 400, headers: { "Content-Type": "application/json" } }
      );
    }

    // Delegate to the internal push notification action
    const result = await ctx.runAction(internal.pushNotifications.sendMarketingPush, {
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });

    const status = result.success ? 200 : 207;
    return new Response(JSON.stringify(result), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
