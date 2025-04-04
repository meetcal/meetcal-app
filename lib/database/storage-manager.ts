import AsyncStorage from '@react-native-async-storage/async-storage';
import { MeetName } from '@/data/types/meet';
import { clearMeetData } from './offline-store';
import * as FileSystem from 'expo-file-system';
import { Buffer } from 'buffer';
import pako from 'pako';

// Constants
const VERSION_KEY = '@storage_version';
const CURRENT_VERSION = 1;
const STORAGE_INFO_KEY = '@storage_info';
const MAX_VERSIONS_PER_MEET = 2;

interface MeetVersion {
  version: number;
  timestamp: number;
  size: number;
  compressed: boolean;
}

interface MeetStorageInfo {
  versions: MeetVersion[];
  totalSize: number;
}

interface StorageInfo {
  version: number;
  lastCleanup: number;
  meets: Record<MeetName, MeetStorageInfo | undefined>;
  totalSize: number;
}

const EMPTY_STORAGE: StorageInfo = {
  version: CURRENT_VERSION,
  lastCleanup: Date.now(),
  meets: {
    'USAW Master\'s Nationals': undefined,
    'Florida WSO Champs': undefined
  },
  totalSize: 0
};

// Initialize storage info
async function initStorageInfo(): Promise<StorageInfo> {
  try {
    const info = await AsyncStorage.getItem(STORAGE_INFO_KEY);
    if (info) {
      return JSON.parse(info);
    }
    await AsyncStorage.setItem(STORAGE_INFO_KEY, JSON.stringify(EMPTY_STORAGE));
    return EMPTY_STORAGE;
  } catch (error) {
    console.error('Error initializing storage info:', error);
    return EMPTY_STORAGE;
  }
}

// Calculate storage usage
export async function calculateStorageUsage(): Promise<{
  total: number;
  available: number;
  used: number;
}> {
  try {
    const info = await FileSystem.getInfoAsync(FileSystem.documentDirectory!);
    const storageInfo = await initStorageInfo();
    
    // Use a safe fallback for storage info
    const estimatedTotal = 1024 * 1024 * 1024; // 1GB estimate
    
    return {
      total: estimatedTotal,
      available: Math.max(0, estimatedTotal - storageInfo.totalSize),
      used: storageInfo.totalSize
    };
  } catch (error) {
    console.error('Error calculating storage usage:', error);
    return { total: 0, available: 0, used: 0 };
  }
}

// Compress data
async function compressData(data: unknown): Promise<string> {
  try {
    const jsonString = JSON.stringify(data);
    const compressed = pako.deflate(jsonString);
    return Buffer.from(compressed).toString('base64');
  } catch (error) {
    console.error('Error compressing data:', error);
    throw error;
  }
}

// Decompress data
async function decompressData(compressed: string): Promise<unknown> {
  try {
    const data = Buffer.from(compressed, 'base64');
    const decompressed = pako.inflate(data);
    const jsonString = Buffer.from(decompressed).toString();
    return JSON.parse(jsonString);
  } catch (error) {
    console.error('Error decompressing data:', error);
    throw error;
  }
}

// Clean up old data
export async function cleanupOldData(): Promise<void> {
  try {
    const storageInfo = await initStorageInfo();
    let modified = false;

    // Clean up old versions for each meet
    for (const [meet, meetInfo] of Object.entries(storageInfo.meets)) {
      if (!meetInfo) continue;

      // Sort versions by timestamp (newest first)
      meetInfo.versions.sort((a, b) => b.timestamp - a.timestamp);

      // Keep only MAX_VERSIONS_PER_MEET versions
      if (meetInfo.versions.length > MAX_VERSIONS_PER_MEET) {
        const versionsToRemove = meetInfo.versions.slice(MAX_VERSIONS_PER_MEET);
        for (const version of versionsToRemove) {
          storageInfo.totalSize -= version.size;
          meetInfo.totalSize -= version.size;
        }
        meetInfo.versions = meetInfo.versions.slice(0, MAX_VERSIONS_PER_MEET);
        modified = true;
      }
    }

    if (modified) {
      storageInfo.lastCleanup = Date.now();
      await AsyncStorage.setItem(STORAGE_INFO_KEY, JSON.stringify(storageInfo));
    }
  } catch (error) {
    console.error('Error cleaning up old data:', error);
  }
}

