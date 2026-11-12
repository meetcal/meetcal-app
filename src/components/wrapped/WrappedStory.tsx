import { LinearGradient } from "expo-linear-gradient";
import { Stack } from "expo-router";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  FlatList,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
  Pressable,
  Share,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import ViewShot from "react-native-view-shot";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { showToast } from "@/components/ui/Toast";
import { PulsingDot, SLIDE_DOT_SIZE } from "@/components/wrapped/PulsingDot";
import { SLIDE_COUNT, WrappedSlide } from "@/components/wrapped/WrappedSlide";
import { wrappedStyles } from "@/components/wrapped/wrapped-styles";
import { BlackAlpha, Palette, WhiteAlpha, WrappedGradients } from "@/constants/Palette";
import type { WrappedYear } from "@/hooks/useWrappedSearch";
import { captureViewAsPng, shareImageFile } from "@/lib/share-image";
import { buildWrappedShareText } from "@/lib/wrapped-stats";
import { wrappedTapDirection } from "@/lib/wrapped-tap-zones";

const SLIDE_DOT_TOUCH_HEIGHT = 44;
const SLIDE_DOTS_BOTTOM_GAP = 16;
const SLIDE_INDEXES = Array.from({ length: SLIDE_COUNT }, (_, i) => i);

function useKeepSlideAnchoredOnResize(
  pagerRef: React.RefObject<FlatList | null>,
  slideWidth: number,
  currentSlide: number,
) {
  const lastSlideWidthRef = useRef(slideWidth);
  useEffect(() => {
    if (lastSlideWidthRef.current === slideWidth) return;
    lastSlideWidthRef.current = slideWidth;
    pagerRef.current?.scrollToOffset({ offset: currentSlide * slideWidth, animated: false });
  }, [pagerRef, slideWidth, currentSlide]);
}

async function shareWrappedAsTextOrWarn(wrapped: WrappedYear) {
  const shareText = buildWrappedShareText(wrapped.stats, wrapped.yearSearched);
  try {
    await Share.share({ message: shareText });
  } catch (error) {
    console.warn("Wrapped: text share failed", error);
    showToast({ type: "error", message: "Couldn't share your Wrapped. Please try again." });
  }
}

