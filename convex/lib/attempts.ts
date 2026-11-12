export type AttemptCounts = { taken: number; made: number };

export function attemptCounts(attempts: readonly number[]): AttemptCounts {
  let taken = 0;
  let made = 0;
  for (const attempt of attempts) {
    if (attempt === 0 || !Number.isFinite(attempt)) continue;
    taken += 1;
    if (attempt > 0) made += 1;
  }
  return { taken, made };
}
