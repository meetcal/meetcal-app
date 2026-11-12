export const chunks = <T>(items: readonly T[], size: number): T[][] => {
  if (!(size >= 1)) throw new Error(`chunks: size must be at least 1, got ${size}`);
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) => items.slice(index * size, (index + 1) * size));
};

export async function mapLimited<T, R>(items: readonly T[], limit: number, run: (item: T) => Promise<R>): Promise<R[]> {
  if (!(limit >= 1)) throw new Error(`mapLimited: limit must be at least 1, got ${limit}`);
  const results: R[] = new Array(items.length);
  let next = 0;
  let failed = false;
  const worker = async () => {
    while (!failed && next < items.length) {
      const i = next++;
      try {
        results[i] = await run(items[i]);
      } catch (error) {
        failed = true;
        throw error;
      }
    }
  };
  const workers = Array.from({ length: Math.min(limit, items.length) }, worker);
  const settled = await Promise.allSettled(workers);
  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
  return results;
}

export async function mapInBatches<T, R>(items: readonly T[], size: number, run: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  for (const batch of chunks(items, size)) results.push(...(await Promise.all(batch.map(run))));
  return results;
}