export function WrappedStory({ wrapped, onClose }: { wrapped: WrappedYear; onClose: () => void }) {
  const insets = useSafeAreaInsets();
  const { width: screenWidth, height: screenHeight } = useWindowDimensions();
  const [currentSlide, setCurrentSlide] = useState(0);
  const flatListRef = useRef<FlatList>(null);
  const viewShotRef = useRef<React.ComponentRef<typeof ViewShot>>(null);

  useKeepSlideAnchoredOnResize(flatListRef, screenWidth, currentSlide);

  const goToSlide = useCallback((index: number) => {
    if (index >= 0 && index < SLIDE_COUNT) {
      flatListRef.current?.scrollToIndex({ index, animated: true });
      setCurrentSlide(index);
    }
  }, []);

  const handleTapAtScreenX = useCallback((pageX: number) => {
    const direction = wrappedTapDirection({
      pageX,
      windowWidth: screenWidth,
      insetLeft: insets.left,
      insetRight: insets.right,
    });
    if (direction !== 0) goToSlide(currentSlide + direction);
  }, [currentSlide, screenWidth, insets.left, insets.right, goToSlide]);

  const shareWrapped = async () => {
    try {
      if (!viewShotRef.current) return;
      const uri = await captureViewAsPng(viewShotRef);
      await shareImageFile(uri, `My ${wrapped.yearSearched} Weightlifting Wrapped!`);
    } catch {
      await shareWrappedAsTextOrWarn(wrapped);
    }
  };

  const onMomentumScrollEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const index = Math.round(e.nativeEvent.contentOffset.x / screenWidth);
      setCurrentSlide(index);
    },
    [screenWidth],
  );

  const renderSlide = useCallback(({ index }: { item: number; index: number }) => (
    <WrappedSlide
      index={index}
      active={currentSlide === index}
      stats={wrapped.stats}
      athleteName={wrapped.athleteName}
      year={wrapped.yearSearched}
      width={screenWidth}
      height={screenHeight}
      insets={insets}
      onTapAtScreenX={handleTapAtScreenX}
    />
  ), [wrapped, currentSlide, screenWidth, screenHeight, insets, handleTapAtScreenX]);

  return (
    <View style={wrappedStyles.storyContainer}>
      <Stack.Screen options={{ headerShown: false }} />
      <ViewShot ref={viewShotRef} style={StyleSheet.absoluteFill} options={{ format: "png", quality: 1 }}>
        <FlatList
          ref={flatListRef}
          data={Array.from(SLIDE_INDEXES)}
          renderItem={renderSlide}
          keyExtractor={(item) => item.toString()}
          horizontal
          pagingEnabled
          showsHorizontalScrollIndicator={false}
          bounces={false}
          onMomentumScrollEnd={onMomentumScrollEnd}
          getItemLayout={(_, index) => ({ length: screenWidth, offset: screenWidth * index, index })}
          initialScrollIndex={0}
        />
      </ViewShot>

      <View
        pointerEvents="box-none"
        style={[
          styles.dotsContainer,
          {
            bottom: insets.bottom + SLIDE_DOTS_BOTTOM_GAP - (SLIDE_DOT_TOUCH_HEIGHT - SLIDE_DOT_SIZE) / 2,
            left: insets.left,
            right: insets.right,
          },
        ]}
      >
        {SLIDE_INDEXES.map((i) => (
          <Pressable
            key={i}
            onPress={() => goToSlide(i)}
            style={styles.slideDotTarget}
            accessibilityRole="button"
            accessibilityLabel={`Slide ${i + 1} of ${SLIDE_COUNT}`}
            accessibilityState={{ selected: currentSlide === i }}
          >
            <PulsingDot active={currentSlide === i} />
          </Pressable>
        ))}
      </View>

      <Pressable
        style={[styles.closeButton, { top: insets.top + 8, right: insets.right + 16 }]}
        onPress={onClose}
        hitSlop={16}
        accessibilityRole="button"
        accessibilityLabel="Close Wrapped"
      >
        <View style={styles.closeButtonBg}>
          <IconSymbol name="xmark" size={18} color={Palette.white} />
        </View>
      </Pressable>

      {currentSlide === SLIDE_COUNT - 1 && (
        <View
          style={[
            styles.shareOverlay,
            {
              bottom: insets.bottom + 48,
              left: insets.left + 24,
              right: insets.right + 24,
            },
          ]}
        >
          <Pressable
            style={({ pressed }) => [styles.shareActionButton, pressed && { opacity: 0.85, transform: [{ scale: 0.97 }] }]}
            onPress={shareWrapped}
            accessibilityRole="button"
            accessibilityLabel="Share your Wrapped"
          >
            <LinearGradient
              colors={WrappedGradients.greenButton}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.shareActionGradient}
            >
              <IconSymbol name="square.and.arrow.up" size={20} color={Palette.black} />
              <Text style={styles.shareActionText}>SHARE YOUR WRAPPED</Text>
            </LinearGradient>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.searchAgainButton, pressed && { opacity: 0.7 }]}
            onPress={onClose}
            accessibilityRole="button"
          >
            <Text style={styles.searchAgainText}>Search Another Athlete</Text>
          </Pressable>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  closeButton: {
    position: "absolute",
    right: 16,
    zIndex: 10,
  },
  closeButtonBg: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: BlackAlpha[50],
    alignItems: "center",
    justifyContent: "center",
  },
  shareOverlay: {
    position: "absolute",
    left: 24,
    right: 24,
    zIndex: 10,
    alignItems: "center",
  },
  slideDotTarget: {
    height: SLIDE_DOT_TOUCH_HEIGHT,
    justifyContent: "center",
  },
  dotsContainer: {
    position: "absolute",
    left: 0,
    right: 0,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    zIndex: 10,
  },
  shareActionButton: {
    width: "100%",
    borderRadius: 30,
    overflow: "hidden",
    marginBottom: 16,
  },
  shareActionGradient: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 16,
    gap: 10,
    borderRadius: 30,
  },
  shareActionText: {
    fontSize: 15,
    fontWeight: "900",
    color: Palette.black,
    letterSpacing: 2,
  },
  searchAgainButton: {
    paddingVertical: 14,
    paddingHorizontal: 24,
  },
  searchAgainText: {
    fontSize: 15,
    fontWeight: "600",
    color: WhiteAlpha[60],
    textDecorationLine: "underline",
  },
});
