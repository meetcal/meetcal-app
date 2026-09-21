import React, { useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useLocalSearchParams, type Href } from 'expo-router';
import RevenueCatUI from 'react-native-purchases-ui';
import { useTheme } from '@/contexts/ThemeContext';
import * as Purchases from 'react-native-purchases';
import { useUser } from '@clerk/expo';
import { useScreenHorizontalInsets } from '@/hooks/useScreenInsets';
import { isInternalRoutePath } from '@/utils/authGuard';
import { devLog } from '@/lib/logger';

/**
 * `from` / `feature` normally arrive as route params, but `SubscriptionGate`
 * renders this screen *inside* the gated route rather than navigating to it.
 * `useLocalSearchParams` would then read the host route's params, so the gate
 * passes them explicitly and they take precedence.
 */
interface PaywallScreenProps {
  from?: string;
  feature?: string;
}

export default function PaywallScreen({
  from: fromProp,
  feature: featureProp,
}: PaywallScreenProps = {}) {
  const screenInsets = useScreenHorizontalInsets();
  const router = useRouter();
  const { currentTheme } = useTheme();
  const params = useLocalSearchParams<{ from?: string; feature?: string }>();
  const from = fromProp ?? params.from;
  const feature = featureProp ?? params.feature;
  const { user, isLoaded } = useUser();
  const [offering, setOffering] = useState<Purchases.PurchasesOffering | null>(null);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (isLoaded && !user) {
      devLog('[Paywall] User not authenticated, redirecting to sign-in');
      router.replace({
        pathname: '/(auth)/sign-in',
        params: {
          from: isInternalRoutePath(from) ? from : '/(tabs)',
          feature: feature || 'subscription',
        },
      });
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

    if (isInternalRoutePath(from)) {
      router.replace(from as Href);
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
          screenInsets,
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
    <View style={[styles.container, screenInsets]}>
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
