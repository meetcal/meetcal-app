import React, { useEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import RevenueCatUI from 'react-native-purchases-ui';
import { useTheme } from '@/contexts/ThemeContext';
import * as Purchases from 'react-native-purchases';
import { useUser } from '@clerk/clerk-expo';

export default function PaywallScreen() {
  const router = useRouter();
  const { currentTheme } = useTheme();
  const { from, feature } = useLocalSearchParams<{ from?: string; feature?: string }>();
  const { user, isLoaded } = useUser();
  const [offering, setOffering] = useState<Purchases.PurchasesOffering | null>(null);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (isLoaded && !user) {
      console.log('[Paywall] User not authenticated, redirecting to sign-in');
      router.replace({
        pathname: '/(auth)/sign-in',
        params: {
          from: from || '/(tabs)',
          feature: feature || 'subscription',
        },
      } as any);
    }
  }, [isLoaded, user, router, from, feature]);

  useEffect(() => {
    const getOffering = async () => {
      try {
        const offerings = await Purchases.default.getOfferings();
        // Get the offering based on platform
        const offeringId = "new image test";
        const platformOffering = offerings.all[offeringId];
        setOffering(platformOffering || offerings.current);
      } catch (e) {
        console.error('Error fetching offerings:', e);
      }
    };

    getOffering();
  }, []);

  const handleDismiss = () => {
    // Return to origin or default to tabs
    if (from && typeof from === 'string') {
      router.replace(from as any);
    } else {
      router.replace('/(tabs)' as any);
    }
  };

  const handlePurchaseComplete = ({ customerInfo }: any) => {
    console.log('Purchase completed:', customerInfo);
    // After successful purchase, return to origin
    if (from && typeof from === 'string') {
      router.replace(from as any);
    } else {
      router.replace('/(tabs)' as any);
    }
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
        onPurchaseCompleted={handlePurchaseComplete}
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
