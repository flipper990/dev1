'use client';

import { useCallback } from 'react';
import {
  TELEMETRY_ENDPOINT,
  TELEMETRY_ENABLED,
  buildTelemetryEvent,
  sanitizeTelemetryPayload,
  telemetryOptOutInLocalStorage,
  type TelemetryEventName,
  type TelemetryEventPayloadMap,
} from './events';
import { recordTelemetryLocally } from './localTracker';

let telemetryTransportDisabled = false;

function canTrackTelemetry(): boolean {
  if (!TELEMETRY_ENABLED) return false;
  if (telemetryTransportDisabled) return false;
  if (telemetryOptOutInLocalStorage()) return false;
  return true;
}

export function useTrackEvent() {
  return useCallback(<K extends TelemetryEventName>(name: K, payload: TelemetryEventPayloadMap[K]) => {
    const sanitizedPayload = sanitizeTelemetryPayload(payload) as TelemetryEventPayloadMap[K];
    const event = buildTelemetryEvent(name, sanitizedPayload);
    recordTelemetryLocally(event);

    if (!canTrackTelemetry()) return;

    const body = JSON.stringify(event);

    void fetch(TELEMETRY_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      keepalive: true,
      cache: 'no-store',
    }).then((response) => {
      if (!response.ok && (response.status === 404 || response.status === 405 || response.status === 501)) {
        telemetryTransportDisabled = true;
      }
    }).catch(() => {
      telemetryTransportDisabled = true;
    });
  }, []);
}
