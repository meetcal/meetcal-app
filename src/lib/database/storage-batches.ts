import AsyncStorage from '@react-native-async-storage/async-storage';

export const STORAGE_REMOVE_BATCH_SIZE = 500;

export const STORAGE_READ_BATCH_SIZE = 500;

const STORAGE_WRITE_BATCH_SIZE = 500;

export async function getManyBatched(keys: readonly string[]): Promise<Map<string, string | null>> {
  const values = new Map<string, string | null>();
  for (let offset = 0; offset < keys.length; offset += STORAGE_READ_BATCH_SIZE) {
    const slice = keys.slice(offset, offset + STORAGE_READ_BATCH_SIZE);
    const entries = await AsyncStorage.getMany(slice);
    slice.forEach((key) => {
      values.set(key, entries[key] ?? null);
    });
  }
  return values;
}

export async function removeManyBatched(keys: readonly string[]): Promise<void> {
  for (let offset = 0; offset < keys.length; offset += STORAGE_REMOVE_BATCH_SIZE) {
    await AsyncStorage.removeMany(keys.slice(offset, offset + STORAGE_REMOVE_BATCH_SIZE));
  }
}

export async function setManyBatched(pairs: readonly [string, string][]): Promise<void> {
  for (let offset = 0; offset < pairs.length; offset += STORAGE_WRITE_BATCH_SIZE) {
    await AsyncStorage.setMany(
      Object.fromEntries(pairs.slice(offset, offset + STORAGE_WRITE_BATCH_SIZE)),
    );
  }
}
