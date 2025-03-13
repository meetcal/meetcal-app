import { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { isOnline } from '@/lib/database/network-status';
import { needsSync } from '@/lib/database/offline-store';
import type { MeetName } from '@/data/types/meet';
import { useTheme } from '@/contexts/ThemeContext';
import { IconSymbol } from '@/components/ui/IconSymbol';

interface SyncStatusBadgeProps {
  meetId: MeetName;
}

type SyncStatus = 'synced' | 'needs-sync' | 'offline';

export function SyncStatusBadge({ meetId }: SyncStatusBadgeProps) {
  const [status, setStatus] = useState<SyncStatus>('synced');
  const { currentTheme } = useTheme();

  useEffect(() => {
    const checkStatus = async () => {
      if (!isOnline()) {
        setStatus('offline');
        return;
      }

      const needsUpdate = await needsSync(meetId);
      setStatus(needsUpdate ? 'needs-sync' : 'synced');
    };

    checkStatus();
    const interval = setInterval(checkStatus, 60000); // Check every minute

    return () => clearInterval(interval);
  }, [meetId]);

  const statusConfig = {
    'synced': {
      backgroundColor: currentTheme === 'dark' ? '#1C3A1C' : '#DCFCE7',
      textColor: currentTheme === 'dark' ? '#4ADE80' : '#166534',
      iconColor: '#4ADE80',
      icon: 'checkmark-circle',
      text: 'Synced'
    },
    'needs-sync': {
      backgroundColor: currentTheme === 'dark' ? '#3A3A1C' : '#FEF9C3',
      textColor: currentTheme === 'dark' ? '#FACC15' : '#854D0E',
      iconColor: '#FACC15',
      icon: 'sync',
      text: 'Syncing...'
    },
    'offline': {
      backgroundColor: currentTheme === 'dark' ? '#2C2C2E' : '#F3F4F6',
      textColor: currentTheme === 'dark' ? '#8E8E93' : '#374151',
      iconColor: '#8E8E93',
      icon: 'cloud-offline',
      text: 'Offline'
    }
  };

  const config = statusConfig[status];

  return (
    <View style={[styles.container, { backgroundColor: config.backgroundColor }]}>
      <IconSymbol 
        name={config.icon} 
        size={12} 
        color={config.iconColor}
      />
      <Text style={[styles.text, { color: config.textColor }]}>
        {config.text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 9999,
    gap: 4,
  },
  text: {
    fontSize: 12,
    fontWeight: '500',
  },
}); 