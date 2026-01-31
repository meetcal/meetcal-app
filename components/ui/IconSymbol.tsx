// This file is a fallback for using MaterialIcons on Android and web.

import { Platform } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { SymbolWeight } from 'expo-symbols';
import React from 'react';
import { OpaqueColorValue, StyleProp, ViewStyle } from 'react-native';

// Map SF Symbols to Ionicons names
const iconMap: Record<string, string> = {
  'chevron.down': 'chevron-down',
  'chevron.right': 'chevron-forward',
  'chevron.up': 'chevron-up',
  'calendar': 'calendar',
  'bookmark.fill': 'bookmark',
  'line.3.horizontal.decrease': 'filter',
  'info.circle.fill': 'information-circle',
  'list.bullet': 'list',
  'checkmark': 'checkmark',
  'checkmark.circle.fill': 'checkmark-circle',
  'plus': 'add',
  'magnifyingglass': 'search',
  'arrow.down.circle': 'arrow-down-circle',
  'arrow.clockwise': 'refresh',
  'arrow.up.arrow.down': 'swap-vertical',
  'lock': 'lock-closed',
  'xmark': 'close',
  'close': 'close',
};

type IconSymbolProps = {
  name: string;
  size: number;
  color: string;
};

export function IconSymbol({ name, size, color }: IconSymbolProps) {
  // Convert SF Symbol name to Ionicons name
  const ionIconName = iconMap[name] || name;

  return (
    <Ionicons 
      name={ionIconName as any}
      size={size}
      color={color}
    />
  );
}
