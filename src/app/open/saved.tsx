import { DismissToRedirect } from "@/components/navigation/DismissToRedirect";

// The Saved widget's `meetcal:///open/saved` link. Pops back to the running
// tabs rather than stacking another tabs navigator on each widget tap.
export default function OpenSavedScreen() {
  return <DismissToRedirect href="/(tabs)/(saved)" />;
}
