import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { getLastSyncTime } from '@/lib/database/offline-store';
import type { MeetName } from '@/data/types/meet';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';

interface LastSyncedIndicatorProps {
  meetId: MeetName;
}

export function LastSyncedIndicator({ meetId }: LastSyncedIndicatorProps) {
  const [lastSync, setLastSync] = useState<number | null>(null);
  const { currentTheme } = useTheme();

  const colors = {
    text: currentTheme === 'dark' ? '#8E8E93' : '#6B6B6B',
  };

  useEffect(() => {
    const checkLastSync = async () => {
      const time = await getLastSyncTime(meetId);
      setLastSync(time);
    };

    checkLastSync();
    const interval = setInterval(checkLastSync, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [meetId]);

  if (!lastSync) return null;

  const getTimeAgo = (timestamp: number) => {
    const seconds = Math.floor((Date.now() - timestamp) / 1000);
    
    if (seconds < 60) return 'just now';
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
    return `${Math.floor(seconds / 86400)}d ago`;
  };

  return (
    <View style={styles.container}>
      <IconSymbol 
        name="sync" 
        size={12} 
        color={colors.text}
      />
      <Text style={[styles.text, { color: colors.text }]}>
        Last synced {getTimeAgo(lastSync)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  text: {
    fontSize: 13,
  },
}); 