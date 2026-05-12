import type { TelemetryEvent } from './events';

const MAX_LOCAL_TELEMETRY_EVENTS = 200;
const localTelemetryBuffer: TelemetryEvent[] = [];

export function recordTelemetryLocally(event: TelemetryEvent): void {
  localTelemetryBuffer.push(event);
  if (localTelemetryBuffer.length > MAX_LOCAL_TELEMETRY_EVENTS) {
    localTelemetryBuffer.splice(0, localTelemetryBuffer.length - MAX_LOCAL_TELEMETRY_EVENTS);
  }
}

export function readLocalTelemetryEvents(): TelemetryEvent[] {
  return [...localTelemetryBuffer];
}

