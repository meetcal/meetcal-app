import { createWriteChain } from '@/lib/data/write-chain';

export interface SerialQueue {
  run<T>(task: () => Promise<T>): Promise<T>;
}

export function createSerialQueue(): SerialQueue {
  return { run: createWriteChain() };
}
