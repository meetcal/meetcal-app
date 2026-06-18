import { MenuView, type MenuAction } from "@react-native-menu/menu";
import React, { useCallback } from "react";
import { Pressable, View } from "react-native";
import { SortButtonContent } from "./SortButtonContent";
import type {
  SessionSortControlProps,
  SortDirection,
  SortKey,
} from "./types";

const ACTION_SEPARATOR = "::";

const encodeActionId = (key: SortKey, direction: SortDirection) =>
  `${key}${ACTION_SEPARATOR}${direction}`;

const decodeActionId = (id: string): [SortKey, SortDirection] => {
  const [key, direction] = id.split(ACTION_SEPARATOR);
  return [key as SortKey, direction as SortDirection];
};

/**
 * iOS session sort control. Renders the native UIMenu, which automatically
 * adopts the iOS 26 liquid glass styling on supported devices (matching the
 * start list filter pills).
 */
const SessionSortControl: React.FC<SessionSortControlProps> = ({
  isSubscribed,
  sortLabel,
  sortKey,
  sortDirection,
  sortOptions,
  onSelect,
  onLockedPress,
}) => {
  const buildActions = useCallback((): MenuAction[] => {
    return sortOptions.map((option) => ({
      id: encodeActionId(option.key, option.direction),
      title: option.label,
      state:
        option.key === sortKey && option.direction === sortDirection
          ? "on"
          : "off",
    }));
  }, [sortOptions, sortKey, sortDirection]);

  // Non-subscribers tap straight through to the paywall instead of a menu.
  if (!isSubscribed) {
    return (
      <Pressable
        onPress={onLockedPress}
        accessibilityRole="button"
        accessibilityLabel="Sort athletes"
      >
        <SortButtonContent isSubscribed={isSubscribed} sortLabel={sortLabel} />
      </Pressable>
    );
  }

  return (
    <MenuView
      title="Sort Athletes"
      actions={buildActions()}
      onPressAction={({ nativeEvent }) => {
        const [key, direction] = decodeActionId(nativeEvent.event);
        onSelect(key, direction);
      }}
    >
      <View accessibilityLabel="Sort athletes">
        <SortButtonContent isSubscribed={isSubscribed} sortLabel={sortLabel} />
      </View>
    </MenuView>
  );
};

export default SessionSortControl;
