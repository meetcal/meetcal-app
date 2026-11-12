import { MenuView, type MenuAction } from "@react-native-menu/menu";
import React, { useCallback } from "react";
import { Pressable, View } from "react-native";
import { SortButtonContent } from "./SortButtonContent";
import {
  SESSION_ATHLETE_SORT_DIRECTIONS,
  SESSION_ATHLETE_SORT_KEYS,
  type SessionAthleteSortDirection,
  type SessionAthleteSortKey,
} from "@/lib/session-athlete-sort";
import type { SessionSortControlProps } from "./types";

const ACTION_SEPARATOR = "::";

const encodeActionId = (key: SessionAthleteSortKey, direction: SessionAthleteSortDirection) =>
  `${key}${ACTION_SEPARATOR}${direction}`;


const decodeActionId = (id: string): [SessionAthleteSortKey, SessionAthleteSortDirection] | null => {
  const [key, direction] = id.split(ACTION_SEPARATOR);
  const sortKey = SESSION_ATHLETE_SORT_KEYS.find((candidate) => candidate === key);
  const sortDirection = SESSION_ATHLETE_SORT_DIRECTIONS.find((candidate) => candidate === direction);
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
