import { useTheme } from "@/contexts/ThemeContext";
import { Pressable, StyleSheet, TextStyle, ViewStyle } from "react-native";
import { ThemedText } from "./ThemedText";

interface ThemedButtonProps {
  onPress: () => void;
  children: React.ReactNode;
  style?: ViewStyle;
  textStyle?: TextStyle;
  disabled?: boolean;
}

export function ThemedButton({
  onPress,
  children,
  style,
  textStyle,
  disabled,
}: ThemedButtonProps) {
  const { currentTheme } = useTheme();

  const colors = {
    background: "#007AFF",
    pressed: currentTheme === "dark" ? "#0056B3" : "#0056B3",
    disabled: currentTheme === "dark" ? "#4A4A4A" : "#A1A1A1",
    text: "#FFFFFF",
  };

  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [
        styles.button,
        {
          backgroundColor: disabled
            ? colors.disabled
            : pressed
              ? colors.pressed
              : colors.background,
        },
        style,
      ]}
      disabled={disabled}
    >
      <ThemedText style={[styles.text, { color: colors.text }, textStyle]}>
        {children}
      </ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 12,
    alignItems: "center",
    justifyContent: "center",
  },
  text: {
    fontSize: 17,
    fontWeight: "600",
  },
});
