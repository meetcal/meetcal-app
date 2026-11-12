import type { Href } from "expo-router";

import { useRedirectIntoTabs } from "@/hooks/useRedirectIntoTabs";

export function DismissToRedirect({ href }: { href: Href }): null {
  useRedirectIntoTabs(href);
  return null;
}
