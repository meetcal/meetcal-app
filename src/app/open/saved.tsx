import { useRedirectIntoTabs } from "@/lib/tab-redirect";

/** `meetcal:///open/saved` (the saved widget): the Saved tab, in the tabs underneath. */
export default function OpenSavedScreen() {
  useRedirectIntoTabs("/(tabs)/(saved)");
  return null;
}
