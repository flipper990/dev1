'use client';

import { useEffect, useRef } from 'react';

export interface RouteMetrics {
  lcp_ms?: number;
  inp_ms?: number;
  cls?: number;
}

interface RouteMetricsOptions {
  onMetrics: (metrics: RouteMetrics) => void;
}

export function useRouteMetrics({ onMetrics }: RouteMetricsOptions) {
  const reported = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined' || reported.current) return;

    let lcp: number | undefined;
    let inp: number | undefined;
    let cls = 0;

    const observers: PerformanceObserver[] = [];

    try {
      const lcpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const last = entries[entries.length - 1];
        if (last) lcp = Math.round(last.startTime);
      });
      lcpObserver.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(lcpObserver);
    } catch {}

    try {
      const inpObserver = new PerformanceObserver((entryList) => {
        const entries = entryList.getEntries();
        const last = entries[entries.length - 1] as PerformanceEntry & { duration?: number };
        if (last?.duration !== undefined) inp = Math.round(last.duration);
      });
      inpObserver.observe({ type: 'event', buffered: true, durationThreshold: 40 });
      observers.push(inpObserver);
    } catch {}

    try {
      const clsObserver = new PerformanceObserver((entryList) => {
        for (const entry of entryList.getEntries() as Array<PerformanceEntry & { value?: number; hadRecentInput?: boolean }>) {
          if (!entry.hadRecentInput && entry.value) {
            cls += entry.value;
          }
        }
      });
      clsObserver.observe({ type: 'layout-shift', buffered: true });
      observers.push(clsObserver);
    } catch {}

    const flush = () => {
      if (reported.current) return;
      reported.current = true;
      onMetrics({ lcp_ms: lcp, inp_ms: inp, cls: Number(cls.toFixed(4)) });
      observers.forEach((observer) => observer.disconnect());
    };

    const timeoutId = window.setTimeout(flush, 5000);
    window.addEventListener('visibilitychange', flush, { once: true });
    window.addEventListener('pagehide', flush, { once: true });

    return () => {
      window.clearTimeout(timeoutId);
      observers.forEach((observer) => observer.disconnect());
      window.removeEventListener('visibilitychange', flush);
      window.removeEventListener('pagehide', flush);
    };
  }, [onMetrics]);
}
