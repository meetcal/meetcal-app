import { useState } from 'react';
import { ManualSyncButton } from './ManualSyncButton';
import { LastSyncedIndicator } from './LastSyncedIndicator';
import { SyncStatusBadge } from './SyncStatusBadge';
import type { MeetName } from '@/data/types/meet';

interface SyncSettingsPanelProps {
  meetId: MeetName;
  onClose?: () => void;
}

export function SyncSettingsPanel({ meetId, onClose }: SyncSettingsPanelProps) {
  const [isOpen, setIsOpen] = useState(true);

  const handleClose = () => {
    setIsOpen(false);
    onClose?.();
  };

  return (
    <div className={`
      fixed inset-y-0 right-0 w-96 bg-white shadow-lg transform transition-transform duration-300
      ${isOpen ? 'translate-x-0' : 'translate-x-full'}
    `}>
      <div className="p-6 h-full flex flex-col">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold">Sync Settings</h2>
          <button
            onClick={handleClose}
            className="text-gray-400 hover:text-gray-500"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="space-y-6">
          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Current Status</h3>
            <SyncStatusBadge meetId={meetId} />
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Last Sync</h3>
            <LastSyncedIndicator meetId={meetId} />
          </div>

          <div>
            <h3 className="text-sm font-medium text-gray-700 mb-2">Manual Sync</h3>
            <ManualSyncButton meetId={meetId} />
          </div>

          <div className="border-t pt-6">
            <h3 className="text-sm font-medium text-gray-700 mb-4">Auto-Sync Settings</h3>
            <div className="space-y-4">
              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
                  defaultChecked
                />
                <span className="text-sm text-gray-700">Enable background sync</span>
              </label>

              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
                  defaultChecked
                />
                <span className="text-sm text-gray-700">Sync on app start</span>
              </label>

              <label className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  className="h-4 w-4 text-blue-500 rounded border-gray-300 focus:ring-blue-500"
                  defaultChecked
                />
                <span className="text-sm text-gray-700">Sync when online</span>
              </label>
            </div>
          </div>
        </div>

        <div className="mt-auto pt-6 border-t">
          <p className="text-xs text-gray-500">
            Changes are automatically saved when you modify settings.
            Last sync status is updated every minute.
          </p>
        </div>
      </div>
    </div>
  );
} 