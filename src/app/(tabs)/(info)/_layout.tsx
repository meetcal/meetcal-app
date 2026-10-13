import { useAppColors } from "@/hooks/useAppColors";
import { Stack } from "expo-router";

export default function InfoLayout() {
  const colors = useAppColors();
  return (
    <Stack
      screenOptions={{
        title: "Info",
        headerStyle: {
          backgroundColor: colors.headerBackground,
        },
        headerTitleStyle: {
          color: colors.headerTitle,
        }
      }}
    />
  );
}
