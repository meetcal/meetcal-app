import { useState } from 'react';
import { isOnline } from '@/lib/database/network-status';
import { SyncManager } from '@/lib/database/sync-manager';
import type { MeetName } from '@/data/types/meet';

interface ManualSyncButtonProps {
  meetId: MeetName;
  onSyncComplete?: () => void;
}

export function ManualSyncButton({ meetId, onSyncComplete }: ManualSyncButtonProps) {
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSync = async () => {
    if (!isOnline()) {
      setError('Cannot sync while offline');
      return;
    }

    try {
      setIsSyncing(true);
      setError(null);
      const syncManager = new SyncManager(meetId);
      await syncManager.forceSync();
      onSyncComplete?.();
    } catch (err) {
      setError('Failed to sync. Please try again.');
      console.error('Sync error:', err);
    } finally {
      setIsSyncing(false);
    }
  };

  return (
    <div className="space-y-2">
      <button
        onClick={handleSync}
        disabled={isSyncing || !isOnline()}
        className={`
          inline-flex items-center space-x-2 px-4 py-2 rounded-md text-sm font-medium
          ${isSyncing || !isOnline() 
            ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
            : 'bg-blue-500 text-white hover:bg-blue-600 active:bg-blue-700'
          }
          transition-colors duration-150
        `}
      >
        <svg 
          className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`}
          fill="none" 
          stroke="currentColor" 
          viewBox="0 0 24 24"
        >
          <path 
            strokeLinecap="round" 
            strokeLinejoin="round" 
            strokeWidth={2} 
            d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
          />
        </svg>
        <span>{isSyncing ? 'Syncing...' : 'Sync Now'}</span>
      </button>
      
      {error && (
        <p className="text-sm text-red-500">{error}</p>
      )}
    </div>
  );
} 