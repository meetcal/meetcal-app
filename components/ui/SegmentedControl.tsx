import { ThemedText } from "@/components/ui/ThemedText";
import { useAppColors } from "@/hooks/useAppColors";
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, View } from "react-native";

interface SegmentedControlProps {
  values: string[];
  selectedIndex: number;
  onChange: (index: number) => void;
}

export function SegmentedControl({
  values,
  selectedIndex,
  onChange,
}: SegmentedControlProps) {
  const colors = useAppColors();
  const [segmentWidth, setSegmentWidth] = useState(0);
  const slideAnimation = useRef(new Animated.Value(0)).current;

   
  useEffect(() => {
    Animated.spring(slideAnimation, {
      toValue: selectedIndex * segmentWidth,
      useNativeDriver: true,
      tension: 100,
      friction: 20,
    }).start();
  }, [selectedIndex, segmentWidth, slideAnimation]);

  return (
    <View
      style={[styles.container, { backgroundColor: colors.background }]}
      onLayout={({ nativeEvent }) => {
        setSegmentWidth(nativeEvent.layout.width / values.length);
      }}
    >
      <Animated.View
        style={[
          styles.selectedSegment,
          {
            backgroundColor: "white",
            width: segmentWidth,
            transform: [{ translateX: slideAnimation }],
          },
        ]}
      />
      {values.map((value, index) => (
        <Pressable
          key={value}
          style={styles.segment}
          onPress={() => onChange(index)}
        >
          <ThemedText
            style={[
              styles.segmentText,
              {
                color: selectedIndex === index ? "black" : colors.text,
                fontWeight: selectedIndex === index ? "600" : "400",
              },
            ]}
          >
            {value}
          </ThemedText>
        </Pressable>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    borderRadius: 8,
    overflow: "hidden",
    height: 32,
    position: "relative",
  },
  selectedSegment: {
    position: "absolute",
    top: 2,
    bottom: 2,
    borderRadius: 6,
    shadowColor: "#000",
    shadowOffset: {
      width: 0,
      height: 1,
    },
    shadowOpacity: 0.15,
    shadowRadius: 1,
    elevation: 2,
  },
  segment: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    zIndex: 1,
  },
  segmentText: {
    fontSize: 13,
  },
});
