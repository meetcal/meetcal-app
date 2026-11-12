import { StyleSheet } from "react-native";
import { Palette, WhiteAlpha } from "@/constants/Palette";

export const wrappedStyles = StyleSheet.create({
  storyContainer: {
    flex: 1,
    backgroundColor: Palette.black,
  },
  slideInner: {
    flex: 1,
    width: "100%",
    justifyContent: "space-between",
    alignItems: "center",
    paddingVertical: 20,
  },
  slideTopLabel: {
    fontSize: 13,
    fontWeight: "700",
    color: WhiteAlpha[60],
    letterSpacing: 4,
    textAlign: "center",
    marginBottom: 20,
  },
});
