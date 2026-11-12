import { useEffect, useRef } from 'react';

import { apiRequestsStarted } from '@/lib/api/meetcal-api';
import { screenTimingSender, startScreenVisit, type ScreenVisit } from '@/lib/screen-timing';

export type ScreenTimingState = {
  source: 'cache' | 'network' | null;
  failed: boolean;
};

function monotonicNow(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();
}

export function useScreenTiming(screen: string | null, { source, failed }: ScreenTimingState): void {
  const visitRef = useRef<ScreenVisit | null>(null);

  useEffect(() => {
    if (screen === null) return;
    const visit = startScreenVisit(screen, {
      now: monotonicNow,
      random: Math.random,
      requestsStarted: apiRequestsStarted,
      send: screenTimingSender(),
    });
    visitRef.current = visit;
    return () => {
      visit.finish();
      if (visitRef.current === visit) visitRef.current = null;
    };
  }, [screen]);

  useEffect(() => {
    const visit = visitRef.current;
    if (!visit || source === null) return;
    visit.content(source);
    if (source === 'network') visit.data();
  }, [source]);

  useEffect(() => {
    if (failed) visitRef.current?.failed();
  }, [failed]);
}
