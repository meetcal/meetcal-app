import { Ionicons } from "@expo/vector-icons";
import type React from "react";

type IoniconName = React.ComponentProps<typeof Ionicons>["name"];

const ioniconForSfSymbol: Record<string, IoniconName> = {
  "chevron.down": "chevron-down",
  "chevron.left": "chevron-back",
  "chevron.right": "chevron-forward",
  "chevron.up": "chevron-up",
  "arrow.back": "arrow-back",
  calendar: "calendar",
  "bookmark.fill": "bookmark",
  "line.3.horizontal.decrease": "filter",
  "info.circle.fill": "information-circle",
  "list.bullet": "list",
  checkmark: "checkmark",
  "checkmark.circle.fill": "checkmark-circle",
  "xmark.circle.fill": "close-circle",
  plus: "add",
  magnifyingglass: "search",
  "arrow.down.circle": "arrow-down-circle",
  "arrow.clockwise": "refresh",
  "arrow.up.arrow.down": "swap-vertical",
  lock: "lock-closed",
  xmark: "close",
  close: "close",
  download: "download",
  "square.and.arrow.down": "download",
  "square.and.arrow.up": "share-outline",
  "wifi.slash": "cloud-offline",
  "chart.bar.fill": "stats-chart",
  bookmark: "bookmark",
  trash: "trash",
  "star.fill": "star",
  "crown.fill": "diamond",
};

function isIoniconName(name: string): name is IoniconName {
  return Object.hasOwn(Ionicons.glyphMap, name);
}

export function ioniconFor(sfSymbolName: string): IoniconName | null {
  const mapped = ioniconForSfSymbol[sfSymbolName];
  if (mapped !== undefined) return mapped;
  return isIoniconName(sfSymbolName) ? sfSymbolName : null;
}
