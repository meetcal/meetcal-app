import { useAppColors } from "@/hooks/useAppColors";
import { StyleSheet, Text, type TextProps } from "react-native";

/**
 * `Text` with the themed foreground colour and the app's body metrics.
 *
 * This used to carry a `type` prop with five presets ("title", "subtitle",
 * "link", ...). Across ~660 call sites not one ever set it, so every render
 * took the "default" branch and the other four style entries were unreachable.
 * Screens style their own headings inline; adding a preset scale is a design
 * decision, not something to leave half-wired.
 */
export type ThemedTextProps = TextProps;

export function ThemedText({ style, ...rest }: ThemedTextProps) {
  const colors = useAppColors();

  return (
    <Text style={[{ color: colors.text }, styles.default, style]} {...rest} />
  );
}

const styles = StyleSheet.create({
  default: {
    fontSize: 16,
    lineHeight: 24,
  },
});
