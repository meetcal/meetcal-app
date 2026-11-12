import { useRedirectIntoTabs } from "@/hooks/useRedirectIntoTabs";

/** `meetcal:///open/saved` (the saved widget): the Saved tab, in the tabs underneath. */
export default function OpenSavedScreen() {
  useRedirectIntoTabs("/(tabs)/(saved)");
  return null;
}
