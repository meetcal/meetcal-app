import { useEffect, useState } from "react";
import { Linking } from "react-native";

import { deepLinkOpensPath } from "@/utils/deepLinks";

/**
 * A key for `useFilterState`'s `resetKey` on a screen whose filters come from
 * route params: it changes when those params change, and when a link to this
 * screen arrives while it is open even with the same params (the user changed
 * the filters in the app, then tapped the widget again).
 */
export function useRouteFilterKey(
  pathname: string,
  routeFilters: readonly (string | undefined)[],
): string {
  const [linkVersion, setLinkVersion] = useState(0);
  useEffect(() => {
    const subscription = Linking.addEventListener("url", ({ url }) => {
      if (deepLinkOpensPath(url, pathname)) setLinkVersion((version) => version + 1);
    });
    return () => subscription.remove();
  }, [pathname]);
  return `${linkVersion}:${JSON.stringify(routeFilters.map((value) => value ?? ""))}`;
}
