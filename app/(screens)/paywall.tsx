import React from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import RevenueCatUI from 'react-native-purchases-ui';
import { useTheme } from '@/contexts/ThemeContext';
import * as Purchases from 'react-native-purchases';
import { useEffect, useState } from 'react';

export default function PaywallScreen() {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const [offering, setOffering] = useState<Purchases.PurchasesOffering | null>(null);

  useEffect(() => {
    const getOffering = async () => {
      try {
        const offerings = await Purchases.default.getOfferings();
        // Get the offering based on platform
        const offeringId = Platform.OS === 'android' ? 'android' : 'test';
        const platformOffering = offerings.all[offeringId];
        setOffering(platformOffering || offerings.current);
      } catch (e) {
        console.error('Error fetching offerings:', e);
      }
    };

    getOffering();
  }, []);

  const handleDismiss = () => {
    router.replace('/schedule');
  };

  if (!offering) {
    return null; // Or show a loading state
  }

  return (
    <View style={styles.container}>
      <Stack.Screen
        options={{
          headerTitle: 'Premium Features',
          headerTitleStyle: {
            color: currentTheme === 'dark' ? '#FFFFFF' : '#000000',
          },
          headerStyle: {
            backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
          },
          headerShadowVisible: false,
        }}
      />
      <RevenueCatUI.Paywall
        options={{
          offering
        }}
        onRestoreCompleted={({customerInfo}) => {
          // Handle restore completion
          console.log('Restore completed:', customerInfo);
        }}
        onDismiss={handleDismiss}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
