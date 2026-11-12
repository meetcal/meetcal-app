import * as Device from 'expo-device';
import NetInfo, { type NetInfoState } from '@react-native-community/netinfo';
import { isRecord } from '@/lib/is-record';

const BYTES_PER_MB = 1024 * 1024;

export type DeviceFacts = {
  deviceModel: string | null;
  deviceMemoryMb: number | null;
};

export function deviceFacts(): DeviceFacts {
  const memory = Device.totalMemory;
  return {
    deviceModel: Device.modelId ?? Device.modelName ?? null,
    deviceMemoryMb: typeof memory === 'number' && Number.isFinite(memory) ? Math.round(memory / BYTES_PER_MB) : null,
  };
}

export function networkTypeOf(state: Pick<NetInfoState, 'type' | 'isConnected' | 'details'>): string {
  if (state.isConnected === false) return 'none';
  if (state.type === 'cellular') {
    const generation = isRecord(state.details) ? state.details.cellularGeneration : null;
    if (typeof generation !== 'string') return 'cellular';
    return generation ? `cellular-${generation}` : 'cellular';
  }
  return state.type;
}

export async function currentNetworkType(): Promise<string> {
  try {
    return networkTypeOf(await NetInfo.fetch());
  } catch {
    return 'unknown';
  }
}
