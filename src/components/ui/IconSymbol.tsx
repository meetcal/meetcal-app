import { Ionicons } from "@expo/vector-icons";
import React from "react";

import { ioniconFor } from "./ionicon-for-sf-symbol";

type IconSymbolProps = {
  name: string;
  size: number;
  color: string;
};

export function IconSymbol({ name, size, color }: IconSymbolProps) {
  const ionIconName = ioniconFor(name);
  if (ionIconName === null) return null;
  return <Ionicons name={ionIconName} size={size} color={color} />;
}