// Optimize cache size
export async function optimizeCacheSize(): Promise<void> {
  try {
    const storageInfo = await initStorageInfo();
    const { available } = await calculateStorageUsage();
    
    // If storage is getting low (less than 100MB), start compressing
    if (available < 100 * 1024 * 1024) {
      for (const meetInfo of Object.values(storageInfo.meets)) {
        if (!meetInfo) continue;

        // Compress uncompressed versions
        for (const version of meetInfo.versions) {
          if (!version.compressed) {
            const key = `@meet_data_${version.version}`;
            const data = await AsyncStorage.getItem(key);
            if (data) {
              const compressed = await compressData(JSON.parse(data));
              await AsyncStorage.setItem(key, compressed);
              version.compressed = true;
              version.size = compressed.length;
            }
          }
        }
      }

      await AsyncStorage.setItem(STORAGE_INFO_KEY, JSON.stringify(storageInfo));
    }
  } catch (error) {
    console.error('Error optimizing cache size:', error);
  }
}

// Keep last N meets
export async function keepLastNMeets(n: number): Promise<void> {
  try {
    const storageInfo = await initStorageInfo();
    const meets = Object.entries(storageInfo.meets) as [MeetName, NonNullable<StorageInfo['meets'][MeetName]>][];
    
    // Sort meets by last version timestamp
    meets.sort(([, a], [, b]) => {
      const lastVersionA = a.versions[0]?.timestamp || 0;
      const lastVersionB = b.versions[0]?.timestamp || 0;
      return lastVersionB - lastVersionA;
    });

    // Remove meets beyond the limit
    const meetsToRemove = meets.slice(n);
    for (const [meet] of meetsToRemove) {
      await clearMeetData(meet);
      delete storageInfo.meets[meet];
    }

    await AsyncStorage.setItem(STORAGE_INFO_KEY, JSON.stringify(storageInfo));
  } catch (error) {
    console.error('Error keeping last N meets:', error);
  }
}

// Remove old versions
export async function removeOldVersions(): Promise<void> {
  try {
    const storageInfo = await initStorageInfo();
    const oneWeek = 7 * 24 * 60 * 60 * 1000;
    let modified = false;

    for (const meetInfo of Object.values(storageInfo.meets)) {
      if (!meetInfo) continue;

      const now = Date.now();
      meetInfo.versions = meetInfo.versions.filter(version => {
        const isRecent = now - version.timestamp < oneWeek;
        if (!isRecent) {
          meetInfo.totalSize -= version.size;
          storageInfo.totalSize -= version.size;
          modified = true;
        }
        return isRecent;
      });
    }

    if (modified) {
      await AsyncStorage.setItem(STORAGE_INFO_KEY, JSON.stringify(storageInfo));
    }
  } catch (error) {
    console.error('Error removing old versions:', error);
  }
}

// Compress old data
export async function compressOldData(): Promise<void> {
  try {
    const storageInfo = await initStorageInfo();
    const oneDay = 24 * 60 * 60 * 1000;
    let modified = false;

    for (const meetInfo of Object.values(storageInfo.meets)) {
      if (!meetInfo) continue;

      const now = Date.now();
      for (const version of meetInfo.versions) {
        if (!version.compressed && now - version.timestamp > oneDay) {
          const key = `@meet_data_${version.version}`;
          const data = await AsyncStorage.getItem(key);
          if (data) {
            const compressed = await compressData(JSON.parse(data));
            await AsyncStorage.setItem(key, compressed);
            version.compressed = true;
            version.size = compressed.length;
            modified = true;
          }
        }
      }
    }

    if (modified) {
      await AsyncStorage.setItem(STORAGE_INFO_KEY, JSON.stringify(storageInfo));
    }
  } catch (error) {
    console.error('Error compressing old data:', error);
  }
} 