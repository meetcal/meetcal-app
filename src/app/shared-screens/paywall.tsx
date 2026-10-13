import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, StyleSheet, View } from 'react-native';
import { Stack, useRouter, useLocalSearchParams } from 'expo-router';
import RevenueCatUI from 'react-native-purchases-ui';
import { useSubscription } from '@/contexts/SubscriptionContext';
import * as Purchases from 'react-native-purchases';
import { useUser } from '@clerk/expo';
import { useScreenHorizontalInsets } from '@/hooks/useScreenInsets';
import { useIsOffline } from '@/hooks/useIsOffline';
import { isInternalRoutePath } from '@/utils/authGuard';
import { DEFAULT_ORIGIN, returnToOrigin } from '@/utils/returnToOrigin';
import { EmptyState } from '@/components/ui/EmptyState';
import { FallbackHeader } from '@/components/ui/FallbackHeader';
import { useAppColors } from '@/hooks/useAppColors';
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

/**
 * Set as `title`, not `headerTitle`: inline, the gated screen's own
 * `title` must replace it once a purchase lets that screen render, and
 * expo-router never resets options a `Stack.Screen` set.
 */
const PAYWALL_TITLE = 'Premium Features';

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
  const colors = useAppColors();
  const params = useLocalSearchParams<{ from?: string; feature?: string }>();
  const from = fromProp ?? params.from;
  const feature = featureProp ?? params.feature;
  const { user, isLoaded } = useUser();
  const userId = user?.id ?? null;
  const [isOffline] = useIsOffline();
  const { recheckSubscription } = useSubscription();
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
          // Inline, sign-in returns to the gated screen, whose gate shows
          // this paywall again. A premium feature name (the estimator's,
          // athlete results') would also queue a routed paywall on top
          // (`lib/premium-intent.ts`), so the gate's sign-in carries none.
          feature: inline ? 'subscription' : feature || 'subscription',
        },
      });
    }
  }, [isLoaded, userId, router, from, feature, inline]);

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

  const retry = useCallback(() => {
    // Offerings wait for Clerk, which cannot load offline: say so rather
    // than leave the button looking dead.
    if (!isLoaded) {
      showToast({ type: 'info', message: paywallErrorCopy('offline').message });
      return;
    }
    setLoadAttempt((attempt) => attempt + 1);
  }, [isLoaded]);

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
    if (exit === 'stay') {
      // The gate swaps to the screen when the provider publishes the
      // entitlement. RevenueCat's listener only fires when CustomerInfo
      // changes, and the gate's "denied" may have come from the cache, so
      // ask again rather than leave a paying user on the paywall.
      recheckSubscription();
      return;
    }

    if (inline) {
      // `from` is the gated screen itself, so dismissing to it would be a
      // no-op: leave the gated screen instead.
      if (router.canGoBack()) router.back();
      else router.replace(DEFAULT_ORIGIN);
      return;
    }
    returnToOrigin(router, from);
  };

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
          { backgroundColor: colors.background },
          screenInsets,
        ]}
      >
        {/* Loading and failing, the paywall has nothing to close it with:
            a header gives it a Back button, pushed or inline. */}
        <FallbackHeader title={PAYWALL_TITLE} />
        {copy ? (
          <EmptyState
            title={copy.title}
            message={copy.message}
            actionLabel="Try Again"
            onActionPress={retry}
          />
        ) : (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={colors.text} />
          </View>
        )}
      </View>
    );
  }

  return (
    <View style={[styles.container, screenInsets]}>
      {/* RevenueCat's paywall is laid out full screen, as before; its close
          control comes from the paywall's design. The loading header's
          options persist until replaced, so hide it explicitly. */}
      <Stack.Screen options={{ headerShown: false }} />
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
