import { NativeModules, Platform } from "react-native";
import { devLog } from "@/lib/logger";
import { DATA_WIDGET_KINDS } from "@/utils/widgetContract";

export type InstalledDataWidgets = "some" | "none" | "unknown";

export async function installedDataWidgets(): Promise<InstalledDataWidgets> {
  if (Platform.OS !== "ios" && Platform.OS !== "android") return "unknown";
  const listKinds = NativeModules.SavedWidget?.installedWidgetKinds;
  if (typeof listKinds !== "function") return "unknown";
  try {
    const kinds: unknown = await listKinds();
    if (!Array.isArray(kinds)) return "unknown";
    const dataKinds: readonly string[] = DATA_WIDGET_KINDS;
    return kinds.some((kind) => typeof kind === "string" && dataKinds.includes(kind)) ? "some" : "none";
  } catch (error) {
    devLog("[Widget] Could not list the installed widgets", error);
    return "unknown";
  }
}
