import { IconSymbol } from '@/components/ui/IconSymbol';
import { useSelectedMeet } from '@/contexts/SelectedMeetContext';
import { getLastSyncTime } from '@/lib/database/offline-store';
import { isNetworkAvailable, subscribeToNetworkChanges } from '@/lib/networkUtils';
import { offlineBannerText } from '@/utils/offlineBanner';
import React, { useEffect, useState } from 'react';
import { Animated, StyleSheet, Text } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * Cold start has Clerk, RevenueCat and the meets list all in flight, and
 * `isInternetReachable` is briefly null. Waiting this long before the banner
 * may appear keeps it from flashing on a perfectly healthy launch.
 */
const BANNER_MIN_DELAY_MS = 8000;

/**
 * Slides in while the device is offline, with how old the selected meet's
 * data on the device is. It used to also show online whenever the
 * subscription cache was over a week old ("Using Cached Data"), which said
 * nothing about the meet data; that staleness stays inside
 * `SubscriptionContext`.
 */
export function OfflineIndicator() {
  const insets = useSafeAreaInsets();
  const { selectedMeet } = useSelectedMeet();
  const [isOffline, setIsOffline] = useState(false);
  const [meetSyncedAt, setMeetSyncedAt] = useState<number | null>(null);
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

  // Read when the device goes offline (nothing syncs while it is) and when
  // the selected meet changes.
  useEffect(() => {
    if (!isOffline || !selectedMeet) {
      setMeetSyncedAt(null);
      return;
    }
    let cancelled = false;
    getLastSyncTime(selectedMeet)
      .then((syncedAt) => {
        if (!cancelled) setMeetSyncedAt(syncedAt);
      })
      .catch(() => {
        if (!cancelled) setMeetSyncedAt(null);
      });
    return () => {
      cancelled = true;
    };
  }, [isOffline, selectedMeet]);

  // Show/hide animation
  useEffect(() => {
    if (isOffline) {
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
  }, [isOffline, slideAnim]);

  const colors = {
    background: '#FF9500',
    text: '#FFFFFF',
  };

  if (!hasCheckedNetwork || !minDelayPassed) {
    return null;
  }

  return (
    <Animated.View
      // Never interactive: the banner sits over the top of the header, and
      // with `auto` it swallowed taps on the header buttons while visible.
      pointerEvents="none"
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
        {isOffline ? offlineBannerText(meetSyncedAt, Date.now()) : null}
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
