import { HapticTab } from "@/components/ui/HapticTab";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useAppColors } from "@/hooks/useAppColors";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/unstable-native-tabs";
import { Platform, StyleSheet } from "react-native";

export default function TabLayout() {
  const colors = useAppColors();

  // Check if iOS 26+ for NativeTabs
  const iosVersion =
    Platform.OS === "ios"
      ? parseInt(String(Platform.Version).split(".")[0], 10)
      : 0;
  const isIOS26OrHigher = iosVersion >= 26;

  if (Platform.OS === "ios" && isIOS26OrHigher) {
    return (
      <NativeTabs
        labelStyle={{ color: colors.secondaryText }}
        tintColor={colors.text}
      >
        <NativeTabs.Trigger name="(index)">
          <NativeTabs.Trigger.Icon sf="calendar" />
          <NativeTabs.Trigger.Label hidden />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(saved)">
          <NativeTabs.Trigger.Icon sf="bookmark.fill" />
          <NativeTabs.Trigger.Label hidden />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(start-list)">
          <NativeTabs.Trigger.Icon sf="list.bullet" />
          <NativeTabs.Trigger.Label hidden />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(info)">
          <NativeTabs.Trigger.Icon sf="info.circle.fill" />
          <NativeTabs.Trigger.Label hidden />
        </NativeTabs.Trigger>
      </NativeTabs>
    );
  }

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.text,
        tabBarInactiveTintColor: colors.secondaryText,
        tabBarStyle: {
          backgroundColor: colors.background,
          borderTopColor: colors.border,
          borderTopWidth: StyleSheet.hairlineWidth,
          position: "absolute",
          bottom: 0,
          left: 0,
          right: 0,
          elevation: 0,
          shadowOpacity: 0,
          height: 70,
          paddingBottom: 15,
          paddingTop: 0,
        },
        tabBarItemStyle: {
          marginTop: 5,
        },
        headerStyle: {
          backgroundColor: colors.background,
        },
        headerTintColor: colors.text,
        headerTransparent: false,
        tabBarButton: HapticTab,
        tabBarShowLabel: false,
      }}
    >
      <Tabs.Screen
        name="(index)"
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="calendar" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(saved)"
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="bookmark.fill" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(start-list)"
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="list.bullet" color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="(info)"
        options={{
          headerShown: false,
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="info.circle.fill" color={color} />
          ),
        }}
      />
    </Tabs>
  );
}
