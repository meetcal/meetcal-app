// This file is a fallback for using MaterialIcons on Android and web.

import { Ionicons } from "@expo/vector-icons";
import React from "react";

// Map SF Symbols to Ionicons names
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
