import { ConvexReactClient } from "convex/react";

const convexUrl = process.env.EXPO_PUBLIC_CONVEX_URL;

if (!convexUrl) {
  console.error("Missing EXPO_PUBLIC_CONVEX_URL environment variable");
}

export const convex = new ConvexReactClient(convexUrl!);
