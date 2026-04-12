import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import RevenueCatUI from 'react-native-purchases-ui';
import { useTheme } from '@/contexts/ThemeContext';
import * as Purchases from 'react-native-purchases';
import { useUser } from '@clerk/expo';

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
    if (!isLoaded || !user) {
      return;
    }

    let cancelled = false;

    const getOffering = async () => {
      try {
        const offerings = await Purchases.default.getOfferings();
        const offeringId = "new image test";
        const platformOffering = offerings.all[offeringId];
        if (!cancelled) {
          setOffering(platformOffering || offerings.current);
        }
      } catch (e) {
        console.error('Error fetching offerings:', e);
      }
    };

    getOffering();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, user]);

  const returnToOrigin = () => {
    if (router.canGoBack()) {
      router.back();
      return;
    }

    if (from && typeof from === 'string') {
      router.replace(from as any);
      return;
    }

    router.replace('/(tabs)' as any);
  };

  if (!isLoaded || !user || !offering) {
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: currentTheme === 'dark' ? '#000000' : '#FFFFFF',
          },
        ]}
      >
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
        <View style={styles.loadingContainer}>
          <ActivityIndicator
            size="large"
            color={currentTheme === 'dark' ? '#FFFFFF' : '#000000'}
          />
        </View>
      </View>
    );
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
        onRestoreCompleted={returnToOrigin}
        onPurchaseCompleted={returnToOrigin}
        onDismiss={returnToOrigin}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
