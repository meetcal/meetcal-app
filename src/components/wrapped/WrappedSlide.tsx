import { LinearGradient } from "expo-linear-gradient";
import React from "react";
import { Pressable, StyleSheet, View } from "react-native";
import type { EdgeInsets } from "react-native-safe-area-context";
import { SlideContent } from "@/components/wrapped/SlideContent";
import { ConsistencySlide } from "@/components/wrapped/slides/ConsistencySlide";
import { FavoriteAttemptSlide } from "@/components/wrapped/slides/FavoriteAttemptSlide";
import { MeetJourneySlide } from "@/components/wrapped/slides/MeetJourneySlide";
import { ShareSlide } from "@/components/wrapped/slides/ShareSlide";
import { TitleSlide } from "@/components/wrapped/slides/TitleSlide";
import { TotalWeightSlide } from "@/components/wrapped/slides/TotalWeightSlide";
import { YearBestsSlide } from "@/components/wrapped/slides/YearBestsSlide";
import { BlackAlpha, WrappedGradients } from "@/constants/Palette";
import type { WrappedStats } from "@/types/wrapped";

export const SLIDE_COUNT = WrappedGradients.slides.length;

export function WrappedSlide({
  index,
  active,
  stats,
  athleteName,
  year,
  width,
  height,
  insets,
  onTapAtScreenX,
}: {
  index: number;
  active: boolean;
  stats: WrappedStats;
  athleteName: string;
  year: number;
  width: number;
  height: number;
  insets: EdgeInsets;
  onTapAtScreenX: (pageX: number) => void;
}) {
  return (
    <View style={{ width, height }}>
      <LinearGradient
        colors={WrappedGradients.slides[index]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={StyleSheet.absoluteFill}
      />
      <View style={styles.slideOverlay} />

      <Pressable
        style={[
          styles.slideContainer,
          {
            paddingTop: insets.top + 20,
            paddingBottom: insets.bottom + 60,
            paddingLeft: insets.left + 24,
            paddingRight: insets.right + 24,
          },
        ]}
        onPress={(e) => onTapAtScreenX(e.nativeEvent.pageX)}
      >
        <SlideContent active={active}>
          {index === 0 && (
            <TitleSlide
              name={athleteName}
              year={year}
              stats={stats}
            />
          )}
          {index === 1 && <TotalWeightSlide stats={stats} active={active} />}
          {index === 2 && <YearBestsSlide stats={stats} year={year} active={active} />}
          {index === 3 && <ConsistencySlide stats={stats} active={active} />}
          {index === 4 && <MeetJourneySlide stats={stats} year={year} active={active} />}
          {index === 5 && <FavoriteAttemptSlide stats={stats} />}
          {index === 6 && (
            <ShareSlide
              stats={stats}
              name={athleteName}
              year={year}
            />
          )}
        </SlideContent>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  slideContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
  },
  slideOverlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: BlackAlpha[15],
  },
});
