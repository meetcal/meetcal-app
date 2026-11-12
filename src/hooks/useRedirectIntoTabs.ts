import type { Href } from "expo-router";
import { useFocusEffect, useRouter } from "expo-router";
import { useCallback } from "react";

export function useRedirectIntoTabs(href: Href): void {
  const router = useRouter();
  useFocusEffect(
    useCallback(() => {
      router.dismissTo(href);
    }, [href, router]),
  );
}
