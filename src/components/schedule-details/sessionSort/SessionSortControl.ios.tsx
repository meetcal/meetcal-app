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

const SORT_KEYS: readonly SortKey[] = ["entryTotal", "snatch", "cj", "total"];
const SORT_DIRECTIONS: readonly SortDirection[] = ["asc", "desc"];

const decodeActionId = (id: string): [SortKey, SortDirection] | null => {
  const [key, direction] = id.split(ACTION_SEPARATOR);
  const sortKey = SORT_KEYS.find((candidate) => candidate === key);
  const sortDirection = SORT_DIRECTIONS.find((candidate) => candidate === direction);
  return sortKey && sortDirection ? [sortKey, sortDirection] : null;
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
        const decoded = decodeActionId(nativeEvent.event);
        if (decoded) onSelect(...decoded);
      }}
    >
      <View accessibilityLabel="Sort athletes">
        <SortButtonContent isSubscribed={isSubscribed} sortLabel={sortLabel} />
      </View>
    </MenuView>
  );
};

export default SessionSortControl;
