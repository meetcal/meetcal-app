// This file is a fallback for using MaterialIcons on Android and web.

import { Ionicons } from "@expo/vector-icons";
import React from "react";

// Map SF Symbols to Ionicons names.
//
// The iOS build resolves `@/components/ui/IconSymbol` to `IconSymbol.ios.tsx`,
// which hands `name` straight to `SymbolView`. TypeScript only ever sees this
// file's `name: string`, so a call site that passes an Ionicons name instead of
// an SF Symbol type-checks and then renders *nothing at all* on iOS. Keys here
// must be SF Symbol names; values are the Ionicons equivalent.
const iconMap: Record<string, string> = {
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
  // Unmapped names fall through to Ionicons verbatim, which silently renders
  // nothing for any dotted SF Symbol name. These four are in use.
  bookmark: "bookmark",
  trash: "trash",
  "star.fill": "star",
  "crown.fill": "diamond",
};

type IconSymbolProps = {
  name: string;
  size: number;
  color: string;
};

export function IconSymbol({ name, size, color }: IconSymbolProps) {
  // Convert SF Symbol name to Ionicons name
  const ionIconName = iconMap[name] || name;

  return <Ionicons name={ionIconName as any} size={size} color={color} />;
}
