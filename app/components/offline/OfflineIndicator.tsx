import { useEffect, useState } from 'react';
import { isOnline, onNetworkStatusChange } from '@/lib/database/network-status';

export function OfflineIndicator() {
  const [online, setOnline] = useState(isOnline());

  useEffect(() => {
    const cleanup = onNetworkStatusChange((isConnected) => {
      setOnline(isConnected);
    });

    return cleanup;
  }, []);

  if (online) return null;

  return (
    <div className="fixed bottom-4 left-4 bg-red-500 text-white px-4 py-2 rounded-full shadow-lg flex items-center space-x-2 z-50">
      <div className="w-2 h-2 bg-white rounded-full animate-pulse" />
      <span className="text-sm font-medium">Offline</span>
    </div>
  );
} 