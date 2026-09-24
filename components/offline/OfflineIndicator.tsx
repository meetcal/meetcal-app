import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils';
import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Cold start has Clerk, RevenueCat and the meets list all in flight, and
 * `isInternetReachable` is briefly null. Waiting this long before the banner
 * may appear keeps it from flashing on a perfectly healthy launch.
 */
const BANNER_MIN_DELAY_MS = 8000;

export function OfflineIndicator() {
  const insets = useSafeAreaInsets();
  const { isUsingStaleCache, lastSyncTimestamp } = useSubscription();
  const [isOffline, setIsOffline] = useState(false);
  const [slideAnim] = useState(new Animated.Value(-100));
  const [hasCheckedNetwork, setHasCheckedNetwork] = useState(false);
  const [minDelayPassed, setMinDelayPassed] = useState(false);

  // One probe for the initial answer, then NetInfo's own change events. This
  // banner is mounted for the life of the app and used to re-probe
  // reachability on a 5-second interval the whole time; the listener is what
  // `useIsOffline` and the providers already use. As there, a change event
  // that lands before the probe resolves is the newer answer and wins.
  useEffect(() => {
    let mounted = true;
    let receivedNetworkEvent = false;

    isNetworkAvailable()
      .then((hasNetwork) => {
        if (!mounted) return;
        if (!receivedNetworkEvent) setIsOffline(!hasNetwork);
        setHasCheckedNetwork(true);
      })
      .catch(() => {
        if (!mounted) return;
        if (!receivedNetworkEvent) setIsOffline(false);
        setHasCheckedNetwork(true);
      });

    const unsubscribe = subscribeToNetworkChanges((isConnected) => {
      receivedNetworkEvent = true;
      if (!mounted) return;
      setIsOffline(!isConnected);
      setHasCheckedNetwork(true);
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setMinDelayPassed(true), BANNER_MIN_DELAY_MS);
    return () => clearTimeout(timer);
  }, []);

  // Show/hide animation
  useEffect(() => {
    if (isOffline || isUsingStaleCache) {
      // Slide in
      Animated.spring(slideAnim, {
        toValue: 0,
        useNativeDriver: true,
        tension: 65,
        friction: 11,
      }).start();
    } else {
      // Slide out
      Animated.timing(slideAnim, {
        toValue: -100,
        duration: 300,
        useNativeDriver: true,
      }).start();
    }
  }, [isOffline, isUsingStaleCache, slideAnim]);

  const colors = {
    background: '#FF9500',
    text: '#FFFFFF',
  };

  const getTimeSinceSync = () => {
    if (!lastSyncTimestamp) return 'unknown';

    const now = Date.now();
    const diff = now - lastSyncTimestamp;
    const days = Math.floor(diff / (24 * 60 * 60 * 1000));
    const hours = Math.floor((diff % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));

    if (days > 0) {
      return `${days}d ago`;
    } else if (hours > 0) {
      return `${hours}h ago`;
    } else {
      return 'recently';
    }
  };

  if (!hasCheckedNetwork || !minDelayPassed) {
    return null;
  }

  return (
    <Animated.View
      pointerEvents={isOffline || isUsingStaleCache ? 'auto' : 'none'}
      style={[
        styles.container,
        {
          backgroundColor: colors.background,
          transform: [{ translateY: slideAnim }],
          paddingTop: insets.top - 10,
          left: insets.left,
          right: insets.right,
        },
      ]}
    >
      <IconSymbol name="wifi.slash" size={16} color={colors.text} />
      <Text style={[styles.text, { color: colors.text }]}>
        {isOffline ? 'Offline Mode' : 'Using Cached Data'}
        {isUsingStaleCache && lastSyncTimestamp && ` • Last synced ${getTimeSinceSync()}`}
      </Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    paddingBottom: 2,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    zIndex: 1000,
    elevation: 1000,
  },
  text: {
    fontSize: 13,
    fontWeight: '600',
  },
});
