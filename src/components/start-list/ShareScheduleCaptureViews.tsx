import ShareScheduleView from "@/components/share/ShareScheduleView";
import type { LiftResult } from "@/data/types/athletes";
import type { ScheduleShareImages } from "@/hooks/useScheduleShareImages";
import type { SessionDetails } from "@/types/start-list";
import React from "react";
import { StyleSheet, View } from "react-native";

export function ShareScheduleCaptureViews({
  shareImages,
  filteredAthletes,
  selectedMeet,
  selectedGroup,
  getSessionDetails,
}: {
  shareImages: Pick<ScheduleShareImages, "whiteViewRef" | "transparentViewRef">;
  filteredAthletes: LiftResult[];
  selectedMeet: string;
  selectedGroup: string;
  getSessionDetails: (sessionNumber: number) => SessionDetails | null;
}) {
  return (
    <View style={styles.offscreen}>
      <View ref={shareImages.whiteViewRef} collapsable={false}>
        <ShareScheduleView
          filteredAthletes={filteredAthletes}
          selectedMeet={selectedMeet}
          selectedGroup={selectedGroup}
          getSessionDetails={getSessionDetails}
          backgroundPreset="white"
        />
      </View>
      <View ref={shareImages.transparentViewRef} collapsable={false}>
        <ShareScheduleView
          filteredAthletes={filteredAthletes}
          selectedMeet={selectedMeet}
          selectedGroup={selectedGroup}
          getSessionDetails={getSessionDetails}
          backgroundPreset="transparent"
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  offscreen: {
    position: "absolute",
    left: -10000,
    top: 0,
  },
});
