// This is a shim for web and Android where the tab bar is generally opaque.
import { useAppColors } from "@/hooks/useAppColors";
import { View } from "react-native";

export default function TabBarBackground() {
  const colors = useAppColors();

  return (
    <View
      style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: colors.background,
      }}
    />
  );
}

export function useBottomTabOverflow() {
  return 0;
}
