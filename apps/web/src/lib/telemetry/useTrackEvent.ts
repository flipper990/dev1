'use client';

import { useCallback } from 'react';
import {
  TELEMETRY_ENDPOINT,
  buildTelemetryEvent,
  sanitizeTelemetryPayload,
  type TelemetryEventName,
  type TelemetryEventPayloadMap,
} from './events';

function canTrackTelemetry(): boolean {
  return typeof window !== 'undefined' && (window.localStorage.getItem('telemetry:disable') !== '1');
}

export function useTrackEvent() {
  return useCallback(<K extends TelemetryEventName>(name: K, payload: TelemetryEventPayloadMap[K]) => {
    if (!canTrackTelemetry()) return;

    const event = buildTelemetryEvent(name, sanitizeTelemetryPayload(payload));
    const body = JSON.stringify(event);

    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      try {
        navigator.sendBeacon(TELEMETRY_ENDPOINT, body);
        return;
      } catch {
        // fallback below
      }
    }

    void fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      cache: 'no-store',
    }).catch(() => {});
  }, []);
}
