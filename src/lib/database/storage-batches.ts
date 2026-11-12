import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_REMOVE_BATCH_SIZE = 500;

export const STORAGE_READ_BATCH_SIZE = 500;

const STORAGE_WRITE_BATCH_SIZE = 500;

export async function multiGetBatched(keys: readonly string[]): Promise<Map<string, string | null>> {
  const values = new Map<string, string | null>();
  for (let offset = 0; offset < keys.length; offset += STORAGE_READ_BATCH_SIZE) {
    const slice = keys.slice(offset, offset + STORAGE_READ_BATCH_SIZE);
    const entries = await AsyncStorage.multiGet(slice);
    slice.forEach((key, index) => {
      values.set(key, entries[index]?.[1] ?? null);
    });
  }
  return values;
}

export async function multiRemoveBatched(keys: readonly string[]): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
    await AsyncStorage.multiRemove(keys.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
  }
}

export async function multiSetBatched(pairs: readonly [string, string][]): Promise<void> {
  for (let offset = 0; offset < pairs.length; offset += STORAGE_WRITE_BATCH_SIZE) {
    await AsyncStorage.multiSet(pairs.slice(offset, offset + STORAGE_WRITE_BATCH_SIZE));
  }
}
