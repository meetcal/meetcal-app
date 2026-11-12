import { ThemedText } from "@/components/ui/ThemedText";
import { useLoadingText } from "@/hooks/useWaitingForConnection";
import type { StyleProp, TextStyle } from "react-native";

export function LoadingLabel({
  label = "Loading...",
  style,
}: {
  label?: string;
  style?: StyleProp<TextStyle>;
}) {
  const text = useLoadingText(label);
  return text.length > 0 ? <ThemedText style={style}>{text}</ThemedText> : null;
}
