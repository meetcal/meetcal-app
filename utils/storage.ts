import { MMKV } from 'react-native-mmkv';

export const storage = new MMKV();

export const StorageKeys = {
  HAS_SEEN_SUBSCRIPTION: 'hasSeenSubscription',
} as const; 