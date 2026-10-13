import { HapticTab } from "@/components/ui/HapticTab";
import { IconSymbol } from "@/components/ui/IconSymbol";
import { useAppColors } from "@/hooks/useAppColors";
import { isMaestroE2E } from "@/lib/e2e";
import { jsTabBarLayout, usesNativeTabs } from "@/lib/tab-bar-layout";
import { Tabs } from "expo-router";
import { NativeTabs } from "expo-router/native-tabs";
import { Platform, StyleSheet } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

export default function TabLayout() {
  const colors = useAppColors();
  const insets = useSafeAreaInsets();
  // Sized from the bottom inset, so Android's navigation bar and the iOS home
  // indicator sit below the icons rather than over them.
  const tabBar = jsTabBarLayout(insets.bottom);

  if (usesNativeTabs(Platform.OS, Platform.Version, isMaestroE2E())) {
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
          height: tabBar.height,
          paddingBottom: tabBar.paddingBottom,
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
          tabBarAccessibilityLabel: "Schedule tab",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="calendar" color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="(saved)"
        options={{
          headerShown: false,
          tabBarAccessibilityLabel: "Saved tab",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="bookmark.fill" color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="(start-list)"
        options={{
          headerShown: false,
          tabBarAccessibilityLabel: "Start list tab",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="list.bullet" color={String(color)} />
          ),
        }}
      />
      <Tabs.Screen
        name="(info)"
        options={{
          headerShown: false,
          tabBarAccessibilityLabel: "Info tab",
          tabBarIcon: ({ color }) => (
            <IconSymbol size={28} name="info.circle.fill" color={String(color)} />
          ),
        }}
      />
    </Tabs>
  );
}
