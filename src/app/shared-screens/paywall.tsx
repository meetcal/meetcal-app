import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import RevenueCatUI from 'react-native-purchases-ui';
import { useTheme } from '@/contexts/ThemeContext';
import * as Purchases from 'react-native-purchases';
import { useUser } from '@clerk/expo';
import { useScreenHorizontalInsets } from '@/hooks/useScreenInsets';
import { useIsOffline } from '@/hooks/useIsOffline';
import { isInternalRoutePath } from '@/utils/authGuard';
import { DEFAULT_ORIGIN, returnToOrigin } from '@/utils/returnToOrigin';
import { EmptyState } from '@/components/ui/EmptyState';
import { showToast } from '@/components/ui/Toast';
import { devLog } from '@/lib/logger';
import { hasSubscriptionEntitlement } from '@/lib/premium-intent';
import {
  NOTHING_RESTORED_TOAST,
  paywallErrorCopy,
  paywallExitFor,
  type PaywallEvent,
  type PaywallLoadError,
} from '@/lib/paywall';
import { Palette } from '@/constants/Palette';

/**
 * `from` / `feature` normally arrive as route params, but `SubscriptionGate`
 * renders this screen *inside* the gated route rather than navigating to it.
 * `useLocalSearchParams` would then read the host route's params, so the gate
 * passes them explicitly and they take precedence.
 */
interface PaywallScreenProps {
  from?: string;
  feature?: string;
  /**
   * Rendered inside the gated screen (`SubscriptionGate`) rather than pushed.
   * A purchase or restore then leaves navigation alone and lets the gate
   * re-render into the screen.
   */
  inline?: boolean;
}

type OfferingState =
  | { status: 'loading' }
  | { status: 'ready'; offering: Purchases.PurchasesOffering }
  | { status: 'error'; error: Exclude<PaywallLoadError, 'offline'> };

export default function PaywallScreen({
  from: fromProp,
  feature: featureProp,
  inline = false,
}: PaywallScreenProps = {}) {
  const screenInsets = useScreenHorizontalInsets();
  const router = useRouter();
  const { currentTheme } = useTheme();
  const params = useLocalSearchParams<{ from?: string; feature?: string }>();
  const from = fromProp ?? params.from;
  const feature = featureProp ?? params.feature;
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? null;
  const [isOffline] = useIsOffline();
  const [offeringState, setOfferingState] = useState<OfferingState>({ status: 'loading' });
  const [loadAttempt, setLoadAttempt] = useState(0);

  // Redirect to sign-in if not authenticated
  useEffect(() => {
    if (isLoaded && !userId) {
      devLog('[Paywall] User not authenticated, redirecting to sign-in');
      router.replace({
        pathname: '/(auth)/sign-in',
        params: {
          from: isInternalRoutePath(from) ? from : '/(tabs)',
          feature: feature || 'subscription',
        },
      });
    }
  }, [isLoaded, userId, router, from, feature]);

  useEffect(() => {
    if (!isLoaded || !userId) {
      return;
    }

    let cancelled = false;
    setOfferingState({ status: 'loading' });

    const getOffering = async () => {
      try {
        const offerings = await Purchases.default.getOfferings();
        if (cancelled) return;
        // RevenueCat's `current` offering, so dashboard targeting and
        // experiments decide what is shown. A hard-coded experiment id used
        // to override them whenever that offering existed.
        const current = offerings.current;
        setOfferingState(
          current ? { status: 'ready', offering: current } : { status: 'error', error: 'empty' },
        );
      } catch (e) {
        console.error('Error fetching offerings:', e);
        if (!cancelled) setOfferingState({ status: 'error', error: 'failed' });
      }
    };

    void getOffering();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, userId, loadAttempt]);

  const retry = useCallback(() => setLoadAttempt((attempt) => attempt + 1), []);

  const handleEvent = (event: PaywallEvent, customerInfo?: Purchases.CustomerInfo) => {
    const exit = paywallExitFor({
      event,
      inline,
      hasEntitlement: customerInfo ? hasSubscriptionEntitlement(customerInfo) : false,
    });
    if (exit === 'nothing-restored') {
      showToast(NOTHING_RESTORED_TOAST);
      return;
    }
    if (exit === 'stay') return;

    if (inline) {
      // `from` is the gated screen itself, so dismissing to it would be a
      // no-op: leave the gated screen instead.
      if (router.canGoBack()) router.back();
      else router.replace(DEFAULT_ORIGIN);
      return;
    }
    returnToOrigin(router, from);
  };

  const header = (
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
  );

  // Offline, Clerk never finishes loading, so `!isLoaded` alone spun forever.
  const loadError: PaywallLoadError | null =
    !isLoaded && isOffline
      ? 'offline'
      : offeringState.status === 'error'
        ? isOffline
          ? 'offline'
          : offeringState.error
        : null;

  if (loadError || !isLoaded || !userId || offeringState.status !== 'ready') {
    const copy = loadError ? paywallErrorCopy(loadError) : null;
    return (
      <View
        style={[
          styles.container,
          {
            backgroundColor: currentTheme === 'dark' ? Palette.black : Palette.white,
          },
          screenInsets,
        ]}
      >
        {header}
        {copy ? (
          <EmptyState
            title={copy.title}
            message={copy.message}
            actionLabel="Try Again"
            onActionPress={retry}
          />
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator
              size="large"
              color={currentTheme === 'dark' ? '#FFFFFF' : '#000000'}
            />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, screenInsets]}>
      {header}
      <RevenueCatUI.Paywall
        options={{
          offering: offeringState.offering,
        }}
        onRestoreCompleted={({ customerInfo }) => handleEvent('restore', customerInfo)}
        onPurchaseCompleted={({ customerInfo }) => handleEvent('purchase', customerInfo)}
        onDismiss={() => handleEvent('dismiss')}
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
