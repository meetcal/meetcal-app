import { Tabs } from 'expo-router';
import { NativeTabs, Icon, Label } from 'expo-router/unstable-native-tabs';
import React from 'react';
import { Platform, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTheme } from '@/contexts/ThemeContext';
import { DarkTheme, DefaultTheme, useNavigation } from '@react-navigation/native';

import { HapticTab } from '@/components/HapticTab';
import { IconSymbol } from '@/components/ui/IconSymbol';

export default function TabLayout() {
  const { currentTheme } = useTheme();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();

  const colors = {
    background: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
    border: currentTheme === 'dark' ? '#1C1C1E' : '#E1E1E1',
    text: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
    secondaryText: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  // Update navigation theme when theme changes
  React.useEffect(() => {
    navigation.setOptions({
      ...(currentTheme === 'dark' ? DarkTheme : DefaultTheme),
    });
  }, [currentTheme, navigation]);

  if (Platform.OS === 'ios') {
    return (
      <NativeTabs
        labelStyle={{ color: colors.secondaryText }}
        tintColor={colors.text}>
        <NativeTabs.Trigger name="(index)">
          <Icon sf="calendar" />
          <Label hidden />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(saved)">
          <Icon sf="bookmark.fill" />
          <Label hidden />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(start-list)">
          <Icon sf="list.bullet" />
          <Label hidden />
        </NativeTabs.Trigger>
        <NativeTabs.Trigger name="(info)">
          <Icon sf="info.circle.fill" />
          <Label hidden />
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
          position: 'absolute',
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
      }}>
      <Tabs.Screen
        name="(index)"
        options={{
          title: 'Today',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="calendar" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(saved)"
        options={{
          title: 'Saved',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="bookmark.fill" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(start-list)"
        options={{
          title: 'Start List',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="list.bullet" color={color} />,
        }}
      />
      <Tabs.Screen
        name="(info)"
        options={{
          title: 'Info',
          tabBarIcon: ({ color }) => <IconSymbol size={28} name="info.circle.fill" color={color} />,
        }}
      />
    </Tabs>
  );
}
