import React, { useEffect, useState } from 'react';
import { Text, StyleSheet, Animated } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useSubscription } from '@/contexts/SubscriptionContext';
import { IconSymbol } from '@/components/ui/IconSymbol';
import { isNetworkAvailable } from '@/lib/networkUtils';

export function OfflineIndicator() {
  const insets = useSafeAreaInsets();
  const { isUsingStaleCache, lastSyncTimestamp } = useSubscription();
  const [isOffline, setIsOffline] = useState(false);
  const [slideAnim] = useState(new Animated.Value(-100));
  const [hasCheckedNetwork, setHasCheckedNetwork] = useState(false);
  const [minDelayPassed, setMinDelayPassed] = useState(false);

  // Check network status
  useEffect(() => {
    async function checkNetwork() {
      const hasNetwork = await isNetworkAvailable();
      setIsOffline(!hasNetwork);
      setHasCheckedNetwork(true);
    }
    checkNetwork();

    // Check periodically
    const interval = setInterval(checkNetwork, 5000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setMinDelayPassed(true), 8000);
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
          paddingTop: insets.top + 8,
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
    paddingBottom: 4,
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
